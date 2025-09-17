import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

type Order = {
  order_status?: string;
  order_price_amount?: string;
};

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

  try {
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    // 1. Get customer basic info including grade and join date
    const customerRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
      params: {
        user_id: userId,
        limit: 1,
        embed: "group" // Include customer group info for grade
      },
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!customerRes.data.customers || customerRes.data.customers.length === 0) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const customer = customerRes.data.customers[0] as Customer;

    // 2. Get customer's order statistics for total purchase amount
    console.log(`[DEBUG] Customer data:`, {
      member_id: customer.member_id,
      user_id: customer.user_id,
      mallId: mallId
    });

    // Orders Count API 사용 (훨씬 효율적!)
    let totalOrders = 0;
    let totalPurchaseAmount = 0;

    // 방법 1: Orders Count API 사용
    try {
      console.log(`[COUNT API] 주문 건수 조회 시작: member_id=${customer.member_id}`);

      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Count API로 완료된 주문 건수 조회
      const countRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders/count`, {
        params: {
          shop_no: 1,
          start_date: startDate,
          end_date: endDate,
          member_id: customer.member_id,
          order_status: "N40,N50" // 배송완료, 구매확정
        },
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 5000
      });

      totalOrders = countRes.data.count || 0;
      console.log(`[COUNT API] 성공: ${totalOrders}건`);

      // 금액은 별도로 조회 (소량의 데이터만)
      if (totalOrders > 0) {
        try {
          const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
            params: {
              shop_no: 1,
              start_date: startDate,
              end_date: endDate,
              member_id: customer.member_id,
              order_status: "N40,N50",
              limit: 50 // 최근 50건만
            },
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: 5000
          });

          if (ordersRes.data.orders) {
            totalPurchaseAmount = ordersRes.data.orders.reduce((sum: number, order: any) => {
              return sum + parseFloat(order.order_price_amount || "0");
            }, 0);
            console.log(`[COUNT API] 금액 계산 완료: ${totalPurchaseAmount}원`);
          }
        } catch (amountError) {
          console.log(`[COUNT API] 금액 조회 실패, 건수만 사용: ${amountError instanceof Error ? amountError.message : String(amountError)}`);
          totalPurchaseAmount = 0;
        }
      }

    } catch (countError) {
      console.log(`[COUNT API] 실패, 폴백 방법 시도: ${countError instanceof Error ? countError.message : String(countError)}`);

      // 폴백: 기존 방법
      try {
        console.log(`[FALLBACK] 기존 orders API 시도`);
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
          params: {
            shop_no: 1,
            start_date: startDate,
            end_date: endDate,
            member_id: customer.member_id,
            limit: 100
          },
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: 8000
        });

        if (ordersRes.data.orders) {
          const completedOrders = ordersRes.data.orders.filter((order: any) =>
            order.order_status === "N40" || order.order_status === "N50"
          );
          totalOrders = completedOrders.length;
          totalPurchaseAmount = completedOrders.reduce((sum: number, order: any) => {
            return sum + parseFloat(order.order_price_amount || "0");
          }, 0);
          console.log(`[FALLBACK] 성공: ${totalOrders}건, ${totalPurchaseAmount}원`);
        }
      } catch (fallbackError) {
        console.log(`[FALLBACK] 실패: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        totalOrders = 0;
        totalPurchaseAmount = 0;
      }
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

    if (error instanceof Error && 'response' in error && (error as { response?: { status?: number } }).response?.status === 401) {
      return NextResponse.json({ error: "Unauthorized - token may be expired" }, { status: 401 });
    }

    return NextResponse.json(
      { error: "Failed to fetch customer information", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}