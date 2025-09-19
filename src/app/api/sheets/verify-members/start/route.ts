// import { NextResponse } from "next/server";
// import { google } from "googleapis";

// /** ========= Types ========= **/

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
//   id?: string; // H열: 로그인ID (선택)
//   name: string; // I열: 이름
//   phone: string; // J열: 연락처
//   rowIndex: number; // 1-based row number in sheet
// }

// interface InfoSuccess {
//   userId?: string;
//   userName?: string;
//   memberId: string;
//   memberGrade?: string;
//   memberGradeNo?: number; // 등급번호(숫자)
//   joinDate?: string; // ISO or YYYY-MM-DD
//   totalOrders: number; // 최근 3개월 주문 건수
//   period?: "3months" | "1year";
//   shopNo?: number;
//   searchMethod?: "cellphone" | "phone" | "member_id";
//   processingTime?: number;
// }

// interface InfoError {
//   error: string;
//   details?: unknown;
// }

// /** ========= Utils ========= **/

// const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// const toDateCell = (v?: string): string => {
//   if (!v) return "";
//   if (v.includes("T")) return v.split("T")[0]!;
//   if (v.includes(" ")) return v.split(" ")[0]!;
//   return v;
// };

// const isInfoError = (v: unknown): v is InfoError => typeof v === "object" && v !== null && "error" in v;

// const digitsOnly = (s: string): string => s.replace(/\D/g, "");

// /** ========= Handler ========= **/

// export async function POST(req: Request) {
//   try {
//     const { spreadsheetId, sheetName, useEnvCredentials, serviceAccountKey, shopNo } = await req.json();

//     if (!spreadsheetId) {
//       return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
//     }
//     const targetSheet = (sheetName || "").trim() || "Sheet1";
//     const shopNoNum = Number.isInteger(Number(shopNo)) ? Number(shopNo) : 1;

//     // Google Sheets 인증
//     let credentials: GoogleCredentials;
//     if (useEnvCredentials) {
//       const googleCredJson = process.env.GOOGLE_CRED_JSON;
//       if (!googleCredJson) {
//         return NextResponse.json({ error: "환경변수 GOOGLE_CRED_JSON 이 설정되지 않았습니다" }, { status: 500 });
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

//     // 1) 시트에서 입력 데이터 읽기 (H:아이디(선택), I:이름, J:연락처)
//     const sourceResponse = await sheets.spreadsheets.values.get({
//       spreadsheetId,
//       range: `${targetSheet}!H:J`,
//     });

//     const rows = sourceResponse.data.values;
//     if (!rows || rows.length <= 1) {
//       return NextResponse.json({ error: "스프레드시트에 데이터가 없습니다" }, { status: 400 });
//     }

//     const members: SheetMember[] = rows
//       .slice(1)
//       .map((row, idx) => ({
//         id: (row?.[0] ?? "").toString().trim(), // H
//         name: (row?.[1] ?? "").toString().trim(), // I
//         phone: (row?.[2] ?? "").toString().trim(), // J
//         rowIndex: idx + 2,
//       }))
//       .filter(m => (m.id || m.phone) && m.name);

//     console.log(`[SHEETS] 파싱된 회원 수: ${members.length}`);

//     // 2) 내 서버의 /api/customer/info 호출 준비
//     const url = new URL(req.url);
//     const origin = `${url.protocol}//${url.host}`;

//     // 3) 각 회원 처리 (ID 먼저 → 실패 시 전화번호)
//     type RowResult = {
//       rowIndex: number;
//       memberId: string;
//       isRegisteredEmoji: "⭕" | "❌";
//       memberGradeNoCell: number | ""; // 숫자 셀 유지 (AE)
//       joinDateCell: string; // (AF)
//       orders3mCell: number | ""; // 숫자 셀 유지 (AG)
//       hadError: boolean;
//     };

//     const results: RowResult[] = [];

//     for (const member of members) {
//       const idCandidate = member.id;
//       const phoneDigits = digitsOnly(member.phone);

//       const tries: Array<{ label: "id" | "phone"; value: string }> = [];
//       if (idCandidate) tries.push({ label: "id", value: idCandidate });
//       if (/^0\d{9,10}$/.test(phoneDigits)) tries.push({ label: "phone", value: phoneDigits });

//       let memberId = "";
//       let isRegisteredEmoji: "⭕" | "❌" = "❌";
//       let memberGradeNoCell: number | "" = "";
//       let joinDateCell = "";
//       let orders3mCell: number | "" = "";
//       let hadError = false;
//       let found = false;

//       if (tries.length === 0) {
//         // 조회 수단 없음
//         results.push({
//           rowIndex: member.rowIndex,
//           memberId,
//           isRegisteredEmoji,
//           memberGradeNoCell,
//           joinDateCell,
//           orders3mCell,
//           hadError: true,
//         });
//         continue;
//       }

//       for (const t of tries) {
//         try {
//           const infoUrl =
//             `${origin}/api/customer/info?` +
//             new URLSearchParams({
//               user_id: t.value,
//               period: "3months",
//               shop_no: String(shopNoNum),
//               guess: "1", // 숫자-only ID일 경우 @k/@n 보조 시도
//             }).toString();

//           const resp = await fetch(infoUrl, { method: "GET" });

//           if (!resp.ok) {
//             if (resp.status === 404) {
//               // 다음 시도 계속
//               continue;
//             } else {
//               // 그 외 오류는 해당 행 오류 처리
//               hadError = true;
//               console.log(`[INFO API] ${member.name}/${t.label}:${t.value} 실패 status=${resp.status}`);
//               break;
//             }
//           }

//           // 성공
//           const payload: InfoSuccess | InfoError = await resp.json();
//           if (isInfoError(payload)) {
//             hadError = true;
//             console.log(`[INFO API] ${member.name}/${t.label}:${t.value} payload error=`, payload.error);
//             break;
//           }

//           memberId = payload.memberId ?? "";
//           isRegisteredEmoji = "⭕";
//           memberGradeNoCell = typeof payload.memberGradeNo === "number" ? payload.memberGradeNo : "";
//           joinDateCell = toDateCell(payload.joinDate);
//           orders3mCell = typeof payload.totalOrders === "number" ? payload.totalOrders : 0;

//           found = true;
//           break;
//         } catch (e) {
//           hadError = true;
//           console.log(`[INFO API] ${member.name}/${t.label}:${t.value} 호출 예외:`, e);
//           break;
//         }
//       }

//       if (!found && !hadError) {
//         // 모든 시도 404
//         isRegisteredEmoji = "❌";
//       }

//       results.push({
//         rowIndex: member.rowIndex,
//         memberId,
//         isRegisteredEmoji,
//         memberGradeNoCell,
//         joinDateCell,
//         orders3mCell,
//         hadError,
//       });

//       // Cafe24 레이트 리밋 보호 (info 라우트 내부도 보호하지만 여기도 대기)
//       await sleep(250);
//     }

//     // 4) 시트에 쓰기
//     // - AC: 회원ID
//     // - AD: 가입여부(⭕/❌)
//     // - AE: 등급번호(숫자)
//     // - AF: 가입일(YYYY-MM-DD)
//     // - AG: 최근3개월 구매건수(숫자)
//     const sorted = results.sort((a, b) => a.rowIndex - b.rowIndex);
//     const maxRowIndex = sorted.length ? sorted[sorted.length - 1].rowIndex : 1;
//     const rowsMatrix: (string | number)[][] = Array.from({ length: Math.max(0, maxRowIndex - 1) }, () => [
//       "",
//       "",
//       "",
//       "",
//       "",
//     ]);

//     for (const r of sorted) {
//       const i = r.rowIndex - 2; // 0-based for AC row
//       if (i < 0 || i >= rowsMatrix.length) continue;
//       rowsMatrix[i] = [
//         r.memberId, // AC
//         r.isRegisteredEmoji, // AD
//         r.memberGradeNoCell, // AE (number | "")
//         r.joinDateCell, // AF
//         r.orders3mCell, // AG (number | "")
//       ];
//     }

//     const writeRange = `${targetSheet}!AC2:AG${maxRowIndex}`;
//     await sheets.spreadsheets.values.update({
//       spreadsheetId,
//       range: writeRange,
//       valueInputOption: "RAW",
//       requestBody: { values: rowsMatrix },
//     });

//     // 5) 요약 통계
//     const summary = {
//       total: results.length,
//       registered: results.filter(r => r.isRegisteredEmoji === "⭕").length,
//       unregistered: results.filter(r => r.isRegisteredEmoji === "❌" && !r.hadError).length,
//       errors: results.filter(r => r.hadError).length,
//     };

//     console.log("[SHEETS] 완료:", summary);

//     return NextResponse.json({
//       success: true,
//       message: `${results.length}명 검증 완료`,
//       statistics: summary,
//     });
//   } catch (error) {
//     console.error("[SHEETS] 작업 실패:", error);
//     return NextResponse.json(
//       { error: "작업에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
//       { status: 500 },
//     );
//   }
// }

// src/app/api/sheets/verify-members/start/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

/** ====== Vercel 실행 환경 힌트 ====== **/
export const runtime = "nodejs";
export const maxDuration = 60;

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

interface SheetMemberRow {
  name: string;
  phone: string;
  rowIndex: number; // 실제 시트의 1-based 로우
}

type SearchMethod = "cellphone" | "member_id";

interface InfoSuccess {
  userId?: string;
  userName?: string;
  memberId: string;
  memberGrade?: string;
  memberGradeNo?: number;
  joinDate?: string;
  totalOrders: number;
  period?: "3months" | "1year";
  shopNo?: number;
  searchMethod?: SearchMethod;
  processingTime?: number;
}

interface InfoError {
  error: string;
  details?: unknown;
}

type RowResult = {
  rowIndex: number;
  memberId: string;
  isRegisteredEmoji: "⭕" | "❌";
  memberGradeNoCell: number | "";
  joinDateCell: string;
  orders3mCell: number | "";
  hadError: boolean;
  attempted: boolean;
};

/** ========= Utils ========= **/
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const toDateCell = (v?: string): string => {
  if (!v) return "";
  if (v.includes("T")) return v.split("T")[0]!;
  if (v.includes(" ")) return v.split(" ")[0]!;
  return v;
};

const isInfoError = (v: unknown): v is InfoError => typeof v === "object" && v !== null && "error" in v;

/** ========= Body 타입 ========= **/
interface StartBody {
  spreadsheetId: string;
  sheetName?: string;
  useEnvCredentials?: boolean;
  serviceAccountKey?: string;
  shopNo?: number;
  startRow?: number; // 기본 2
  limit?: number; // 기본 100
  concurrency?: number; // 기본 2
}

/** ========= 핸들러 ========= **/
export async function POST(req: Request) {
  const SOFT_DEADLINE_MS = Number(process.env.START_SOFT_DEADLINE_MS ?? 45000);
  const startedAt = Date.now();

  try {
    const { spreadsheetId, sheetName, useEnvCredentials, serviceAccountKey, shopNo, startRow, limit, concurrency } =
      (await req.json()) as StartBody;

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }

    const targetSheet = (sheetName || "").trim() || "Sheet1";
    const shopNoNum = Number.isInteger(Number(shopNo)) ? Number(shopNo) : 1;
    const startRowNum = Number.isInteger(Number(startRow)) ? Math.max(2, Number(startRow)) : 2;
    const limitNum = Number.isInteger(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 200) : 100;
    const concurrencyNum = Number.isInteger(Number(concurrency)) ? Math.min(Math.max(Number(concurrency), 1), 5) : 2;

    // Google 인증
    let credentials: GoogleCredentials;
    if (useEnvCredentials ?? true) {
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

    // 1) 배치 범위 읽기: I(이름), J(연락처)
    const endRow = startRowNum + limitNum - 1;
    const readRange = `${targetSheet}!I${startRowNum}:J${endRow}`;
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: readRange,
    });

    const values = sourceResponse.data.values ?? [];
    const rowsLen = values.length;

    if (rowsLen === 0) {
      return NextResponse.json({
        success: true,
        message: "처리할 행이 없습니다.",
        statistics: { total: 0, registered: 0, unregistered: 0, errors: 0 },
        nextStartRow: null,
        processedRange: { startRow: startRowNum, endRow: startRowNum - 1 },
        used: { limit: limitNum, concurrency: concurrencyNum },
      });
    }

    const batchMembers: SheetMemberRow[] = values.map((row, idx) => ({
      name: (row?.[0] ?? "").toString().trim(),
      phone: (row?.[1] ?? "").toString().trim(),
      rowIndex: startRowNum + idx,
    }));

    // 2) /api/customer/info 호출 origin
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    // 3) 결과 버퍼
    const results: RowResult[] = Array.from({ length: rowsLen }, (_, i) => ({
      rowIndex: startRowNum + i,
      memberId: "",
      isRegisteredEmoji: "❌",
      memberGradeNoCell: "",
      joinDateCell: "",
      orders3mCell: "",
      hadError: false,
      attempted: false,
    }));

    // 동시성 처리
    let cursor = 0;
    let attemptedCount = 0;

    async function worker(): Promise<void> {
      while (cursor < batchMembers.length) {
        if (Date.now() - startedAt > SOFT_DEADLINE_MS) break;

        const myIdx = cursor++;
        const row = batchMembers[myIdx];
        const out = results[myIdx];

        const cleanPhone = row.phone.replace(/\D/g, "");
        const isPhone = /^0\d{9,10}$/.test(cleanPhone);
        if (!isPhone) continue; // attempted=false 유지

        out.attempted = true;
        attemptedCount++;

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
              out.isRegisteredEmoji = "❌";
            } else {
              out.hadError = true;
            }
          } else {
            const payload: InfoSuccess | InfoError = (await resp.json()) as InfoSuccess | InfoError;
            if (isInfoError(payload)) {
              out.hadError = true;
            } else {
              out.memberId = payload.memberId ?? "";
              out.isRegisteredEmoji = "⭕";
              out.memberGradeNoCell = typeof payload.memberGradeNo === "number" ? payload.memberGradeNo : "";
              out.joinDateCell = toDateCell(payload.joinDate);
              out.orders3mCell = typeof payload.totalOrders === "number" ? payload.totalOrders : 0;
            }
          }
        } catch {
          // ← 여기! e 변수 제거해서 ESLint 해결
          out.hadError = true;
        }

        await sleep(150);
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrencyNum; i++) workers.push(worker());
    await Promise.all(workers);

    // 통계 (attempted=true만 집계)
    const stats = {
      total: attemptedCount,
      registered: results.filter(r => r.attempted && r.isRegisteredEmoji === "⭕").length,
      unregistered: results.filter(r => r.attempted && r.isRegisteredEmoji === "❌" && !r.hadError).length,
      errors: results.filter(r => r.attempted && r.hadError).length,
    };

    // 4) 시트에 부분 저장
    const writeMatrix: (string | number)[][] = results.map(r => [
      r.memberId, // AC
      r.isRegisteredEmoji, // AD
      r.memberGradeNoCell, // AE (숫자)
      r.joinDateCell, // AF
      r.orders3mCell, // AG (숫자)
    ]);

    const writeStart = startRowNum;
    const writeEnd = startRowNum + rowsLen - 1;
    const writeRange = `${targetSheet}!AC${writeStart}:AG${writeEnd}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: writeMatrix },
    });

    // 5) 다음 배치 커서
    const nextStartRow = rowsLen < limitNum ? null : startRowNum + limitNum;
    const elapsed = Date.now() - startedAt;
    const msg =
      rowsLen < limitNum
        ? `마지막 배치 처리 완료 (${attemptedCount}명 시도, ${elapsed}ms)`
        : `배치 처리 완료 (${attemptedCount}명 시도, ${elapsed}ms)`;

    return NextResponse.json({
      success: true,
      message: msg,
      statistics: stats,
      nextStartRow,
      processedRange: { startRow: writeStart, endRow: writeEnd },
      used: { limit: limitNum, concurrency: concurrencyNum },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "작업에 실패했습니다", details: msg }, { status: 500 });
  }
}
