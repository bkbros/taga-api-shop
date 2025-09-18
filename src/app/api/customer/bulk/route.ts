// app/api/customer/bulk/route.ts
import { NextResponse } from "next/server";
import { loadParams } from "@/lib/ssm";
import { AxiosResponse } from "axios";
import { mapPool } from "@/lib/pool";
import { RateLimiter, cafe24Get } from "@/lib/rate-limit";

/** ---- 필요한 타입들 (요약) ---- */
type Period = "3months" | "1year";
type StrategyName = "cellphone" | "member_id";

type Customer = {
  user_id: string;
  user_name?: string;
  member_id: string;
  created_date?: string;
  email?: string;
  phone?: string;
  last_login_date?: string;
  group?: { group_name?: string };
};
type CustomersResponse = { customers: Customer[] };
type OrdersCountResponse = { count: number };
type OrdersListOrder = { order_price_amount?: string };
type OrdersListResponse = { orders: OrdersListOrder[] };

type SingleOk = {
  input: string;
  ok: true;
  data: {
    userId?: string;
    userName?: string;
    memberGrade?: string;
    joinDate?: string;
    totalPurchaseAmount: number;
    totalOrders: number;
    email?: string;
    phone?: string;
    lastLoginDate?: string;
    memberId: string;
    period: Period;
    shopNo: number;
    searchMethod: StrategyName;
  };
};
type SingleErr = { input: string; ok: false; error: { code: string; message: string; details?: unknown } };
type SingleResult = SingleOk | SingleErr;

/** ---- KST 유틸: 네 /api/customer/info 코드에서 쓰던 걸 그대로 붙여넣기 ---- */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");
function fmtKST(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())} ${pad2(k.getUTCHours())}:${pad2(
    k.getUTCMinutes(),
  )}:${pad2(k.getUTCSeconds())}`;
}
function fromKst(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  const utc = Date.UTC(y, m - 1, d, hh, mm, ss);
  return new Date(utc - KST_OFFSET_MS);
}
function getKstYmd(d: Date): { y: number; m: number; d: number } {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}
function kstStartOfDay(d: Date): Date {
  const { y, m, d: dd } = getKstYmd(d);
  return fromKst(y, m, dd, 0, 0, 0);
}
function kstEndOfDay(d: Date): Date {
  const { y, m, d: dd } = getKstYmd(d);
  return fromKst(y, m, dd, 23, 59, 59);
}
function addMonthsKST(base: Date, months: number): Date {
  const k = new Date(base.getTime() + KST_OFFSET_MS);
  k.setUTCMonth(k.getUTCMonth() + months);
  return new Date(k.getTime() - KST_OFFSET_MS);
}
function clampCafe24WindowKST(startKstDay: Date, capKstDay: Date): { s: Date; e: Date } {
  const s = kstStartOfDay(startKstDay);
  const maxEnd = addMonthsKST(s, +3);
  maxEnd.setUTCSeconds(maxEnd.getUTCSeconds() - 1);
  const capEnd = kstEndOfDay(capKstDay);
  const e = new Date(Math.min(maxEnd.getTime(), capEnd.getTime()));
  return { s, e };
}

/** ---- 액수 파싱 ---- */
// const toAmount = (v: unknown): number => {
//   const n = Number(v);
//   return Number.isFinite(n) ? n : 0;
// };

/** ---- 단건 처리 ---- */
async function fetchOne(
  input: string,
  ctx: {
    mallId: string;
    token: string;
    shopNo: number;
    period: Period;
    guess: boolean;
    limiter: RateLimiter;
  },
): Promise<SingleResult> {
  const { mallId, token, shopNo, period, guess, limiter } = ctx;

  console.log(`[FETCH_ONE] 처리 시작: ${input}`);

  try {

  // 입력 전처리
  let raw = input;
  try {
    raw = decodeURIComponent(input).trim();
  } catch {}
  const digits = raw.replace(/\D/g, "");
  const isPhone = /^0\d{9,10}$/.test(digits);
  const isNumericOnly = /^\d+$/.test(raw);

  const headers = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2025-06-01" };

  // 고객 찾기
  let memberId: string | undefined;
  let searchMethod: StrategyName | undefined;

  if (isPhone) {
    // cellphone
    const res: AxiosResponse<CustomersResponse> = await cafe24Get<CustomersResponse>(
      limiter,
      `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
      { params: { limit: 1, cellphone: digits }, headers, timeout: 8000 },
    );
    const c = res.data?.customers?.[0];
    if (c?.member_id || c?.user_id) {
      memberId = c.member_id || c.user_id;
      searchMethod = "cellphone";
    }
  } else if (isNumericOnly) {
    const candidates = guess ? [raw, `${raw}@k`, `${raw}@n`] : [raw];
    for (const cand of candidates) {
      const t: AxiosResponse<CustomersResponse> = await cafe24Get<CustomersResponse>(
        limiter,
        `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
        { params: { limit: 1, member_id: cand }, headers, timeout: 8000 },
      );
      if (t.data?.customers?.length) {
        memberId = t.data.customers[0].member_id || t.data.customers[0].user_id;
        searchMethod = "member_id";
        break;
      }
    }
  } else {
    // member_id
    const res: AxiosResponse<CustomersResponse> = await cafe24Get<CustomersResponse>(
      limiter,
      `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
      { params: { limit: 1, member_id: raw }, headers, timeout: 8000 },
    );
    const c = res.data?.customers?.[0];
    if (c?.member_id || c?.user_id) {
      memberId = c.member_id || c.user_id;
      searchMethod = "member_id";
    }
  }

  if (!memberId || !searchMethod) {
    console.log(`[FETCH_ONE] 고객 찾기 실패: ${input}`);
    return { input, ok: false, error: { code: "CUSTOMER_NOT_FOUND", message: "고객을 찾지 못했습니다." } };
  }

  console.log(`[FETCH_ONE] 고객 발견: ${input} -> ${memberId} (${searchMethod})`);

  // 고객 정보(응답 필드용)
  const cRes: AxiosResponse<CustomersResponse> = await cafe24Get<CustomersResponse>(
    limiter,
    `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
    { params: { limit: 1, member_id: memberId }, headers, timeout: 8000 },
  );
  const customer = cRes.data.customers[0];

  // 기간 계산 (KST/3개월 제한)
  let totalOrders = 0;
  let totalAmount = 0;
  const now = new Date();

  if (period === "3months") {
    const { s, e } = clampCafe24WindowKST(addMonthsKST(now, -3), now);
    const startStr = fmtKST(s);
    const endStr = fmtKST(e);

    const cnt: AxiosResponse<OrdersCountResponse> = await cafe24Get<OrdersCountResponse>(
      limiter,
      `https://${mallId}.cafe24api.com/api/v2/admin/orders/count`,
      {
        params: {
          shop_no: shopNo,
          start_date: startStr,
          end_date: endStr,
          member_id: memberId,
          order_status: "N40,N50",
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      },
    );
    totalOrders = cnt.data?.count ?? 0;

    if (totalOrders > 0) {
      // 페이지네이션 합산 (레이트리미터 적용)
      let offset = 0;
      const pageSize = 100;
      while (true) {
        const list: AxiosResponse<OrdersListResponse> = await cafe24Get<OrdersListResponse>(
          limiter,
          `https://${mallId}.cafe24api.com/api/v2/admin/orders`,
          {
            params: {
              shop_no: shopNo,
              start_date: startStr,
              end_date: endStr,
              member_id: memberId,
              order_status: "N40,N50",
              limit: pageSize,
              offset,
            },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000,
          },
        );
        const orders = list.data?.orders ?? [];
        if (orders.length === 0) break;
        totalAmount += orders.reduce((s, o) => s + (o.order_price_amount ? Number(o.order_price_amount) : 0), 0);
        if (orders.length < pageSize) break;
        offset += pageSize;
      }
    }
  } else {
    // 1년은 3개월 창으로 4회 분할
    for (let i = 4; i >= 1; i--) {
      const endEdge = addMonthsKST(now, -(i - 1) * 3);
      const startEdge = addMonthsKST(now, -i * 3);
      const { s, e } = clampCafe24WindowKST(startEdge, endEdge);
      const startStr = fmtKST(s);
      const endStr = fmtKST(e);

      const cnt: AxiosResponse<OrdersCountResponse> = await cafe24Get<OrdersCountResponse>(
        limiter,
        `https://${mallId}.cafe24api.com/api/v2/admin/orders/count`,
        {
          params: {
            shop_no: shopNo,
            start_date: startStr,
            end_date: endStr,
            member_id: memberId,
            order_status: "N40,N50",
          },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 8000,
        },
      );
      const chunkCount = cnt.data?.count ?? 0;
      totalOrders += chunkCount;

      if (chunkCount > 0) {
        let offset = 0;
        const pageSize = 200;
        while (true) {
          const list: AxiosResponse<OrdersListResponse> = await cafe24Get<OrdersListResponse>(
            limiter,
            `https://${mallId}.cafe24api.com/api/v2/admin/orders`,
            {
              params: {
                shop_no: shopNo,
                start_date: startStr,
                end_date: endStr,
                member_id: memberId,
                order_status: "N40,N50",
                limit: pageSize,
                offset,
              },
              headers: { Authorization: `Bearer ${token}` },
              timeout: 8000,
            },
          );
          const orders = list.data?.orders ?? [];
          if (orders.length === 0) break;
          totalAmount += orders.reduce((s, o) => s + (o.order_price_amount ? Number(o.order_price_amount) : 0), 0);
          if (orders.length < pageSize) break;
          offset += pageSize;
        }
      }
    }
  }

  console.log(`[FETCH_ONE] 처리 완료: ${input} -> 주문${totalOrders}건, 금액${totalAmount}원`);

  return {
    input,
    ok: true,
    data: {
      userId: customer.user_id,
      userName: customer.user_name,
      memberGrade: customer.group?.group_name || "일반회원",
      joinDate: customer.created_date,
      totalPurchaseAmount: totalAmount,
      totalOrders,
      email: customer.email,
      phone: customer.phone,
      lastLoginDate: customer.last_login_date,
      memberId,
      period,
      shopNo,
      searchMethod,
    },
  };
  } catch (error) {
    console.error(`[FETCH_ONE] ${input} 처리 중 에러:`, error);

    let errorCode = "UNKNOWN_ERROR";
    let errorMessage = "알 수 없는 에러가 발생했습니다";

    if (error instanceof Error) {
      if (error.message.includes("timeout")) {
        errorCode = "TIMEOUT_ERROR";
        errorMessage = "요청 시간이 초과되었습니다";
      } else if (error.message.includes("Network")) {
        errorCode = "NETWORK_ERROR";
        errorMessage = "네트워크 오류가 발생했습니다";
      } else {
        errorMessage = error.message;
      }
    }

    return {
      input,
      ok: false,
      error: {
        code: errorCode,
        message: errorMessage,
        details: error
      }
    };
  }
}

/** ---- 라우트 핸들러 ---- */
type BulkRequest = {
  user_ids: string[];
  period?: Period;
  shop_no?: number;
  guess?: boolean;
  concurrency?: number; // 동시 실행 요청 수 (기본 4~8 권장)
  rps?: number; // 초당 호출 수 (카페24 제한보다 낮게)
  burst?: number; // 버스트(초당 토큰 최대치)
};

export async function POST(req: Request) {
  const startTime = Date.now();
  console.log(`[BULK API] 요청 시작`);

  try {
    const body = (await req.json()) as BulkRequest;

    const userIds = body.user_ids ?? [];
    if (userIds.length === 0) {
      return NextResponse.json({ error: "user_ids is required" }, { status: 400 });
    }

    console.log(`[BULK API] 처리할 사용자 수: ${userIds.length}`);

    const period: Period = body.period ?? "3months";
    const shopNo = body.shop_no ?? 1;
    const guess = body.guess ?? true;

    // 안전한 기본값으로 설정 (800명 이상 처리를 위해)
    const concurrency = Math.max(1, Math.min(body.concurrency ?? 2, 8)); // 동시성을 낮춤
    const rps = Math.max(0.5, Math.min(body.rps ?? 1.5, 5)); // RPS를 낮춤
    const burst = Math.max(1, Math.min(body.burst ?? 3, 10)); // 버스트를 낮춤

    console.log(`[BULK API] 설정 - 동시성: ${concurrency}, RPS: ${rps}, 버스트: ${burst}`);

    const { access_token } = (await loadParams(["access_token"])) as { access_token: string };
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    if (!mallId) {
      throw new Error("NEXT_PUBLIC_CAFE24_MALL_ID가 설정되지 않았습니다");
    }

    const limiter = new RateLimiter(rps, burst);

    try {
      console.log(`[BULK API] 처리 시작 - ${userIds.length}개 아이템`);

      const results = await mapPool<string, SingleResult>(userIds, concurrency, async (uid, index) => {
        try {
          console.log(`[BULK API] 진행: ${index + 1}/${userIds.length} - ${uid}`);
          return await fetchOne(uid, { mallId, token: access_token, shopNo, period, guess, limiter });
        } catch (error) {
          console.error(`[BULK API] ${uid} 처리 중 에러:`, error);
          return {
            input: uid,
            ok: false,
            error: {
              code: "PROCESSING_ERROR",
              message: error instanceof Error ? error.message : "알 수 없는 에러가 발생했습니다",
              details: error
            }
          } as SingleResult;
        }
      });

      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;
      const processingTime = Date.now() - startTime;

      console.log(`[BULK API] 완료 - 성공: ${ok}, 실패: ${fail}, 처리시간: ${processingTime}ms`);

      return NextResponse.json({
        total: results.length,
        ok,
        fail,
        rps,
        concurrency,
        processingTime,
        results,
      });
    } finally {
      limiter.dispose();
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[BULK API] 전체 처리 중 에러 (${processingTime}ms):`, error);

    return NextResponse.json({
      error: "대량 처리 중 오류가 발생했습니다",
      message: error instanceof Error ? error.message : "알 수 없는 에러",
      processingTime
    }, { status: 500 });
  }
}
