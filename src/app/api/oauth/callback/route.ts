// src/app/api/oauth/callback/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { saveParam } from "@/lib/ssm";

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

    const basicAuth = Buffer.from(`${client_id}:${client_secret}`).toString("base64");

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

    // SSM 등에 저장
    await saveParam("access_token", tokenRes.data.access_token);
    await saveParam("refresh_token", tokenRes.data.refresh_token);

    // ✅ JSON이 아닌 Redirect 응답을 클라이언트로 보냅니다!
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/success`);
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error("Cafe24 token error status:", err.response?.status);
      console.error("Cafe24 token error data:  ", err.response?.data);
    } else {
      console.error("Unknown error in OAuth callback:", err);
    }
    // 실패해도 성공 페이지로 돌려보낼지, 에러 페이지로 보낼지 결정하세요
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/error`);
  }
}
