// src/app/api/sheets/check-product-purchases/route.ts
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

type CheckProductsSuccess = {
  memberId: string;
  hasPurchased: boolean;
  purchasedProducts: Array<{
    productNo: number;
    productCode?: string;
    productName?: string;
    orderId: string;
    orderDate?: string;
    quantity: number;
  }>;
  specifiedProductsQuantity: number; // 지정 상품들만의 총 수량
  totalQuantity: number; // 전체 구매 총 수량
  specifiedProductsOrderCount: number; // 지정 상품이 포함된 주문 건수
  totalOrderCount: number; // 전체 주문 건수
  orderIds: string[];
};

type CheckProductsError = { error: string; details?: unknown };

type RowInput = {
  rowIndex: number;
  memberId: string;
};

type RowOutput = {
  rowIndex: number;
  memberId: string;
  purchasedProductNamesCell: string; // AH: 구매한 상품 목록
  totalQuantityCell: number | ""; // AI: 전체 구매 총 수량
  totalOrderCountCell: number | ""; // AJ: 전체 주문 건수
  specifiedProductDetailsCell: string; // AK: 지정 상품 상세 정보
  hadError: boolean;
};

/** ========= Utils ========= **/
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const isCheckProductsError = (v: unknown): v is CheckProductsError =>
  typeof v === "object" && v !== null && "error" in v;

// 열 문자를 숫자로 변환 (A=1, B=2, ..., Z=26, AA=27, AB=28, ...)
function columnLetterToNumber(col: string): number {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

// 숫자를 열 문자로 변환 (1=A, 2=B, ..., 26=Z, 27=AA, 28=AB, ...)
function getColumnLetter(num: number): string {
  let letter = "";
  while (num > 0) {
    const mod = (num - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    num = Math.floor((num - 1) / 26);
  }
  return letter;
}

// 간단 동시성 풀
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

// Google Sheets value 배열이 완전 빈지 판단
function isColumnAllEmpty(vals: string[][] | undefined): boolean {
  const rows = vals ?? [];
  return rows.every(r => {
    const a = (r?.[0] ?? "").toString().trim();
    return !a;
  });
}

/** ========= Handler ========= **/
/**
 * POST /api/sheets/check-product-purchases
 *
 * Body:
 * {
 *   spreadsheetId: string,        // Google Sheets ID
 *   sheetName: string,             // 시트 이름 (기본: "Sheet1")
 *   memberIdColumn: string,        // 회원 ID가 있는 열 (예: "A", "AC")
 *   outputStartColumn: string,     // 결과를 쓸 시작 열 (예: "AH")
 *   productNos: string,            // 확인할 상품 번호들 (쉼표로 구분, 예: "123,456")
 *   startRow: number,              // 시작 행 (기본: 2)
 *   limit: number,                 // 배치 크기 (기본: 100)
 *   concurrency: number,           // 동시성 (기본: 2)
 *   startDate?: string,            // 시작일 (YYYY-MM-DD, 선택)
 *   endDate?: string,              // 종료일 (YYYY-MM-DD, 선택)
 *   shopNo?: number,               // 쇼핑몰 번호 (기본: 1)
 *   orderStatus?: string,          // 주문 상태 (기본: "N40,N50")
 *   useEnvCredentials?: boolean,   // 환경변수 사용 여부
 *   serviceAccountKey?: string,    // Google 서비스 계정 키 (JSON)
 * }
 */
export async function POST(req: Request) {
  try {
    const {
      spreadsheetId,
      sheetName,
      memberIdColumn,
      outputStartColumn,
      productNos,
      useEnvCredentials,
      serviceAccountKey,
      shopNo,
      startRow: startRowRaw,
      limit: limitRaw,
      concurrency: concurrencyRaw,
      startDate,
      endDate,
      orderStatus,
    } = await req.json();

    // 파라미터 검증
    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId가 필요합니다" }, { status: 400 });
    }
    if (!memberIdColumn) {
      return NextResponse.json({ error: "memberIdColumn이 필요합니다 (예: 'AC')" }, { status: 400 });
    }
    if (!outputStartColumn) {
      return NextResponse.json({ error: "outputStartColumn이 필요합니다 (예: 'AH')" }, { status: 400 });
    }
    if (!productNos) {
      return NextResponse.json({ error: "productNos가 필요합니다 (예: '123,456,789')" }, { status: 400 });
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
        return NextResponse.json({ error: "환경변수 GOOGLE_CRED_JSON이 설정되지 않았습니다" }, { status: 500 });
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

    // 읽기 범위 계산
    const endRow = startRow + limit - 1;
    const memberIdRange = `${targetSheet}!${memberIdColumn}${startRow}:${memberIdColumn}${endRow}`;

    // 회원 ID 읽기
    const idRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: memberIdRange });
    const idRows = idRes.data.values ?? [];

    // 빈 블록 체크
    if (isColumnAllEmpty(idRows)) {
      return NextResponse.json({
        success: true,
        message: "처리할 회원 ID가 없습니다 (빈 구간)",
        statistics: { total: 0, hasPurchased: 0, notPurchased: 0, errors: 0 },
        nextStartRow: null,
        used: { limit, concurrency },
      });
    }

    // RowInput 구성
    const inputs: RowInput[] = [];
    for (let i = 0; i < idRows.length; i++) {
      const rowIndex = startRow + i;
      const memberId = (idRows[i]?.[0] ?? "").toString().trim();
      if (!memberId) continue;
      inputs.push({ rowIndex, memberId });
    }

    if (inputs.length === 0) {
      return NextResponse.json({
        success: true,
        message: "유효한 회원 ID가 없습니다",
        statistics: { total: 0, hasPurchased: 0, notPurchased: 0, errors: 0 },
        nextStartRow: endRow + 1,
        used: { limit, concurrency },
      });
    }

    // /api/customer/check-products 호출 준비
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    // 429 대응 로컬 재시도
    const callCheckProductsWithRetry = async (memberId: string) => {
      let lastRes: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const params = new URLSearchParams({
          member_id: memberId,
          product_nos: productNos,
          shop_no: String(shopNoNum),
        });
        if (startDate) params.append("start_date", startDate);
        if (endDate) params.append("end_date", endDate);
        if (orderStatus) params.append("order_status", orderStatus);

        const resp = await fetch(`${origin}/api/customer/check-products?${params}`, { method: "GET" });
        if (resp.status !== 429) return resp;
        lastRes = resp;
        const delay = 1200 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
        await sleep(delay);
      }
      return lastRes!;
    };

    // 태스크들
    const tasks: Array<() => Promise<RowOutput>> = inputs.map(member => {
      return async () => {
        let purchasedProductNamesCell = ""; // AH: 구매한 상품 목록
        let totalQuantityCell: number | "" = ""; // AI: 전체 구매 총 수량
        let totalOrderCountCell: number | "" = ""; // AJ: 전체 주문 건수
        let specifiedProductDetailsCell = ""; // AK: 지정 상품 상세 정보
        let hadError = false;

        try {
          const resp = await callCheckProductsWithRetry(member.memberId);

          if (!resp.ok) {
            if (resp.status === 404) {
              purchasedProductNamesCell = "없음";
              totalQuantityCell = 0;
              totalOrderCountCell = 0;
            } else {
              hadError = true; // 429/5xx 등은 공백 유지
            }
          } else {
            const payload: CheckProductsSuccess | CheckProductsError = await resp.json();
            if (isCheckProductsError(payload)) {
              hadError = true;
            } else {
              // AH: 구매한 상품 목록 (지정 상품 중 실제 구매한 것들)
              if (payload.purchasedProducts.length > 0) {
                const uniqueProductNames = Array.from(
                  new Set(payload.purchasedProducts.map(p => p.productName || `상품${p.productNo}`))
                );
                purchasedProductNamesCell = uniqueProductNames.join(", ");
              } else {
                purchasedProductNamesCell = "없음";
              }

              // AI: 전체 구매 총 수량 (기간 내 모든 상품)
              totalQuantityCell = payload.totalQuantity;

              // AJ: 전체 주문 건수 (기간 내 모든 주문)
              totalOrderCountCell = payload.totalOrderCount;

              // AK: 지정 상품 상세 정보
              if (payload.purchasedProducts.length > 0) {
                const productDetails = payload.purchasedProducts
                  .map(p => `${p.productName || p.productNo}(x${p.quantity})`)
                  .join(", ");
                specifiedProductDetailsCell = productDetails.substring(0, 500); // 시트 셀 크기 제한 고려
              }
            }
          }
        } catch (err) {
          console.error(`[ERROR] memberId=${member.memberId}`, err);
          hadError = true;
        }

        await sleep(150); // 추가 완충
        return {
          rowIndex: member.rowIndex,
          memberId: member.memberId,
          purchasedProductNamesCell,
          totalQuantityCell,
          totalOrderCountCell,
          specifiedProductDetailsCell,
          hadError,
        };
      };
    });

    // 동시 실행
    const outputs = await runPool<RowOutput>(tasks, concurrency);

    // 시트 쓰기 (outputStartColumn부터 4개 열: 구매한상품목록, 전체수량, 전체주문수, 지정상품상세)
    const lastRow = inputs.length > 0 ? inputs[inputs.length - 1].rowIndex : endRow;
    const rowsMatrix: (string | number)[][] = Array.from({ length: Math.max(0, lastRow - startRow + 1) }, () => [
      "",
      "",
      "",
      "",
    ]);

    for (const r of outputs) {
      const idx = r.rowIndex - startRow;
      if (idx < 0 || idx >= rowsMatrix.length) continue;
      rowsMatrix[idx] = [
        r.purchasedProductNamesCell,
        r.totalQuantityCell,
        r.totalOrderCountCell,
        r.specifiedProductDetailsCell,
      ];
    }

    // 열 계산 (예: AH, AI, AJ, AK)
    const colStart = outputStartColumn.toUpperCase();
    const colEnd = getColumnLetter(columnLetterToNumber(colStart) + 3);
    const writeRange = `${targetSheet}!${colStart}${startRow}:${colEnd}${lastRow}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rowsMatrix },
    });

    // 통계
    const stats = {
      total: outputs.length,
      hasPurchased: outputs.filter(o => o.purchasedProductNamesCell && o.purchasedProductNamesCell !== "없음")
        .length,
      notPurchased: outputs.filter(o => o.purchasedProductNamesCell === "없음").length,
      errors: outputs.filter(o => o.hadError).length,
    };

    const hasMore = idRows.length >= limit;
    const nextStartRow = hasMore ? endRow + 1 : null;

    return NextResponse.json({
      success: true,
      message: `${stats.total}개 회원 처리 완료 (구매: ${stats.hasPurchased}, 미구매: ${stats.notPurchased}, 오류: ${stats.errors})`,
      statistics: stats,
      nextStartRow,
      processedRange: { startRow, endRow: lastRow },
      used: { limit, concurrency },
    });
  } catch (error: unknown) {
    console.error("[ERROR] check-product-purchases failed", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "상품 구매 확인 실패", details: errMsg }, { status: 500 });
  }
}
