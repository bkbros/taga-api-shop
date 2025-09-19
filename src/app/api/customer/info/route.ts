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
//   // Cafe24 응답에 등급 번호가 들어오는 경우가 있어 대비
//   group?: { group_name?: string; group_no?: number };
//   group_no?: number; // 혹시 top-level 로 내려오는 몰도 있어 대비
// };

// type CustomersResponse = { customers: Customer[] };

// type OrdersCountResponse = { count: number };

// type Strategy = { name: "cellphone" | "member_id"; params: Record<string, string | number> };

// type Period = "3months" | "1year";

// /** ===================== Phone Normalizer ===================== **/

// function normalizeKoreanCellphone(input: string): string | null {
//   const digits = input.replace(/\D/g, "");
//   if (!digits) return null;

//   // 82로 시작하면 0 프리픽스 부여
//   if (digits.startsWith("82")) {
//     const rest = digits.slice(2);
//     if (rest.startsWith("10")) return `0${rest}`; // 8210xxxx → 010xxxx
//     if (rest.length >= 2 && rest[0] !== "0") return `0${rest}`;
//   }

//   // 10xxxxxxxx → 010xxxxxxxx
//   if (digits.startsWith("10")) return `0${digits}`;

//   // 이미 0으로 시작하는 10~11자리
//   if (/^0\d{9,10}$/.test(digits)) return digits;

//   return null;
// }

// /** ===================== KST Utilities (for 3 months window) ===================== **/

// const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// const pad2 = (n: number) => String(n).padStart(2, "0");

// function fmtKST(d: Date): string {
//   const k = new Date(d.getTime() + KST_OFFSET_MS);
//   const y = k.getUTCFullYear();
//   const m = pad2(k.getUTCMonth() + 1);
//   const day = pad2(k.getUTCDate());
//   const hh = pad2(k.getUTCHours());
//   const mm = pad2(k.getUTCMinutes());
//   const ss = pad2(k.getUTCSeconds());
//   return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
// }

// function fromKst(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
//   const utc = Date.UTC(y, m - 1, d, hh, mm, ss);
//   return new Date(utc - KST_OFFSET_MS);
// }

// function getKstYmd(d: Date): { y: number; m: number; d: number } {
//   const k = new Date(d.getTime() + KST_OFFSET_MS);
//   return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
// }

// function kstStartOfDay(d: Date): Date {
//   const { y, m, d: dd } = getKstYmd(d);
//   return fromKst(y, m, dd, 0, 0, 0);
// }

// function kstEndOfDay(d: Date): Date {
//   const { y, m, d: dd } = getKstYmd(d);
//   return fromKst(y, m, dd, 23, 59, 59);
// }

// function addMonthsKST(base: Date, months: number): Date {
//   const k = new Date(base.getTime() + KST_OFFSET_MS);
//   k.setUTCMonth(k.getUTCMonth() + months);
//   return new Date(k.getTime() - KST_OFFSET_MS);
// }

// function clampCafe24WindowKST(startKstDay: Date, capKstDay: Date): { s: Date; e: Date } {
//   const s = kstStartOfDay(startKstDay);
//   const maxEnd = addMonthsKST(s, +3);
//   maxEnd.setUTCSeconds(maxEnd.getUTCSeconds() - 1); // 3개월 - 1초
//   const capEnd = kstEndOfDay(capKstDay);
//   const e = new Date(Math.min(maxEnd.getTime(), capEnd.getTime()));
//   return { s, e };
// }

// /** ===================== Simple Rate Limiter + Retry ===================== **/

// class RateLimiter {
//   private queue: Array<() => Promise<void>> = [];
//   private running = 0;
//   private lastRequestTime = 0;

//   constructor(private maxConcurrent = 3, private minInterval = 200) {}

//   async execute<T>(fn: () => Promise<T>): Promise<T> {
//     return new Promise<T>((resolve, reject) => {
//       const task = async () => {
//         try {
//           const now = Date.now();
//           const delta = now - this.lastRequestTime;
//           if (delta < this.minInterval) {
//             await new Promise(r => setTimeout(r, this.minInterval - delta));
//           }
//           this.lastRequestTime = Date.now();
//           const res = await fn();
//           resolve(res);
//         } catch (e) {
//           reject(e);
//         } finally {
//           this.running--;
//           this.pump();
//         }
//       };
//       this.queue.push(task);
//       this.pump();
//     });
//   }

//   private pump() {
//     if (this.running >= this.maxConcurrent) return;
//     const next = this.queue.shift();
//     if (!next) return;
//     this.running++;
//     next();
//   }
// }

// const rateLimiter = new RateLimiter(1, 400);

// // (B) withRetry에서 429 지수백오프 + 지터 강화
// async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4, baseDelay = 1200): Promise<T> {
//   let last: unknown;
//   for (let attempt = 0; attempt <= maxRetries; attempt++) {
//     try {
//       return await rateLimiter.execute(fn);
//     } catch (err) {
//       last = err;
//       if (axios.isAxiosError(err)) {
//         const status = err.response?.status;
//         if (status === 429 || (status && status >= 500)) {
//           if (attempt < maxRetries) {
//             // Retry-After 헤더 있으면 우선 사용
//             const ra = (err.response?.headers as Record<string, string> | undefined)?.["retry-after"];
//             let delay = ra ? Number(ra) * 1000 : baseDelay * Math.pow(2, attempt);
//             delay += Math.floor(Math.random() * 400); // 지터
//             await new Promise(r => setTimeout(r, delay));
//             continue;
//           }
//         }
//       }
//       if (attempt === maxRetries) throw last;
//     }
//   }
//   throw last as Error;
// }
// // const limiter = new RateLimiter(3, 200);
// // async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
// //   let lastErr: unknown;
// //   for (let i = 0; i <= maxRetries; i++) {
// //     try {
// //       return await limiter.execute(fn);
// //     } catch (e) {
// //       lastErr = e;
// //       if (axios.isAxiosError(e)) {
// //         const st = e.response?.status ?? 0;
// //         if (st === 429 || st >= 500) {
// //           if (i < maxRetries) {
// //             const delay = baseDelay * Math.pow(2, i);
// //             await new Promise(r => setTimeout(r, delay));
// //             continue;
// //           }
// //         }
// //       }
// //       break;
// //     }
// //   }
// //   throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
// // }

// /** ===================== Handler ===================== **/

// export async function GET(req: Request) {
//   const url = new URL(req.url);
//   const userId = url.searchParams.get("user_id");
//   const periodParam = (url.searchParams.get("period") || "3months") as Period;
//   const shopNoRaw = url.searchParams.get("shop_no") ?? "1";
//   const shopNo = Number.isNaN(Number(shopNoRaw)) ? 1 : Number(shopNoRaw);
//   const guess = url.searchParams.get("guess") !== "0"; // 숫자-only → @k/@n 후보 시도 여부

//   if (!userId) {
//     return NextResponse.json({ error: "user_id parameter is required" }, { status: 400 });
//   }
//   if (periodParam !== "3months" && periodParam !== "1year") {
//     return NextResponse.json({ error: "Invalid period parameter", validValues: ["3months", "1year"] }, { status: 400 });
//   }

//   const startTime = Date.now();
//   let raw: string;
//   try {
//     raw = decodeURIComponent(userId).trim();
//   } catch {
//     return NextResponse.json({ error: "Invalid user_id encoding" }, { status: 400 });
//   }

//   console.log(`[REQUEST] user_id=${raw}, period=${periodParam}, shop_no=${shopNo}`);

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

//     /** 1) 고객 조회: member_id 우선 시도(숫자-only면 @k/@n 후보도), 실패 시 cellphone **/
//     const strategies: Strategy[] = [];

//     const isNumericOnly = /^\d+$/.test(raw);

//     if (!raw.includes("@") && !raw.includes(".") && isNumericOnly) {
//       // 숫자-only → 아이디 후보 시도
//       const candidates = guess ? [raw, `${raw}@k`, `${raw}@n`] : [raw];
//       let matched: string | undefined;

//       for (const cand of candidates) {
//         const t: AxiosResponse<CustomersResponse> = await withRetry(() =>
//           axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
//             params: { limit: 1, member_id: cand },
//             headers: authHeaders,
//             timeout: 10000,
//             validateStatus: () => true,
//           }),
//         );

//         if (t.status === 200 && t.data?.customers?.length > 0) {
//           matched = cand;
//           break;
//         }
//       }

//       if (matched) {
//         strategies.push({ name: "member_id", params: { limit: 1, member_id: matched } });
//         console.log(`[CUSTOMERS] numeric→member_id matched: ${raw} -> ${matched}`);
//       } else {
//         // 아이디 매칭 실패 → 휴대폰 정규화 시도
//         const normalizedCell = normalizeKoreanCellphone(raw);
//         if (normalizedCell) {
//           strategies.push({ name: "cellphone", params: { limit: 1, cellphone: normalizedCell } });
//           console.log(`[CUSTOMERS] fallback as cellphone=${normalizedCell}`);
//         } else {
//           return NextResponse.json(
//             {
//               error: "Unsupported identifier",
//               hint: "로그인 아이디(예: 4346815169@k) 또는 휴대폰(010...)을 주세요.",
//               received: raw,
//             },
//             { status: 400 },
//           );
//         }
//       }
//     } else {
//       // 먼저 member_id 로 시도
//       strategies.push({ name: "member_id", params: { limit: 1, member_id: raw } });
//       // 실패 대비해 휴대폰도 후보로 넣어줌
//       const normalizedCell = normalizeKoreanCellphone(raw);
//       if (normalizedCell) {
//         strategies.push({ name: "cellphone", params: { limit: 1, cellphone: normalizedCell } });
//       }
//     }

//     let customerRes: AxiosResponse<CustomersResponse> | undefined;
//     let memberLoginId: string | undefined;
//     let foundBy: Strategy["name"] | undefined;

//     for (const st of strategies) {
//       console.log(`[CUSTOMERS] try by ${st.name}`, st.params);
//       try {
//         const r: AxiosResponse<CustomersResponse> = await withRetry(() =>
//           axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
//             params: st.params,
//             headers: authHeaders,
//             timeout: 10000,
//             validateStatus: s => s === 200 || s === 404 || s === 422,
//           }),
//         );

//         if (r.status === 422) {
//           console.error(`[CUSTOMERS] 422:`, r.data, `sent=`, st.params);
//           continue;
//         }

//         const list = r.data?.customers ?? [];
//         if (list.length > 0) {
//           customerRes = r;
//           const c = list[0];
//           const loginId = c.member_id || c.user_id;
//           if (!loginId) {
//             console.warn(`[CUSTOMERS] found but loginId missing`);
//             continue;
//           }
//           memberLoginId = loginId;
//           foundBy = st.name;
//           console.log(`[CUSTOMERS] OK by=${foundBy}, member_id=${memberLoginId}`);
//           break;
//         } else {
//           console.log(`[CUSTOMERS] ${st.name} no result`);
//         }
//       } catch (err) {
//         const ax = err as AxiosError<unknown>;
//         console.error(`[CUSTOMERS] ${st.name} failed`, ax.response?.status, ax.response?.data);
//       }
//     }

//     if (!customerRes || !memberLoginId || !foundBy) {
//       return NextResponse.json(
//         {
//           error: "Customer not found",
//           triedStrategies: strategies.map(s => s.name),
//           hint: "아이디(@k/@n/일반ID) 또는 국내 휴대폰(010~)을 확인하세요.",
//         },
//         { status: 404 },
//       );
//     }

//     const customer = customerRes.data.customers[0];

//     /** 2) Orders 조회: KST 기준 최근 3개월 **/
//     let totalOrders = 0;
//     const now = new Date();
//     const threeMonthsAgo = addMonthsKST(now, -3);
//     const { s, e } = clampCafe24WindowKST(threeMonthsAgo, now);
//     const startStr = fmtKST(s);
//     const endStr = fmtKST(e);

//     console.log(`[ORDERS] window: ${startStr} ~ ${endStr}`);

//     const countRes: AxiosResponse<OrdersCountResponse> = await withRetry(() =>
//       axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
//         params: {
//           shop_no: shopNo,
//           start_date: startStr,
//           end_date: endStr,
//           member_id: memberLoginId,
//           order_status: "N40,N50",
//         },
//         headers: { Authorization: `Bearer ${access_token}` },
//         timeout: 10000,
//       }),
//     );

//     totalOrders = countRes.data?.count ?? 0;

//     const processingTime = Date.now() - startTime;
//     console.log(`[FINAL RESULT] totalOrders=${totalOrders}, processingTime=${processingTime}ms`);

//     // 등급 번호(숫자) 추출: group.group_no 우선, 없으면 top-level group_no 시도
//     const memberGradeNo =
//       (typeof customer.group?.group_no === "number" ? customer.group.group_no : undefined) ??
//       (typeof customer.group_no === "number" ? customer.group_no : undefined);

//     const customerInfo = {
//       userId: customer.user_id,
//       userName: customer.user_name,
//       memberId: memberLoginId,
//       memberGrade: customer.group?.group_name || "일반회원",
//       memberGradeNo, // 숫자 (없으면 undefined)
//       joinDate: customer.created_date,
//       totalOrders,
//       email: customer.email,
//       phone: customer.phone,
//       lastLoginDate: customer.last_login_date,
//       period: periodParam,
//       shopNo,
//       searchMethod: foundBy,
//       processingTime,
//     };

//     return NextResponse.json(customerInfo);
//   } catch (error) {
//     const processingTime = Date.now() - startTime;
//     console.error(`[ERROR] failed after ${processingTime}ms`, error);

//     if (axios.isAxiosError(error)) {
//       const st = error.response?.status;
//       const data = error.response?.data;
//       if (st === 401)
//         return NextResponse.json({ error: "Unauthorized - token may be expired", processingTime }, { status: 401 });
//       if (st === 422)
//         return NextResponse.json(
//           { error: "Invalid request parameters", details: data, processingTime },
//           { status: 422 },
//         );
//       if (st === 404) return NextResponse.json({ error: "Not found", details: data, processingTime }, { status: 404 });
//       if (st === 429)
//         return NextResponse.json(
//           { error: "Rate limited by Cafe24 API. Please retry later.", processingTime },
//           { status: 429 },
//         );
//       if (st && st >= 500)
//         return NextResponse.json(
//           { error: "Upstream server error from Cafe24", details: data, processingTime },
//           { status: 502 },
//         );
//     }

//     return NextResponse.json({ error: "Failed to fetch customer information", processingTime }, { status: 500 });
//   }
// }
import { NextResponse } from "next/server";
import axios, { AxiosError, AxiosResponse } from "axios";
import { loadParams } from "@/lib/ssm";

/** ========= Types ========= **/
type Customer = {
  user_id: string;
  user_name?: string;
  member_id: string;
  member_no?: string | number;
  created_date?: string;
  email?: string;
  phone?: string;
  last_login_date?: string;
  group?: { group_name?: string; group_no?: number };
  group_no?: number;
};
type CustomersResponse = { customers: Customer[] };
type OrdersCountResponse = { count: number };
type Strategy = { name: "member_id" | "cellphone"; params: Record<string, string | number> };
type Period = "3months" | "1year";

/** ========= Phone normalize ========= **/
function normalizeKoreanCellphone(input?: string | null): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("82")) {
    const rest = digits.slice(2);
    if (rest.startsWith("10")) return `0${rest}`;
    if (rest.length >= 2 && rest[0] !== "0") return `0${rest}`;
  }
  if (digits.startsWith("10")) return `0${digits}`;
  if (/^0\d{9,10}$/.test(digits)) return digits;
  return null;
}

/** ========= KST helpers ========= **/
const KST = 9 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");
function fmtKST(d: Date) {
  const k = new Date(d.getTime() + KST);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())} ${pad2(k.getUTCHours())}:${pad2(
    k.getUTCMinutes(),
  )}:${pad2(k.getUTCSeconds())}`;
}
function addMonthsKST(base: Date, months: number) {
  const k = new Date(base.getTime() + KST);
  k.setUTCMonth(k.getUTCMonth() + months);
  return new Date(k.getTime() - KST);
}
function clamp3MonthsWindow(ksStart: Date, ksEnd: Date) {
  const s = new Date(ksStart);
  s.setUTCHours(0, 0, 0, 0);
  const e = new Date(s);
  e.setUTCMonth(e.getUTCMonth() + 3);
  e.setUTCSeconds(e.getUTCSeconds() - 1);
  const cap = new Date(ksEnd);
  cap.setUTCHours(23, 59, 59, 0);
  return { s, e: new Date(Math.min(e.getTime(), cap.getTime())) };
}

/** ========= limiter + retry ========= **/
class RateLimiter {
  private q: Array<() => Promise<void>> = [];
  private running = 0;
  private last = 0;
  constructor(private maxC = 3, private minMs = 200) {}
  execute<T>(fn: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const task = async () => {
        try {
          const now = Date.now();
          const wait = this.minMs - (now - this.last);
          if (wait > 0) await new Promise(r => setTimeout(r, wait));
          this.last = Date.now();
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          this.pump();
        }
      };
      this.q.push(task);
      this.pump();
    });
  }
  private pump() {
    if (this.running >= this.maxC) return;
    const t = this.q.shift();
    if (!t) return;
    this.running++;
    t();
  }
}
const limiter = new RateLimiter(3, 200);

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await limiter.execute(fn);
    } catch (e) {
      last = e;
      if (axios.isAxiosError(e)) {
        const st = e.response?.status ?? 0;
        if ((st === 429 || st >= 500) && i < maxRetries) {
          const delay = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 300);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      break;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** ========= Handler ========= **/
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userIdRaw = url.searchParams.get("user_id");
  const phoneHintRaw = url.searchParams.get("phone_hint"); // 👈 폰 힌트 추가
  const period = (url.searchParams.get("period") || "3months") as Period;
  const shopNo = Number(url.searchParams.get("shop_no") ?? "1") || 1;
  const guess = url.searchParams.get("guess") !== "0"; // 아이디 후보(@k/@n) 시도 여부

  if (!userIdRaw) {
    return NextResponse.json({ error: "user_id parameter is required" }, { status: 400 });
  }
  if (period !== "3months" && period !== "1year") {
    return NextResponse.json({ error: "Invalid period parameter", validValues: ["3months", "1year"] }, { status: 400 });
  }

  const startT = Date.now();
  const raw = decodeURIComponent(userIdRaw).trim();
  const phoneHint = normalizeKoreanCellphone(phoneHintRaw);

  console.log(`[REQUEST] primary="${raw}", phone_hint="${phoneHint ?? ""}", period=${period}`);

  try {
    const { access_token } = (await loadParams(["access_token"])) as { access_token: string };
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const authHeaders = { Authorization: `Bearer ${access_token}`, "X-Cafe24-Api-Version": "2025-06-01" };

    /** ------- 1) Search order: member_id → cellphone (with phone_hint) ------- **/
    const strategies: Strategy[] = [];
    const looksLikePhone = !!normalizeKoreanCellphone(raw);
    const isNumericOnly = /^\d+$/.test(raw);

    // 항상 아이디 먼저 시도
    if (!looksLikePhone) {
      const idCandidates = guess && isNumericOnly ? [raw, `${raw}@k`, `${raw}@n`] : [raw];
      for (const cand of idCandidates) {
        strategies.push({ name: "member_id", params: { limit: 1, member_id: cand } });
      }
    } else {
      // raw가 전화번호처럼 보여도, 아이디 케이스가 아니므로 넘어감
      // (배치 쪽에서 AC가 있으면 그걸 user_id로 넘겨주니 여기선 phone 먼저 가는게 정상)
    }

    // 아이디가 안 맞으면 휴대폰(힌트 우선, 없으면 raw가 폰이면 raw)
    const phoneForFallback = phoneHint ?? (looksLikePhone ? normalizeKoreanCellphone(raw) : null);
    if (phoneForFallback) {
      strategies.push({ name: "cellphone", params: { limit: 1, cellphone: phoneForFallback } });
    }

    let found: Customer | null = null;
    let memberLoginId = "";
    let foundBy: "member_id" | "cellphone" | null = null;

    for (const st of strategies) {
      console.log(`[CUSTOMERS] try by ${st.name}`, st.params);
      try {
        const r: AxiosResponse<CustomersResponse> = await withRetry(() =>
          axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
            params: st.params,
            headers: authHeaders,
            timeout: 10000,
            validateStatus: s => s === 200 || s === 404 || s === 422,
          }),
        );

        if (r.status !== 200) {
          console.warn(`[CUSTOMERS] status=${r.status}`, r.data);
          continue;
        }

        const list = r.data?.customers ?? [];
        if (list.length > 0) {
          found = list[0];
          memberLoginId = found.member_id || found.user_id;
          foundBy = st.name;
          console.log(`[CUSTOMERS] OK by=${foundBy}, member_id=${memberLoginId}`);
          break;
        }
      } catch (err) {
        const ax = err as AxiosError;
        console.error(`[CUSTOMERS] ${st.name} failed`, ax.response?.status, ax.response?.data);
      }
    }

    if (!found || !memberLoginId) {
      return NextResponse.json({ error: "Customer not found", tried: strategies.map(s => s.name) }, { status: 404 });
    }

    /** ------- 2) Orders: recent 3 months (KST) ------- **/
    const now = new Date();
    const threeAgo = addMonthsKST(now, -3);
    const { s, e } = clamp3MonthsWindow(threeAgo, now);
    const startStr = fmtKST(s);
    const endStr = fmtKST(e);

    const countRes: AxiosResponse<OrdersCountResponse> = await withRetry(() =>
      axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
        params: {
          shop_no: shopNo,
          start_date: startStr,
          end_date: endStr,
          member_id: memberLoginId,
          order_status: "N40,N50",
        },
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 10000,
      }),
    );
    const totalOrders = countRes.data?.count ?? 0;

    // 등급 번호
    const memberGradeNo =
      (typeof found.group?.group_no === "number" ? found.group.group_no : undefined) ??
      (typeof (found as any).group_no === "number" ? (found as any).group_no : undefined);

    const body = {
      userId: found.user_id,
      userName: found.user_name,
      memberId: memberLoginId,
      memberGrade: found.group?.group_name || "일반회원",
      memberGradeNo,
      joinDate: found.created_date,
      totalOrders,
      email: found.email,
      phone: found.phone,
      lastLoginDate: found.last_login_date,
      period,
      shopNo,
      searchMethod: foundBy,
      processingTime: Date.now() - startT,
    };

    return NextResponse.json(body);
  } catch (error) {
    const ms = Date.now() - (Number.NaN as any);
    console.error(`[ERROR] info route failed`, error);
    if (axios.isAxiosError(error)) {
      const st = error.response?.status;
      const data = error.response?.data;
      if (st === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      if (st === 422) return NextResponse.json({ error: "Invalid request", details: data }, { status: 422 });
      if (st === 429) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
      if (st && st >= 500) return NextResponse.json({ error: "Upstream error", details: data }, { status: 502 });
    }
    return NextResponse.json({ error: "Failed to fetch customer information" }, { status: 500 });
  }
}
