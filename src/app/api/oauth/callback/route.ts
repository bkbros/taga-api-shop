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
    // 여기서 반드시 prefix 없는 키로 읽습니다!
    const client_secret = process.env.CAFE24_CLIENT_SECRET!;
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

    // 받은 토큰 저장 (DB, SSM 등)
    // await saveTokens(tokenRes.data);

    return NextResponse.json(tokenRes.data);
  } catch (e: unknown) {
    console.error("OAuth callback error:", e);
    return NextResponse.json({ error: "토큰 교환 중 오류" }, { status: 500 });
  }
}
