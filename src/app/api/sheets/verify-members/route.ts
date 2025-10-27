import { NextResponse } from "next/server";
import { google } from "googleapis";
import { loadParams } from "@/lib/ssm";
import axios from "axios";

type SheetMember = {
  name: string;
  phone: string;
  userId: string;
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
      useEnvCredentials = false,
      nameColumn = "I",
      phoneColumn = "J",
      userIdColumn = "H"
    } = body;

    sheetName = requestSheetName; // 요청된 값으로 업데이트

    console.log("파싱된 파라미터:", {
      spreadsheetId,
      sheetName,
      useEnvCredentials,
      hasServiceAccountKey: !!serviceAccountKey,
      nameColumn,
      phoneColumn,
      userIdColumn
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

    // 1. 스프레드시트에서 이름, 연락처, 회원ID 열 읽기
    const readRange = `${sheetName}!${userIdColumn}:${phoneColumn}`; // H:J (회원ID, 이름, 연락처)
    console.log(`스프레드시트 데이터 읽기 시작: ${readRange}`);
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: readRange,
    });
    console.log("스프레드시트 데이터 읽기 성공");

    const rows = sourceResponse.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json({
        error: "스프레드시트에 데이터가 없습니다"
      }, { status: 400 });
    }

    // 컬럼 인덱스 계산 (H=0, I=1, J=2)
    const userIdColIndex = userIdColumn.charCodeAt(0) - userIdColumn.charCodeAt(0); // 0
    const nameColIndex = nameColumn.charCodeAt(0) - userIdColumn.charCodeAt(0); // 1
    const phoneColIndex = phoneColumn.charCodeAt(0) - userIdColumn.charCodeAt(0); // 2

    // 헤더 제외하고 회원 데이터 파싱 (행 번호도 추적)
    const members: SheetMember[] = rows.slice(1).map((row, index) => ({
      userId: (row[userIdColIndex] || "").toString().trim(),
      name: (row[nameColIndex] || "").toString().trim(),
      phone: (row[phoneColIndex] || "").toString().trim(),
      rowIndex: index + 2, // 헤더 제외하고 실제 행 번호 (1-based + 헤더 1행)
    })).filter(member => member.name); // 이름이 있는 것만 (연락처나 회원ID는 선택사항)

    console.log(`파싱된 회원 수: ${members.length}`);
    console.log("첫 3개 회원:", members.slice(0, 3));

    // 모든 회원 처리 (제한 제거)
    const limitedMembers = members; // 제한 없이 모든 회원 처리
    console.log(`실제 처리할 회원 수: ${limitedMembers.length}명 (제한 없음)`);

    // 2. Cafe24 API로 각 회원 정보 검증
    console.log("Cafe24 API 토큰 로드 시작");
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    console.log(`Cafe24 토큰 로드 완료, Mall ID: ${mallId}`);

    const verificationResults: VerificationResult[] = [];

    // 배치 처리를 위한 설정 (대량 처리 시 안정성 향상)
    const batchSize = 20; // 한 번에 20명씩 처리
    const batches = [];
    for (let i = 0; i < limitedMembers.length; i += batchSize) {
      batches.push(limitedMembers.slice(i, i + batchSize));
    }

    console.log(`배치 처리 시작: 총 ${batches.length}개 배치, 배치당 최대 ${batchSize}명`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`배치 ${batchIndex + 1}/${batches.length} 처리 시작 (${batch.length}명)`);

      for (const member of batch) {
      console.log(`회원 검증 시작: ${member.name} (전화: ${member.phone}, ID: ${member.userId})`);
      try {
        // Cafe24에서 회원 정보 조회
        let customer = null;

        // 1. cellphone으로 먼저 검색 (하이픈 제거한 숫자만)
        const cleanPhone = member.phone.replace(/\D/g, "");
        if (cleanPhone) {
          console.log(`cellphone으로 1차 검색: ${cleanPhone}`);
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
              console.log(`✅ 핸드폰으로 찾음:`, {
                member_id: customer.member_id,
                user_id: customer.user_id,
                group_no: customer.group_no
              });
            }
          } catch (error) {
            console.log(`cellphone 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // 2. cellphone 안되면 phone으로 검색 (원본 형태)
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
              console.log(`✅ 원본 전화번호로 찾음: ${customer.member_id}`);
            }
          } catch (error) {
            console.log(`phone 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // 3. 핸드폰으로 못 찾았고 회원 ID가 있으면 member_id로 재검색
        if (!customer && member.userId) {
          console.log(`핸드폰으로 못 찾음 → member_id로 재시도: ${member.userId}`);
          try {
            const memberIdRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
              params: {
                member_id: member.userId,
                limit: 10,
                embed: "group"
              },
              headers: { Authorization: `Bearer ${access_token}` },
              timeout: 5000,
            });
            console.log(`member_id 검색 결과: ${memberIdRes.data.customers?.length || 0}건`);

            if (memberIdRes.data.customers && memberIdRes.data.customers.length > 0) {
              customer = memberIdRes.data.customers[0];
              console.log(`✅ 회원 ID로 찾음: ${customer.member_id}`);
            }
          } catch (error) {
            console.log(`member_id 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
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

        // Lambda와 동일한 방식: group_no 필드 직접 사용
        let finalGroupNo = customer.group_no;
        if (finalGroupNo == null) {
          finalGroupNo = customer.group?.group_no;
        }
        if (finalGroupNo == null) {
          finalGroupNo = 1; // 기본값
        }
        console.log(`회원 등급 정보 확인 (Lambda 방식):`, {
          member_id: customer.member_id,
          group_no: customer.group_no,
          group_object: customer.group,
          finalGroupNo: finalGroupNo,
          finalGroupNo_type: typeof finalGroupNo
        });

        verificationResults.push({
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: true,
          cafe24Data: {
            userId: customer.user_id || customer.member_id || "", // 실제 user_id 우선, 없으면 member_id
            userName: customer.user_name || "",
            memberGrade: finalGroupNo ? parseInt(finalGroupNo.toString()) : 1, // customergroups API 결과 우선 사용
            joinDate: customer.created_date || "",
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

      console.log(`배치 ${batchIndex + 1}/${batches.length} 완료 (${batch.length}명 처리)`);

      // 배치 간 휴식 (마지막 배치가 아닌 경우에만)
      if (batchIndex < batches.length - 1) {
        console.log(`배치 간 휴식 3초`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log(`모든 회원 검증 완료. 총 ${verificationResults.length}건`);

    // 3. 검증 결과를 AC~AF열에 쓰기
    // AC: 가입여부, AD: 회원ID, AE: 회원등급, AF: 가입일
    console.log("스프레드시트에 결과 쓰기 시작");

    // 각 행별로 개별 업데이트 (행별로 다른 위치에 써야 하므로)
    const updatePromises = verificationResults.map(async (result) => {
      const rowData = [
        result.isRegistered ? "⭕" : "❌", // AC: 가입여부
        result.cafe24Data?.userId || "", // AD: 아이디
        result.cafe24Data?.memberGrade || "", // AE: 등급
        result.cafe24Data?.joinDate ? result.cafe24Data.joinDate.split('T')[0] : "", // AF: 가입날짜 (YYYY-MM-DD)
      ];

      // 각 행의 AC~AF 범위에 데이터 쓰기
      return sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!AC${result.rowIndex}:AF${result.rowIndex}`,
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
      message: `검증 완료: 총 ${verificationResults.length}명 중 가입 ${registeredCount}명, 미가입 ${unregisteredCount}명 (AC~AF열에 저장됨)`,
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