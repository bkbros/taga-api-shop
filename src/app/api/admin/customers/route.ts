// src/app/api/admin/customers/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

export async function GET(request: Request) {
  // 1) SSM에서 토큰 꺼내오기
  const { access_token } = await loadParams(["access_token"]);

  // 2) 쿼리에서 member_id 받아오기
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("member_id");
  if (!memberId) {
    return NextResponse.json({ error: "member_id가 필요합니다" }, { status: 400 });
  }

  const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

  try {
    // 3) params 객체로 정확히 전달
    const res = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
      params: {
        search_type: "member_id",
        keyword: memberId,
        limit: 1,
        shop_no: 1,
      },
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    // 4) 결과 리턴
    const exists = (res.data.customers?.length ?? 0) > 0;
    return NextResponse.json({ exists });
  } catch (err: any) {
    console.error("Customer lookup error:", err.response?.data || err.message);
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
