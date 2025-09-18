import { NextResponse } from "next/server";
import axios, { AxiosError, AxiosResponse } from "axios";
import { loadParams } from "@/lib/ssm";

/** ===================== Types ===================== **/

type Customer = {
  user_id: string; // 일부 응답에서 로그인ID 역할로도 올 수 있어 대비
  user_name?: string;
  member_id: string; // 로그인 아이디(= 주문 필터에 넣는 값)
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
  order_price_amount?: string; // 금액 합산에 사용
  // 필요한 필드가 있으면 여기에 확장
};

type OrdersListResponse = {
  orders: OrdersListOrder[];
};

/** ===================== Utilities ===================== **/

// 3개월 단위로 [start, end] 구간을 생성 (end는 inclusive로 23:59:59 붙여서 호출)
function chunkBy3Months(from: Date, to: Date): Array<{ s: Date; e: Date }> {
  const chunks: Array<{ s: Date; e: Date }> = [];
  let s = new Date(from);

  while (s <= to) {
    const e = new Date(s);
    e.setMonth(e.getMonth() + 3);
    if (e > to) e.setTime(to.getTime());
    chunks.push({ s: new Date(s), e: new Date(e) });
    // 다음 구간 시작: e 다음날 00:00:00
    s = new Date(e);
    s.setDate(s.getDate() + 1);
    s.setHours(0, 0, 0, 0);
  }
  return chunks;
}

// YYYY-MM-DD + 시간 접미사
const formatDate = (d: Date, end = false): string => d.toISOString().slice(0, 10) + (end ? " 23:59:59" : " 00:00:00");

// 숫자 안전 파싱
const toAmount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 주문 합계(금액) 페이지네이션 합산 (offset 기반)
async function sumOrdersAmount(params: {
  mallId: string;
  token: string;
  memberId: string;
  start: string;
  end: string;
  shopNo?: number;
  pageSize?: number;
  maxPages?: number; // 안전 상한
}): Promise<number> {
  const {
    mallId,
    token,
    memberId,
    start,
    end,
    shopNo = 1,
    pageSize = 100,
    maxPages = 50, // 최대 5,000건까지(100*50) 합산
  } = params;

  let offset = 0;
  let pages = 0;
  let total = 0;

  while (pages < maxPages) {
    const res: AxiosResponse<OrdersListResponse> = await axios.get(
      `https://${mallId}.cafe24api.com/api/v2/admin/orders`,
      {
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
        validateStatus: (s: number) => s === 200 || s === 404, // 404면 빈 결과로 취급
      },
    );

    const orders = res.data?.orders ?? [];
    if (orders.length === 0) break;

    total += orders.reduce((sum: number, o: OrdersListOrder) => sum + toAmount(o.order_price_amount), 0);

    if (orders.length < pageSize) break; // 마지막 페이지
    offset += pageSize;
    pages += 1;
  }
  return total;
}

type Strategy = { name: "cellphone" | "member_id"; params: Record<string, string | number> };

/** ===================== Handler ===================== **/

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Query
  const userId = url.searchParams.get("user_id");
  const periodParam = url.searchParams.get("period") || "3months"; // "3months" | "1year"
  const shopNoRaw = url.searchParams.get("shop_no") ?? "1";
  const shopNo = Number.isNaN(Number(shopNoRaw)) ? 1 : Number(shopNoRaw);

  if (!userId) {
    return NextResponse.json({ error: "user_id parameter is required" }, { status: 400 });
  }
  if (!["3months", "1year"].includes(periodParam)) {
    return NextResponse.json({ error: "Invalid period parameter", validValues: ["3months", "1year"] }, { status: 400 });
  }

  // 전처리
  let raw: string;
  try {
    raw = decodeURIComponent(userId).trim();
  } catch {
    return NextResponse.json({ error: "Invalid user_id encoding" }, { status: 400 });
  }

  console.log(`[DEBUG] Raw input: ${raw}`);

  const digits = raw.replace(/\D/g, "");
  const isPhone = /^0\d{9,10}$/.test(digits); // 010/011/016... 10~11자리 가정
  const isNumericOnly = /^\d+$/.test(raw);

  try {
    const { access_token } = (await loadParams(["access_token"])) as { access_token: string };
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID;
    if (!mallId) {
      return NextResponse.json({ error: "Missing NEXT_PUBLIC_CAFE24_MALL_ID" }, { status: 500 });
    }

    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${access_token}`,
      "X-Cafe24-Api-Version": "2025-06-01",
    };

    /** 1) Customers 조회: cellphone 또는 member_id만 허용 **/

    const strategies: Strategy[] = [];

    if (isPhone) {
      strategies.push({ name: "cellphone", params: { limit: 1, cellphone: digits } });
    } else {
      if (isNumericOnly) {
        // 숫자-only → 먼저 member_id로 1회 탐색 시도
        const trial: AxiosResponse<CustomersResponse> = await axios.get(
          `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
          {
            params: { limit: 1, member_id: raw },
            headers: authHeaders,
            timeout: 6000,
            validateStatus: () => true,
          },
        );

        if (trial.status === 200 && trial.data?.customers?.length > 0) {
          strategies.push({ name: "member_id", params: { limit: 1, member_id: raw } });
          console.log(`[DEBUG] 숫자-only지만 member_id로 매칭 가능: ${raw}`);
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
    }

    let customerRes: AxiosResponse<CustomersResponse> | undefined;
    let memberLoginId: string | undefined;
    let foundBy: Strategy["name"] | undefined;

    for (const st of strategies) {
      console.log(`[CUSTOMERS API] ${st.name}로 검색 시도`);
      try {
        const r: AxiosResponse<CustomersResponse> = await axios.get(
          `https://${mallId}.cafe24api.com/api/v2/admin/customers`,
          {
            params: st.params,
            headers: authHeaders,
            timeout: 8000,
          },
        );
        const list = r.data?.customers ?? [];
        if (list.length > 0) {
          customerRes = r;
          const c = list[0];
          const loginId = c.member_id || c.user_id;
          if (!loginId) {
            console.log(`[CUSTOMERS API] 경고: 로그인 아이디 필드가 없음 (member_id/user_id 불명)`);
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
        // 다른 전략 있으면 계속 진행
      }
    }

    if (!customerRes || !memberLoginId) {
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
    // 개인정보 과다 로그는 지양
    console.log(`[DEBUG] Customer located by ${foundBy}. member_id=${memberLoginId}`);

    /** 2) Orders 조회: 3개월 제한 준수 **/

    let totalOrders = 0;
    let totalPurchaseAmount = 0;

    const now = new Date();

    if (periodParam === "3months") {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);

      const startStr = formatDate(start, false);
      const endStr = formatDate(now, true);

      console.log(`[ORDERS API] 3개월 범위: ${startStr} ~ ${endStr}`);

      // Count
      const countRes: AxiosResponse<OrdersCountResponse> = await axios.get(
        `https://${mallId}.cafe24api.com/api/v2/admin/orders/count`,
        {
          params: {
            shop_no: shopNo,
            start_date: startStr,
            end_date: endStr,
            member_id: memberLoginId,
            order_status: "N40,N50",
          },
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: 8000,
        },
      );
      totalOrders = countRes.data?.count ?? 0;

      // Amount
      if (totalOrders > 0) {
        totalPurchaseAmount = await sumOrdersAmount({
          mallId,
          token: access_token,
          memberId: memberLoginId,
          start: startStr,
          end: endStr,
          shopNo,
          pageSize: 100,
        });
      }
    } else {
      // 1년
      const endAll = new Date(now);
      const startAll = new Date(now);
      startAll.setFullYear(endAll.getFullYear() - 1);

      console.log(`[ORDERS API] 1년 구간 분할: ${formatDate(startAll, false)} ~ ${formatDate(endAll, true)}`);

      const chunks = chunkBy3Months(startAll, endAll);
      console.log(`[ORDERS API] 총 ${chunks.length}개 구간`);

      for (const { s, e } of chunks) {
        const sStr = formatDate(s, false);
        const eStr = formatDate(e, true);

        // Count
        const countRes: AxiosResponse<OrdersCountResponse> = await axios.get(
          `https://${mallId}.cafe24api.com/api/v2/admin/orders/count`,
          {
            params: {
              shop_no: shopNo,
              start_date: sStr,
              end_date: eStr,
              member_id: memberLoginId,
              order_status: "N40,N50",
            },
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: 8000,
          },
        );

        const chunkCount = countRes.data?.count ?? 0;
        totalOrders += chunkCount;

        if (chunkCount > 0) {
          // Amount per chunk
          const chunkAmount = await sumOrdersAmount({
            mallId,
            token: access_token,
            memberId: memberLoginId,
            start: sStr,
            end: eStr,
            shopNo,
            pageSize: 200, // 1년 합산이므로 페이지 조금 키움
            maxPages: 100, // 상한 (200*100 = 20,000건)
          });
          totalPurchaseAmount += chunkAmount;
        }
      }
    }

    console.log(`[FINAL RESULT] totalOrders=${totalOrders}, totalPurchaseAmount=${totalPurchaseAmount}`);

    /** 3) 응답 **/
    const customerInfo = {
      userId: customer.user_id,
      userName: customer.user_name,
      memberGrade: customer.group?.group_name || "일반회원",
      joinDate: customer.created_date,
      totalPurchaseAmount,
      totalOrders,
      email: customer.email,
      phone: customer.phone,
      lastLoginDate: customer.last_login_date,
      memberId: memberLoginId, // 최종 사용한 로그인 아이디
      period: periodParam,
      shopNo,
    };

    return NextResponse.json(customerInfo);
  } catch (error: unknown) {
    // 상세 에러 매핑
    if (axios.isAxiosError(error)) {
      const ax = error as AxiosError<unknown>;
      const status = ax.response?.status;
      const data = ax.response?.data;

      console.error(`[ERROR] Status=${String(status)}`, data);

      if (status === 401) {
        return NextResponse.json({ error: "Unauthorized - token may be expired" }, { status: 401 });
      }
      if (status === 422) {
        return NextResponse.json({ error: "Invalid request parameters", details: data }, { status: 422 });
      }
      if (status === 404) {
        return NextResponse.json({ error: "Not found", details: data }, { status: 404 });
      }
      if (status === 429) {
        return NextResponse.json({ error: "Rate limited by Cafe24 API. Please retry later." }, { status: 429 });
      }
      if (status && status >= 500) {
        return NextResponse.json({ error: "Upstream server error from Cafe24", details: data }, { status: 502 });
      }
    } else {
      console.error(`[UNCAUGHT ERROR]`, error);
    }

    return NextResponse.json({ error: "Failed to fetch customer information" }, { status: 500 });
  }
}
