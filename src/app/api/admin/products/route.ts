// src/app/api/admin/products/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { getAccessToken } from "@/lib/cafe24Auth";

export async function GET() {
  try {
    // 1) 토큰 가져오기 (자동 갱신 포함)
    const access_token = await getAccessToken();

    // 2) API 호출
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const res = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/products`, {
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
