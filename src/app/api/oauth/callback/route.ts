// src/app/api/oauth/callback/route.ts
import { NextResponse } from "next/server";
import axios from "axios";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "authorization code missing" }, { status: 400 });
  }

  try {
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const client_id = process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!;
    const client_secret = process.env.CAFE24_CLIENT_SECRET!; // <-- 여기를 다시 한번 확인
    const redirect_uri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth/callback`;

    const tokenRes = await axios.post(
      `https://${mallId}.cafe24api.com/api/v2/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id,
        client_secret,
        redirect_uri,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    // 토큰 저장 로직 생략...
    return NextResponse.json(tokenRes.data);
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error("Cafe24 token error status:", err.response?.status);
      console.error("Cafe24 token error data: ", err.response?.data);
    } else {
      console.error("Unknown error in OAuth callback:", err);
    }
    return NextResponse.json({ error: "토큰 교환 중 오류" }, { status: 500 });
  }
}
