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

  // URL 디코딩 처리 (최상위 스코프로 이동)
  const decodedUserId = decodeURIComponent(userId);
  console.log(`[DEBUG] Decoded user_id: ${decodedUserId}`);

  // 입력값 형태에 따라 검색 방법 결정 (2025-06-01 API 스펙 기준)
  const isPhonePattern = /^01[0-9]{8,9}$/.test(decodedUserId); // 휴대폰 패턴만 cellphone으로

  // 파라미터 매핑: 휴대폰이면 cellphone, 그 외는 모두 member_id
  const params: Record<string, string | number> = { limit: 1 };
  if (isPhonePattern) {
    params.cellphone = decodedUserId; // 휴대폰 전체번호
  } else {
    params.member_id = decodedUserId; // 로그인 ID (@k, @n, 일반, 숫자ID 모두 포함)
  }

  try {
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    // 1. Customers API로 단일 검색 (2025-06-01 스펙 준수)
    console.log(`[CUSTOMERS API] ${isPhonePattern ? 'cellphone' : 'member_id'}로 검색: ${decodedUserId} (${isPhonePattern ? '휴대폰' : '로그인 ID'})`);

    let customerRes;
    let memberLoginId; // member_id는 로그인 ID (문자열)

    try {
      customerRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
        params,
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
          return NextResponse.json({
            error: "Customer found but missing login ID",
            customerData: customer
          }, { status: 404 });
        }

        console.log(`[CUSTOMERS API] 성공: member_id(로그인ID) 획득: ${memberLoginId}`);
        console.log(`[CUSTOMERS API] 고객 정보:`, JSON.stringify(customer, null, 2));
      } else {
        console.log(`[CUSTOMERS API] 고객을 찾을 수 없음 - 404 반환`);
        return NextResponse.json({
          error: "Customer not found",
          tried: params,
          hint: isPhonePattern
            ? '휴대폰 번호가 맞는지 확인하세요 (01012345678 형식)'
            : '로그인 ID가 맞는지 확인하세요 (@k123, user@domain, 일반ID 등)'
        }, { status: 404 });
      }
    } catch (customerError) {
      console.log(`[CUSTOMERS API] 실패:`, customerError instanceof Error ? customerError.message : String(customerError));

      // 422 에러 상세 로그
      if (customerError instanceof Error && 'response' in customerError) {
        const axiosError = customerError as { response?: { status?: number; data?: unknown } };
        if (axiosError.response?.status === 422) {
          console.error(`[CUSTOMERS API 422] 상세 원인:`, axiosError.response?.data);
        }
      }

      throw customerError;
    }

    // customer 객체 안전성 검증
    if (!customerRes || !customerRes.data.customers || customerRes.data.customers.length === 0) {
      console.log(`[ERROR] customerRes가 비어있음 - 예상치 못한 상황`);
      return NextResponse.json({
        error: "Customer data is unexpectedly empty",
        customerRes: customerRes ? "exists" : "undefined"
      }, { status: 500 });
    }

    const customer = customerRes.data.customers[0] as Customer;

    console.log(`[DEBUG] Customer data:`, {
      member_id: customer.member_id,
      user_id: customer.user_id,
      memberLoginId: memberLoginId
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
          decodedUserId: decodedUserId,
          searchParam: isPhonePattern ? 'cellphone' : 'member_id'
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