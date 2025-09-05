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
  status?: string; // 몰/버전별 호환
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
// 3개월 "이내" 구간 보장: 기준일 + 3개월 - 1일
function addMonthsMinusOneDay(d: Date, months: number) {
  const nd = new Date(d);
  nd.setMonth(nd.getMonth() + months);
  nd.setDate(nd.getDate() - 1);
  return nd;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    // ?status=DELIVERY_COMPLETE,PURCHASE_CONFIRM&from=YYYY-MM-DD&to=YYYY-MM-DD
    const statusCsv = url.searchParams.get("status") || "DELIVERY_COMPLETE";
    const fromQ = url.searchParams.get("from");
    const toQ = url.searchParams.get("to");

    const memberId = "sda0125"; // 테스트용
    const shopNo = 1;

    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const headers = { Authorization: `Bearer ${access_token}` };

    const limit = 100;

    // ✅ const로 변경 (prefer-const 해결)
    const startAll = fromQ ? new Date(fromQ) : new Date("2010-01-01");
    const endAll = toQ ? new Date(toQ) : new Date();

    if (Number.isNaN(+startAll) || Number.isNaN(+endAll) || startAll > endAll) {
      return NextResponse.json({ error: "Invalid date range. Use YYYY-MM-DD and ensure from <= to." }, { status: 400 });
    }

    const all: Cafe24Order[] = [];

    // 3개월 단위 윈도우 루프
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
            items: "embed",
            order_status: statusCsv, // 서버에서 상태 필터
            limit,
            page,
          },
          timeout: 20000,
        });

        let batch: Cafe24Order[] = resp.data?.orders ?? resp.data?.order_list ?? [];

        // 이중 가드(혹시 서버가 느슨하게 반환할 경우)
        const allowed = new Set(
          statusCsv
            .split(",")
            .map(s => s.trim())
            .filter(Boolean),
        );
        batch = batch.filter(o => {
          const st = o.order_status ?? o.status;
          return !st || allowed.has(st); // 상태 없으면 통과, 있으면 허용된 상태만
        });

        all.push(...batch);

        if (batch.length < limit) break;
        page += 1;
      }
    }

    // 아이템 평탄화
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
