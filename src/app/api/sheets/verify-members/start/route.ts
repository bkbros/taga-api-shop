import { NextResponse } from "next/server";
import { google } from "googleapis";
import { loadParams } from "@/lib/ssm";
import { jobStore, generateJobId } from "@/lib/job-store";

// 기본 타입들
interface SheetMember {
  name: string;
  phone: string;
  rowIndex: number;
}

interface VerificationResult {
  rowIndex: number;
  name: string;
  phone: string;
  isRegistered: boolean;
  memberId?: string;
  memberGrade?: number;
  joinDate?: string;
  totalPurchaseAmount?: number;
  error?: string;
}

export async function POST(req: Request) {
  try {
    const { spreadsheetId, sheetName, useEnvCredentials, serviceAccountKey } = await req.json();

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }

    // Google Sheets 인증 설정
    let credentials;
    if (useEnvCredentials) {
      const googleCredJson = process.env.GOOGLE_CRED_JSON;
      if (!googleCredJson) {
        return NextResponse.json({ error: "환경변수에 GOOGLE_CRED_JSON이 설정되지 않았습니다" }, { status: 500 });
      }
      credentials = JSON.parse(Buffer.from(googleCredJson, 'base64').toString('utf-8'));
    } else {
      if (!serviceAccountKey) {
        return NextResponse.json({ error: "serviceAccountKey가 필요합니다" }, { status: 400 });
      }
      credentials = JSON.parse(serviceAccountKey);
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // 1. 스프레드시트에서 회원 데이터 읽기
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!I:J`,
    });

    const rows = sourceResponse.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json({ error: "스프레드시트에 데이터가 없습니다" }, { status: 400 });
    }

    // 회원 데이터 파싱
    const members: SheetMember[] = rows.slice(1).map((row, index) => ({
      name: (row[0] || "").toString().trim(),
      phone: (row[1] || "").toString().trim(),
      rowIndex: index + 2
    })).filter(member => member.name && member.phone);

    console.log(`파싱된 회원 수: ${members.length}`);

    // Job 생성
    const jobId = generateJobId();
    jobStore.createJob(jobId, members.length, "회원 검증 작업 시작");

    // 백그라운드에서 비동기 처리 시작
    processMembers(jobId, members, spreadsheetId, sheetName, credentials)
      .catch(error => {
        console.error(`[JOB ${jobId}] 백그라운드 작업 실패:`, error);
        jobStore.failJob(jobId, error.message || "알 수 없는 오류");
      });

    // 즉시 응답 (작업 ID 반환)
    return NextResponse.json({
      success: true,
      jobId,
      message: `${members.length}명의 회원 검증 작업이 시작되었습니다`,
      totalMembers: members.length
    });

  } catch (error) {
    console.error("작업 시작 실패:", error);
    return NextResponse.json(
      { error: "작업 시작에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// 백그라운드 처리 함수
async function processMembers(
  jobId: string,
  members: SheetMember[],
  spreadsheetId: string,
  sheetName: string,
  credentials: unknown
) {
  console.log(`[JOB ${jobId}] 백그라운드 처리 시작: ${members.length}명`);

  try {
    // Cafe24 토큰 로드
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    const verificationResults: VerificationResult[] = [];

    // 배치 처리 (5명씩 - 더 작은 배치로 안정성 향상)
    const batchSize = 5;
    const batches = [];
    for (let i = 0; i < members.length; i += batchSize) {
      batches.push(members.slice(i, i + batchSize));
    }

    jobStore.updateProgress(jobId, 0, `총 ${batches.length}개 배치로 나누어 처리 시작`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[JOB ${jobId}] 배치 ${batchIndex + 1}/${batches.length} 처리 시작 (${batch.length}명)`);

      for (const member of batch) {
        try {
          // 각 회원 검증 로직 (기존과 동일)
          let customer = null;

          // cellphone으로 검색
          const cleanPhone = member.phone.replace(/\D/g, "");
          if (cleanPhone) {
            try {
              const response = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${access_token}`,
                  'Content-Type': 'application/json',
                  'X-Cafe24-Api-Version': '2025-06-01'
                },
                // URLSearchParams로 쿼리 구성
              });

              if (response.ok) {
                const data = await response.json();
                if (data.customers && data.customers.length > 0) {
                  customer = data.customers[0];
                }
              }
            } catch (error) {
              console.log(`[JOB ${jobId}] cellphone 검색 실패: ${error}`);
            }
          }

          if (customer) {
            // 가입 회원
            verificationResults.push({
              rowIndex: member.rowIndex,
              name: member.name,
              phone: member.phone,
              isRegistered: true,
              memberId: customer.member_id,
              memberGrade: customer.group_no || 1,
              joinDate: customer.created_date,
              totalPurchaseAmount: 0 // 간단화를 위해 0으로 설정
            });
          } else {
            // 미가입 회원
            verificationResults.push({
              rowIndex: member.rowIndex,
              name: member.name,
              phone: member.phone,
              isRegistered: false
            });
          }

          // 진행률 업데이트
          const processed = (batchIndex * batchSize) + verificationResults.length % batchSize || batchSize;
          jobStore.updateProgress(jobId, Math.min(processed, members.length), `${member.name} 검증 완료`);

          // API 호출 간격
          await new Promise(resolve => setTimeout(resolve, 300));

        } catch (error) {
          console.error(`[JOB ${jobId}] ${member.name} 처리 실패:`, error);
          verificationResults.push({
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: false,
            error: error instanceof Error ? error.message : "처리 중 오류 발생"
          });
        }
      }

      // 배치 간 휴식
      if (batchIndex < batches.length - 1) {
        jobStore.updateProgress(jobId, (batchIndex + 1) * batchSize, `배치 ${batchIndex + 1} 완료, 잠시 휴식`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // 스프레드시트에 결과 쓰기
    jobStore.updateProgress(jobId, members.length, "스프레드시트에 결과 쓰기 중");

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const writeData = verificationResults.map(result => [
      result.memberId || "",
      result.isRegistered ? "가입" : "미가입",
      result.memberGrade || "",
      result.joinDate || "",
      result.totalPurchaseAmount || ""
    ]);

    const writeRange = `${sheetName}!AC2:AG${writeData.length + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: writeData }
    });

    // 작업 완료
    const summary = {
      total: verificationResults.length,
      registered: verificationResults.filter(r => r.isRegistered).length,
      unregistered: verificationResults.filter(r => !r.isRegistered).length,
      errors: verificationResults.filter(r => r.error).length
    };

    jobStore.completeJob(jobId, summary);
    console.log(`[JOB ${jobId}] 모든 작업 완료:`, summary);

  } catch (error) {
    console.error(`[JOB ${jobId}] 전체 작업 실패:`, error);
    jobStore.failJob(jobId, error instanceof Error ? error.message : "알 수 없는 오류");
  }
}