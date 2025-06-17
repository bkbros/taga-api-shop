import { NextResponse } from "next/server";
import { cafe24Api } from "@/utils/cafe24";
import type { AxiosError } from "axios";

export async function GET() {
  try {
    const res = await cafe24Api.get(`/api/v2/admin/products`, {
      baseURL: `https://${process.env.NEXT_PUBLIC_CAFE24_MALL_ID}.cafe24api.com`,
    });
    return NextResponse.json(res.data);
  } catch (err: unknown) {
    // AxiosError인지 검사
    if ((err as AxiosError).isAxiosError) {
      const axiosErr = err as AxiosError;
      console.error(axiosErr.response?.data ?? axiosErr.message);
    } else if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    return NextResponse.json({ error: "상품 조회 실패" }, { status: 500 });
  }
}
