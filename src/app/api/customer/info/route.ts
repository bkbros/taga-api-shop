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
    // API 문서 기준 필수 파라미터 추가
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
      params: {
        member_id: customer.member_id,
        start_date: startDate,  // 필수 파라미터
        end_date: endDate,      // 필수 파라미터
        shop_no: 1,            // 필수 파라미터
        limit: 1000,
        offset: 0,
        embed: "items"
      },
      headers: { Authorization: `Bearer ${access_token}` },
    });

    // Calculate total purchase amount from completed orders
    let totalPurchaseAmount = 0;
    let totalOrders = 0;

    if (ordersRes.data.orders) {
      const completedOrders = (ordersRes.data.orders as Order[]).filter((order: Order) =>
        order.order_status === "N40" || order.order_status === "N50" // Delivered or Purchase confirmed
      );

      totalOrders = completedOrders.length;
      totalPurchaseAmount = completedOrders.reduce((sum: number, order: Order) => {
        return sum + parseFloat(order.order_price_amount || "0");
      }, 0);
    }

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