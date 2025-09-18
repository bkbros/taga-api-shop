import { NextResponse } from "next/server";
import { google } from "googleapis";

/** =============== Types =============== **/
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
  rowIndex: number;
}

interface VerificationResult {
  rowIndex: number;
  name: string;
  phone: string;
  isRegistered: boolean;
  memberId?: string;
  memberGrade?: string; // info 라우트는 문자열 등급을 줍니다.
  joinDate?: string;
  totalOrders?: number;
  totalPurchaseAmount?: number; // 금액도 받아서 AG에 씁니다.
  error?: string;
}

type InfoPeriod = "3months" | "1year";

interface InfoApiResponse {
  userId?: string;
  userName?: string;
  memberGrade?: string;
  joinDate?: string; // ISO or YYYY-MM-DD
  totalPurchaseAmount: number;
  totalOrders: number;
  email?: string;
  phone?: string;
  lastLoginDate?: string;
  memberId?: string; // 실제 조회에 사용된 로그인 아이디
  period: InfoPeriod;
  shopNo: number;
  searchMethod?: "cellphone" | "member_id";
  processingTime?: number;
}

/** =============== Helpers =============== **/
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** =============== Handler =============== **/
export async function POST(req: Request) {
  try {
    const {
      spreadsheetId,
      sheetName,
      useEnvCredentials,
      serviceAccountKey,
    }: // 옵션이 필요하면 period, shopNo 등을 여기에 받을 수 있습니다.
    {
      spreadsheetId: string;
      sheetName: string;
      useEnvCredentials: boolean;
      serviceAccountKey?: string;
    } = await req.json();

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }

    // Google 인증
    let credentials: GoogleCredentials;
    if (useEnvCredentials) {
      const googleCredJson = process.env.GOOGLE_CRED_JSON;
      if (!googleCredJson) {
        return NextResponse.json({ error: "환경변수 GOOGLE_CRED_JSON이 없습니다" }, { status: 500 });
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

    // 시트에서 I:J 읽기 (I=이름, J=연락처)
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!I:J`,
    });

    const rows = sourceResponse.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json({ error: "스프레드시트에 데이터가 없습니다" }, { status: 400 });
    }

    // 헤더 제외하고 파싱
    const members: SheetMember[] = rows
      .slice(1)
      .map((row, index) => ({
        name: (row[0] ?? "").toString().trim(),
        phone: (row[1] ?? "").toString().trim(),
        rowIndex: index + 2,
      }))
      .filter(m => m.name && m.phone);

    console.log(`파싱된 회원 수: ${members.length}`);

    // 우리 info 라우트 호출 준비
    const { origin } = new URL(req.url);
    const period: InfoPeriod = "3months";
    const shopNo = 1;

    const verificationResults: VerificationResult[] = [];

    for (const member of members) {
      try {
        const cleanPhone = member.phone.replace(/\D/g, "");
        if (!cleanPhone) {
          verificationResults.push({
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: false,
            error: "연락처 없음",
          });
          continue;
        }

        // ✅ info 라우트 호출 (KST/3개월 제한/재시도/추측 로직 모두 재사용)
        const url = `${origin}/api/customer/info?user_id=${encodeURIComponent(
          cleanPhone,
        )}&period=${period}&shop_no=${shopNo}`;
        const res = await fetch(url, { method: "GET" });

        if (res.ok) {
          const data = (await res.json()) as InfoApiResponse;

          // joinDate를 YYYY-MM-DD로 정리
          let joinDate = "";
          if (data.joinDate) {
            try {
              joinDate = data.joinDate.split("T")[0];
            } catch {
              joinDate = data.joinDate;
            }
          }

          verificationResults.push({
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: true,
            memberId: data.memberId ?? data.userId ?? "",
            memberGrade: data.memberGrade ?? "",
            joinDate,
            totalOrders: data.totalOrders,
            totalPurchaseAmount: data.totalPurchaseAmount,
          });
        } else if (res.status === 404) {
          // 미가입
          verificationResults.push({
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: false,
          });
        } else {
          const text = await res.text();
          verificationResults.push({
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: false,
            error: `info API 실패(${res.status}): ${text}`,
          });
        }

        // rate-limit 완화
        await sleep(250);
      } catch (err) {
        verificationResults.push({
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: false,
          error: err instanceof Error ? err.message : "처리 중 오류 발생",
        });
      }
    }

    // 결과 정렬 후 쓰기
    const sorted = verificationResults.sort((a, b) => a.rowIndex - b.rowIndex);

    // 컬럼 매핑:
    // AC: 회원ID, AD: 가입여부, AE: 회원등급, AF: 가입일, AG: 총구매금액
    const writeData = sorted.map(r => [
      r.memberId ?? "",
      r.isRegistered ? "가입" : "미가입",
      r.memberGrade ?? "",
      r.joinDate ?? "",
      r.totalPurchaseAmount ?? "", // ✅ AG에 '총구매금액' 기록
    ]);

    const writeRange = `${sheetName}!AC2:AG${writeData.length + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: writeData },
    });

    const summary = {
      total: verificationResults.length,
      registered: verificationResults.filter(r => r.isRegistered).length,
      unregistered: verificationResults.filter(r => !r.isRegistered).length,
      errors: verificationResults.filter(r => !!r.error).length,
    };

    return NextResponse.json({
      success: true,
      message: `${sorted.length}명 검증 완료`,
      statistics: summary,
    });
  } catch (error) {
    console.error("작업 실패:", error);
    return NextResponse.json(
      { error: "작업에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
