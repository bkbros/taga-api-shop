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

// type InfoSuccess = {
//   userId?: string;
//   userName?: string;
//   memberId: string;
//   memberGrade?: string;
//   memberGradeNo?: number;
//   joinDate?: string;
//   totalOrders: number;
// };

// type InfoError = { error: string; details?: unknown };

// type RowInput = {
//   rowIndex: number;
//   name: string;
//   phone: string;
//   existingId: string;
// };

// type RowOutput = {
//   rowIndex: number;
//   memberId: string;
//   isRegisteredCell: "⭕" | "❌" | "";
//   gradeNoCell: number | "";
//   joinDateCell: string;
//   orders3mCell: number | "";
//   hadError: boolean;
// };

// /** ========= Utils ========= **/
// function normalizeKoreanCellphone(input: string): string | null {
//   const digits = input.replace(/\D/g, "");
//   if (!digits) return null;
//   if (digits.startsWith("82")) {
//     const rest = digits.slice(2);
//     if (rest.startsWith("10")) return `0${rest}`;
//     if (rest.length >= 2 && rest[0] !== "0") return `0${rest}`;
//   }
//   if (digits.startsWith("10")) return `0${digits}`;
//   if (/^0\d{9,10}$/.test(digits)) return digits;
//   return null;
// }

// const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// const toDateCell = (v?: string): string => {
//   if (!v) return "";
//   if (v.includes("T")) return v.split("T")[0]!;
//   if (v.includes(" ")) return v.split(" ")[0]!;
//   return v;
// };

// const isInfoError = (v: unknown): v is InfoError => typeof v === "object" && v !== null && "error" in v;

// const firstNumberIn = (s?: string): number | undefined => {
//   if (!s) return undefined;
//   const m = s.match(/\d+/);
//   return m ? Number(m[0]) : undefined;
// };

// // 간단 동시성 풀
// async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
//   const results: T[] = [];
//   let i = 0;
//   async function worker() {
//     while (i < tasks.length) {
//       const my = i++;
//       const out = await tasks[my]();
//       results[my] = out;
//     }
//   }
//   const n = Math.max(1, Math.min(concurrency, tasks.length));
//   await Promise.all(Array.from({ length: n }, () => worker()));
//   return results;
// }

// // Google Sheets value 배열이 “완전 빈 블록”인지 판단
// function isBlockAllEmpty(vals: string[][] | undefined): boolean {
//   const rows = vals ?? [];
//   return rows.every(r => {
//     const a = (r?.[0] ?? "").toString().trim();
//     const b = (r?.[1] ?? "").toString().trim();
//     return !a && !b; // 두 칸(I,J) 모두 빈칸
//   });
// }
// function isColumnAllEmpty(vals: string[][] | undefined): boolean {
//   const rows = vals ?? [];
//   return rows.every(r => {
//     const a = (r?.[0] ?? "").toString().trim();
//     return !a; // AC 한 칸
//   });
// }

// /** ========= Handler ========= **/
// export async function POST(req: Request) {
//   try {
//     const {
//       spreadsheetId,
//       sheetName,
//       useEnvCredentials,
//       serviceAccountKey,
//       shopNo,
//       startRow: startRowRaw,
//       limit: limitRaw,
//       concurrency: concurrencyRaw,
//       // 선택: 빈 블록을 몇 개까지 미리 훑을지
//       skipAheadBlocks = 8,
//     } = await req.json();

//     if (!spreadsheetId) {
//       return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
//     }

//     const targetSheet = (sheetName || "").trim() || "Sheet1";
//     const shopNoNum = Number.isInteger(Number(shopNo)) ? Number(shopNo) : 1;
//     const startRow = Number.isInteger(Number(startRowRaw)) ? Number(startRowRaw) : 2; // 헤더 다음
//     const limit = Math.max(1, Math.min(Number(limitRaw ?? 100), 200));
//     const concurrency = Math.max(1, Math.min(Number(concurrencyRaw ?? 2), 5));

//     // Google 인증
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

//     // 읽기 범위
//     const endRow = startRow + limit - 1;

//     // 현재 블록: 입력(I:J) + 기존 ID(AC)
//     const [inRes, idRes] = await Promise.all([
//       sheets.spreadsheets.values.get({ spreadsheetId, range: `${targetSheet}!I${startRow}:J${endRow}` }),
//       sheets.spreadsheets.values.get({ spreadsheetId, range: `${targetSheet}!AC${startRow}:AC${endRow}` }),
//     ]);
//     const inRows = inRes.data.values ?? [];
//     const idRows = idRes.data.values ?? [];

//     const nowBlockEmpty = isBlockAllEmpty(inRows) && isColumnAllEmpty(idRows);

//     // ⛳️ 빈 블록이면, 앞으로 skipAheadBlocks 만큼 미리 훑어서 다음 유효 블록으로 점프
//     if (nowBlockEmpty) {
//       const blocks = Math.max(1, Math.min(Number(skipAheadBlocks), 30)); // 안전상한
//       const ranges: string[] = [];
//       const starts: number[] = [];
//       for (let k = 1; k <= blocks; k++) {
//         const s = startRow + k * limit;
//         const e = s + limit - 1;
//         starts.push(s);
//         ranges.push(`${targetSheet}!I${s}:J${e}`, `${targetSheet}!AC${s}:AC${e}`);
//       }

//       if (ranges.length > 0) {
//         const peek = await sheets.spreadsheets.values.batchGet({
//           spreadsheetId,
//           ranges,
//         });

//         const vrs = peek.data.valueRanges ?? [];
//         let foundStart: number | null = null;

//         for (let i = 0; i < starts.length; i++) {
//           const inVals = vrs[i * 2]?.values ?? [];
//           const acVals = vrs[i * 2 + 1]?.values ?? [];
//           const blockEmpty = isBlockAllEmpty(inVals) && isColumnAllEmpty(acVals);
//           if (!blockEmpty) {
//             foundStart = starts[i];
//             break;
//           }
//         }

//         if (foundStart != null) {
//           return NextResponse.json({
//             success: true,
//             message: `빈 구간을 건너뜀 → 다음 시작 행 ${foundStart}`,
//             statistics: { total: 0, registered: 0, unregistered: 0, errors: 0 },
//             nextStartRow: foundStart,
//             used: { limit, concurrency },
//           });
//         }
//       }

//       // 앞쪽도 전부 비어있으면 진짜 끝
//       return NextResponse.json({
//         success: true,
//         message: "더 이상 처리할 행이 없습니다. (빈 구간 이후에도 데이터 없음)",
//         statistics: { total: 0, registered: 0, unregistered: 0, errors: 0 },
//         nextStartRow: null,
//         used: { limit, concurrency },
//       });
//     }

//     // RowInput 구성
//     const inputs: RowInput[] = [];
//     for (let i = 0; i < Math.max(inRows.length, idRows.length); i++) {
//       const rowIndex = startRow + i;
//       const name = (inRows[i]?.[0] ?? "").toString().trim();
//       const phone = (inRows[i]?.[1] ?? "").toString().trim();
//       const existingId = (idRows[i]?.[0] ?? "").toString().trim();
//       if (!name && !phone && !existingId) continue;
//       inputs.push({ rowIndex, name, phone, existingId });
//     }

//     // /api/customer/info 호출 준비
//     const url = new URL(req.url);
//     const origin = `${url.protocol}//${url.host}`;

//     // 429 대응 로컬 재시도
//     const callInfoWithLocalRetry = async (queryUserId: string) => {
//       let lastRes: Response | null = null;
//       for (let attempt = 0; attempt < 3; attempt++) {
//         const resp = await fetch(
//           `${origin}/api/customer/info?` +
//             new URLSearchParams({
//               user_id: queryUserId,
//               period: "3months",
//               shop_no: String(shopNoNum),
//               guess: "1",
//             }),
//           { method: "GET" },
//         );
//         if (resp.status !== 429) return resp;
//         lastRes = resp;
//         const delay = 1200 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
//         await sleep(delay);
//       }
//       return lastRes!;
//     };

//     // 태스크들
//     const tasks: Array<() => Promise<RowOutput>> = inputs.map(member => {
//       return async () => {
//         let memberId = "";
//         let isRegisteredCell: "⭕" | "❌" | "" = "";
//         let gradeNoCell: number | "" = "";
//         let joinDateCell = "";
//         let orders3mCell: number | "" = "";
//         let hadError = false;

//         // 1순위: AC ID, 없으면 휴대폰
//         let queryUserId = member.existingId || "";
//         if (!queryUserId) {
//           const normalized = normalizeKoreanCellphone(member.phone);
//           if (!normalized) {
//             hadError = true;
//             return {
//               rowIndex: member.rowIndex,
//               memberId,
//               isRegisteredCell,
//               gradeNoCell,
//               joinDateCell,
//               orders3mCell,
//               hadError,
//             };
//           }
//           queryUserId = normalized;
//         }

//         try {
//           const resp = await callInfoWithLocalRetry(queryUserId);

//           if (!resp.ok) {
//             if (resp.status === 404) {
//               isRegisteredCell = "❌";
//             } else {
//               hadError = true; // 429/5xx 등은 공백 유지
//             }
//           } else {
//             const payload: InfoSuccess | InfoError = await resp.json();
//             if (isInfoError(payload)) {
//               hadError = true;
//             } else {
//               memberId = payload.memberId ?? "";
//               isRegisteredCell = "⭕";
//               if (typeof payload.memberGradeNo === "number") {
//                 gradeNoCell = payload.memberGradeNo;
//               } else {
//                 const n = firstNumberIn(payload.memberGrade);
//                 gradeNoCell = Number.isFinite(n) ? (n as number) : "";
//               }
//               joinDateCell = toDateCell(payload.joinDate);
//               orders3mCell = typeof payload.totalOrders === "number" ? payload.totalOrders : 0;
//             }
//           }
//         } catch {
//           hadError = true;
//         }

//         await sleep(150); // 추가 완충
//         return {
//           rowIndex: member.rowIndex,
//           memberId,
//           isRegisteredCell,
//           gradeNoCell,
//           joinDateCell,
//           orders3mCell,
//           hadError,
//         };
//       };
//     });

//     // 동시 실행
//     const outputs = await runPool<RowOutput>(tasks, concurrency);

//     // 시트 쓰기 (AC~AG)
//     const lastRow = inputs.length > 0 ? inputs[inputs.length - 1].rowIndex : endRow;
//     const rowsMatrix: (string | number)[][] = Array.from({ length: Math.max(0, lastRow - startRow + 1) }, () => [
//       "",
//       "",
//       "",
//       "",
//       "",
//     ]);

//     for (const r of outputs) {
//       const idx = r.rowIndex - startRow;
//       if (idx < 0 || idx >= rowsMatrix.length) continue;
//       rowsMatrix[idx] = [r.memberId, r.isRegisteredCell, r.gradeNoCell, r.joinDateCell, r.orders3mCell];
//     }

//     if (rowsMatrix.length > 0) {
//       await sheets.spreadsheets.values.update({
//         spreadsheetId,
//         range: `${targetSheet}!AC${startRow}:AG${startRow + rowsMatrix.length - 1}`,
//         valueInputOption: "RAW",
//         requestBody: { values: rowsMatrix },
//       });
//     }

//     // 통계 & 다음 시작 행
//     const stats = {
//       total: outputs.length,
//       registered: outputs.filter(o => o.isRegisteredCell === "⭕").length,
//       unregistered: outputs.filter(o => o.isRegisteredCell === "❌").length,
//       errors: outputs.filter(o => o.hadError).length,
//     };
//     const processedAny = inputs.length > 0;
//     const nextStartRow = processedAny ? endRow + 1 : null;

//     return NextResponse.json({
//       success: true,
//       message: `${outputs.length}행 처리 완료 (AC~AG 반영)`,
//       statistics: stats,
//       nextStartRow,
//       processedRange: rowsMatrix.length > 0 ? { startRow, endRow: startRow + rowsMatrix.length - 1 } : undefined,
//       used: { limit, concurrency },
//     });
//   } catch (error) {
//     return NextResponse.json(
//       { error: "작업에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
//       { status: 500 },
//     );
//   }
// }
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

type InfoSuccess = {
  memberId: string;
  memberGrade?: string;
  memberGradeNo?: number;
  joinDate?: string;
  totalOrders: number;
};
type InfoError = { error: string; details?: unknown };

type RowInput = {
  rowIndex: number;
  name: string;
  phone: string;
  existingId: string;
};
type RowOutput = {
  rowIndex: number;
  memberId: string;
  isRegisteredEmoji: "⭕" | "❌";
  gradeNoCell: number | "";
  joinDateCell: string;
  orders3mCell: number | "";
  hadError: boolean;
};

/** ========= Utils ========= **/
function normalizeKoreanCellphone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("82")) {
    const rest = digits.slice(2);
    if (rest.startsWith("10")) return `0${rest}`;
    if (rest.length >= 2 && rest[0] !== "0") return `0${rest}`;
  }
  if (digits.startsWith("10")) return `0${digits}`;
  if (/^0\d{9,10}$/.test(digits)) return digits;
  return null;
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const toDateCell = (v?: string): string => {
  if (!v) return "";
  if (v.includes("T")) return v.split("T")[0]!;
  if (v.includes(" ")) return v.split(" ")[0]!;
  return v;
};
const isInfoError = (v: unknown): v is InfoError => typeof v === "object" && v !== null && "error" in v;

async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const my = i++;
      const out = await tasks[my]();
      results[my] = out;
    }
  }
  const n = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** ========= Handler ========= **/
export async function POST(req: Request) {
  try {
    const {
      spreadsheetId,
      sheetName,
      useEnvCredentials,
      serviceAccountKey,
      shopNo,
      startRow: startRowRaw,
      limit: limitRaw,
      concurrency: concurrencyRaw,
    } = await req.json();

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }

    const targetSheet = (sheetName || "").trim() || "Sheet1";
    const shopNoNum = Number.isInteger(Number(shopNo)) ? Number(shopNo) : 1;
    const startRow = Number.isInteger(Number(startRowRaw)) ? Number(startRowRaw) : 2;
    const limit = Math.max(1, Math.min(Number(limitRaw ?? 100), 200));
    const concurrency = Math.max(1, Math.min(Number(concurrencyRaw ?? 2), 5));

    // Google 인증
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

    // 읽기 범위
    const endRow = startRow + limit - 1;

    // I:J + AC 함께 읽기
    const [inRes, idRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${targetSheet}!I${startRow}:J${endRow}` }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${targetSheet}!AC${startRow}:AC${endRow}` }),
    ]);
    const inRows = inRes.data.values ?? [];
    const idRows = idRes.data.values ?? [];

    const allEmpty =
      inRows.every(r => !(r?.[0] ?? "").toString().trim() && !(r?.[1] ?? "").toString().trim()) &&
      idRows.every(r => !(r?.[0] ?? "").toString().trim());
    if (allEmpty) {
      return NextResponse.json({
        success: true,
        message: "더 이상 처리할 행이 없습니다.",
        statistics: { total: 0, registered: 0, unregistered: 0, errors: 0 },
        nextStartRow: null,
        used: { limit, concurrency },
      });
    }

    // 입력 조립
    const inputs: RowInput[] = [];
    for (let i = 0; i < Math.max(inRows.length, idRows.length); i++) {
      const rowIndex = startRow + i;
      const name = (inRows[i]?.[0] ?? "").toString().trim();
      const phone = (inRows[i]?.[1] ?? "").toString().trim();
      const existingId = (idRows[i]?.[0] ?? "").toString().trim();
      if (!name && !phone && !existingId) continue;
      inputs.push({ rowIndex, name, phone, existingId });
    }

    // origin
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    // 태스크
    const tasks: Array<() => Promise<RowOutput>> = inputs.map(member => {
      return async () => {
        let memberId = "";
        let isRegisteredEmoji: "⭕" | "❌" = "❌";
        let gradeNoCell: number | "" = "";
        let joinDateCell = "";
        let orders3mCell: number | "" = "";
        let hadError = false;

        const normalizedPhone = normalizeKoreanCellphone(member.phone);
        const queryUserId = member.existingId || normalizedPhone || "";

        if (!queryUserId) {
          // 조회 자체가 불가
          hadError = true;
          return {
            rowIndex: member.rowIndex,
            memberId,
            isRegisteredEmoji,
            gradeNoCell,
            joinDateCell,
            orders3mCell,
            hadError,
          };
        }

        try {
          const params = new URLSearchParams({
            user_id: queryUserId,
            period: "3months",
            shop_no: String(shopNoNum),
            guess: "1",
          });
          if (normalizedPhone) params.set("phone_hint", normalizedPhone); // 👈 항상 phone_hint 전달

          const resp = await fetch(`${origin}/api/customer/info?${params.toString()}`, { method: "GET" });

          if (!resp.ok) {
            if (resp.status === 404) {
              isRegisteredEmoji = "❌";
            } else {
              hadError = true;
            }
          } else {
            const payload: InfoSuccess | InfoError = await resp.json();
            if (isInfoError(payload)) {
              hadError = true;
            } else {
              memberId = payload.memberId ?? "";
              isRegisteredEmoji = "⭕";
              gradeNoCell = typeof payload.memberGradeNo === "number" ? payload.memberGradeNo : "";
              joinDateCell = toDateCell(payload.joinDate);
              orders3mCell = typeof payload.totalOrders === "number" ? payload.totalOrders : 0;
            }
          }
        } catch {
          hadError = true;
        }

        await sleep(120); // 추가 보호
        return {
          rowIndex: member.rowIndex,
          memberId,
          isRegisteredEmoji,
          gradeNoCell,
          joinDateCell,
          orders3mCell,
          hadError,
        };
      };
    });

    const outputs = await runPool<RowOutput>(tasks, concurrency);

    // 시트 쓰기 AC~AG
    const lastRow = inputs.length > 0 ? inputs[inputs.length - 1].rowIndex : endRow;
    const rowsMatrix: (string | number)[][] = Array.from({ length: Math.max(0, lastRow - startRow + 1) }, () => [
      "",
      "",
      "",
      "",
      "",
    ]);

    for (const r of outputs) {
      const idx = r.rowIndex - startRow; // 0-based
      if (idx < 0 || idx >= rowsMatrix.length) continue;
      rowsMatrix[idx] = [r.memberId, r.isRegisteredEmoji, r.gradeNoCell, r.joinDateCell, r.orders3mCell];
    }

    if (rowsMatrix.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${targetSheet}!AC${startRow}:AG${startRow + rowsMatrix.length - 1}`,
        valueInputOption: "RAW",
        requestBody: { values: rowsMatrix },
      });
    }

    // 통계 & next
    const stats = {
      total: outputs.length,
      registered: outputs.filter(o => o.isRegisteredEmoji === "⭕").length,
      unregistered: outputs.filter(o => o.isRegisteredEmoji === "❌" && !o.hadError).length,
      errors: outputs.filter(o => o.hadError).length,
    };
    const nextStartRow = inputs.length > 0 ? endRow + 1 : null;

    return NextResponse.json({
      success: true,
      message: `${outputs.length}행 처리 완료 (AC~AG 반영)`,
      statistics: stats,
      nextStartRow,
      processedRange: rowsMatrix.length > 0 ? { startRow, endRow: startRow + rowsMatrix.length - 1 } : undefined,
      used: { limit, concurrency },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "작업에 실패했습니다", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
