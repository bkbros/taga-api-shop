// src/app/api/admin/customers/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm"; // SSM에서 꺼내올 유틸

export async function GET() {
  try {
    // 1) SSM에서 토큰 불러오기
    const { access_token } = await loadParams(["access_token"]);

    // 2) API 호출
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const res = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
      params: {
        search_type: "member_id", // ‘member_id’로 검색하겠다
        keyword: "sda0125", // 실제 회원 아이디
        limit: 1, // 최대 1건
        shop_no: 1, // 샵 번호 (보통 1)
      },
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    return NextResponse.json(res.data);
  } catch (err: unknown) {
    console.error("Admin products API error:", err);
    return NextResponse.json({ error: "상품 조회 실패" }, { status: 500 });
  }
}
