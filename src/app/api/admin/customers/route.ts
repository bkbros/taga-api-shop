// src/app/api/admin/customers/route.ts
import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import { loadParams } from "@/lib/ssm";

export async function GET(request: Request) {
  console.log("▶ Incoming URL:", request.url);
  try {
    // 토큰
    const { access_token } = await loadParams(["access_token"]);
    console.log("▶ access_token:", access_token?.slice(0, 10), "…");

    // 파라미터

    const memberId = "sda0125";

    if (!memberId) {
      return NextResponse.json({ error: "member_id 파라미터가 필요합니다" }, { status: 400 });
    }

    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

    console.log("▶ mallId, apiVer:", mallId);

    // 호출
    const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
      params: { cellphone: memberId },
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
    console.log("▶ API response:", resp.status, resp.data);

    const exists =
      Boolean(resp.data.customer?.member_id) || (Array.isArray(resp.data.customers) && resp.data.customers.length > 0);
    console.log("▶ exists:", exists);
    return NextResponse.json({ exists });
  } catch (e: unknown) {
    if (e instanceof AxiosError) {
      console.error("▶ AxiosError:", e.response?.data || e.message);
    } else if (e instanceof Error) {
      console.error("▶ Error:", e.message);
    } else {
      console.error("▶ Unknown error:", e);
    }
    return NextResponse.json({ error: "회원 조회 중 오류가 발생했습니다" }, { status: 500 });
  }
}
