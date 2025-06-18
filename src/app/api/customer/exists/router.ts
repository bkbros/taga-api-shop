// src/app/api/customers/exists/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id missing" }, { status: 400 });
  }

  try {
    // 1) SSM에서 토큰 꺼내기
    const { access_token } = await loadParams(["access_token"]);
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    // 2) Admin API: customers 검색 (user_id 조건)
    const res = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
      params: { user_id: userId, limit: 1 },
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const exists = Array.isArray(res.data.customers) && res.data.customers.length > 0;
    return NextResponse.json({ exists });
  } catch (err: unknown) {
    console.error("Customer exists check error:", err);
    return NextResponse.json({ exists: false }, { status: 200 });
  }
}
