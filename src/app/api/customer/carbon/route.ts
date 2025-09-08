// import { NextResponse } from "next/server";
// import axios, { AxiosError } from "axios";
// import { loadParams } from "@/lib/ssm";

// /* ========== 설정 ========== */
// const CO2_PER_UNIT_KG = 0.6; // ✅ 품목 1개당 0.6kg 상쇄
// const DEFAULT_STATUS = "N40,N50"; // 배송완료/구매확정만 기본 집계

// const ALLOWED_ORIGINS = [
//   "http://skin-mobile11.bkbros.cafe24.com",
//   "https://skin-mobile11.bkbros.cafe24.com",
//   "https://taga-api-shop.vercel.app",
//   "http://localhost:3000",
// ];
// /* ========================== */

// /* ========== 타입 ========== */
// type Cafe24OrderItem = {
//   order_item_code: string;
//   product_no?: number;
//   product_name?: string;
//   option_value?: string;
//   quantity?: number;
//   order_status?: string;
//   status?: string;
//   created_date?: string;
// };
// type Cafe24Order = {
//   order_id: string;
//   created_date?: string;
//   order_status?: string;
//   status?: string;
//   items?: Cafe24OrderItem[];
// };
// type CarbonBreakdownRow = {
//   productNo: string;
//   name?: string;
//   units: number;
//   co2e_kg: number;
//   lastPurchased?: string;
// };
// /* ========================== */

// /* ======= 공통 유틸 ======= */
// function withCORS(res: NextResponse, origin: string | null) {
//   const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
//   res.headers.set("Access-Control-Allow-Origin", allowOrigin);
//   res.headers.set("Vary", "Origin");
//   res.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
//   res.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-APP-SECRET");
//   res.headers.set("Access-Control-Max-Age", "86400");
//   return res;
// }
// export async function OPTIONS(req: Request) {
//   return withCORS(new NextResponse(null, { status: 204 }), req.headers.get("Origin"));
// }

// const fmt = (d: Date) => {
//   const yy = d.getFullYear();
//   const mm = String(d.getMonth() + 1).padStart(2, "0");
//   const dd = String(d.getDate()).padStart(2, "0");
//   return `${yy}-${mm}-${dd}`;
// };
// const addDays = (d: Date, days: number) => {
//   const nd = new Date(d);
//   nd.setDate(nd.getDate() + days);
//   return nd;
// };
// const addMonthsMinusOneDay = (d: Date, months: number) => {
//   const nd = new Date(d);
//   nd.setMonth(nd.getMonth() + months);
//   nd.setDate(nd.getDate() - 1);
//   return nd;
// };
// const ymd = (s?: string) => (s ? new Date(s).toISOString().slice(0, 10) : undefined);
// /* ======================== */

// /* ======= 회원 매핑 (예시) ======= */
// // 실제 서비스에선 pid → member_id 매핑을 DB/세션에서 찾도록 구현
// async function lookupMemberIdByPid(pid?: string): Promise<string | null> {
//   // TODO: 실제 매핑 로직으로 교체
//   if (!pid) return null;
//   // 테스트: 아무 pid나 오면 sda0125로 처리
//   return "3952619679@k";
// }
// /* ============================== */

// export async function POST(req: Request) {
//   const origin = req.headers.get("Origin");
//   try {
//     // (1) 입력 파싱
//     const body = (await req.json()) as {
//       pid?: string; // 프론트에서 보내는 개인화 식별자
//       from?: string; // YYYY-MM-DD (옵션)
//       to?: string; // YYYY-MM-DD (옵션)
//       status?: string; // 예: "N40,N50" (옵션)
//       includeBreakdown?: boolean; // true면 상세 목록 포함
//     } | null;

//     const pid = body?.pid;
//     const memberId = (await lookupMemberIdByPid(pid)) ?? "sda0125"; // fallback for test
//     const from = body?.from ?? "2010-01-01";
//     const to = body?.to ?? new Date().toISOString().slice(0, 10);
//     const status = body?.status ?? DEFAULT_STATUS;
//     const includeBreakdown = Boolean(body?.includeBreakdown);

//     // (2) 인증/환경
//     const { access_token } = await loadParams(["access_token"]);
//     const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
//     const headers = { Authorization: `Bearer ${access_token}` };
//     const shopNo = 1;

//     // (3) Cafe24 주문 전부 가져오기 (3개월 윈도우 + 페이지네이션)
//     const limit = 100;
//     const all: Cafe24Order[] = [];

//     let cursor = new Date(from);
//     const endBoundary = new Date(to);

//     while (cursor <= endBoundary) {
//       let windowEnd = addMonthsMinusOneDay(cursor, 3);
//       if (windowEnd > endBoundary) windowEnd = endBoundary;

//       const start_date = fmt(cursor);
//       const end_date = fmt(windowEnd);

//       let page = 1;
//       while (true) {
//         const params: Record<string, string | number> = {
//           shop_no: shopNo,
//           member_id: memberId,
//           date_type: "order_date",
//           start_date,
//           end_date,
//           embed: "items", // ✅ 품목 포함
//           order_status: status, // ✅ N40,N50 기본
//           limit,
//           page,
//         };

//         const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
//           headers,
//           params,
//           timeout: 20000,
//         });

//         const batch: Cafe24Order[] = resp.data?.orders ?? resp.data?.order_list ?? [];
//         all.push(...batch);

//         if (batch.length < limit) break;
//         page += 1;
//       }
//       cursor = addDays(windowEnd, 1);
//     }

//     // (4) 품목 집계 (상품단위)
//     const byProduct = new Map<string, { name?: string; units: number; last?: string }>();
//     for (const o of all) {
//       const orderDate = ymd(o.created_date);
//       for (const it of o.items ?? []) {
//         if (!it.product_no || !it.quantity) continue;
//         const key = String(it.product_no);
//         const prev = byProduct.get(key) ?? { name: it.product_name, units: 0, last: undefined };
//         prev.units += Number(it.quantity);
//         const d = ymd(it.created_date) || orderDate;
//         if (d && (!prev.last || d > prev.last)) prev.last = d;
//         byProduct.set(key, prev);
//       }
//     }

//     // (5) 탄소 계산 (0.6kg × 수량)
//     const breakdown: CarbonBreakdownRow[] = Array.from(byProduct.entries()).map(([productNo, v]) => ({
//       productNo,
//       name: v.name,
//       units: v.units,
//       co2e_kg: +(v.units * CO2_PER_UNIT_KG).toFixed(3),
//       lastPurchased: v.last,
//     }));

//     const totalUnits = breakdown.reduce((a, b) => a + b.units, 0);
//     const totalKg = breakdown.reduce((a, b) => a + b.co2e_kg, 0);
//     breakdown.sort((a, b) => (b.lastPurchased || "").localeCompare(a.lastPurchased || ""));

//     // (6) 응답
//     const res = NextResponse.json({
//       memberId,
//       range: { from, to },
//       statusFilter: status,
//       factor: { perUnitKg: CO2_PER_UNIT_KG, version: "fixed-0.6kg-v1" },
//       totals: { units: totalUnits, co2e_kg: +totalKg.toFixed(3) },
//       breakdown: includeBreakdown ? breakdown : undefined,
//     });
//     res.headers.set("Cache-Control", "private, max-age=120");
//     return withCORS(res, origin);
//   } catch (e) {
//     const ax = e as AxiosError;
//     const errRes = NextResponse.json(
//       { error: ax.response?.data ?? ax.message ?? "UNKNOWN_ERROR" },
//       { status: ax.response?.status ?? 500 },
//     );
//     return withCORS(errRes, origin);
//   }
// }
import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import { loadParams } from "@/lib/ssm";

/* ========== 설정 ========== */
const CO2_PER_UNIT_KG = 0.6; // ✅ 품목 1개당 0.6kg 상쇄
const DEFAULT_STATUS = "N40,N50"; // 배송완료/구매확정만 기본 집계
const DEFAULT_MEMBER_ID = "3952619679@k"; // pid 없을 때 테스트용 폴백

const ALLOWED_ORIGINS = [
  "http://skin-mobile11.bkbros.cafe24.com",
  "https://skin-mobile11.bkbros.cafe24.com",
  "https://taga-api-shop.vercel.app",
  "http://localhost:3000",
];
/* ========================== */

/* ========== 타입 ========== */
type Cafe24OrderItem = {
  order_item_code: string;
  product_no?: number;
  product_name?: string;
  option_value?: string;
  quantity?: number;
  created_date?: string;
};
type Cafe24Order = {
  order_id: string;
  created_date?: string;
  order_status?: string; // N코드 또는 문자열(DELIVERY_COMPLETE 등)
  status?: string; // 일부 응답에서 쓰이는 필드명
  items?: Cafe24OrderItem[];
};
type CarbonBreakdownRow = {
  productNo: string;
  name?: string;
  units: number;
  co2e_kg: number;
  lastPurchased?: string;
};
/* ========================== */

/* ======= 공통 유틸 ======= */
function withCORS(res: NextResponse, origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.headers.set("Access-Control-Allow-Origin", allowOrigin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-APP-SECRET");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}
export async function OPTIONS(req: Request) {
  return withCORS(new NextResponse(null, { status: 204 }), req.headers.get("Origin"));
}

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
const ymd = (s?: string) => (s ? new Date(s).toISOString().slice(0, 10) : undefined);
/* ======================== */

/* ======= 회원 매핑 ======= */
/** 실제 운영에선 pid -> Cafe24 member_id 매핑을 DB/세션 등으로 구현 */
async function lookupMemberIdByPid(pid?: string): Promise<string | null> {
  if (pid && pid.trim()) return pid.trim(); // 기본: pid를 그대로 member_id로 사용
  return DEFAULT_MEMBER_ID; // 테스트/폴백
}
/* ======================== */

export async function POST(req: Request) {
  const origin = req.headers.get("Origin");
  try {
    // (1) 입력 안전 파싱
    const raw = await req.text();
    let body: {
      pid?: string; // 프론트에서 보내는 개인화 식별자 → 그대로 member_id로 사용
      from?: string; // YYYY-MM-DD (옵션)
      to?: string; // YYYY-MM-DD (옵션)
      status?: string; // "N40,N50" 등 (옵션)
      includeBreakdown?: boolean; // true면 상세 반환
    } | null = null;

    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      const errRes = NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      return withCORS(errRes, origin);
    }

    const receivedPid = body?.pid && body.pid.trim() ? body.pid.trim() : undefined; // string | undefined
    const resolvedMemberId = (await lookupMemberIdByPid(receivedPid)) ?? null;

    if (!resolvedMemberId) {
      const errRes = NextResponse.json({ error: "Unknown or missing pid", receivedPid }, { status: 400 });
      return withCORS(errRes, origin);
    }

    // 날짜/상태 기본값
    const nowYmd = new Date().toISOString().slice(0, 10);
    let from = body?.from ?? "2010-01-01";
    let to = body?.to ?? nowYmd;
    if (from > to) [from, to] = [to, from]; // from/to 뒤바뀐 경우 교정
    const status = body?.status ?? DEFAULT_STATUS;
    const includeBreakdown = Boolean(body?.includeBreakdown);

    // (2) 인증/환경
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const headers = { Authorization: `Bearer ${access_token}` };
    const shopNo = 1;

    // (3) Cafe24 주문 수집: 3개월 윈도우 + 페이지네이션
    const limit = 100;
    const all: Cafe24Order[] = [];
    let cursor = new Date(from);
    const endBoundary = new Date(to);

    let windowCount = 0;
    let pageCount = 0;

    while (cursor <= endBoundary) {
      let windowEnd = addMonthsMinusOneDay(cursor, 3);
      if (windowEnd > endBoundary) windowEnd = endBoundary;

      const start_date = fmt(cursor);
      const end_date = fmt(windowEnd);
      windowCount++;

      let page = 1;
      while (true) {
        const params: Record<string, string | number> = {
          shop_no: shopNo,
          member_id: resolvedMemberId,
          date_type: "order_date",
          start_date,
          end_date,
          embed: "items", // ✅ 품목 포함
          order_status: status, // ✅ N40,N50 기본
          limit,
          page,
        };

        const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
          headers,
          params,
          timeout: 20000,
        });

        const batch: Cafe24Order[] = resp.data?.orders ?? resp.data?.order_list ?? [];
        all.push(...batch);

        pageCount++;
        if (batch.length < limit) break;
        page += 1;
      }
      cursor = addDays(windowEnd, 1);
    }

    // (4) 품목 집계(상품 단위) + 0.6kg/개 적용
    const byProduct = new Map<string, { name?: string; units: number; last?: string }>();
    for (const o of all) {
      const orderDate = ymd(o.created_date);
      for (const it of o.items ?? []) {
        if (!it.product_no || !it.quantity) continue;
        const key = String(it.product_no);
        const prev = byProduct.get(key) ?? { name: it.product_name, units: 0, last: undefined };
        prev.units += Number(it.quantity);
        const d = ymd(it.created_date) || orderDate;
        if (d && (!prev.last || d > prev.last)) prev.last = d;
        byProduct.set(key, prev);
      }
    }

    const breakdown: CarbonBreakdownRow[] = Array.from(byProduct.entries()).map(([productNo, v]) => ({
      productNo,
      name: v.name,
      units: v.units,
      co2e_kg: +(v.units * CO2_PER_UNIT_KG).toFixed(3),
      lastPurchased: v.last,
    }));

    const totalUnits = breakdown.reduce((a, b) => a + b.units, 0);
    const totalKg = breakdown.reduce((a, b) => a + b.co2e_kg, 0);
    breakdown.sort((a, b) => (b.lastPurchased || "").localeCompare(a.lastPurchased || ""));

    // (5) 응답 (pid/매핑값 에코 + 디버그 포함)
    const res = NextResponse.json({
      ok: true,
      receivedPid, // 👀 프론트에서 보낸 pid 그대로
      resolvedMemberId, // 👀 서버가 사용한 Cafe24 member_id
      range: { from, to },
      statusFilter: status,
      factor: { perUnitKg: CO2_PER_UNIT_KG, version: "fixed-0.6kg-v1" },
      totals: { units: totalUnits, co2e_kg: +totalKg.toFixed(3) },
      breakdown: includeBreakdown ? breakdown : undefined,
      debug: { windows: windowCount, pages: pageCount, fetchedOrders: all.length },
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
