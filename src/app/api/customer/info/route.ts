import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

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

    const customer = customerRes.data.customers[0];

    // 2. Get customer's order statistics for total purchase amount
    const ordersRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
      params: {
        member_id: customer.member_id,
        limit: 1000, // Get all orders to calculate total
        embed: "items"
      },
      headers: { Authorization: `Bearer ${access_token}` },
    });

    // Calculate total purchase amount from completed orders
    let totalPurchaseAmount = 0;
    let totalOrders = 0;

    if (ordersRes.data.orders) {
      const completedOrders = ordersRes.data.orders.filter((order: any) =>
        order.order_status === "N40" || order.order_status === "N50" // Delivered or Purchase confirmed
      );

      totalOrders = completedOrders.length;
      totalPurchaseAmount = completedOrders.reduce((sum: number, order: any) => {
        return sum + parseFloat(order.order_price_amount || 0);
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

  } catch (error: any) {
    console.error("Customer info fetch error:", error);

    if (error.response?.status === 401) {
      return NextResponse.json({ error: "Unauthorized - token may be expired" }, { status: 401 });
    }

    return NextResponse.json(
      { error: "Failed to fetch customer information", details: error.message },
      { status: 500 }
    );
  }
}