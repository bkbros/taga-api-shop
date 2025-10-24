// src/app/api/customer/all-orders/route.ts
import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import { getAccessToken } from "@/lib/cafe24Auth";

/* -------------------- 타입 -------------------- */
type Cafe24OrderItem = {
  order_item_code: string;
  product_no?: number;
  product_name?: string;
  option_value?: string;
  quantity?: number;
  // 🔹 일부 몰/버전에서 품목 레벨에 상태가 있음
  order_status?: string;
  status?: string;
};

type Cafe24Order = {
  order_id: string;
  created_date?: string;
  // 🔹 주문 상단 상태(몰/버전에 따라 필드명이 다를 수 있음)
  order_status?: string;
  status?: string;
  items?: Cafe24OrderItem[];
};
/* ---------------------------------------------- */

/* -------------------- CORS -------------------- */
const ALLOWED_ORIGINS = [
  "http://skin-mobile11.bkbros.cafe24.com",
  "https://skin-mobile11.bkbros.cafe24.com",
  "https://taga-api-shop.vercel.app",
  "http://localhost:3000",
];

function withCORS(res: NextResponse, origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.headers.set("Access-Control-Allow-Origin", allowOrigin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-APP-SECRET");
  // res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export async function OPTIONS(req: Request) {
  return withCORS(new NextResponse(null, { status: 204 }), req.headers.get("Origin"));
}
/* ---------------------------------------------- */

/* -------------------- 날짜 유틸 -------------------- */
const fmt = (d: Date) => {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};
const addDays = (d: Date, days: number) => {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
};
const addMonthsMinusOneDay = (d: Date, months: number) => {
  const nd = new Date(d);
  nd.setMonth(nd.getMonth() + months);
  nd.setDate(nd.getDate() - 1);
  return nd;
};
/* ---------------------------------------------- */

/* ---- ?status=delivered|N40,... → "N40,N50" 형태 변환 ---- */
function toOrderStatusCodes(input: string | null): string | undefined {
  if (!input) return undefined;

  const ALLOWED = new Set([
    // Normal
    "N00",
    "N10",
    "N20",
    "N21",
    "N22",
    "N30",
    "N40",
    "N50",
    // Cancel
    "C00",
    "C10",
    "C11",
    "C34",
    "C35",
    "C36",
    "C40",
    "C41",
    "C47",
    "C48",
    "C49",
    // Return
    "R00",
    "R10",
    "R12",
    "R13",
    "R30",
    "R34",
    "R36",
    "R40",
    // Exchange (일부)
    "E00",
    "E10",
    "N01",
    "E12",
    "E13",
    "E20",
    "E30",
  ]);

  const alias = (t: string): string[] => {
    switch (t) {
      case "delivered":
      case "배송완료":
      case "shipped":
      case "complete":
      case "completed":
        return ["N40"];
      case "purchaseconfirmed":
      case "구매확정":
        return ["N50"];
      case "in_transit":
      case "shipping":
      case "배송중":
        return ["N30"];
      case "preparing":
      case "상품준비중":
        return ["N10"];
      case "awaiting_shipment":
      case "배송대기":
        return ["N21"];
      case "on_hold":
      case "배송보류":
        return ["N22"];
      case "pending":
      case "입금전":
        return ["N00"];
      case "ready_to_ship":
      case "배송준비중":
        return ["N20"];
      default:
        return [];
    }
  };

  const tokens = input
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const codes: string[] = [];
  for (const tk of tokens) {
    const maybe = tk.toUpperCase();
    if (/^[NCRE]\d{2}$/.test(maybe)) {
      if (ALLOWED.has(maybe)) codes.push(maybe);
      continue;
    }
    for (const c of alias(tk.toLowerCase())) {
      if (ALLOWED.has(c)) codes.push(c);
    }
  }
  const dedup = Array.from(new Set(codes));
  return dedup.length ? dedup.join(",") : undefined;
}
/* ------------------------------------------------ */

export async function GET(request: Request) {
  const origin = request.headers.get("Origin");
  try {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const orderStatus = toOrderStatusCodes(statusParam);

    // (테스트 고정) 실제 서비스에선 로그인 세션/토큰으로 식별
    const memberId = "sda0125";
    const shopNo = 1;

    const access_token = await getAccessToken();
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const headers = { Authorization: `Bearer ${access_token}` };

    const limit = 100;
    let cursor = new Date("2010-01-01");
    const today = new Date();

    const all: Cafe24Order[] = [];

    // 3개월 윈도우 반복 (카페24 검색기간 제약)
    while (cursor <= today) {
      let windowEnd = addMonthsMinusOneDay(cursor, 3);
      if (windowEnd > today) windowEnd = today;

      const start_date = fmt(cursor);
      const end_date = fmt(windowEnd);

      let page = 1;
      while (true) {
        const params: Record<string, string | number> = {
          shop_no: shopNo,
          member_id: memberId,
          date_type: "order_date",
          start_date,
          end_date,
          embed: "items", // ✅ 품목 포함
          limit,
          page,
        };
        if (orderStatus) params.order_status = orderStatus;

        const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
          headers,
          params,
          timeout: 20000,
        });

        const batch: Cafe24Order[] = resp.data?.orders ?? resp.data?.order_list ?? [];
        all.push(...batch);

        if (batch.length < limit) break;
        page += 1;
      }
      cursor = addDays(windowEnd, 1);
    }

    // ✅ deliveredOrderIds 계산 로직
    let deliveredOrderIds: string[];
    if (orderStatus) {
      // 쿼리로 상태를 지정한 경우: 이미 Cafe24에서 그 상태로 필터된 결과임
      deliveredOrderIds = all.map(o => o.order_id);
    } else {
      // 쿼리 미지정: 상단 상태가 없으면 품목 상태로 판별
      const isDeliveredOrConfirmed = (o: Cafe24Order) => {
        const top = (o.order_status ?? o.status ?? "").toUpperCase();
        if (top === "N40" || top === "N50" || top === "DELIVERY_COMPLETE" || top === "PURCHASE_CONFIRM") return true;

        // 🔹 any 없이 item 레벨 상태 확인
        const itemCodes = (o.items ?? [])
          .map(it => it.order_status ?? it.status)
          .filter((s): s is string => Boolean(s))
          .map(s => s.toUpperCase());

        return (
          itemCodes.length > 0 &&
          itemCodes.every(c => c === "N40" || c === "N50" || c === "DELIVERY_COMPLETE" || c === "PURCHASE_CONFIRM")
        );
      };

      deliveredOrderIds = all.filter(isDeliveredOrConfirmed).map(o => o.order_id);
    }

    // 아이템 평탄화
    const items = all.flatMap(o =>
      (o.items ?? []).map(it => ({
        orderId: o.order_id,
        createdDate: o.created_date,
        orderItemCode: it.order_item_code,
        productNo: it.product_no,
        productName: it.product_name,
        optionValue: it.option_value,
        qty: it.quantity,
      })),
    );

    const res = NextResponse.json({
      totalOrders: all.length,
      totalItems: items.length,
      deliveredCount: deliveredOrderIds.length,
      deliveredOrderIds,
      orders: all,
      items,
    });
    res.headers.set("Cache-Control", "private, max-age=120");
    return withCORS(res, origin);
  } catch (e) {
    const ax = e as AxiosError;
    const errRes = NextResponse.json(
      { error: ax.response?.data ?? ax.message ?? "UNKNOWN_ERROR" },
      { status: ax.response?.status ?? 500 },
    );
    return withCORS(errRes, origin);
  }
}
