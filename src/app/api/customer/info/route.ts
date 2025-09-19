import { NextResponse } from "next/server";
import axios, { AxiosError, AxiosResponse } from "axios";
import { loadParams } from "@/lib/ssm";

/** ===================== Types ===================== **/

type Customer = {
  user_id: string;
  user_name?: string;
  member_id: string; // 로그인 아이디(주문 조회에 사용)
  member_no?: string | number;
  created_date?: string;
  email?: string;
  phone?: string;
  cellphone?: string;
  last_login_date?: string;
  group_no?: number; // 일부 몰에서 루트에 존재
  group?: {
    group_name?: string;
    group_no?: number; // 일부 몰에서 group 객체에 존재
  };
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

type StrategyName = "cellphone" | "phone" | "member_id";
type Strategy = { name: StrategyName; params: Record<string, string | number> };

type Period = "3months" | "1year";

/** ===================== KST Utilities ===================== **/

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");

// KST 달력 기준으로 포맷: 'YYYY-MM-DD HH:mm:ss'
function fmtKST(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  const y = k.getUTCFullYear();
  const m = pad2(k.getUTCMonth() + 1);
  const day = pad2(k.getUTCDate());
  const hh = pad2(k.getUTCHours());
  const mm = pad2(k.getUTCMinutes());
  const ss = pad2(k.getUTCSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

// 주어진 KST 달력 시각을 나타내는 Date 생성(내부적으로 UTC기반으로 저장)
function fromKst(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  const utc = Date.UTC(y, m - 1, d, hh, mm, ss);
  return new Date(utc - KST_OFFSET_MS);
}

// Date를 KST 달력으로 해석했을 때의 Y/M/D 반환
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

// KST 달력 기준 월 이동
function addMonthsKST(base: Date, months: number): Date {
  const k = new Date(base.getTime() + KST_OFFSET_MS);
  k.setUTCMonth(k.getUTCMonth() + months);
  return new Date(k.getTime() - KST_OFFSET_MS);
}

// Cafe24 한 호출 범위: start(00:00:00 KST) ~ min(start+3개월-1초, capEndOfDay(KST))
function clampCafe24WindowKST(startKstDay: Date, capKstDay: Date): { s: Date; e: Date } {
  const s = kstStartOfDay(startKstDay);
  const maxEnd = addMonthsKST(s, +3);
  maxEnd.setUTCSeconds(maxEnd.getUTCSeconds() - 1); // 3개월 - 1초
  const capEnd = kstEndOfDay(capKstDay);
  const e = new Date(Math.min(maxEnd.getTime(), capEnd.getTime()));
  return { s, e };
}

// 긴 범위를 KST 기준 3개월 윈도우로 분할
function splitCafe24WindowsKST(fromKstDate: Date, toKstDate: Date): Array<{ s: Date; e: Date }> {
  const out: Array<{ s: Date; e: Date }> = [];
  let cursor = kstStartOfDay(fromKstDate);
  const cap = kstEndOfDay(toKstDate);

  while (cursor.getTime() <= cap.getTime()) {
    const { s, e } = clampCafe24WindowKST(cursor, cap);
    out.push({ s, e });

    // 다음 윈도우 시작: e 다음 날 00:00:00 (KST)
    const { y, m, d } = getKstYmd(e);
    cursor = fromKst(y, m, d + 1, 0, 0, 0);
  }
  return out;
}

/** ===================== Rate Limiting & Retry ===================== **/

class RateLimiter {
  private queue: Array<() => Promise<unknown>> = [];
  private running = 0;
  private lastRequestTime = 0;

  constructor(private maxConcurrent = 3, private minInterval = 200) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const now = Date.now();
          const gap = now - this.lastRequestTime;
          if (gap < this.minInterval) {
            await new Promise(r => setTimeout(r, this.minInterval - gap));
          }
          this.lastRequestTime = Date.now();
          const result = await fn();
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          this.processQueue();
        }
      });
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;
    const task = this.queue.shift();
    if (task) {
      this.running++;
      task();
    }
  }
}
const rateLimiter = new RateLimiter(3, 200);

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await rateLimiter.execute(fn);
    } catch (error) {
      lastError = error as Error;
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 429 || (status && status >= 500)) {
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`[RETRY] ${attempt + 1}/${maxRetries + 1} retry in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        } else {
          throw error;
        }
      }
      if (attempt === maxRetries) throw lastError;
    }
  }
  throw lastError!;
}

/** ===================== Helpers ===================== **/

const toAmount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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
    const res: AxiosResponse<OrdersListResponse> = await withRetry(() =>
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
        timeout: 15000,
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

/** ===================== Handler ===================== **/

export async function GET(req: Request) {
  const url = new URL(req.url);

  const userId = url.searchParams.get("user_id");
  const periodParam = (url.searchParams.get("period") || "3months") as Period;
  const shopNoRaw = url.searchParams.get("shop_no") ?? "1";
  const shopNo = Number.isNaN(Number(shopNoRaw)) ? 1 : Number(shopNoRaw);
  const guess = url.searchParams.get("guess") !== "0"; // 숫자-only → @k/@n 자동 시도

  if (!userId) {
    return NextResponse.json({ error: "user_id parameter is required" }, { status: 400 });
  }
  if (periodParam !== "3months" && periodParam !== "1year") {
    return NextResponse.json({ error: "Invalid period parameter", validValues: ["3months", "1year"] }, { status: 400 });
  }

  console.log(`[REQUEST START] user_id=${userId}, period=${periodParam}, shop_no=${shopNo}`);
  const startedAt = Date.now();

  // 입력 전처리
  let raw = "";
  try {
    raw = decodeURIComponent(userId).trim();
  } catch {
    return NextResponse.json({ error: "Invalid user_id encoding" }, { status: 400 });
  }

  console.log(`[DEBUG] Raw input: ${raw}`);

  const digits = raw.replace(/\D/g, "");
  const isPhone = /^0\d{9,10}$/.test(digits); // 10~11자리
  const isNumericOnly = /^\d+$/.test(raw);

  try {
    const { access_token } = (await loadParams(["access_token"])) as { access_token: string };
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID;
    if (!mallId) return NextResponse.json({ error: "Missing NEXT_PUBLIC_CAFE24_MALL_ID" }, { status: 500 });

    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${access_token}`,
      "X-Cafe24-Api-Version": "2025-06-01",
    };

    /** 1) Customers 조회 전략 구성 **/
    const strategies: Strategy[] = [];

    if (isPhone) {
      // 1순위 cellphone, 2순위 phone (몰에 따라 필드 상이)
      strategies.push({ name: "cellphone", params: { limit: 1, cellphone: digits } });
      strategies.push({ name: "phone", params: { limit: 1, phone: digits } });
    } else if (isNumericOnly) {
      // 숫자-only → 후보 생성 (raw, raw@k, raw@n)
      const candidates: string[] = guess ? [raw, `${raw}@k`, `${raw}@n`] : [raw];
      let matched: string | undefined;

      for (const cand of candidates) {
        const t: AxiosResponse<CustomersResponse> = await withRetry(() =>
          axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
            params: { limit: 1, member_id: cand },
            headers: authHeaders,
            timeout: 10000,
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
        console.log(`[DEBUG] 숫자-only 매칭 성공: ${raw} -> ${matched}`);
      } else {
        console.log(`[ERROR] Unsupported identifier: ${raw} (numeric-only, not phone, not member_id)`);
        return NextResponse.json(
          {
            error: "Unsupported identifier",
            hint: "member_id(로그인 아이디) 또는 휴대폰 번호(010...)를 전달하세요.",
            received: raw,
            examples: ["4346815169@k", "2225150920@n", "yoonhyerin", "01012345678"],
          },
          { status: 400 },
        );
      }
    } else {
      strategies.push({ name: "member_id", params: { limit: 1, member_id: raw } });
    }

    let customerRes: AxiosResponse<CustomersResponse> | undefined;
    let memberLoginId: string | undefined;
    let foundBy: StrategyName | undefined;

    for (const st of strategies) {
      console.log(`[CUSTOMERS API] ${st.name}로 검색 시도`);
      try {
        const r: AxiosResponse<CustomersResponse> = await withRetry(() =>
          axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
            params: st.params,
            headers: authHeaders,
            timeout: 10000,
          }),
        );
        const list = r.data?.customers ?? [];
        if (list.length > 0) {
          customerRes = r;
          const c = list[0];
          const loginId = c.member_id || c.user_id;
          if (!loginId) {
            console.log(`[CUSTOMERS API] 경고: 로그인 아이디 없음(member_id/user_id)`);
            continue;
          }
          memberLoginId = loginId;
          foundBy = st.name;
          console.log(`[CUSTOMERS API] 고객 발견: by=${foundBy}, member_id=${memberLoginId}`);
          break;
        } else {
          console.log(`[CUSTOMERS API] ${st.name} 결과 없음`);
        }
      } catch (err: unknown) {
        const ax = err as AxiosError<unknown>;
        console.log(`[CUSTOMERS API] ${st.name} 실패`, ax.response?.status, ax.response?.data);
      }
    }

    if (!customerRes || !memberLoginId || !foundBy) {
      return NextResponse.json(
        {
          error: "Customer not found",
          triedStrategies: strategies.map(s => s.name),
          hint: isPhone
            ? "휴대폰 번호(010xxxxxxxx) 형식이 정확한지 확인하세요."
            : "로그인 아이디(@k/@n/일반ID)가 맞는지 확인하세요.",
        },
        { status: 404 },
      );
    }

    const customer = customerRes.data.customers[0];
    console.log(`[DEBUG] Customer located by ${foundBy}. member_id=${memberLoginId}`);

    /** 2) Orders 조회: KST 기준, 3개월 한도 엄격 준수 **/

    let totalOrders = 0;
    let totalPurchaseAmount = 0;

    const now = new Date();

    if (periodParam === "3months") {
      const nowKstDay = now;
      const threeMonthsAgoKst = addMonthsKST(nowKstDay, -3);
      const { s, e } = clampCafe24WindowKST(threeMonthsAgoKst, nowKstDay);
      const startStr = fmtKST(s);
      const endStr = fmtKST(e);

      console.log(`[ORDERS API] 3개월 범위: ${startStr} ~ ${endStr}`);

      // Count
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
      totalOrders = countRes.data?.count ?? 0;

      // Amount (필요 시)
      if (totalOrders > 0) {
        totalPurchaseAmount = await sumOrdersAmount({
          mallId,
          token: access_token,
          memberId: memberLoginId,
          start: startStr,
          end: endStr,
          shopNo,
          pageSize: 50,
          maxPages: 100,
        });
      }
    } else {
      // 1년 → KST 기준 3개월 윈도우로 분할
      const endAll = now;
      const startAll = addMonthsKST(endAll, -12);
      const windows = splitCafe24WindowsKST(startAll, endAll);
      console.log(`[ORDERS API] 1년 분할: ${windows.length}개 구간`);

      for (const { s, e } of windows) {
        const sStr = fmtKST(s);
        const eStr = fmtKST(e);

        const countRes: AxiosResponse<OrdersCountResponse> = await withRetry(() =>
          axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
            params: {
              shop_no: shopNo,
              start_date: sStr,
              end_date: eStr,
              member_id: memberLoginId,
              order_status: "N40,N50",
            },
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: 10000,
          }),
        );

        const chunkCount = countRes.data?.count ?? 0;
        totalOrders += chunkCount;

        if (chunkCount > 0) {
          const res: AxiosResponse<OrdersListResponse> = await withRetry(() =>
            axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
              params: {
                shop_no: shopNo,
                start_date: sStr,
                end_date: eStr,
                member_id: memberLoginId,
                order_status: "N40,N50",
                limit: 200,
                offset: 0,
              },
              headers: { Authorization: `Bearer ${access_token}` },
              timeout: 15000,
              validateStatus: (s2: number) => s2 === 200 || s2 === 404,
            }),
          );

          const orders = res.data?.orders ?? [];
          totalPurchaseAmount += orders.reduce((sum, o) => sum + toAmount(o.order_price_amount), 0);
        }
      }
    }

    const processingTime = Date.now() - startedAt;
    console.log(
      `[FINAL RESULT] totalOrders=${totalOrders}, totalPurchaseAmount=${totalPurchaseAmount}, processingTime=${processingTime}ms`,
    );

    // 등급 번호 우선 확보 (가능한 모든 위치에서 시도)
    const memberGradeNo =
      typeof customer.group_no === "number"
        ? customer.group_no
        : typeof customer.group?.group_no === "number"
        ? customer.group?.group_no
        : undefined;

    const customerInfo = {
      userId: customer.user_id,
      userName: customer.user_name,
      memberId: memberLoginId, // 실제 조회에 사용된 로그인 아이디
      memberGrade: customer.group?.group_name,
      memberGradeNo, // <- 숫자 등급
      joinDate: customer.created_date,
      totalOrders,
      totalPurchaseAmount,
      email: customer.email,
      phone: customer.phone ?? customer.cellphone,
      lastLoginDate: customer.last_login_date,
      period: periodParam,
      shopNo,
      searchMethod: foundBy, // "cellphone" | "phone" | "member_id"
      processingTime,
    };

    return NextResponse.json(customerInfo);
  } catch (error: unknown) {
    const took = Date.now() - (globalThis as unknown as { startedAt?: number }).startedAt!;
    console.error(`[ERROR] Request failed after ${took || "?"}ms`, error);

    if (axios.isAxiosError(error)) {
      const ax = error as AxiosError<unknown>;
      const status = ax.response?.status;
      const data = ax.response?.data;

      console.error(`[AXIOS ERROR] Status=${String(status)}`, data);

      if (status === 401) return NextResponse.json({ error: "Unauthorized - token may be expired" }, { status: 401 });
      if (status === 422)
        return NextResponse.json({ error: "Invalid request parameters", details: data }, { status: 422 });
      if (status === 404) return NextResponse.json({ error: "Not found", details: data }, { status: 404 });
      if (status === 429)
        return NextResponse.json(
          { error: "Rate limited by Cafe24 API. Please retry later.", hint: "잠시 후 다시 시도하세요." },
          { status: 429 },
        );
      if (status && status >= 500)
        return NextResponse.json({ error: "Upstream server error from Cafe24", details: data }, { status: 502 });
    }

    return NextResponse.json({ error: "Failed to fetch customer information" }, { status: 500 });
  }
}
