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

// YYYY-MM-DD
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
// d + months 의 같은 날짜에서 하루 빼서 3개월 이내 보장
const addMonthsMinusOneDay = (d: Date, months: number) => {
  const nd = new Date(d);
  nd.setMonth(nd.getMonth() + months);
  nd.setDate(nd.getDate() - 1);
  return nd;
};

// 사용자가 넣은 status 쿼리(별칭/코드/콤마)를 카페24 코드로 정제
function toOrderStatusCodes(input: string | null): string | undefined {
  if (!input) return undefined;

  // 허용 코드 화이트리스트
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

  const mapAlias = (t: string): string[] => {
    switch (t) {
      // ✅ 한국어/영어 별칭들
      case "delivered":
      case "배송완료":
      case "shipped": // 보통 '배송완료'를 의미한다고 가정
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
    // 코드 직접 입력(Nxx/Cxx/Exx/Rxx)도 허용
    const maybeCode = tk.toUpperCase();
    if (/^[NCRE]\d{2}$/.test(maybeCode)) {
      if (ALLOWED.has(maybeCode)) codes.push(maybeCode);
      continue;
    }
    // 별칭 → 코드
    for (const c of mapAlias(tk.toLowerCase())) {
      if (ALLOWED.has(c)) codes.push(c);
    }
  }

  const dedup = Array.from(new Set(codes));
  return dedup.length ? dedup.join(",") : undefined;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    // 예: ?status=delivered  또는 ?status=N40,N50
    const statusParam = url.searchParams.get("status");
    const orderStatus = toOrderStatusCodes(statusParam);

    // (테스트 고정) 실제 서비스에선 인증 세션/쿠키로 memberId 식별
    const memberId = "sda0125";
    const shopNo = 1;

    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const headers = { Authorization: `Bearer ${access_token}` };

    const limit = 100;
    let cursor = new Date("2010-01-01"); // 전체 조회 시작일(원하면 더 최근으로)
    const today = new Date();

    const all: Cafe24Order[] = [];

    // 3개월 단위 윈도우로 끊어서 전부 조회 (API 제약)
    while (cursor <= today) {
      let windowEnd = addMonthsMinusOneDay(cursor, 3);
      if (windowEnd > today) windowEnd = today;

      const start_date = fmt(cursor);
      const end_date = fmt(windowEnd);

      let page = 1;
      // 페이지네이션: 응답 길이로 다음 페이지 유무 판단
      while (true) {
        const params: Record<string, string | number> = {
          shop_no: shopNo,
          member_id: memberId,
          date_type: "order_date", // 주문일 기준
          start_date,
          end_date,
          items: "embed", // 품목 포함
          limit,
          page,
        };
        if (orderStatus) params.order_status = orderStatus; // ✅ 코드만 전달(공백 X)

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

      // 다음 윈도우 (겹치지 않게 다음날로 이동)
      cursor = addDays(windowEnd, 1);
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
