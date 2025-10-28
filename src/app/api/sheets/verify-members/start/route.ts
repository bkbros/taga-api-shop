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

    // H, I:J 함께 읽기 (H: 회원ID, I: 이름, J: 전화번호)
    const [idRes, inRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${targetSheet}!H${startRow}:H${endRow}` }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${targetSheet}!I${startRow}:J${endRow}` }),
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
        let hadError = false;

        const normalizedPhone = normalizeKoreanCellphone(member.phone);

        console.log(
          `[DEBUG] Row ${member.rowIndex}: phone="${member.phone}", existingId="${member.existingId}", normalizedPhone="${normalizedPhone}"`,
        );

        if (!normalizedPhone && !member.existingId) {
          // 조회 자체가 불가 (전화번호도 회원ID도 없음)
          hadError = true;
          return {
            rowIndex: member.rowIndex,
            memberId,
            isRegisteredEmoji,
            gradeNoCell,
            joinDateCell,
            hadError,
          };
        }

        try {
          let found = false;

          // 1차: 전화번호로 검색
          if (normalizedPhone) {
            const params1 = new URLSearchParams({
              user_id: normalizedPhone,
              period: "3months",
              shop_no: String(shopNoNum),
              guess: "1",
            });
            params1.set("phone_hint", normalizedPhone);

            const resp1 = await fetch(`${origin}/api/customer/info?${params1.toString()}`, { method: "GET" });

            if (resp1.ok) {
              const payload: InfoSuccess | InfoError = await resp1.json();
              if (!isInfoError(payload)) {
                memberId = payload.memberId ?? "";
                isRegisteredEmoji = "⭕";
                gradeNoCell = typeof payload.memberGradeNo === "number" ? payload.memberGradeNo : "";
                joinDateCell = toDateCell(payload.joinDate);
                found = true;
              }
            } else if (resp1.status !== 404) {
              // 404가 아닌 에러는 hadError 처리
              hadError = true;
            }
          }

          // 2차: 전화번호로 못 찾았고 회원 ID가 있으면 재시도
          if (!found && member.existingId) {
            console.log(`[DEBUG] 2차 검색 시작: 회원ID="${member.existingId}"`);
            const params2 = new URLSearchParams({
              user_id: member.existingId,
              period: "3months",
              shop_no: String(shopNoNum),
              guess: "1",
            });
            if (normalizedPhone) params2.set("phone_hint", normalizedPhone);

            const resp2 = await fetch(`${origin}/api/customer/info?${params2.toString()}`, { method: "GET" });

            if (resp2.ok) {
              const payload: InfoSuccess | InfoError = await resp2.json();
              if (!isInfoError(payload)) {
                memberId = payload.memberId ?? "";
                isRegisteredEmoji = "⭕";
                gradeNoCell = typeof payload.memberGradeNo === "number" ? payload.memberGradeNo : "";
                joinDateCell = toDateCell(payload.joinDate);
                found = true;
              }
            } else if (resp2.status !== 404) {
              hadError = true;
            }
          }

          // 둘 다 404면 미가입
          if (!found && !hadError) {
            isRegisteredEmoji = "❌";
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
          hadError,
        };
      };
    });

    const outputs = await runPool<RowOutput>(tasks, concurrency);

    // 시트 쓰기 AC~AF (구매건수 제거)
    const lastRow = inputs.length > 0 ? inputs[inputs.length - 1].rowIndex : endRow;
    const rowsMatrix: (string | number)[][] = Array.from({ length: Math.max(0, lastRow - startRow + 1) }, () => [
      "",
      "",
      "",
      "",
    ]);

    for (const r of outputs) {
      const idx = r.rowIndex - startRow; // 0-based
      if (idx < 0 || idx >= rowsMatrix.length) continue;
      rowsMatrix[idx] = [r.memberId, r.isRegisteredEmoji, r.gradeNoCell, r.joinDateCell];
    }

    if (rowsMatrix.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${targetSheet}!AC${startRow}:AF${startRow + rowsMatrix.length - 1}`,
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
