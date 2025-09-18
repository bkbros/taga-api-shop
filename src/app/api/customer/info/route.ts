// import { NextResponse } from "next/server";
// import axios, { AxiosError, AxiosResponse } from "axios";
// import { loadParams } from "@/lib/ssm";

// /** ===================== Types ===================== **/

// type Customer = {
//   user_id: string;
//   user_name?: string;
//   member_id: string; // 로그인 아이디(주문 조회에 사용)
//   member_no?: string | number;
//   created_date?: string;
//   email?: string;
//   phone?: string;
//   last_login_date?: string;
//   group?: { group_name?: string };
// };

// type CustomersResponse = {
//   customers: Customer[];
// };

// type OrdersCountResponse = {
//   count: number;
// };

// type OrdersListOrder = {
//   order_id?: string;
//   order_price_amount?: string; // 금액 합산에 사용
//   // 필요한 필드가 있으면 확장
// };

// type OrdersListResponse = {
//   orders: OrdersListOrder[];
// };

// type Strategy = { name: "cellphone" | "member_id"; params: Record<string, string | number> };

// /** ===================== Utilities ===================== **/

// // 'YYYY-MM-DD HH:mm:ss' 로 포맷
// const fmtYmdHms = (d: Date): string => {
//   const pad = (n: number) => String(n).padStart(2, "0");
//   const y = d.getFullYear();
//   const m = pad(d.getMonth() + 1);
//   const day = pad(d.getDate());
//   const hh = pad(d.getHours());
//   const mm = pad(d.getMinutes());
//   const ss = pad(d.getSeconds());
//   return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
// };

// // Cafe24 규칙: 한 호출 범위는 start ~ (start+3개월-1초) 이내
// // to(상한)와 비교해 더 이른 쪽을 end로 사용
// function clampCafe24Window(start: Date, to: Date): { s: Date; e: Date } {
//   const s = new Date(start);
//   s.setHours(0, 0, 0, 0);

//   const maxEnd = new Date(s);
//   maxEnd.setMonth(maxEnd.getMonth() + 3);
//   maxEnd.setSeconds(maxEnd.getSeconds() - 1);

//   const endCap = new Date(to);
//   endCap.setHours(23, 59, 59, 0);

//   const e = new Date(Math.min(maxEnd.getTime(), endCap.getTime()));
//   return { s, e };
// }

// // 1년 등 긴 범위를 Cafe24 허용 윈도우(최대 3개월)로 분할
// function splitCafe24Windows(from: Date, to: Date): Array<{ s: Date; e: Date }> {
//   const out: Array<{ s: Date; e: Date }> = [];
//   let cursor = new Date(from);
//   cursor.setHours(0, 0, 0, 0);

//   const hardTo = new Date(to);
//   hardTo.setHours(23, 59, 59, 0);

//   while (cursor <= hardTo) {
//     const { s, e } = clampCafe24Window(cursor, hardTo);
//     out.push({ s, e });

//     const next = new Date(e);
//     next.setDate(next.getDate() + 1); // 다음날
//     next.setHours(0, 0, 0, 0);
//     cursor = next;
//   }
//   return out;
// }

// // 숫자 안전 파싱
// const toAmount = (v: unknown): number => {
//   const n = Number(v);
//   return Number.isFinite(n) ? n : 0;
// };

// // 주문 합계(금액) 페이지네이션 합산 (offset 기반)
// async function sumOrdersAmount(params: {
//   mallId: string;
//   token: string;
//   memberId: string;
//   start: string;
//   end: string;
//   shopNo?: number;
//   pageSize?: number;
//   maxPages?: number;
// }): Promise<number> {
//   const {
//     mallId,
//     token,
//     memberId,
//     start,
//     end,
//     shopNo = 1,
//     pageSize = 100,
//     maxPages = 50, // 5,000건 상한
//   } = params;

//   let offset = 0;
//   let pages = 0;
//   let total = 0;

//   while (pages < maxPages) {
//     const res: AxiosResponse<OrdersListResponse> = await axios.get(
//       `https://${mallId}.cafe24api.com/api/v2/admin/orders`,
//       {
//         params: {
//           shop_no: shopNo,
//           start_date: start,
//           end_date: end,
//           member_id: memberId,
//           order_status: "N40,N50",
//           limit: pageSize,
//           offset,
//         },
//         headers: { Authorization: `Bearer ${token}` },
//         timeout: 8000,
//         validateStatus: (s: number) => s === 200 || s === 404,
//       },
//     );

//     const orders = res.data?.orders ?? [];
//     if (orders.length === 0) break;

//     total += orders.reduce((sum: number, o: OrdersListOrder) => sum + toAmount(o.order_price_amount), 0);

//     if (orders.length < pageSize) break;
//     offset += pageSize;
//     pages += 1;
//   }
//   return total;
// }

// /** ===================== Handler ===================== **/

// export async function GET(req: Request) {
//   const url = new URL(req.url);

//   // Query
//   const userId = url.searchParams.get("user_id");
//   const periodParam = url.searchParams.get("period") || "3months"; // "3months" | "1year"
//   const shopNoRaw = url.searchParams.get("shop_no") ?? "1";
//   const shopNo = Number.isNaN(Number(shopNoRaw)) ? 1 : Number(shopNoRaw);
//   const guess = url.searchParams.get("guess") !== "0"; // 숫자-only @k/@n 자동시도 (기본 on)

//   if (!userId) {
//     return NextResponse.json({ error: "user_id parameter is required" }, { status: 400 });
//   }
//   if (!["3months", "1year"].includes(periodParam)) {
//     return NextResponse.json({ error: "Invalid period parameter", validValues: ["3months", "1year"] }, { status: 400 });
//   }

//   // 전처리
//   let raw: string;
//   try {
//     raw = decodeURIComponent(userId).trim();
//   } catch {
//     return NextResponse.json({ error: "Invalid user_id encoding" }, { status: 400 });
//   }

//   console.log(`[DEBUG] Raw input: ${raw}`);

//   const digits = raw.replace(/\D/g, "");
//   const isPhone = /^0\d{9,10}$/.test(digits); // 10~11자리
//   const isNumericOnly = /^\d+$/.test(raw);

//   try {
//     const { access_token } = (await loadParams(["access_token"])) as { access_token: string };
//     const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID;
//     if (!mallId) {
//       return NextResponse.json({ error: "Missing NEXT_PUBLIC_CAFE24_MALL_ID" }, { status: 500 });
//     }

//     const authHeaders: Record<string, string> = {
//       Authorization: `Bearer ${access_token}`,
//       "X-Cafe24-Api-Version": "2025-06-01",
//     };

//     /** 1) Customers 조회: cellphone 또는 member_id만 허용 **/

//     const strategies: Strategy[] = [];

//     if (isPhone) {
//       strategies.push({ name: "cellphone", params: { limit: 1, cellphone: digits } });
//     } else if (isNumericOnly) {
//       // 숫자-only → 추측 모드면 @k/@n까지 후보 생성
//       const candidates: string[] = guess ? [raw, `${raw}@k`, `${raw}@n`] : [raw];
//       let matched: string | undefined;

//       for (const cand of candidates) {
//         const t: AxiosResponse<CustomersResponse> = await axios.get(
//           `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
//           {
//             params: { limit: 1, member_id: cand },
//             headers: authHeaders,
//             timeout: 6000,
//             validateStatus: () => true,
//           },
//         );
//         if (t.status === 200 && t.data?.customers?.length > 0) {
//           matched = cand;
//           break;
//         }
//       }

//       if (matched) {
//         strategies.push({ name: "member_id", params: { limit: 1, member_id: matched } });
//         console.log(`[DEBUG] 숫자-only 매칭 성공: ${raw} -> ${matched}`);
//       } else {
//         console.log(`[ERROR] Unsupported identifier: ${raw} (numeric-only, not phone, not member_id)`);
//         return NextResponse.json(
//           {
//             error: "Unsupported identifier",
//             hint: "member_id(로그인 아이디) 또는 휴대폰 번호(010...)를 전달하세요.",
//             received: raw,
//             examples: ["4346815169@k", "2225150920@n", "yoonhyerin", "01012345678"],
//           },
//           { status: 400 },
//         );
//       }
//     } else {
//       strategies.push({ name: "member_id", params: { limit: 1, member_id: raw } });
//     }

//     let customerRes: AxiosResponse<CustomersResponse> | undefined;
//     let memberLoginId: string | undefined;
//     let foundBy: Strategy["name"] | undefined;

//     for (const st of strategies) {
//       console.log(`[CUSTOMERS API] ${st.name}로 검색 시도`);
//       try {
//         const r: AxiosResponse<CustomersResponse> = await axios.get(
//           `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
//           {
//             params: st.params,
//             headers: authHeaders,
//             timeout: 8000,
//           },
//         );
//         const list = r.data?.customers ?? [];
//         if (list.length > 0) {
//           customerRes = r;
//           const c = list[0];
//           const loginId = c.member_id || c.user_id;
//           if (!loginId) {
//             console.log(`[CUSTOMERS API] 경고: 로그인 아이디 필드가 없음 (member_id/user_id 불명)`);
//             continue;
//           }
//           memberLoginId = loginId;
//           foundBy = st.name;
//           console.log(`[CUSTOMERS API] 고객 발견: by=${foundBy}, member_id=${memberLoginId}`);
//           break;
//         } else {
//           console.log(`[CUSTOMERS API] ${st.name} 결과 없음`);
//         }
//       } catch (err: unknown) {
//         const ax = err as AxiosError<unknown>;
//         console.log(`[CUSTOMERS API] ${st.name} 실패`, ax.response?.status, ax.response?.data);
//         // 다음 전략 시도
//       }
//     }

//     if (!customerRes || !memberLoginId) {
//       return NextResponse.json(
//         {
//           error: "Customer not found",
//           triedStrategies: strategies.map(s => s.name),
//           hint: isPhone
//             ? "휴대폰 번호(010xxxxxxxx) 형식이 정확한지 확인하세요."
//             : "로그인 아이디(@k/@n/일반ID)가 맞는지 확인하세요.",
//         },
//         { status: 404 },
//       );
//     }

//     const customer = customerRes.data.customers[0];
//     console.log(`[DEBUG] Customer located by ${foundBy}. member_id=${memberLoginId}`);

//     /** 2) Orders 조회: Cafe24 3개월 한도 엄격 준수 **/

//     let totalOrders = 0;
//     let totalPurchaseAmount = 0;

//     const now = new Date();

//     if (periodParam === "3months") {
//       // 최근 3개월 창을 규칙대로 클램프
//       const threeMonthsAgo = new Date(now);
//       threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

//       const { s, e } = clampCafe24Window(threeMonthsAgo, now);
//       const startStr = fmtYmdHms(s);
//       const endStr = fmtYmdHms(e);

//       console.log(`[ORDERS API] 3개월 범위: ${startStr} ~ ${endStr}`);

//       // Count
//       const countRes: AxiosResponse<OrdersCountResponse> = await axios.get(
//         `https://${mallId}.cafe24api.com/api/v2/admin/orders/count`,
//         {
//           params: {
//             shop_no: shopNo,
//             start_date: startStr,
//             end_date: endStr,
//             member_id: memberLoginId,
//             order_status: "N40,N50",
//           },
//           headers: { Authorization: `Bearer ${access_token}` },
//           timeout: 8000,
//         },
//       );
//       totalOrders = countRes.data?.count ?? 0;

//       // Amount
//       if (totalOrders > 0) {
//         totalPurchaseAmount = await sumOrdersAmount({
//           mallId,
//           token: access_token,
//           memberId: memberLoginId,
//           start: startStr,
//           end: endStr,
//           shopNo,
//           pageSize: 100,
//         });
//       }
//     } else {
//       // 1년 → 3개월 윈도우로 분할 후 합산
//       const endAll = new Date(now);
//       const startAll = new Date(now);
//       startAll.setFullYear(endAll.getFullYear() - 1);

//       const windows = splitCafe24Windows(startAll, endAll);
//       console.log(`[ORDERS API] 1년 분할: ${windows.length}개 구간`);

//       for (const { s, e } of windows) {
//         const sStr = fmtYmdHms(s);
//         const eStr = fmtYmdHms(e);

//         const countRes: AxiosResponse<OrdersCountResponse> = await axios.get(
//           `https://${mallId}.cafe24api.com/api/v2/admin/orders/count`,
//           {
//             params: {
//               shop_no: shopNo,
//               start_date: sStr,
//               end_date: eStr,
//               member_id: memberLoginId,
//               order_status: "N40,N50",
//             },
//             headers: { Authorization: `Bearer ${access_token}` },
//             timeout: 8000,
//           },
//         );

//         const chunkCount = countRes.data?.count ?? 0;
//         totalOrders += chunkCount;

//         if (chunkCount > 0) {
//           const chunkAmount = await sumOrdersAmount({
//             mallId,
//             token: access_token,
//             memberId: memberLoginId,
//             start: sStr,
//             end: eStr,
//             shopNo,
//             pageSize: 200,
//             maxPages: 100,
//           });
//           totalPurchaseAmount += chunkAmount;
//         }
//       }
//     }

//     console.log(`[FINAL RESULT] totalOrders=${totalOrders}, totalPurchaseAmount=${totalPurchaseAmount}`);

//     /** 3) 응답 **/
//     const customerInfo = {
//       userId: customer.user_id,
//       userName: customer.user_name,
//       memberGrade: customer.group?.group_name || "일반회원",
//       joinDate: customer.created_date,
//       totalPurchaseAmount,
//       totalOrders,
//       email: customer.email,
//       phone: customer.phone,
//       lastLoginDate: customer.last_login_date,
//       memberId: memberLoginId, // 최종 사용한 로그인 아이디
//       period: periodParam,
//       shopNo,
//     };

//     return NextResponse.json(customerInfo);
//   } catch (error: unknown) {
//     if (axios.isAxiosError(error)) {
//       const ax = error as AxiosError<unknown>;
//       const status = ax.response?.status;
//       const data = ax.response?.data;

//       console.error(`[ERROR] Status=${String(status)}`, data);

//       if (status === 401) {
//         return NextResponse.json({ error: "Unauthorized - token may be expired" }, { status: 401 });
//       }
//       if (status === 422) {
//         return NextResponse.json({ error: "Invalid request parameters", details: data }, { status: 422 });
//       }
//       if (status === 404) {
//         return NextResponse.json({ error: "Not found", details: data }, { status: 404 });
//       }
//       if (status === 429) {
//         return NextResponse.json({ error: "Rate limited by Cafe24 API. Please retry later." }, { status: 429 });
//       }
//       if (status && status >= 500) {
//         return NextResponse.json({ error: "Upstream server error from Cafe24", details: data }, { status: 502 });
//       }
//     } else {
//       console.error(`[UNCAUGHT ERROR]`, error);
//     }

//     return NextResponse.json({ error: "Failed to fetch customer information" }, { status: 500 });
//   }
// }

// app/api/customer/bulk/route.ts
import { NextResponse } from "next/server";
import axios, { AxiosError, AxiosResponse } from "axios";
import { loadParams } from "@/lib/ssm";

/** ===================== Types ===================== **/

type Customer = {
  user_id: string;
  user_name?: string;
  member_id: string;
  member_no?: string | number;
  created_date?: string;
  email?: string;
  phone?: string;
  last_login_date?: string;
  group?: { group_name?: string };
};

type CustomersResponse = {
  customers: Customer[];
};

type OrdersCountResponse = {
  count: number;
};

type OrdersListOrder = {
  order_id?: string;
  order_price_amount?: string;
};

type OrdersListResponse = {
  orders: OrdersListOrder[];
};

type Period = "3months" | "1year";

type Strategy = { name: "cellphone" | "member_id"; params: Record<string, string | number> };

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
    memberId: string; // 실제 조회에 사용된 로그인 아이디
    period: Period;
    shopNo: number;
    foundBy: "cellphone" | "member_id";
  };
};

type SingleErr = {
  input: string;
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type SingleResult = SingleOk | SingleErr;

type BulkRequest = {
  user_ids: string[];
  period?: Period;
  shop_no?: number;
  guess?: boolean;
  concurrency?: number;
};

/** ===================== Utilities ===================== **/

// 'YYYY-MM-DD HH:mm:ss'
const fmtYmdHms = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
};

// Cafe24 한도: start ~ (start+3개월−1초)
function clampCafe24Window(start: Date, to: Date): { s: Date; e: Date } {
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);

  const maxEnd = new Date(s);
  maxEnd.setMonth(maxEnd.getMonth() + 3);
  maxEnd.setSeconds(maxEnd.getSeconds() - 1);

  const endCap = new Date(to);
  endCap.setHours(23, 59, 59, 0);

  const e = new Date(Math.min(maxEnd.getTime(), endCap.getTime()));
  return { s, e };
}

// 긴 범위(예: 1년) → 3개월 윈도우로 분할
function splitCafe24Windows(from: Date, to: Date): Array<{ s: Date; e: Date }> {
  const out: Array<{ s: Date; e: Date }> = [];
  let cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  const hardTo = new Date(to);
  hardTo.setHours(23, 59, 59, 0);

  while (cursor <= hardTo) {
    const { s, e } = clampCafe24Window(cursor, hardTo);
    out.push({ s, e });

    const next = new Date(e);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    cursor = next;
  }
  return out;
}

// 숫자 안전 파싱
const toAmount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 지수 백오프 재시도 (429/5xx만)
async function withBackoff<T>(fn: () => Promise<T>, attempts = 3, baseMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const ax = e as AxiosError<unknown>;
      const status = ax.response?.status ?? 0;
      const retriable = status === 429 || status >= 500;
      if (!retriable || i === attempts - 1) break;
      const jitter = Math.floor(Math.random() * 150);
      const delay = baseMs * Math.pow(2, i) + jitter;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// 페이지네이션 합산
async function sumOrdersAmount(params: {
  mallId: string;
  token: string;
  memberId: string;
  start: string;
  end: string;
  shopNo: number;
  pageSize?: number;
  maxPages?: number;
}): Promise<number> {
  const { mallId, token, memberId, start, end, shopNo, pageSize = 100, maxPages = 50 } = params;

  let offset = 0;
  let pages = 0;
  let total = 0;

  while (pages < maxPages) {
    const res = await withBackoff<AxiosResponse<OrdersListResponse>>(() =>
      axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
        params: {
          shop_no: shopNo,
          start_date: start,
          end_date: end,
          member_id: memberId,
          order_status: "N40,N50",
          limit: pageSize,
          offset,
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
        validateStatus: (s: number) => s === 200 || s === 404,
      }),
    );

    const orders = res.data?.orders ?? [];
    if (orders.length === 0) break;

    total += orders.reduce((sum: number, o: OrdersListOrder) => sum + toAmount(o.order_price_amount), 0);

    if (orders.length < pageSize) break;
    offset += pageSize;
    pages += 1;
  }
  return total;
}

/** ===================== Core: single user ===================== **/

type SingleCtx = {
  mallId: string;
  token: string;
  shopNo: number;
  period: Period;
  guess: boolean;
};

async function fetchOne(rawInput: string, ctx: SingleCtx): Promise<SingleResult> {
  const { mallId, token, shopNo, period, guess } = ctx;

  const raw = decodeURIComponent(rawInput).trim();
  const digits = raw.replace(/\D/g, "");
  const isPhone = /^0\d{9,10}$/.test(digits);
  const isNumericOnly = /^\d+$/.test(raw);

  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Cafe24-Api-Version": "2025-06-01",
  };

  // 1) Customers 조회 전략 만들기
  const strategies: Strategy[] = [];
  if (isPhone) {
    strategies.push({ name: "cellphone", params: { limit: 1, cellphone: digits } });
  } else if (isNumericOnly) {
    // 숫자-only → 후보 생성
    const candidates: string[] = guess ? [raw, `${raw}@k`, `${raw}@n`] : [raw];
    let matched: string | undefined;

    for (const cand of candidates) {
      const t = await withBackoff<AxiosResponse<CustomersResponse>>(() =>
        axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
          params: { limit: 1, member_id: cand },
          headers: authHeaders,
          timeout: 6000,
          validateStatus: () => true,
        }),
      );
      if (t.status === 200 && t.data?.customers?.length > 0) {
        matched = cand;
        break;
      }
    }

    if (matched) {
      strategies.push({ name: "member_id", params: { limit: 1, member_id: matched } });
    } else {
      return {
        input: rawInput,
        ok: false,
        error: {
          code: "UNSUPPORTED_IDENTIFIER",
          message: "numeric-only 값이지만 phone/member_id로 해석되지 않습니다.",
          details: { received: raw },
        },
      };
    }
  } else {
    strategies.push({ name: "member_id", params: { limit: 1, member_id: raw } });
  }

  // 2) Customers 조회 실행
  let customerRes: AxiosResponse<CustomersResponse> | undefined;
  let memberLoginId: string | undefined;
  let foundBy: Strategy["name"] | undefined;

  for (const st of strategies) {
    try {
      const r = await withBackoff<AxiosResponse<CustomersResponse>>(() =>
        axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
          params: st.params,
          headers: authHeaders,
          timeout: 8000,
        }),
      );
      const list = r.data?.customers ?? [];
      if (list.length > 0) {
        customerRes = r;
        const c = list[0];
        memberLoginId = c.member_id || c.user_id;
        if (!memberLoginId) continue;
        foundBy = st.name;
        break;
      }
    } catch (e) {
      const ax = e as AxiosError<unknown>;
      if (ax.response?.status === 422) {
        // 파라미터 문제 → 다음 전략 시도
        continue;
      }
      // 그 외 에러는 즉시 실패
      return {
        input: rawInput,
        ok: false,
        error: {
          code: "CUSTOMERS_API_ERROR",
          message: "Customers API 호출 실패",
          details: { status: ax.response?.status, data: ax.response?.data },
        },
      };
    }
  }

  if (!customerRes || !memberLoginId) {
    return {
      input: rawInput,
      ok: false,
      error: {
        code: "CUSTOMER_NOT_FOUND",
        message: "해당 고객을 찾을 수 없습니다.",
        details: { strategies: strategies.map(s => s.name) },
      },
    };
  }

  const customer = customerRes.data.customers[0];

  // 3) Orders 조회
  let totalOrders = 0;
  let totalPurchaseAmount = 0;
  const now = new Date();

  try {
    if (period === "3months") {
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const { s, e } = clampCafe24Window(threeMonthsAgo, now);
      const startStr = fmtYmdHms(s);
      const endStr = fmtYmdHms(e);

      const countRes = await withBackoff<AxiosResponse<OrdersCountResponse>>(() =>
        axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
          params: {
            shop_no: shopNo,
            start_date: startStr,
            end_date: endStr,
            member_id: memberLoginId as string,
            order_status: "N40,N50",
          },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 8000,
        }),
      );
      totalOrders = countRes.data?.count ?? 0;

      if (totalOrders > 0) {
        totalPurchaseAmount = await sumOrdersAmount({
          mallId,
          token,
          memberId: memberLoginId,
          start: startStr,
          end: endStr,
          shopNo,
          pageSize: 100,
        });
      }
    } else {
      const endAll = new Date(now);
      const startAll = new Date(now);
      startAll.setFullYear(endAll.getFullYear() - 1);

      const windows = splitCafe24Windows(startAll, endAll);
      for (const { s, e } of windows) {
        const sStr = fmtYmdHms(s);
        const eStr = fmtYmdHms(e);

        const countRes = await withBackoff<AxiosResponse<OrdersCountResponse>>(() =>
          axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
            params: {
              shop_no: shopNo,
              start_date: sStr,
              end_date: eStr,
              member_id: memberLoginId as string,
              order_status: "N40,N50",
            },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000,
          }),
        );

        const chunkCount = countRes.data?.count ?? 0;
        totalOrders += chunkCount;

        if (chunkCount > 0) {
          const chunkAmount = await sumOrdersAmount({
            mallId,
            token,
            memberId: memberLoginId,
            start: sStr,
            end: eStr,
            shopNo,
            pageSize: 200,
            maxPages: 100,
          });
          totalPurchaseAmount += chunkAmount;
        }
      }
    }
  } catch (e) {
    const ax = e as AxiosError<unknown>;
    return {
      input: rawInput,
      ok: false,
      error: {
        code: "ORDERS_API_ERROR",
        message: "Orders API 호출 실패",
        details: { status: ax.response?.status, data: ax.response?.data },
      },
    };
  }

  return {
    input: rawInput,
    ok: true,
    data: {
      userId: customer.user_id,
      userName: customer.user_name,
      memberGrade: customer.group?.group_name,
      joinDate: customer.created_date,
      totalPurchaseAmount,
      totalOrders,
      email: customer.email,
      phone: customer.phone,
      lastLoginDate: customer.last_login_date,
      memberId: memberLoginId,
      period,
      shopNo,
      foundBy: isPhone ? "cellphone" : "member_id",
    },
  };
}

/** ===================== Concurrency Runner ===================== **/

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  // 간단한 작업 큐 (의존 라이브러리 없이)
  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    for (;;) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  };

  const runners: Array<Promise<void>> = [];
  const pool = Math.max(1, limit);
  for (let i = 0; i < pool; i++) {
    runners.push(runOne());
  }

  await Promise.all(runners);
  return results;
}

/** ===================== Handler (POST) ===================== **/

export async function POST(req: Request) {
  let body: BulkRequest;
  try {
    body = (await req.json()) as BulkRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userIds = Array.isArray(body.user_ids) ? body.user_ids : [];
  if (userIds.length === 0) {
    return NextResponse.json({ error: "user_ids must be a non-empty array" }, { status: 400 });
  }

  const period: Period = body.period ?? "3months";
  if (period !== "3months" && period !== "1year") {
    return NextResponse.json({ error: "Invalid period", valid: ["3months", "1year"] }, { status: 400 });
  }

  const shopNo = typeof body.shop_no === "number" ? body.shop_no : 1;
  const guess = body.guess !== false; // default true
  const concurrency = typeof body.concurrency === "number" && body.concurrency > 0 ? body.concurrency : 8;

  // 토큰/몰ID 1회 로드
  const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID;
  if (!mallId) {
    return NextResponse.json({ error: "Missing NEXT_PUBLIC_CAFE24_MALL_ID" }, { status: 500 });
  }
  const { access_token } = (await loadParams(["access_token"])) as { access_token: string };

  const ctx: SingleCtx = { mallId, token: access_token, shopNo, period, guess };

  // 중복 제거(같은 id 여러 번 온 경우 낭비 방지)
  const unique = Array.from(new Set(userIds));

  // 동시성 제한 실행
  const results = await runWithConcurrency<string, SingleResult>(unique, concurrency, id => fetchOne(id, ctx));

  // 원래 순서대로 재정렬(중복은 첫 결과 매핑)
  const byInput = new Map<string, SingleResult>();
  for (const r of results) {
    byInput.set(r.input, r);
  }
  const ordered: SingleResult[] = userIds.map(
    id =>
      byInput.get(id) ?? {
        input: id,
        ok: false,
        error: { code: "INTERNAL", message: "Missing result (unexpected)" },
      },
  );

  // 집계
  const okCount = ordered.filter(r => r.ok).length;
  const failCount = ordered.length - okCount;

  return NextResponse.json({
    total: ordered.length,
    success: okCount,
    failed: failCount,
    period,
    shopNo,
    concurrency,
    results: ordered,
  });
}
