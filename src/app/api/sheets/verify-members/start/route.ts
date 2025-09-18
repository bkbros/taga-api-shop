// src/app/api/sheets/verify-members/start/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

/** ========= Types ========= **/

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

interface SheetMember {
  name: string;
  phone: string;
  rowIndex: number; // 1-based row number in sheet
}

// /api/customer/info 성공 응답 형태 (우리가 만든 라우트 기준)
interface InfoSuccess {
  userId?: string;
  userName?: string;
  memberId: string;
  memberGrade?: string; // 등급명 (예: "VIP 3")
  memberGradeNo?: number; // 등급번호 (숫자)
  joinDate?: string; // ISO or YYYY-MM-DD
  totalOrders: number; // 최근 3개월 주문 건수
  period?: "3months" | "1year";
  shopNo?: number;
  searchMethod?: "cellphone" | "member_id";
  processingTime?: number;
}

interface InfoError {
  error: string;
  details?: unknown;
}

/** ========= Utils ========= **/

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const toDateCell = (v?: string): string => {
  if (!v) return "";
  // "YYYY-MM-DDTHH:mm:ss" | "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DD"
  if (v.includes("T")) return v.split("T")[0]!;
  if (v.includes(" ")) return v.split(" ")[0]!;
  return v;
};

const isInfoError = (v: unknown): v is InfoError => typeof v === "object" && v !== null && "error" in v;

/** ========= Handler ========= **/

export async function POST(req: Request) {
  try {
    const { spreadsheetId, sheetName, useEnvCredentials, serviceAccountKey, shopNo } = await req.json();

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }
    const targetSheet = (sheetName || "").trim() || "Sheet1";
    const shopNoNum = Number.isInteger(Number(shopNo)) ? Number(shopNo) : 1;

    // Google Sheets 인증
    let credentials: GoogleCredentials;
    if (useEnvCredentials) {
      const googleCredJson = process.env.GOOGLE_CRED_JSON;
      if (!googleCredJson) {
        return NextResponse.json({ error: "환경변수 GOOGLE_CRED_JSON 이 설정되지 않았습니다" }, { status: 500 });
      }
      credentials = JSON.parse(Buffer.from(googleCredJson, "base64").toString("utf-8")) as GoogleCredentials;
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

    // 1) 시트에서 입력 데이터 읽기 (I:이름, J:연락처)
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${targetSheet}!I:J`,
    });

    const rows = sourceResponse.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json({ error: "스프레드시트에 데이터가 없습니다" }, { status: 400 });
    }

    const members: SheetMember[] = rows
      .slice(1)
      .map((row, idx) => ({
        name: (row?.[0] ?? "").toString().trim(),
        phone: (row?.[1] ?? "").toString().trim(),
        rowIndex: idx + 2,
      }))
      .filter(m => m.name && m.phone);

    console.log(`[SHEETS] 파싱된 회원 수: ${members.length}`);

    // 2) 내 서버의 /api/customer/info 호출 준비 (origin 계산)
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    // 3) 각 회원 처리 (순차 + 소폭 대기)
    type RowResult = {
      rowIndex: number;
      memberId: string;
      isRegisteredEmoji: "⭕" | "❌";
      memberGradeNoCell: number | ""; // 숫자 셀 유지
      joinDateCell: string;
      orders3mCell: number | ""; // 숫자 셀 유지
      hadError: boolean;
    };

    const results: RowResult[] = [];

    for (const member of members) {
      const cleanPhone = member.phone.replace(/\D/g, "");
      let memberId = "";
      let isRegisteredEmoji: "⭕" | "❌" = "❌";
      let memberGradeNoCell: number | "" = "";
      let joinDateCell = "";
      let orders3mCell: number | "" = "";
      let hadError = false;

      // 휴대폰 10~11자리(0으로 시작)만 조회
      if (!/^0\d{9,10}$/.test(cleanPhone)) {
        results.push({
          rowIndex: member.rowIndex,
          memberId,
          isRegisteredEmoji,
          memberGradeNoCell,
          joinDateCell,
          orders3mCell,
          hadError: true,
        });
        continue;
      }

      try {
        const infoUrl =
          `${origin}/api/customer/info?` +
          new URLSearchParams({
            user_id: cleanPhone,
            period: "3months",
            shop_no: String(shopNoNum),
            guess: "1",
          }).toString();

        const resp = await fetch(infoUrl, { method: "GET" });

        if (!resp.ok) {
          if (resp.status === 404) {
            // 미가입
            isRegisteredEmoji = "❌";
          } else {
            hadError = true;
            console.log(`[INFO API] ${member.name}/${cleanPhone} 실패 status=${resp.status}`);
          }
        } else {
          const payload: InfoSuccess | InfoError = await resp.json();
          if (isInfoError(payload)) {
            hadError = true;
            console.log(`[INFO API] ${member.name}/${cleanPhone} payload error=`, payload.error);
          } else {
            // 성공
            memberId = payload.memberId ?? "";
            isRegisteredEmoji = "⭕";

            // 등급번호: 숫자 그 자체!
            if (typeof payload.memberGradeNo === "number") {
              memberGradeNoCell = payload.memberGradeNo;
            } else {
              memberGradeNoCell = ""; // 못 받으면 빈칸
            }

            joinDateCell = toDateCell(payload.joinDate);
            orders3mCell = typeof payload.totalOrders === "number" ? payload.totalOrders : 0;
          }
        }
      } catch (e) {
        hadError = true;
        console.log(`[INFO API] ${member.name}/${cleanPhone} 호출 예외:`, e);
      }

      results.push({
        rowIndex: member.rowIndex,
        memberId,
        isRegisteredEmoji,
        memberGradeNoCell,
        joinDateCell,
        orders3mCell,
        hadError,
      });

      // Cafe24 레이트 리밋 보호 (info 라우트 내부에서도 보호하지만 여기도 대기)
      await sleep(250);
    }

    // 4) 시트에 쓰기
    // - AC: 회원ID
    // - AD: 가입여부(⭕/❌)
    // - AE: 등급번호(숫자)
    // - AF: 가입일(YYYY-MM-DD)
    // - AG: 최근3개월 구매건수(숫자)
    // 행 정렬 + 원본 행 번호에 맞춰 빈 줄 채우기
    const sorted = results.sort((a, b) => a.rowIndex - b.rowIndex);
    const maxRowIndex = sorted.length ? sorted[sorted.length - 1].rowIndex : 1;
    const rowsMatrix: (string | number)[][] = Array.from({ length: Math.max(0, maxRowIndex - 1) }, () => [
      "",
      "",
      "",
      "",
      "",
    ]);

    for (const r of sorted) {
      const i = r.rowIndex - 2; // 0-based index for AC row
      if (i < 0 || i >= rowsMatrix.length) continue;
      rowsMatrix[i] = [
        r.memberId, // AC
        r.isRegisteredEmoji, // AD
        r.memberGradeNoCell, // AE (number | "")
        r.joinDateCell, // AF
        r.orders3mCell, // AG (number | "")
      ];
    }

    const writeRange = `${targetSheet}!AC2:AG${maxRowIndex}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: rowsMatrix },
    });

    // 5) 요약 통계
    const summary = {
      total: results.length,
      registered: results.filter(r => r.isRegisteredEmoji === "⭕").length,
      unregistered: results.filter(r => r.isRegisteredEmoji === "❌" && !r.hadError).length,
      errors: results.filter(r => r.hadError).length,
    };

    console.log("[SHEETS] 완료:", summary);

    return NextResponse.json({
      success: true,
      message: `${results.length}명 검증 완료`,
      statistics: summary,
    });
  } catch (error) {
    console.error("[SHEETS] 작업 실패:", error);
    return NextResponse.json(
      {
        error: "작업에 실패했습니다",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
