import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";


type Customer = {
  user_id: string;
  user_name?: string;
  member_id: string;
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

  // 입력값 형태에 따라 검색 방법 결정 (최상위 스코프로 이동)
  const isNumericId = /^\d+$/.test(decodedUserId);
  const searchParam = isNumericId ? 'member_id' : 'user_id';

  try {
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    // 1. Customers API로 user_id 검색하여 정확한 member_id 획득
    console.log(`[DEBUG] Searching customer with user_id: ${userId}`);

    let customerRes;
    let numericMemberId;

    console.log(`[CUSTOMERS API] ${searchParam}로 검색: ${decodedUserId} (${isNumericId ? '숫자 PK' : '로그인 ID'})`);

    try {
      customerRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
        params: {
          [searchParam]: decodedUserId, // 숫자면 member_id, 문자열이면 user_id
          limit: 1
        },
        headers: {
          Authorization: `Bearer ${access_token}`,
          'X-Cafe24-Api-Version': '2025-06-01' // API 버전 헤더 추가
        },
      });

      if (customerRes.data.customers && customerRes.data.customers.length > 0) {
        const customer = customerRes.data.customers[0];
        numericMemberId = customer.member_id;
        console.log(`[CUSTOMERS API] 성공: 숫자형 member_id 획득: ${numericMemberId}`);
        console.log(`[CUSTOMERS API] 고객 정보:`, JSON.stringify(customer, null, 2));
      } else {
        console.log(`[CUSTOMERS API] 고객을 찾을 수 없음`);
        throw new Error('Customer not found');
      }
    } catch (customerError) {
      console.log(`[CUSTOMERS API] 실패:`, customerError instanceof Error ? customerError.message : String(customerError));
      throw customerError;
    }

    // customer 객체는 이미 위에서 획득했으므로 바로 사용
    const customer = customerRes.data.customers[0] as Customer;

    console.log(`[DEBUG] Customer data:`, {
      member_id: customer.member_id,
      user_id: customer.user_id,
      numericMemberId: numericMemberId
    });

    // 3. 획득한 숫자형 member_id로 주문 정보 조회
    let totalOrders = 0;
    let totalPurchaseAmount = 0;

    try {
      console.log(`[ORDERS API] 숫자형 member_id로 주문 조회: ${numericMemberId}`);

      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Orders Count API로 완료된 주문 건수 조회
      const countRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
        params: {
          shop_no: 1,
          start_date: startDate,
          end_date: endDate,
          member_id: numericMemberId, // 숫자형 member_id 사용
          order_status: "N40,N50" // 배송완료, 구매확정
        },
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 5000
      });

      totalOrders = countRes.data.count || 0;
      console.log(`[ORDERS API] 성공: ${totalOrders}건`);

      // 금액은 별도로 조회 (소량의 데이터만)
      if (totalOrders > 0) {
        try {
          const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
            params: {
              shop_no: 1,
              start_date: startDate,
              end_date: endDate,
              member_id: numericMemberId, // 숫자형 member_id 사용
              order_status: "N40,N50",
              limit: 50 // 최근 50건만
            },
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: 5000
          });

          if (ordersRes.data.orders) {
            totalPurchaseAmount = ordersRes.data.orders.reduce((sum: number, order: { order_price_amount?: string }) => {
              return sum + parseFloat(order.order_price_amount || "0");
            }, 0);
            console.log(`[ORDERS API] 금액 계산 완료: ${totalPurchaseAmount}원`);
          }
        } catch (amountError) {
          console.log(`[ORDERS API] 금액 조회 실패, 건수만 사용: ${amountError instanceof Error ? amountError.message : String(amountError)}`);
          totalPurchaseAmount = 0;
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
    console.error("Customer info fetch error:", error);

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
          searchParam: isNumericId ? 'member_id' : 'user_id'
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