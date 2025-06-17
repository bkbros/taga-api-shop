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
    const client_secret = process.env.CAFE24_CLIENT_SECRET!;
    const redirect_uri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth/callback`;

    // Basic Auth 헤더 생성
    const basicAuth = Buffer.from(`${client_id}:${client_secret}`).toString("base64");

    // token endpoint 호출: client_id/client_secret은 헤더에만!
    const tokenRes = await axios.post(
      `https://${mallId}.cafe24api.com/api/v2/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
      },
    );

    // 토큰 저장 로직…
    // await saveParam("access_token", tokenRes.data.access_token);
    // await saveParam("refresh_token", tokenRes.data.refresh_token);

    return NextResponse.json(tokenRes.data);
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error("Cafe24 token error status:", err.response?.status);
      console.error("Cafe24 token error data:  ", err.response?.data);
    } else {
      console.error("Unknown error in OAuth callback:", err);
    }
    return NextResponse.json({ error: "토큰 교환 중 오류" }, { status: 500 });
  }
}
