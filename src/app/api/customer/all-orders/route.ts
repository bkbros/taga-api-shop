// import { NextResponse } from "next/server";
// import axios, { AxiosError } from "axios";
// import { loadParams } from "@/lib/ssm";

// type Cafe24Order = {
//   order_id: string;
//   created_date?: string;
//   items?: Array<{
//     order_item_code: string;
//     product_no?: number;
//     product_name?: string;
//     option_value?: string;
//     quantity?: number;
//   }>;
// };

// // YYYY-MM-DD
// function fmt(d: Date) {
//   const yy = d.getFullYear();
//   const mm = String(d.getMonth() + 1).padStart(2, "0");
//   const dd = String(d.getDate()).padStart(2, "0");
//   return `${yy}-${mm}-${dd}`;
// }
// function addDays(d: Date, days: number) {
//   const nd = new Date(d);
//   nd.setDate(nd.getDate() + days);
//   return nd;
// }
// // 월 단위로 정확히 3개월 뒤의 "같은 날짜"를 구하고, 하루 빼서 3개월 이내를 보장
// function addMonthsMinusOneDay(d: Date, months: number) {
//   // d는 보통 월초(1일)로 줄 것이므로 안전
//   const nd = new Date(d);
//   nd.setMonth(nd.getMonth() + months);
//   // 3개월 범위 "이내"가 조건이므로 하루 빼기
//   nd.setDate(nd.getDate() - 1);
//   return nd;
// }

// export async function GET() {
//   try {
//     const memberId = "sda0125"; // 테스트용
//     const shopNo = 1;

//     const { access_token } = await loadParams(["access_token"]);
//     const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
//     const headers = { Authorization: `Bearer ${access_token}` };

//     const limit = 100;

//     // 전체 조회 기간(필요하면 시작일을 더 최근으로 조정)
//     let cursor = new Date("2010-01-01"); // 시작일
//     const today = new Date(); // 종료 한계

//     const all: Cafe24Order[] = [];

//     while (cursor <= today) {
//       // 이 구간의 end는 "cursor + 3개월 - 1일", 단 today를 넘지 않도록
//       let windowEnd = addMonthsMinusOneDay(cursor, 3);
//       if (windowEnd > today) windowEnd = today;

//       const start_date = fmt(cursor);
//       const end_date = fmt(windowEnd);

//       // 페이지네이션
//       let page = 1;
//       while (true) {
//         const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
//           headers,
//           params: {
//             shop_no: shopNo,
//             member_id: memberId,
//             date_type: "order_date",
//             start_date,
//             end_date,
//             items: "embed", // ✅ 품목 포함(문서/에러 more_info 형식과 일치)
//             limit,
//             page,
//           },
//           timeout: 20000,
//         });

//         const batch: Cafe24Order[] = resp.data?.orders ?? resp.data?.order_list ?? [];
//         all.push(...batch);

//         // 다음 페이지 판단(응답에 pagination이 없을 수 있으니 길이로 판단)
//         if (batch.length < limit) break;
//         page += 1;
//       }

//       // 다음 윈도우(겹치지 않게 end 다음 날부터)
//       cursor = addDays(windowEnd, 1);
//     }

//     // 아이템 평탄화
//     const flattenedItems = all.flatMap(o =>
//       (o.items ?? []).map(it => ({
//         orderId: o.order_id,
//         createdDate: o.created_date,
//         orderItemCode: it.order_item_code,
//         productNo: it.product_no,
//         productName: it.product_name,
//         optionValue: it.option_value,
//         qty: it.quantity,
//       })),
//     );

//     const res = NextResponse.json({
//       totalOrders: all.length,
//       totalItems: flattenedItems.length,
//       orders: all,
//       items: flattenedItems,
//     });
//     res.headers.set("Cache-Control", "private, max-age=120");
//     return res;
//   } catch (e) {
//     const ax = e as AxiosError;
//     return NextResponse.json(
//       { error: ax.response?.data ?? ax.message ?? "UNKNOWN_ERROR" },
//       { status: ax.response?.status ?? 500 },
//     );
//   }
// }
// src/app/api/customer/all-orders/route.ts
import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import { loadParams } from "@/lib/ssm";

type Cafe24Order = {
  order_id: string;
  created_date?: string;
  order_status?: string;
  status?: string;
  items?: Array<{
    order_item_code: string;
    product_no?: number;
    product_name?: string;
    option_value?: string;
    quantity?: number;
  }>;
};

// YYYY-MM-DD
function fmt(d: Date) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function addDays(d: Date, days: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}
// 정확히 3개월 - 1일 (API 제한 이내)
function addMonthsMinusOneDay(d: Date, months: number) {
  const nd = new Date(d);
  nd.setMonth(nd.getMonth() + months);
  nd.setDate(nd.getDate() - 1);
  return nd;
}

// 카페24 주문 상태 허용 코드(소문자)
const ALLOWED_STATUSES = new Set([
  "unpaid",
  "unshipped",
  "shipping",
  "standby",
  "shipped", // 배송완료
  "partially_canceled",
  "canceled",
]);

// 흔한 별칭/한글 → 공식 코드 매핑(옵션)
const STATUS_SYNONYM: Record<string, string> = {
  delivery_complete: "shipped",
  배송완료: "shipped",
  "배송 완료": "shipped",
  unpaid: "unpaid",
  unshipped: "unshipped",
  shipping: "shipping",
  standby: "standby",
  shipped: "shipped",
  partially_canceled: "partially_canceled",
  canceled: "canceled",
};

function normalizeStatuses(rawCsv: string | null): string[] {
  const src = (rawCsv ?? "shipped")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => STATUS_SYNONYM[s] ?? s)
    .filter(s => ALLOWED_STATUSES.has(s));
  return Array.from(new Set(src)); // 중복 제거
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopNo = Number(url.searchParams.get("shop_no") ?? 1);

    // ?status=shipped,canceled  (없으면 shipped 기본)
    const statuses = normalizeStatuses(url.searchParams.get("status"));
    if (statuses.length === 0) {
      return NextResponse.json(
        { error: `Invalid status. Use one of: ${Array.from(ALLOWED_STATUSES).join(", ")}` },
        { status: 400 },
      );
    }
    const statusCsv = statuses.join(",");

    // 기간 한정(선택): ?from=YYYY-MM-DD&to=YYYY-MM-DD
    const fromQ = url.searchParams.get("from");
    const toQ = url.searchParams.get("to");

    const memberId = "sda0125"; // 테스트용 고정
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const headers = { Authorization: `Bearer ${access_token}` };

    const limit = 100;

    const startAll = fromQ ? new Date(fromQ) : new Date("2010-01-01");
    const endAll = toQ ? new Date(toQ) : new Date();
    if (Number.isNaN(+startAll) || Number.isNaN(+endAll) || startAll > endAll) {
      return NextResponse.json({ error: "Invalid date range. Use YYYY-MM-DD and ensure from <= to." }, { status: 400 });
    }

    const all: Cafe24Order[] = [];

    // 3개월 윈도우 반복
    for (let cursor = new Date(startAll); cursor <= endAll; cursor = addDays(addMonthsMinusOneDay(cursor, 3), 1)) {
      let windowEnd = addMonthsMinusOneDay(cursor, 3);
      if (windowEnd > endAll) windowEnd = endAll;

      const start_date = fmt(cursor);
      const end_date = fmt(windowEnd);

      let page = 1;
      while (true) {
        const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
          headers,
          params: {
            shop_no: shopNo,
            member_id: memberId,
            date_type: "order_date",
            start_date,
            end_date,
            items: "embed", // 품목 포함
            order_status: statusCsv, // 상태 필터
            limit,
            page,
          },
          timeout: 20000,
        });

        let batch: Cafe24Order[] = resp.data?.orders ?? resp.data?.order_list ?? [];

        // 서버가 느슨히 반환할 가능성 대비 이중 가드
        const allowed = new Set(statuses);
        batch = batch.filter(o => {
          const st = (o.order_status ?? o.status ?? "").toLowerCase();
          return !st || allowed.has(st);
        });

        all.push(...batch);
        if (batch.length < limit) break;
        page += 1;
      }
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
      orders: all,
      items,
    });
    res.headers.set("Cache-Control", "private, max-age=120");
    return res;
  } catch (e) {
    const ax = e as AxiosError;
    return NextResponse.json(
      { error: ax.response?.data ?? ax.message ?? "UNKNOWN_ERROR" },
      { status: ax.response?.status ?? 500 },
    );
  }
}
