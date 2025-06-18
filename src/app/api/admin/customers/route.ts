// src/app/api/admin/customers/route.ts
import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import { loadParams } from "@/lib/ssm";

export async function GET(request: Request) {
  try {
    // 1) SSM에서 토큰 불러오기
    const { access_token } = await loadParams(["access_token"]);

    // 2) 쿼리 파라미터에서 member_id 받아오기
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("member_id");
    if (!memberId) {
      return NextResponse.json({ error: "member_id 파라미터가 필요합니다" }, { status: 400 });
    }

    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const apiVer = process.env.CAFE24_API_VERSION!;

    // 3) Admin API 호출
    const response = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/customers`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "X-Cafe24-Api-Version": apiVer,
      },
    });

    const exists = Array.isArray(response.data.customers) && response.data.customers.length > 0;
    return NextResponse.json({ exists });
  } catch (error) {
    // AxiosError 타입으로 좁혀서 처리
    if (error instanceof AxiosError) {
      console.error("Customer lookup AxiosError:", error.response?.data || error.message);
    } else if (error instanceof Error) {
      console.error("Customer lookup Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    return NextResponse.json({ error: "회원 조회 중 오류가 발생했습니다" }, { status: 500 });
  }
}
