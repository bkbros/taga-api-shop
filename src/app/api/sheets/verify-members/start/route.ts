import { NextResponse } from "next/server";
import { google } from "googleapis";
import { loadParams } from "@/lib/ssm";

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

    // 2. Cafe24 토큰 로드
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    const verificationResults: VerificationResult[] = [];

    // 3. 각 회원 검증 (순차 처리로 안정성 확보)
    for (const member of members) {
      try {
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
              console.log(`${member.name}(${cleanPhone}) 검색 결과:`, data.customers?.length || 0, '건');
              if (data.customers && data.customers.length > 0) {
                customer = data.customers[0];
                console.log(`${member.name} 회원 발견: ${customer.member_id}`);
              }
            } else {
              console.log(`${member.name}(${cleanPhone}) API 응답 실패: ${response.status}`);
            }
          } catch (error) {
            console.log(`cellphone 검색 실패: ${error}`);
          }
        }

        if (customer) {
          // 가입 회원 - 구매건수 조회 (최근 3개월)
          let totalOrders = 0;
          try {
            const memberId = customer.member_id;
            if (memberId) {
              // 최근 3개월 범위 계산
              const now = new Date();
              const threeMonthsAgo = new Date();
              threeMonthsAgo.setMonth(now.getMonth() - 3);

              const startDate = threeMonthsAgo.toISOString().split('T')[0] + ' 00:00:00';
              const endDate = now.toISOString().split('T')[0] + ' 23:59:59';

              const ordersParams = new URLSearchParams({
                member_id: memberId,
                start_date: startDate,
                end_date: endDate,
                order_status: 'N40,N50'
              });

              const ordersResponse = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count?${ordersParams}`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${access_token}`,
                  'Content-Type': 'application/json',
                  'X-Cafe24-Api-Version': '2025-06-01'
                }
              });

              if (ordersResponse.ok) {
                const ordersData = await ordersResponse.json();
                totalOrders = ordersData.count || 0;
                console.log(`${member.name} 구매건수: ${totalOrders}건`);
              }
            }
          } catch (error) {
            console.log(`${member.name} 구매건수 조회 실패:`, error);
          }

          verificationResults.push({
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: true,
            memberId: customer.member_id,
            memberGrade: customer.group_no || 1,
            joinDate: customer.created_date,
            totalOrders: totalOrders
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

        // API 호출 간격 (Rate Limit 방지 - 구매건수 조회 추가로 늘림)
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (error) {
        console.error(`${member.name} 처리 실패:`, error);
        verificationResults.push({
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: false,
          error: error instanceof Error ? error.message : "처리 중 오류 발생"
        });
      }
    }

    // 4. 스프레드시트에 결과 쓰기
    console.log("스프레드시트에 결과 쓰기 중");

    // 결과를 원래 행 순서로 정렬
    const sortedResults = verificationResults.sort((a, b) => a.rowIndex - b.rowIndex);

    const writeData = sortedResults.map(result => {
      // 날짜 형식 정리 (ISO -> YYYY-MM-DD)
      let cleanJoinDate = "";
      if (result.joinDate) {
        try {
          cleanJoinDate = result.joinDate.split('T')[0];
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

    // 5. 결과 반환
    const summary = {
      total: verificationResults.length,
      registered: verificationResults.filter(r => r.isRegistered).length,
      unregistered: verificationResults.filter(r => !r.isRegistered).length,
      errors: verificationResults.filter(r => r.error).length
    };

    console.log("모든 작업 완료:", summary);

    return NextResponse.json({
      success: true,
      message: `${members.length}명 검증 완료`,
      statistics: summary
    });

  } catch (error) {
    console.error("작업 실패:", error);
    return NextResponse.json(
      { error: "작업에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}