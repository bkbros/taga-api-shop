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
    // 사용할 env 변수, NEXT_PUBLIC_ 접두어가 붙은 값도 fallback으로 지원
    const mallId = process.env.CAFE24_MALL_ID ?? process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const clientId = process.env.CAFE24_CLIENT_ID ?? process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!;
    const clientSecret = process.env.CAFE24_CLIENT_SECRET!;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth/callback`;

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    console.log("[OAUTH] Requesting token from Cafe24...");
    const tokenRes = await axios.post(
      `https://${mallId}.cafe24api.com/api/v2/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
      },
    );

    console.log("[OAUTH] Token response received:", {
      status: tokenRes.status,
      dataKeys: Object.keys(tokenRes.data || {}),
    });

    const { access_token, refresh_token, expires_at } = tokenRes.data;

    console.log("[OAUTH] Token data received:", {
      hasAccessToken: !!access_token,
      hasRefreshToken: !!refresh_token,
      expiresAt: expires_at,
    });

    // Cafe24는 expires_at을 ISO 8601 문자열로 반환 (예: "2025-10-24T18:58:45.000")
    // Date 객체로 파싱하고 60초 버퍼 적용
    const EXPIRY_SKEW_SEC = 60;
    const expiresAtDate = new Date(expires_at);

    if (isNaN(expiresAtDate.getTime())) {
      console.error("[OAUTH] Invalid expires_at value:", expires_at);
      throw new Error("Invalid expires_at from Cafe24");
    }

    const expiresAtMs = expiresAtDate.getTime() - EXPIRY_SKEW_SEC * 1000;

    console.log("[OAUTH] Saving tokens to SSM...");
    // SSM에 저장
    await Promise.all([
      saveParam("access_token", access_token),
      saveParam("refresh_token", refresh_token),
      saveParam("access_token_expires_at", String(expiresAtMs)),
    ]);
    console.log("[OAUTH] ✓ Tokens saved successfully");
    console.log("[OAUTH] ✓ Expires at:", new Date(expiresAtMs).toISOString());

    // HTTP-only 쿠키 설정
    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/success`);
    // access_token 쿠키: 전체 경로
    // maxAge는 초 단위이므로 (만료시간 - 현재시간) / 1000
    const maxAgeSec = Math.max(0, Math.floor((expiresAtDate.getTime() - Date.now()) / 1000));
    response.cookies.set("access_token", access_token, {
      httpOnly: true,
      secure: true,
      path: "/",
      maxAge: maxAgeSec,
    });
    // refresh_token 쿠키: 리프레시 엔드포인트에만 전송
    response.cookies.set("refresh_token", refresh_token, {
      httpOnly: true,
      secure: true,
      path: "/api/oauth/refresh",
      maxAge: 14 * 24 * 3600,
    });
    return response;
  } catch (e) {
    console.error("OAuth callback error:", e);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/error`);
  }
}
