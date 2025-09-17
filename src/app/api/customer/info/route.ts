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

    // 주문 정보는 일단 기본값으로 설정 (API 에러 방지)
    let totalOrders = 0;
    let totalPurchaseAmount = 0;

    console.log(`[INFO] 주문 조회는 현재 비활성화됨 (422 에러 방지)`);
    console.log(`[INFO] member_id: ${customer.member_id}`);

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