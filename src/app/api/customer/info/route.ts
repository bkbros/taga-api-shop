import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

// 3개월 단위 분할 함수 (1년치 등 장기간 조회 시 사용)
function chunkBy3Months(from: Date, to: Date): Array<{s: Date; e: Date}> {
  const chunks = [];
  let s = new Date(from);

  while (s < to) {
    const e = new Date(s);
    e.setMonth(e.getMonth() + 3);
    if (e > to) e.setTime(to.getTime());
    chunks.push({ s: new Date(s), e: new Date(e) });
    s = new Date(e);
    s.setDate(s.getDate() + 1); // 다음 날부터
  }
  return chunks;
}

// 날짜 포맷 함수
const formatDate = (d: Date, end = false): string =>
  d.toISOString().slice(0, 10) + (end ? " 23:59:59" : " 00:00:00");


type Customer = {
  user_id: string;
  user_name?: string;
  member_id: string;
  member_no?: string | number;
  created_date?: string;
  email?: string;
  phone?: string;
  last_login_date?: string;
  group?: {
    group_name?: string;
  };
};


export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  const periodParam = url.searchParams.get("period") || "3months"; // 기본값: 3개월

  if (!userId) {
    return NextResponse.json({ error: "user_id parameter is required" }, { status: 400 });
  }

  // 기간 검증
  const validPeriods = ["3months", "1year"];
  if (!validPeriods.includes(periodParam)) {
    return NextResponse.json({
      error: "Invalid period parameter",
      validValues: validPeriods,
      hint: "period=3months (기본값) 또는 period=1year"
    }, { status: 400 });
  }

  // 전처리
  const raw = decodeURIComponent(userId).trim();
  console.log(`[DEBUG] Raw input: ${raw}`);

  const digits = raw.replace(/\D/g, "");
  const isPhone = /^0\d{9,10}$/.test(digits);

  // 다중 검색 전략 구현
  const searchStrategies = [];

  if (isPhone) {
    // 휴대폰 번호 검색 (phone 파라미터 사용)
    searchStrategies.push({
      name: 'phone',
      params: { limit: 1, phone: digits },
      description: `휴대폰 번호: ${digits}`
    });
  } else {
    if (/^\d+$/.test(raw)) {
      // 숫자-only인데 휴대폰이 아님 => 지원 불가 식별자
      console.log(`[ERROR] 지원하지 않는 식별자: ${raw} (숫자-only but not phone)`);
      return NextResponse.json({
        error: "Unsupported identifier",
        hint: "member_id(로그인 아이디)나 휴대폰 번호(010...)를 전달하세요.",
        received: raw,
        examples: ["@k123456", "user@domain.com", "01012345678"]
      }, { status: 400 });
    }

    // 로그인 ID 검색
    searchStrategies.push({
      name: 'member_id',
      params: { limit: 1, member_id: raw },
      description: `로그인 ID: ${raw}`
    });
  }

  try {
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    // 1. 다중 검색 전략으로 고객 찾기
    let customerRes;
    let memberLoginId; // member_id는 로그인 ID (문자열)
    let successfulStrategy;

    for (const strategy of searchStrategies) {
      console.log(`[CUSTOMERS API] ${strategy.name}로 검색 시도: ${strategy.description}`);

      try {
        customerRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
          params: strategy.params,
          headers: {
            Authorization: `Bearer ${access_token}`,
            'X-Cafe24-Api-Version': '2025-06-01'
          },
        });

        if (customerRes.data.customers && customerRes.data.customers.length > 0) {
          const customer = customerRes.data.customers[0];
          memberLoginId = customer.member_id || customer.user_id;

          if (!memberLoginId) {
            console.log(`[CUSTOMERS API] 경고: member_id/user_id가 비어있음`);
            continue; // 다음 전략 시도
          }

          console.log(`[CUSTOMERS API] 성공: ${strategy.name}로 고객 발견, member_id: ${memberLoginId}`);
          console.log(`[CUSTOMERS API] 고객 정보:`, JSON.stringify(customer, null, 2));
          successfulStrategy = strategy.name;
          break; // 성공하면 루프 종료
        } else {
          console.log(`[CUSTOMERS API] ${strategy.name} 검색 결과 없음`);
        }
      } catch (customerError) {
        console.log(`[CUSTOMERS API] ${strategy.name} 검색 실패:`, customerError instanceof Error ? customerError.message : String(customerError));

        // 422 에러 상세 로그
        if (customerError instanceof Error && 'response' in customerError) {
          const axiosError = customerError as { response?: { status?: number; data?: unknown } };
          if (axiosError.response?.status === 422) {
            console.error(`[CUSTOMERS API 422] ${strategy.name} 상세 원인:`, axiosError.response?.data);
          }
        }
        // 계속해서 다음 전략 시도
      }
    }

    // 모든 전략이 실패한 경우
    if (!customerRes || !customerRes.data.customers || customerRes.data.customers.length === 0) {
      console.log(`[CUSTOMERS API] 모든 검색 전략 실패 - 404 반환`);
      return NextResponse.json({
        error: "Customer not found",
        triedStrategies: searchStrategies.map(s => s.name),
        hint: isPhone
          ? '휴대폰 번호가 맞는지 확인하세요 (010xxxxxxxx 형식)'
          : '로그인 ID가 맞는지 확인하세요 (@k123, user@domain, 일반ID 등)'
      }, { status: 404 });
    }

    const customer = customerRes.data.customers[0] as Customer;

    console.log(`[DEBUG] Customer data:`, {
      member_id: customer.member_id,
      user_id: customer.user_id,
      memberLoginId: memberLoginId,
      foundBy: successfulStrategy
    });

    // 2. 주문 정보 조회 (기간별 처리, Cafe24 API 3개월 제한 준수)
    let totalOrders = 0;
    let totalPurchaseAmount = 0;

    try {
      console.log(`[ORDERS API] member_id로 주문 조회: ${memberLoginId} (기간: ${periodParam})`);

      if (periodParam === "3months") {
        // 최근 3개월 (단일 호출)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(endDate.getMonth() - 3);

        const startDateStr = formatDate(startDate, false);
        const endDateStr = formatDate(endDate, true);

        console.log(`[ORDERS API] 검색 기간: ${startDateStr} ~ ${endDateStr}`);

        // Orders Count API
        const countRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
          params: {
            shop_no: 1,
            start_date: startDateStr,
            end_date: endDateStr,
            member_id: memberLoginId,
            order_status: "N40,N50"
          },
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: 5000
        });

        totalOrders = countRes.data.count || 0;
        console.log(`[ORDERS API] 주문 건수: ${totalOrders}건`);

        // 구매 금액 조회
        if (totalOrders > 0) {
          const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
            params: {
              shop_no: 1,
              start_date: startDateStr,
              end_date: endDateStr,
              member_id: memberLoginId,
              order_status: "N40,N50",
              limit: 100
            },
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: 5000
          });

          if (ordersRes.data.orders) {
            totalPurchaseAmount = ordersRes.data.orders.reduce((sum: number, order: { order_price_amount?: string }) => {
              return sum + parseFloat(order.order_price_amount || "0");
            }, 0);
            console.log(`[ORDERS API] 구매 금액: ${totalPurchaseAmount}원`);
          }
        }

      } else if (periodParam === "1year") {
        // 1년치 (3개월씩 분할 호출)
        const endAll = new Date();
        const startAll = new Date();
        startAll.setFullYear(endAll.getFullYear() - 1);

        console.log(`[ORDERS API] 1년 분할 검색: ${formatDate(startAll, false)} ~ ${formatDate(endAll, true)}`);

        const chunks = chunkBy3Months(startAll, endAll);
        console.log(`[ORDERS API] 총 ${chunks.length}개 구간으로 분할`);

        for (const {s, e} of chunks) {
          const chunkStart = formatDate(s, false);
          const chunkEnd = formatDate(e, true);

          console.log(`[ORDERS API] 구간 처리: ${chunkStart} ~ ${chunkEnd}`);

          // Count
          const countRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
            params: {
              shop_no: 1,
              start_date: chunkStart,
              end_date: chunkEnd,
              member_id: memberLoginId,
              order_status: "N40,N50"
            },
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: 5000
          });

          const chunkCount = countRes.data.count || 0;
          totalOrders += chunkCount;
          console.log(`[ORDERS API] 구간 주문 건수: ${chunkCount}건 (누적: ${totalOrders}건)`);

          // Amount
          if (chunkCount > 0) {
            const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
              params: {
                shop_no: 1,
                start_date: chunkStart,
                end_date: chunkEnd,
                member_id: memberLoginId,
                order_status: "N40,N50",
                limit: 1000
              },
              headers: { Authorization: `Bearer ${access_token}` },
              timeout: 5000
            });

            if (ordersRes.data.orders) {
              const chunkAmount = ordersRes.data.orders.reduce(
                (sum: number, order: { order_price_amount?: string }) =>
                  sum + parseFloat(order.order_price_amount || "0"),
                0
              );
              totalPurchaseAmount += chunkAmount;
              console.log(`[ORDERS API] 구간 구매 금액: ${chunkAmount}원 (누적: ${totalPurchaseAmount}원)`);
            }
          }
        }
      }

    } catch (ordersError) {
      console.log(`[ORDERS API] 실패: ${ordersError instanceof Error ? ordersError.message : String(ordersError)}`);

      // 422 에러 상세 로그
      if (ordersError instanceof Error && 'response' in ordersError) {
        const axiosError = ordersError as { response?: { status?: number; data?: unknown } };
        if (axiosError.response?.status === 422) {
          console.error(`[ORDERS API 422] 상세 원인:`, axiosError.response?.data);
        }
      }

      totalOrders = 0;
      totalPurchaseAmount = 0;
    }

    console.log(`[FINAL RESULT] totalOrders: ${totalOrders}, totalPurchaseAmount: ${totalPurchaseAmount}`);

    // Format response data
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
    };

    return NextResponse.json(customerInfo);

  } catch (error: unknown) {
    console.error(`[최상위 에러] 고객 정보 조회 실패 요약:`, error instanceof Error ? error.message : String(error));

    // 422 에러 상세 정보 출력
    if (error instanceof Error && 'response' in error) {
      const axiosError = error as { response?: { status?: number; data?: unknown }; config?: { url?: string; params?: unknown; headers?: unknown } };
      console.error(`[ERROR] Status: ${axiosError.response?.status}`);
      console.error(`[ERROR] Data:`, axiosError.response?.data);
      console.error(`[ERROR] Config:`, {
        url: axiosError.config?.url,
        params: axiosError.config?.params,
        headers: axiosError.config?.headers
      });

      if (axiosError.response?.status === 422) {
        console.error(`[422 ERROR] 상세 원인:`, axiosError.response?.data);
        return NextResponse.json({
          error: "Invalid request parameters",
          details: axiosError.response?.data,
          requestedUserId: userId,
          decodedUserId: raw,
          triedStrategies: searchStrategies.map(s => s.name),
          searchType: isPhone ? 'phone' : 'member_id'
        }, { status: 422 });
      }

      if (axiosError.response?.status === 401) {
        return NextResponse.json({ error: "Unauthorized - token may be expired" }, { status: 401 });
      }
    }

    return NextResponse.json(
      { error: "Failed to fetch customer information", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}