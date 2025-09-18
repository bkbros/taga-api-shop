import { NextResponse } from "next/server";
import { google } from "googleapis";
import { loadParams } from "@/lib/ssm";
import { jobStore, generateJobId } from "@/lib/job-store";

// Google Auth 타입 정의
type GoogleCredentials = {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
};

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
  totalOrders?: number;
  error?: string;
}

export async function POST(req: Request) {
  try {
    const { spreadsheetId, sheetName, useEnvCredentials, serviceAccountKey } = await req.json();

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }

    // Google Sheets 인증 설정
    let credentials: GoogleCredentials;
    if (useEnvCredentials) {
      const googleCredJson = process.env.GOOGLE_CRED_JSON;
      if (!googleCredJson) {
        return NextResponse.json({ error: "환경변수에 GOOGLE_CRED_JSON이 설정되지 않았습니다" }, { status: 500 });
      }
      credentials = JSON.parse(Buffer.from(googleCredJson, 'base64').toString('utf-8')) as GoogleCredentials;
    } else {
      if (!serviceAccountKey) {
        return NextResponse.json({ error: "serviceAccountKey가 필요합니다" }, { status: 400 });
      }
      credentials = JSON.parse(serviceAccountKey) as GoogleCredentials;
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
  credentials: GoogleCredentials
) {
  console.log(`[JOB ${jobId}] 백그라운드 처리 시작: ${members.length}명`);

  try {
    // Cafe24 토큰 로드
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    const verificationResults: VerificationResult[] = [];

    // 배치 처리 (10명씩 - 속도 향상)
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < members.length; i += batchSize) {
      batches.push(members.slice(i, i + batchSize));
    }

    jobStore.updateProgress(jobId, 0, `총 ${batches.length}개 배치로 나누어 처리 시작`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[JOB ${jobId}] 배치 ${batchIndex + 1}/${batches.length} 처리 시작 (${batch.length}명)`);

      // 배치 내 회원들을 병렬 처리
      const batchPromises = batch.map(async (member) => {
        try {
          // 각 회원 검증 로직
          let customer = null;

          // cellphone으로 검색
          const cleanPhone = member.phone.replace(/\D/g, "");
          if (cleanPhone) {
            try {
              const searchParams = new URLSearchParams({
                cellphone: cleanPhone,
                limit: '1'
              });

              const response = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/customers?${searchParams}`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${access_token}`,
                  'Content-Type': 'application/json',
                  'X-Cafe24-Api-Version': '2025-06-01'
                }
              });

              if (response.ok) {
                const data = await response.json();
                console.log(`[JOB ${jobId}] ${member.name}(${cleanPhone}) 검색 결과:`, data.customers?.length || 0, '건');
                if (data.customers && data.customers.length > 0) {
                  customer = data.customers[0];
                  console.log(`[JOB ${jobId}] ${member.name} 회원 발견: ${customer.member_id}`);
                }
              } else {
                console.log(`[JOB ${jobId}] ${member.name}(${cleanPhone}) API 응답 실패: ${response.status}`);
              }
            } catch (error) {
              console.log(`[JOB ${jobId}] cellphone 검색 실패: ${error}`);
            }
          }

          if (customer) {
            // 속도 향상을 위해 구매건수 조회 생략 (필요시 별도 구현)
            const totalOrders = 0; // 임시로 0으로 설정

            // 가입 회원
            return {
              rowIndex: member.rowIndex,
              name: member.name,
              phone: member.phone,
              isRegistered: true,
              memberId: customer.member_id,
              memberGrade: customer.group_no || 1,
              joinDate: customer.created_date,
              totalOrders: totalOrders
            };
          } else {
            // 미가입 회원
            return {
              rowIndex: member.rowIndex,
              name: member.name,
              phone: member.phone,
              isRegistered: false
            };
          }

        } catch (error) {
          console.error(`[JOB ${jobId}] ${member.name} 처리 실패:`, error);
          return {
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: false,
            error: error instanceof Error ? error.message : "처리 중 오류 발생"
          };
        }
      });

      // 배치 내 모든 회원을 동시에 처리하고 결과 대기
      const batchResults = await Promise.all(batchPromises);
      verificationResults.push(...batchResults);

      // 진행률 업데이트
      const processed = Math.min((batchIndex + 1) * batchSize, members.length);
      jobStore.updateProgress(jobId, processed, `배치 ${batchIndex + 1} 완료 (${batchResults.length}명 처리)`);

      // 배치 간 휴식 (단축)
      if (batchIndex < batches.length - 1) {
        jobStore.updateProgress(jobId, (batchIndex + 1) * batchSize, `배치 ${batchIndex + 1} 완료`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 스프레드시트에 결과 쓰기
    jobStore.updateProgress(jobId, members.length, "스프레드시트에 결과 쓰기 중");

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // 병렬 처리로 뒤섞인 결과를 원래 행 순서로 정렬
    const sortedResults = verificationResults.sort((a, b) => a.rowIndex - b.rowIndex);

    const writeData = sortedResults.map(result => {
      // 날짜 형식 정리 (ISO -> YYYY-MM-DD)
      let cleanJoinDate = "";
      if (result.joinDate) {
        try {
          cleanJoinDate = result.joinDate.split('T')[0]; // 2025-09-01T05:00:44+09:00 -> 2025-09-01
        } catch {
          cleanJoinDate = result.joinDate;
        }
      }

      return [
        result.memberId || "",
        result.isRegistered ? "가입" : "미가입",
        result.memberGrade || "",
        cleanJoinDate,
        result.totalOrders || ""
      ];
    });

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