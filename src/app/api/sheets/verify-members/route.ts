import { NextResponse } from "next/server";
import { google } from "googleapis";
import { loadParams } from "@/lib/ssm";
import axios from "axios";

type SheetMember = {
  name: string;
  phone: string;
  rowIndex: number; // 행 번호 추적용
};

type VerificationResult = {
  rowIndex: number;
  name: string;
  phone: string;
  isRegistered: boolean;
  cafe24Data?: {
    userId?: string;
    userName?: string;
    memberGrade: number;
    joinDate?: string;
    totalOrders: number;
  };
  error?: string;
};

export async function POST(req: Request) {
  let sheetName = "Smore-5pURyYjo8l-HRG"; // 기본값을 미리 설정

  try {
    const body = await req.json();
    console.log("API 요청 받음:", body);

    const {
      spreadsheetId,
      sheetName: requestSheetName = "Smore-5pURyYjo8l-HRG",
      serviceAccountKey,
      useEnvCredentials = false
    } = body;

    sheetName = requestSheetName; // 요청된 값으로 업데이트

    console.log("파싱된 파라미터:", {
      spreadsheetId,
      sheetName,
      useEnvCredentials,
      hasServiceAccountKey: !!serviceAccountKey
    });

    if (!spreadsheetId) {
      console.log("에러: spreadsheetId 누락");
      return NextResponse.json({
        error: "spreadsheetId가 필요합니다"
      }, { status: 400 });
    }

    let credentials;
    if (useEnvCredentials) {
      console.log("환경변수 인증 사용");
      // 환경변수에서 Google 인증 정보 가져오기
      const googleCredJson = process.env.GOOGLE_CRED_JSON;
      if (!googleCredJson) {
        console.log("에러: GOOGLE_CRED_JSON 환경변수 누락");
        return NextResponse.json({
          error: "환경변수에 GOOGLE_CRED_JSON이 설정되지 않았습니다"
        }, { status: 500 });
      }

      try {
        credentials = JSON.parse(Buffer.from(googleCredJson, 'base64').toString('utf-8'));
        console.log("환경변수 인증 정보 파싱 성공");
      } catch {
        console.log("에러: 환경변수 인증 정보 파싱 실패");
        return NextResponse.json({
          error: "환경변수의 Google 인증 정보를 파싱할 수 없습니다"
        }, { status: 500 });
      }
    } else {
      console.log("수동 키 인증 사용");
      if (!serviceAccountKey) {
        console.log("에러: serviceAccountKey 누락");
        return NextResponse.json({
          error: "serviceAccountKey가 필요합니다"
        }, { status: 400 });
      }

      try {
        credentials = JSON.parse(serviceAccountKey);
        console.log("수동 키 파싱 성공");
      } catch {
        console.log("에러: 수동 키 파싱 실패");
        return NextResponse.json({
          error: "serviceAccountKey 형식이 올바르지 않습니다"
        }, { status: 400 });
      }
    }

    // Google Sheets API 인증
    console.log("Google Sheets API 인증 시작");
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    console.log("Google Sheets 클라이언트 생성 완료");

    // 1. 스프레드시트에서 I, J열 (이름, 연락처) 읽기
    console.log(`스프레드시트 데이터 읽기 시작: ${sheetName}!I:J`);
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!I:J`, // I: 이름, J: 연락처
    });
    console.log("스프레드시트 데이터 읽기 성공");

    const rows = sourceResponse.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json({
        error: "스프레드시트에 데이터가 없습니다"
      }, { status: 400 });
    }

    // 헤더 제외하고 회원 데이터 파싱 (행 번호도 추적)
    const members: SheetMember[] = rows.slice(1).map((row, index) => ({
      name: (row[0] || "").toString().trim(),
      phone: (row[1] || "").toString().trim(),
      rowIndex: index + 2, // 헤더 제외하고 실제 행 번호 (1-based + 헤더 1행)
    })).filter(member => member.name && member.phone); // 이름과 연락처가 모두 있는 것만

    console.log(`파싱된 회원 수: ${members.length}`);
    console.log("첫 3개 회원:", members.slice(0, 3));

    // 처리할 회원 수 제한 (단계적 증가: 10명)
    const limitedMembers = members.slice(0, 10);
    console.log(`실제 처리할 회원 수: ${limitedMembers.length}명 (제한 적용)`);

    // 2. Cafe24 API로 각 회원 정보 검증
    console.log("Cafe24 API 토큰 로드 시작");
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    console.log(`Cafe24 토큰 로드 완료, Mall ID: ${mallId}`);

    const verificationResults: VerificationResult[] = [];

    for (const member of limitedMembers) {
      console.log(`회원 검증 시작: ${member.name} (${member.phone})`);
      try {
        // Cafe24에서 회원 정보 조회 - 다양한 방법으로 검색
        let customer = null;

        // 1. cellphone으로 검색 (하이픈 제거한 숫자만)
        const cleanPhone = member.phone.replace(/\D/g, "");
        if (cleanPhone) {
          console.log(`cellphone으로 검색: ${cleanPhone}`);
          try {
            const cellphoneRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
              params: {
                cellphone: cleanPhone,
                limit: 10,
                embed: "group"
              },
              headers: { Authorization: `Bearer ${access_token}` },
              timeout: 5000,
            });
            console.log(`cellphone 검색 결과: ${cellphoneRes.data.customers?.length || 0}건`);

            if (cellphoneRes.data.customers && cellphoneRes.data.customers.length > 0) {
              customer = cellphoneRes.data.customers[0];
            }
          } catch (error) {
            console.log(`cellphone 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // 2. phone으로 검색 (원본 형태)
        if (!customer && member.phone) {
          console.log(`phone으로 검색: ${member.phone}`);
          try {
            const phoneSearchRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
              params: {
                phone: member.phone,
                limit: 10,
                embed: "group"
              },
              headers: { Authorization: `Bearer ${access_token}` },
              timeout: 5000,
            });
            console.log(`phone 검색 결과: ${phoneSearchRes.data.customers?.length || 0}건`);

            if (phoneSearchRes.data.customers && phoneSearchRes.data.customers.length > 0) {
              customer = phoneSearchRes.data.customers[0];
            }
          } catch (error) {
            console.log(`phone 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // 3. 이름으로 검색
        if (!customer && member.name) {
          console.log(`이름으로 검색: ${member.name}`);
          try {
            const nameSearchRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
              params: {
                user_name: member.name,
                limit: 10,
                embed: "group"
              },
              headers: { Authorization: `Bearer ${access_token}` },
              timeout: 5000,
            });
            console.log(`이름 검색 결과: ${nameSearchRes.data.customers?.length || 0}건`);

            if (nameSearchRes.data.customers && nameSearchRes.data.customers.length > 0) {
              customer = nameSearchRes.data.customers[0];
            }
          } catch (error) {
            console.log(`이름 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (!customer) {
          // 미가입 회원
          verificationResults.push({
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: false,
          });
          continue;
        }

        // 주문 건수 조회 재시도 (간단한 파라미터로)
        let totalOrders = 0;

        try {
          console.log(`주문 건수 조회 시작: ${customer.member_id}`);

          // 간단한 주문 조회 (최소 파라미터만)
          const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
            params: {
              member_id: customer.member_id, // 원본 member_id 사용
              limit: 100 // 최근 100건만
            },
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: 5000,
          });

          totalOrders = ordersRes.data.orders?.length || 0;
          console.log(`주문 건수 조회 성공: ${totalOrders}건`);

        } catch (orderError) {
          console.log(`주문 조회 실패 (0으로 처리): ${orderError instanceof Error ? orderError.message : String(orderError)}`);
          totalOrders = 0;
        }

        // 회원 등급 정보 로깅
        console.log(`회원 등급 정보 확인:`, {
          member_id: customer.member_id,
          group: customer.group,
          group_no: customer.group?.group_no,
          group_name: customer.group?.group_name,
          group_no_type: typeof customer.group?.group_no
        });

        verificationResults.push({
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: true,
          cafe24Data: {
            userId: customer.user_id || customer.member_id || "", // 실제 user_id 우선, 없으면 member_id
            userName: customer.user_name || "",
            memberGrade: customer.group?.group_no ? parseInt(customer.group.group_no.toString()) : 1, // 숫자 등급 변환
            joinDate: customer.created_date || "",
            totalOrders, // 구매 건수
          },
        });

      } catch (error) {
        verificationResults.push({
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: false,
          error: error instanceof Error ? error.message : "알 수 없는 오류",
        });
      }

      console.log(`회원 검증 완료: ${member.name}`);

      // API 호출 제한을 위한 딜레이 (200ms로 단축)
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`모든 회원 검증 완료. 총 ${verificationResults.length}건`);

    // 3. 검증 결과를 AC~AG열에 쓰기
    // AC: 회원ID, AD: 가입여부, AE: 회원등급, AF: 가입일, AG: 총구매금액
    console.log("스프레드시트에 결과 쓰기 시작");

    // 각 행별로 개별 업데이트 (행별로 다른 위치에 써야 하므로)
    const updatePromises = verificationResults.map(async (result) => {
      const rowData = [
        result.isRegistered ? "⭕" : "❌", // AC: 가입여부
        result.cafe24Data?.userId || "", // AD: 아이디
        result.cafe24Data?.memberGrade || "", // AE: 등급
        result.cafe24Data?.joinDate ? result.cafe24Data.joinDate.split('T')[0] : "", // AF: 가입날짜 (YYYY-MM-DD)
        result.cafe24Data?.totalOrders || 0, // AG: 구매건수
      ];

      // 각 행의 AC~AG 범위에 데이터 쓰기
      return sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!AC${result.rowIndex}:AG${result.rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData],
        },
      });
    });

    // 모든 업데이트 병렬 실행
    await Promise.all(updatePromises);
    console.log("스프레드시트 결과 쓰기 완료");

    // 4. 통계 정보 반환
    const registeredCount = verificationResults.filter(r => r.isRegistered).length;
    const unregisteredCount = verificationResults.filter(r => !r.isRegistered).length;
    const errorCount = verificationResults.filter(r => r.error).length;

    console.log("최종 응답 생성:", {
      total: verificationResults.length,
      registered: registeredCount,
      unregistered: unregisteredCount,
      errors: errorCount
    });

    return NextResponse.json({
      success: true,
      statistics: {
        total: verificationResults.length,
        registered: registeredCount,
        unregistered: unregisteredCount,
        errors: errorCount,
      },
      message: `검증 완료: 총 ${verificationResults.length}명 중 가입 ${registeredCount}명, 미가입 ${unregisteredCount}명 (AC~AG열에 저장됨)`,
    });

  } catch (error) {
    console.error("Sheets verification error:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");

    let errorMessage = "회원 검증 중 오류 발생";
    let errorDetails = error instanceof Error ? error.message : String(error);

    // Google Sheets API 특정 에러 처리
    if (error instanceof Error && error.message.includes("Unable to parse range")) {
      errorMessage = "잘못된 시트 이름 또는 범위";
      errorDetails = `시트 이름 '${sheetName}'을 찾을 수 없습니다. 정확한 시트 이름을 확인하세요.`;
    } else if (error instanceof Error && error.message.includes("permission")) {
      errorMessage = "권한 오류";
      errorDetails = "Google Sheets에 대한 접근 권한이 없습니다. 서비스 계정에 편집 권한을 부여하세요.";
    }

    return NextResponse.json(
      {
        error: errorMessage,
        details: errorDetails
      },
      { status: 500 }
    );
  }
}