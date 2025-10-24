// src/app/api/customer/check-products/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { getAccessToken } from "@/lib/cafe24Auth";

/* -------------------- 타입 -------------------- */
type Cafe24OrderItem = {
  order_item_code: string;
  product_no?: number;
  product_code?: string;
  product_name?: string;
  option_value?: string;
  quantity?: number;
  order_status?: string;
  status?: string;
};

type Cafe24OrderAmount = {
  order_price_amount?: string;
  shipping_fee?: string;
  points_spent_amount?: string;
  credits_spent_amount?: string;
  coupon_discount_price?: string;
  coupon_shipping_fee_amount?: string;
  membership_discount_amount?: string;
  shipping_fee_discount_amount?: string;
  set_product_discount_amount?: string;
  app_discount_amount?: string;
  point_incentive_amount?: string;
  total_amount_due?: string;
  payment_amount?: string;
  market_other_discount_amount?: string;
  tax?: string | null;
};

type Cafe24Order = {
  order_id: string;
  created_date?: string;
  order_status?: string;
  status?: string;
  actual_order_amount?: Cafe24OrderAmount; // 실제 주문 금액 객체
  initial_order_amount?: Cafe24OrderAmount; // 최초 주문 금액 객체
  payment_amount?: string; // 결제 금액 (루트 레벨)
  items?: Cafe24OrderItem[];
};

type CustomerProductCheck = {
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
  allProducts: Array<{
    // 전체 구매 상품 목록
    productNo: number;
    productCode?: string;
    productName?: string;
    quantity: number;
  }>;
  specifiedProductsQuantity: number; // 지정 상품들만의 총 수량
  totalQuantity: number; // 전체 구매 총 수량
  specifiedProductsOrderCount: number; // 지정 상품이 포함된 주문 건수
  totalOrderCount: number; // 전체 주문 건수
  totalAmount: number; // 전체 구매 금액
  orderIds: string[];
};
/* ---------------------------------------------- */

/* -------------------- KST 날짜 유틸 -------------------- */
const KST_MS = 9 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtKST(d: Date): string {
  const k = new Date(d.getTime() + KST_MS);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}

function addMonthsKST(base: Date, months: number): Date {
  const k = new Date(base.getTime() + KST_MS);
  k.setUTCMonth(k.getUTCMonth() + months);
  return new Date(k.getTime() - KST_MS);
}

function addDays(d: Date, days: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}
/* ---------------------------------------------- */

/* -------------------- Rate Limiter -------------------- */
class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private lastRequestAt = 0;
  constructor(private maxConcurrent = 3, private minIntervalMs = 200) {}
  execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = async () => {
        try {
          const now = Date.now();
          const delta = now - this.lastRequestAt;
          if (delta < this.minIntervalMs) {
            await new Promise(r => setTimeout(r, this.minIntervalMs - delta));
          }
          this.lastRequestAt = Date.now();
          const res = await fn();
          resolve(res);
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          this.pump();
        }
      };
      this.queue.push(task);
      this.pump();
    });
  }
  private pump() {
    if (this.running >= this.maxConcurrent) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running++;
    next();
  }
}

const limiter = new RateLimiter(2, 300);

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await limiter.execute(fn);
    } catch (e: unknown) {
      lastErr = e;
      if (axios.isAxiosError(e)) {
        const st = e.response?.status ?? 0;
        if ((st === 429 || st >= 500) && i < maxRetries) {
          const jitter = Math.floor(Math.random() * 300);
          const delay = baseDelay * Math.pow(2, i) + jitter;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      break;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error(String(lastErr));
}
/* ---------------------------------------------- */

/**
 * GET /api/customer/check-products
 *
 * Query Parameters:
 * - member_id (required): 회원 로그인 아이디
 * - product_nos (required): 확인할 상품 번호들 (쉼표로 구분, 예: "123,456,789")
 * - start_date (optional): 시작일 (YYYY-MM-DD, 기본: 3개월 전)
 * - end_date (optional): 종료일 (YYYY-MM-DD, 기본: 오늘)
 * - shop_no (optional): 쇼핑몰 번호 (기본: 1)
 * - order_status (optional): 주문 상태 필터 (기본: "N40,N50" - 배송완료/구매확정)
 */
export async function GET(req: Request) {
  const startT = Date.now();

  try {
    const url = new URL(req.url);
    const memberId = url.searchParams.get("member_id");
    const productNosParam = url.searchParams.get("product_nos");
    const startDateParam = url.searchParams.get("start_date");
    const endDateParam = url.searchParams.get("end_date");
    const shopNo = Number(url.searchParams.get("shop_no") ?? "1") || 1;
    const orderStatus = url.searchParams.get("order_status") || "N40,N50";

    // 파라미터 검증
    if (!memberId) {
      return NextResponse.json({ error: "member_id parameter is required" }, { status: 400 });
    }
    if (!productNosParam) {
      return NextResponse.json({ error: "product_nos parameter is required (comma-separated)" }, { status: 400 });
    }

    // 상품 번호 파싱
    const productNos = productNosParam
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(n => !isNaN(n));

    if (productNos.length === 0) {
      return NextResponse.json({ error: "Invalid product_nos format" }, { status: 400 });
    }

    // 날짜 범위 설정
    const now = new Date();
    const threeMonthsAgo = addMonthsKST(now, -3);
    const startDate = startDateParam ? new Date(startDateParam) : threeMonthsAgo;
    const endDate = endDateParam ? new Date(endDateParam) : now;

    console.log(`[CHECK-PRODUCTS] member_id=${memberId}, products=${productNos.join(",")}, period=${fmtKST(startDate)}~${fmtKST(endDate)}`);

    // 토큰 자동 갱신 포함 로드
    const access_token = await getAccessToken();
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID;
    if (!mallId) {
      return NextResponse.json({ error: "Missing NEXT_PUBLIC_CAFE24_MALL_ID" }, { status: 500 });
    }

    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${access_token}`,
      "X-Cafe24-Api-Version": "2025-06-01",
    };

    // 주문 조회 (3개월 윈도우로 분할)
    const allOrders: Cafe24Order[] = [];
    let cursor = new Date(startDate);
    const finalEnd = new Date(endDate);

    while (cursor <= finalEnd) {
      // 3개월 윈도우 계산 (Cafe24 API 제약)
      let windowEnd = addMonthsKST(cursor, 3);
      windowEnd = addDays(windowEnd, -1); // 3개월 - 1일
      if (windowEnd > finalEnd) windowEnd = finalEnd;

      const startStr = fmtKST(cursor);
      const endStr = fmtKST(windowEnd);

      console.log(`[ORDERS] Fetching window: ${startStr} ~ ${endStr}`);

      // 페이지네이션으로 모든 주문 조회
      let offset = 0;
      const limit = 100;

      while (true) {
        const params: Record<string, string | number> = {
          shop_no: shopNo,
          member_id: memberId,
          date_type: "order_date",
          start_date: startStr,
          end_date: endStr,
          embed: "items",
          limit,
          offset,
        };

        if (orderStatus) {
          params.order_status = orderStatus;
        }

        const resp = await withRetry(() =>
          axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
            headers: authHeaders,
            params,
            timeout: 15000,
          })
        );

        const batch: Cafe24Order[] = resp.data?.orders ?? [];

        // 각 주문에 대해 상세 정보 조회하여 정확한 금액 가져오기
        for (const order of batch) {
          try {
            const detailResp = await withRetry(() =>
              axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/${order.order_id}`, {
                headers: authHeaders,
                params: { shop_no: shopNo },
                timeout: 10000,
              })
            );

            const detailOrder = detailResp.data?.order;
            if (detailOrder) {
              // 상세 조회의 금액 정보를 원본 주문 객체에 추가
              order.actual_order_amount = detailOrder.actual_order_amount;
              order.payment_amount = detailOrder.payment_amount;
              order.initial_order_amount = detailOrder.initial_order_amount;
            }
          } catch (e) {
            console.warn(`[WARN] Failed to fetch order detail for ${order.order_id}:`, e);
            // 실패해도 계속 진행 (목록 조회의 금액 정보 사용)
          }
        }

        allOrders.push(...batch);

        console.log(`[ORDERS] Fetched ${batch.length} orders (offset=${offset})`);

        if (batch.length < limit) break;
        offset += limit;
      }

      // 다음 윈도우로 이동
      cursor = addDays(windowEnd, 1);
    }

    console.log(`[ORDERS] Total orders fetched: ${allOrders.length}`);

    // 디버깅: 첫 번째 주문의 금액 필드 확인
    if (allOrders.length > 0) {
      const firstOrder = allOrders[0];
      console.log(`[DEBUG] First order amount fields:`, {
        order_id: firstOrder.order_id,
        actual_order_amount: firstOrder.actual_order_amount,
        payment_amount: firstOrder.payment_amount,
        initial_order_amount: firstOrder.initial_order_amount,
      });
    }

    // 전체 주문 통계 및 전체 상품 목록 계산
    const totalOrderCount = allOrders.length;
    let totalQuantityAllProducts = 0;
    let totalAmount = 0; // 전체 구매 금액
    const allProductsMap = new Map<number, { productNo: number; productCode?: string; productName?: string; quantity: number }>();

    for (const order of allOrders) {
      // 주문 금액 누적 (actual_order_amount.payment_amount 또는 payment_amount 사용)
      let amountStr = "0";
      if (order.actual_order_amount && typeof order.actual_order_amount === "object") {
        amountStr = order.actual_order_amount.payment_amount || "0";
      } else if (order.payment_amount) {
        amountStr = order.payment_amount;
      }
      const amt = Number(amountStr) || 0;
      console.log(`[DEBUG] Order ${order.order_id}: amountStr=${amountStr}, parsed=${amt}`);
      totalAmount += amt;

      const items = order.items ?? [];
      for (const item of items) {
        totalQuantityAllProducts += item.quantity ?? 0;

        // 전체 상품 목록 집계
        if (item.product_no) {
          const existing = allProductsMap.get(item.product_no);
          if (existing) {
            existing.quantity += item.quantity ?? 0;
          } else {
            allProductsMap.set(item.product_no, {
              productNo: item.product_no,
              productCode: item.product_code,
              productName: item.product_name,
              quantity: item.quantity ?? 0,
            });
          }
        }
      }
    }

    const allProducts = Array.from(allProductsMap.values());

    // 특정 상품이 포함된 주문 필터링
    const productSet = new Set(productNos);
    const purchasedProducts: CustomerProductCheck["purchasedProducts"] = [];
    const orderIdSet = new Set<string>();

    // 디버깅: 첫 번째 주문의 아이템 확인
    if (allOrders.length > 0) {
      const firstOrder = allOrders[0];
      const itemProductNos = (firstOrder.items ?? []).map(it => it.product_no);
      console.log(`[DEBUG] First order items product_nos: ${itemProductNos.join(", ")}`);
      console.log(`[DEBUG] Looking for product_nos: ${Array.from(productSet).join(", ")}`);
    }

    for (const order of allOrders) {
      const items = order.items ?? [];
      for (const item of items) {
        if (item.product_no && productSet.has(item.product_no)) {
          console.log(`[MATCH] Found product ${item.product_no} in order ${order.order_id}`);
          purchasedProducts.push({
            productNo: item.product_no,
            productCode: item.product_code,
            productName: item.product_name,
            orderId: order.order_id,
            orderDate: order.created_date,
            quantity: item.quantity ?? 0,
          });
          orderIdSet.add(order.order_id);
        }
      }
    }

    const specifiedProductsQuantity = purchasedProducts.reduce((sum, p) => sum + p.quantity, 0);
    const hasPurchased = purchasedProducts.length > 0;

    const processingTime = Date.now() - startT;
    const result: CustomerProductCheck = {
      memberId,
      hasPurchased,
      purchasedProducts,
      allProducts, // 전체 구매 상품 목록
      specifiedProductsQuantity, // 지정 상품들만의 총 수량
      totalQuantity: totalQuantityAllProducts, // 전체 구매 총 수량
      specifiedProductsOrderCount: orderIdSet.size, // 지정 상품이 포함된 주문 건수
      totalOrderCount, // 전체 주문 건수
      totalAmount, // 전체 구매 금액
      orderIds: Array.from(orderIdSet),
    };

    console.log(`[RESULT] hasPurchased=${hasPurchased}, products=${purchasedProducts.length}, orders=${orderIdSet.size}, time=${processingTime}ms`);

    return NextResponse.json({
      ...result,
      searchParams: {
        memberId,
        productNos,
        startDate: fmtKST(startDate),
        endDate: fmtKST(endDate),
        shopNo,
        orderStatus,
      },
      processingTime,
    });

  } catch (error: unknown) {
    const processingTime = Date.now() - startT;
    console.error(`[ERROR] check-products failed after ${processingTime}ms`, error);

    if (axios.isAxiosError(error)) {
      const st = error.response?.status;
      const data = error.response?.data;
      if (st === 401)
        return NextResponse.json({ error: "Unauthorized - token may be expired", processingTime }, { status: 401 });
      if (st === 404) return NextResponse.json({ error: "Not found", details: data, processingTime }, { status: 404 });
      if (st === 429)
        return NextResponse.json(
          { error: "Rate limited by Cafe24 API. Please retry later.", processingTime },
          { status: 429 }
        );
      if (st && st >= 500)
        return NextResponse.json(
          { error: "Upstream server error from Cafe24", details: data, processingTime },
          { status: 502 }
        );
    }

    return NextResponse.json({ error: "Failed to check product purchases", processingTime }, { status: 500 });
  }
}
