// // src/app/api/customer/all-orders/route.ts
// import { NextResponse } from "next/server";
// import axios from "axios";
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

// export async function GET() {
//   const memberId = "sda0125"; // 테스트용 고정값 (실서비스에선 식별로직으로 치환)
//   const { access_token } = await loadParams(["access_token"]);
//   const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
//   const headers = { Authorization: `Bearer ${access_token}` };

//   const limit = 100;
//   let page = 1; // 또는 offset 기반이면 offset=0부터 시작
//   const all: Cafe24Order[] = [];

//   while (true) {
//     const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
//       headers,
//       params: {
//         member_id: memberId,
//         embed: "items",
//         limit,
//         page, // 만약 offset 방식이면 offset: (page-1) * limit 로 교체
//         // created_start_date: "2020-01-01",
//         // created_end_date: "2025-12-31",
//       },
//     });

//     const batch: Cafe24Order[] = resp.data?.orders ?? [];
//     all.push(...batch);

//     if (batch.length < limit) break; // 마지막 페이지
//     page += 1;
//   }

//   // 원하면 주문별 아이템만 평탄화해서 돌려주기
//   const flattenedItems = all.flatMap(o =>
//     (o.items ?? []).map(it => ({
//       orderId: o.order_id,
//       createdDate: o.created_date,
//       orderItemCode: it.order_item_code,
//       productNo: it.product_no,
//       productName: it.product_name,
//       optionValue: it.option_value,
//       qty: it.quantity,
//     })),
//   );

//   return NextResponse.json({
//     totalOrders: all.length,
//     totalItems: flattenedItems.length,
//     orders: all,
//     items: flattenedItems,
//   });
// }
// src/app/api/customer/all-orders/route.ts
import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import { loadParams } from "@/lib/ssm";

type Cafe24Order = {
  order_id: string;
  created_date?: string;
  items?: Array<{
    order_item_code: string;
    product_no?: number;
    product_name?: string;
    option_value?: string;
    quantity?: number;
  }>;
};

function fmt(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function addDays(d: Date, days: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}

export async function GET() {
  try {
    const memberId = "sda0125"; // 테스트용
    const shopNo = 1;

    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const headers = { Authorization: `Bearer ${access_token}` };

    // ---- 기간 쪼개기 설정 ----
    const windowDays = 90; // 필요 시 30으로 줄여도 됨
    const startAll = new Date("2010-01-01"); // 전체 시작(적당히 과거)
    const endAll = new Date(); // 오늘
    const limit = 100;

    const all: Cafe24Order[] = [];

    // 날짜 구간 루프
    for (let s = new Date(startAll); s <= endAll; s = addDays(s, windowDays + 1)) {
      const e = addDays(s, windowDays);
      const start_date = fmt(s);
      const end_date = fmt(e > endAll ? endAll : e);

      // 각 구간에서 페이지네이션
      let page = 1;
      while (true) {
        const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
          headers,
          params: {
            shop_no: shopNo,
            member_id: memberId,
            date_type: "order_date", // ✅ 주문일 기준
            start_date, // ✅ 필수
            end_date, // ✅ 필수
            embed: "items", // ✅ 품목 포함
            limit,
            page,
          },
          timeout: 20000,
        });

        const batch: Cafe24Order[] = resp.data?.orders ?? resp.data?.order_list ?? [];
        all.push(...batch);

        // 다음 페이지 유무
        const hasMore = batch.length === limit;
        if (!hasMore) break;
        page += 1;
      }
    }

    // 평탄화
    const flattenedItems = all.flatMap(o =>
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
      totalItems: flattenedItems.length,
      orders: all,
      items: flattenedItems,
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
