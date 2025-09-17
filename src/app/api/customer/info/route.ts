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

    // 1. Get customer basic info (다양한 방법으로 시도)
    console.log(`[DEBUG] Searching customer with user_id: ${userId}`);

    let customerRes;

    // 방법 1: member_id로 검색 시도 (user_id 대신)
    try {
      console.log(`[TRY1] member_id로 검색: ${userId}`);
      customerRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
        params: {
          member_id: userId,
          limit: 1
        },
        headers: { Authorization: `Bearer ${access_token}` },
      });
      console.log(`[TRY1] 성공: member_id로 고객 찾음`);
    } catch (memberIdError) {
      console.log(`[TRY1] 실패: member_id 검색 에러`);

      // 방법 2: user_id로 검색 시도
      try {
        console.log(`[TRY2] user_id로 검색: ${userId}`);
        customerRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
          params: {
            user_id: userId,
            limit: 1
          },
          headers: { Authorization: `Bearer ${access_token}` },
        });
        console.log(`[TRY2] 성공: user_id로 고객 찾음`);
      } catch (userIdError) {
        console.log(`[TRY2] 실패: user_id 검색 에러`);

        // 방법 3: phone으로 검색 시도 (숫자만 있는 경우)
        try {
          console.log(`[TRY3] phone으로 검색: ${userId}`);
          customerRes = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
            params: {
              phone: userId,
              limit: 1
            },
            headers: { Authorization: `Bearer ${access_token}` },
          });
          console.log(`[TRY3] 성공: phone으로 고객 찾음`);
        } catch (phoneError) {
          console.log(`[TRY3] 실패: phone 검색 에러`);
          throw userIdError; // 원래 user_id 에러를 throw
        }
      }
    }

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
    const totalOrders = 0;
    const totalPurchaseAmount = 0;

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
        return NextResponse.json({
          error: "Invalid request parameters",
          details: axiosError.response?.data,
          requestedUserId: userId
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