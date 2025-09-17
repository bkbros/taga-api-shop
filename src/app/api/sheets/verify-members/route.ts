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
    memberGrade: string;
    joinDate?: string;
    totalPurchaseAmount: number;
    totalOrders: number;
  };
  error?: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("API 요청 받음:", body);

    const {
      spreadsheetId,
      sheetName = "Smore-5pURyYjo8l-HRG",
      serviceAccountKey,
      useEnvCredentials = false
    } = body;

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
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 1. 스프레드시트에서 I, J열 (이름, 연락처) 읽기
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!I:J`, // I: 이름, J: 연락처
    });

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

    // 2. Cafe24 API로 각 회원 정보 검증
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    const verificationResults: VerificationResult[] = [];

    for (const member of members) {
      try {
        // Cafe24에서 회원 정보 조회 - 이름 또는 연락처로 검색
        let customer = null;

        // 1. 연락처로 검색 (전화번호 기준)
        if (member.phone) {
          const phoneSearchRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
            params: {
              phone: member.phone,
              limit: 10,
              embed: "group"
            },
            headers: { Authorization: `Bearer ${access_token}` },
          });

          if (phoneSearchRes.data.customers && phoneSearchRes.data.customers.length > 0) {
            // 이름도 매칭되는지 확인
            customer = phoneSearchRes.data.customers.find((c: { user_name?: string }) =>
              c.user_name && c.user_name.includes(member.name)
            ) || phoneSearchRes.data.customers[0];
          }
        }

        // 2. 연락처로 찾지 못했으면 이름으로 검색
        if (!customer && member.name) {
          const nameSearchRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
            params: {
              user_name: member.name,
              limit: 10,
              embed: "group"
            },
            headers: { Authorization: `Bearer ${access_token}` },
          });

          if (nameSearchRes.data.customers && nameSearchRes.data.customers.length > 0) {
            customer = nameSearchRes.data.customers[0];
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

        // 주문 통계 조회
        const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
          params: {
            member_id: customer.member_id,
            limit: 1000,
            embed: "items"
          },
          headers: { Authorization: `Bearer ${access_token}` },
        });

        // 완료된 주문만 집계
        let totalPurchaseAmount = 0;
        let totalOrders = 0;

        if (ordersRes.data.orders) {
          const completedOrders = ordersRes.data.orders.filter((order: { order_status?: string }) =>
            order.order_status === "N40" || order.order_status === "N50"
          );

          totalOrders = completedOrders.length;
          totalPurchaseAmount = completedOrders.reduce((sum: number, order: { order_price_amount?: string }) => {
            return sum + parseFloat(order.order_price_amount || "0");
          }, 0);
        }

        verificationResults.push({
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: true,
          cafe24Data: {
            userId: customer.user_id,
            userName: customer.user_name,
            memberGrade: customer.group?.group_name || "일반회원",
            joinDate: customer.created_date,
            totalPurchaseAmount,
            totalOrders,
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

      // API 호출 제한을 위한 딜레이
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 3. 검증 결과를 AC~AG열에 쓰기
    // AC: 회원ID, AD: 가입여부, AE: 회원등급, AF: 가입일, AG: 총구매금액

    // 각 행별로 개별 업데이트 (행별로 다른 위치에 써야 하므로)
    const updatePromises = verificationResults.map(async (result) => {
      const rowData = [
        result.cafe24Data?.userId || "", // AC: 회원ID
        result.isRegistered ? "O" : "X", // AD: 가입여부
        result.cafe24Data?.memberGrade || "", // AE: 회원등급
        result.cafe24Data?.joinDate ? new Date(result.cafe24Data.joinDate).toLocaleDateString('ko-KR') : "", // AF: 가입일
        result.cafe24Data?.totalPurchaseAmount || 0, // AG: 총구매금액
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

    // 4. 통계 정보 반환
    const registeredCount = verificationResults.filter(r => r.isRegistered).length;
    const unregisteredCount = verificationResults.filter(r => !r.isRegistered).length;
    const errorCount = verificationResults.filter(r => r.error).length;

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
    return NextResponse.json(
      {
        error: "회원 검증 중 오류 발생",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}