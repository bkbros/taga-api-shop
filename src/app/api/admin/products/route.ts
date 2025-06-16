import { NextResponse } from "next/server";
import { cafe24Api } from "@/utils/cafe24";

export async function GET() {
  try {
    const res = await cafe24Api.get(`/api/v2/admin/products`, {
      baseURL: `https://${process.env.NEXT_PUBLIC_CAFE24_MALL_ID}.cafe24api.com`,
    });
    return NextResponse.json(res.data);
  } catch (err: any) {
    console.error(err.response?.data || err.message);
    return NextResponse.json({ error: "상품 조회 실패" }, { status: 500 });
  }
}
