import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";


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

  if (!userId) {
    return NextResponse.json({ error: "user_id parameter is required" }, { status: 400 });
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

    // 2. 주문 정보 조회 (member_id로 조회)
    let totalOrders = 0;
    let totalPurchaseAmount = 0;

    try {
      console.log(`[ORDERS API] member_id로 주문 조회: ${memberLoginId}`);

      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Orders Count API
      const countRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
        params: {
          shop_no: 1,
          start_date: startDate,
          end_date: endDate,
          member_id: memberLoginId,
          order_status: "N40,N50"
        },
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 5000
      });

      totalOrders = countRes.data.count || 0;
      console.log(`[ORDERS API] 주문 건수: ${totalOrders}건`);

      // 구매 금액 조회 (필요시 페이지네이션)
      if (totalOrders > 0) {
        const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
          params: {
            shop_no: 1,
            start_date: startDate,
            end_date: endDate,
            member_id: memberLoginId,
            order_status: "N40,N50",
            limit: 50
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

    } catch (ordersError) {
      console.log(`[ORDERS API] 실패: ${ordersError instanceof Error ? ordersError.message : String(ordersError)}`);
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