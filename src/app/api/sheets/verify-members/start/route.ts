// // src/app/api/sheets/verify-members/start/route.ts
// import { NextResponse } from "next/server";
// import { google } from "googleapis";

// /** =============== Types =============== **/
// type GoogleCredentials = {
//   type: string;
//   project_id: string;
//   private_key_id: string;
//   private_key: string;
//   client_email: string;
//   client_id: string;
//   auth_uri: string;
//   token_uri: string;
//   auth_provider_x509_cert_url: string;
//   client_x509_cert_url: string;
// };

// interface SheetMember {
//   name: string;
//   phone: string;
//   rowIndex: number;
// }

// type InfoPeriod = "3months" | "1year";

// interface InfoApiResponse {
//   userId?: string;
//   userName?: string;
//   memberGrade?: string;
//   joinDate?: string;
//   totalPurchaseAmount: number;
//   totalOrders: number; // ✅ 주문 건수
//   email?: string;
//   phone?: string;
//   lastLoginDate?: string;
//   memberId?: string;
//   period: InfoPeriod;
//   shopNo: number;
//   searchMethod?: "cellphone" | "member_id";
//   processingTime?: number;
// }

// interface VerificationResult {
//   rowIndex: number;
//   name: string;
//   phone: string;
//   isRegistered: boolean;
//   memberId?: string;
//   memberGrade?: string;
//   joinDate?: string;
//   totalOrders?: number; // ✅ 주문 건수
//   error?: string;
// }

// /** =============== Helpers =============== **/
// const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// /** =============== Handler =============== **/
// export async function POST(req: Request) {
//   try {
//     const {
//       spreadsheetId,
//       sheetName,
//       useEnvCredentials,
//       serviceAccountKey,
//     }: {
//       spreadsheetId: string;
//       sheetName: string;
//       useEnvCredentials: boolean;
//       serviceAccountKey?: string;
//     } = await req.json();

//     if (!spreadsheetId) {
//       return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
//     }

//     // Google 인증
//     let credentials: GoogleCredentials;
//     if (useEnvCredentials) {
//       const googleCredJson = process.env.GOOGLE_CRED_JSON;
//       if (!googleCredJson) {
//         return NextResponse.json({ error: "환경변수 GOOGLE_CRED_JSON이 없습니다" }, { status: 500 });
//       }
//       credentials = JSON.parse(Buffer.from(googleCredJson, "base64").toString("utf-8")) as GoogleCredentials;
//     } else {
//       if (!serviceAccountKey) {
//         return NextResponse.json({ error: "serviceAccountKey가 필요합니다" }, { status: 400 });
//       }
//       credentials = JSON.parse(serviceAccountKey) as GoogleCredentials;
//     }

//     const auth = new google.auth.GoogleAuth({
//       credentials,
//       scopes: ["https://www.googleapis.com/auth/spreadsheets"],
//     });
//     const sheets = google.sheets({ version: "v4", auth });

//     // 시트에서 I:J 읽기 (I=이름, J=연락처)
//     const sourceResponse = await sheets.spreadsheets.values.get({
//       spreadsheetId,
//       range: `${sheetName}!I:J`,
//     });

//     const rows = sourceResponse.data.values;
//     if (!rows || rows.length <= 1) {
//       return NextResponse.json({ error: "스프레드시트에 데이터가 없습니다" }, { status: 400 });
//     }

//     const members: SheetMember[] = rows
//       .slice(1)
//       .map((row, index) => ({
//         name: (row[0] ?? "").toString().trim(),
//         phone: (row[1] ?? "").toString().trim(),
//         rowIndex: index + 2, // 1-based + header
//       }))
//       .filter(m => m.name && m.phone);

//     console.log(`파싱된 회원 수: ${members.length}`);

//     // info 라우트 호출 준비
//     const { origin } = new URL(req.url);
//     const period: InfoPeriod = "3months";
//     const shopNo = 1;

//     const verificationResults: VerificationResult[] = [];

//     for (const member of members) {
//       try {
//         const cleanPhone = member.phone.replace(/\D/g, "");
//         if (!cleanPhone) {
//           verificationResults.push({
//             rowIndex: member.rowIndex,
//             name: member.name,
//             phone: member.phone,
//             isRegistered: false,
//             error: "연락처 없음",
//           });
//           continue;
//         }

//         const url = `${origin}/api/customer/info?user_id=${encodeURIComponent(
//           cleanPhone,
//         )}&period=${period}&shop_no=${shopNo}`;
//         const res = await fetch(url, { method: "GET" });

//         if (res.ok) {
//           const data = (await res.json()) as InfoApiResponse;

//           let joinDate = "";
//           if (data.joinDate) {
//             try {
//               joinDate = data.joinDate.split("T")[0];
//             } catch {
//               joinDate = data.joinDate;
//             }
//           }

//           verificationResults.push({
//             rowIndex: member.rowIndex,
//             name: member.name,
//             phone: member.phone,
//             isRegistered: true,
//             memberId: data.memberId ?? data.userId ?? "",
//             memberGrade: data.memberGrade ?? "",
//             joinDate,
//             totalOrders: data.totalOrders, // ✅ 주문 건수만 사용
//           });
//         } else if (res.status === 404) {
//           verificationResults.push({
//             rowIndex: member.rowIndex,
//             name: member.name,
//             phone: member.phone,
//             isRegistered: false,
//           });
//         } else {
//           const text = await res.text();
//           verificationResults.push({
//             rowIndex: member.rowIndex,
//             name: member.name,
//             phone: member.phone,
//             isRegistered: false,
//             error: `info API 실패(${res.status}): ${text}`,
//           });
//         }

//         // Cafe24 rate-limit 완화
//         await sleep(250);
//       } catch (err) {
//         verificationResults.push({
//           rowIndex: member.rowIndex,
//           name: member.name,
//           phone: member.phone,
//           isRegistered: false,
//           error: err instanceof Error ? err.message : "처리 중 오류 발생",
//         });
//       }
//     }

//     // 결과 정렬
//     const sorted = verificationResults.sort((a, b) => a.rowIndex - b.rowIndex);

//     // 시트 쓰기 (AC~AG)
//     // AC: 회원ID, AD: 가입여부, AE: 회원등급, AF: 가입일, AG: 최근3개월 구매건수 ✅
//     const writeData = sorted.map(r => [
//       r.memberId ?? "",
//       r.isRegistered ? "가입" : "미가입",
//       r.memberGrade ?? "",
//       r.joinDate ?? "",
//       r.totalOrders ?? "", // ✅ AG = 주문건수
//     ]);

//     const writeRange = `${sheetName}!AC2:AG${writeData.length + 1}`;
//     await sheets.spreadsheets.values.update({
//       spreadsheetId,
//       range: writeRange,
//       valueInputOption: "RAW",
//       requestBody: { values: writeData },
//     });

//     const summary = {
//       total: sorted.length,
//       registered: sorted.filter(r => r.isRegistered).length,
//       unregistered: sorted.filter(r => !r.isRegistered).length,
//       errors: sorted.filter(r => !!r.error).length,
//     };

//     return NextResponse.json({
//       success: true,
//       message: `${sorted.length}명 검증 완료`,
//       statistics: summary,
//     });
//   } catch (error) {
//     console.error("작업 실패:", error);
//     return NextResponse.json(
//       { error: "작업에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
//       { status: 500 },
//     );
//   }
// }
// src/app/api/sheets/verify-members/start/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

/** ===================== Types ===================== **/

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
  rowIndex: number; // 1-based (헤더는 1행)
}

type InfoSearchMethod = "cellphone" | "member_id";
type InfoPeriod = "3months" | "1year";

interface InfoApiResponse {
  userId?: string;
  userName?: string;
  memberGrade?: string;
  memberGradeNo?: number; // ✅ 숫자 등급(있으면 사용)
  joinDate?: string; // ISO 또는 'YYYY-MM-DD ...'
  totalOrders: number; // ✅ 최근 3개월(또는 period) 구매건수
  email?: string;
  phone?: string;
  lastLoginDate?: string;
  memberId?: string;
  period?: InfoPeriod;
  shopNo?: number;
  searchMethod?: InfoSearchMethod;
  processingTime?: number;
}

interface VerificationResult {
  rowIndex: number;
  name: string;
  phone: string;
  isRegistered: boolean;
  memberId?: string;
  memberGradeNo?: number;
  joinDate?: string;
  totalOrders?: number;
  error?: string;
}

/** ===================== Small helpers ===================== **/

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** 제한 동시성 병렬 처리 */
async function concurrentMap<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, runner);
  await Promise.all(workers);
  return results;
}

/** ===================== Route Handler ===================== **/

export async function POST(req: Request) {
  try {
    const { spreadsheetId, sheetName, useEnvCredentials, serviceAccountKey } = (await req.json()) as {
      spreadsheetId?: string;
      sheetName?: string;
      useEnvCredentials?: boolean;
      serviceAccountKey?: string;
    };

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }
    if (!sheetName) {
      return NextResponse.json({ error: "sheetName이 필요합니다" }, { status: 400 });
    }

    /** 1) Google Sheets 인증 */
    let credentials: GoogleCredentials;
    if (useEnvCredentials ?? true) {
      const googleCredJson = process.env.GOOGLE_CRED_JSON;
      if (!googleCredJson) {
        return NextResponse.json({ error: "환경변수 GOOGLE_CRED_JSON 이 누락되었습니다" }, { status: 500 });
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

    /** 2) 스프레드시트에서 I:J 읽기 (이름, 연락처) */
    const sourceResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!I:J`,
    });
    const rows = sourceResp.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json(
        { error: "스프레드시트에 데이터가 없습니다 (헤더 제외 1행 이상 필요)" },
        { status: 400 },
      );
    }

    const members: SheetMember[] = rows
      .slice(1)
      .map((row, idx) => {
        const name = (row[0] ?? "").toString().trim();
        const phone = (row[1] ?? "").toString().trim();
        return { name, phone, rowIndex: idx + 2 }; // 2행부터 데이터
      })
      .filter(m => m.name && m.phone);

    const total = members.length;
    if (total === 0) {
      return NextResponse.json({ error: "이름과 연락처가 모두 채워진 행이 없습니다" }, { status: 400 });
    }

    console.log(`[VERIFY] 대상 행 수: ${total}`);

    /** 3) 각 회원 → 내부 /api/customer/info 호출 (period=3months, shop_no=1) */
    const base = new URL(req.url);
    const infoBase = new URL("/api/customer/info", base.origin);

    // 동시성 3, 각 작업 사이 소폭 대기 (내부 라우트 및 상류 Rate Limit 배려)
    const results = await concurrentMap<SheetMember, VerificationResult>(members, 3, async member => {
      const cleanPhone = member.phone.replace(/\D/g, "");
      if (!cleanPhone) {
        return {
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: false,
          error: "연락처 포맷 오류",
        };
      }

      const u = new URL(infoBase.toString());
      u.searchParams.set("user_id", cleanPhone);
      u.searchParams.set("period", "3months");
      u.searchParams.set("shop_no", "1");

      try {
        const res = await fetch(u.toString(), { method: "GET" });
        if (res.ok) {
          const data = (await res.json()) as InfoApiResponse;

          // 날짜를 YYYY-MM-DD 로 슬림화
          let ymd = "";
          if (data.joinDate) {
            try {
              ymd = data.joinDate.split("T")[0];
            } catch {
              ymd = data.joinDate;
            }
          }

          // 숫자 등급 파생 (memberGradeNo 우선, 없으면 memberGrade에서 정수 추출 시도)
          let gradeNo: number | undefined = data.memberGradeNo;
          if (gradeNo === undefined && data.memberGrade) {
            const m = data.memberGrade.match(/\d+/);
            if (m) gradeNo = Number(m[0]);
          }

          return {
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: true,
            memberId: data.memberId ?? data.userId ?? "",
            memberGradeNo: Number.isFinite(gradeNo) ? (gradeNo as number) : undefined,
            joinDate: ymd,
            totalOrders: data.totalOrders ?? 0,
          };
        }

        if (res.status === 404) {
          return {
            rowIndex: member.rowIndex,
            name: member.name,
            phone: member.phone,
            isRegistered: false,
          };
        }

        const errText = await res.text();
        return {
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: false,
          error: `info 응답 실패(${res.status}): ${errText}`,
        };
      } catch (e: unknown) {
        return {
          rowIndex: member.rowIndex,
          name: member.name,
          phone: member.phone,
          isRegistered: false,
          error: e instanceof Error ? e.message : "알 수 없는 오류",
        };
      } finally {
        // 너무 과도한 연속 호출을 피하기 위해 살짝 쉼
        await sleep(150);
      }
    });

    /** 4) 결과 시트 쓰기 (행별 정확 위치에 batchUpdate) */
    const sorted = results.sort((a, b) => a.rowIndex - b.rowIndex);

    // AC: 회원ID, AD: 가입여부(⭕/❌), AE: 회원등급(숫자), AF: 가입일, AG: 최근3개월 구매건수
    const data = sorted.map(r => ({
      range: `${sheetName}!AC${r.rowIndex}:AG${r.rowIndex}`,
      values: [
        [
          r.memberId ?? "",
          r.isRegistered ? "⭕" : "❌",
          typeof r.memberGradeNo === "number" ? r.memberGradeNo : "",
          r.joinDate ?? "",
          r.totalOrders ?? "",
        ],
      ],
    }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });

    /** 5) 요약 반환 */
    const summary = {
      total: sorted.length,
      registered: sorted.filter(r => r.isRegistered).length,
      unregistered: sorted.filter(r => !r.isRegistered && !r.error).length,
      errors: sorted.filter(r => Boolean(r.error)).length,
    };

    return NextResponse.json({
      success: true,
      message: `${sorted.length}명 검증 완료 (최근 3개월 구매건수 기준)`,
      statistics: summary,
    });
  } catch (error: unknown) {
    console.error("[verify-members/start] 실패:", error);
    return NextResponse.json(
      { error: "작업에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
