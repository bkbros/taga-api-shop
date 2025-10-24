// // src/app/api/oauth/callback/route.ts
// import { NextResponse } from "next/server";
// import axios from "axios";
// import { saveParam } from "@/lib/ssm";

// export async function GET(req: Request) {
//   const { searchParams } = new URL(req.url);
//   const code = searchParams.get("code");
//   if (!code) {
//     return NextResponse.json({ error: "authorization code missing" }, { status: 400 });
//   }

//   try {
//     const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
//     const client_id = process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!;
//     const client_secret = process.env.CAFE24_CLIENT_SECRET!;
//     const redirect_uri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth/callback`;

//     const basicAuth = Buffer.from(`${client_id}:${client_secret}`).toString("base64");

//     const tokenRes = await axios.post(
//       `https://${mallId}.cafe24api.com/api/v2/oauth/token`,
//       new URLSearchParams({
//         grant_type: "authorization_code",
//         code,
//         redirect_uri,
//       }).toString(),
//       {
//         headers: {
//           "Content-Type": "application/x-www-form-urlencoded",
//           Authorization: `Basic ${basicAuth}`,
//         },
//       },
//     );

//     // SSM 등에 저장
//     await saveParam("access_token", tokenRes.data.access_token);
//     await saveParam("refresh_token", tokenRes.data.refresh_token);

//     // ✅ JSON이 아닌 Redirect 응답을 클라이언트로 보냅니다!
//     return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/success`);
//   } catch (err: unknown) {
//     if (axios.isAxiosError(err)) {
//       console.error("Cafe24 token error status:", err.response?.status);
//       console.error("Cafe24 token error data:  ", err.response?.data);
//     } else {
//       console.error("Unknown error in OAuth callback:", err);
//     }
//     // 실패해도 성공 페이지로 돌려보낼지, 에러 페이지로 보낼지 결정하세요
//     return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}`);
//   }
// }
// src/app/api/oauth/callback/route.ts
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
    // 사용할 env 변수, NEXT_PUBLIC_ 접두어가 붙은 값도 fallback으로 지원
    const mallId = process.env.CAFE24_MALL_ID ?? process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const clientId = process.env.CAFE24_CLIENT_ID ?? process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!;
    const clientSecret = process.env.CAFE24_CLIENT_SECRET!;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth/callback`;

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // 만료 시각 계산 (밀리초 단위, 60초 버퍼)
    const EXPIRY_SKEW_SEC = 60;
    const expiresAtMs = Date.now() + Math.max(0, (Number(expires_in) - EXPIRY_SKEW_SEC) * 1000);

    console.log('[OAUTH] Saving tokens to SSM...');
    // SSM에 저장 (cafe24Auth.ts와 동일한 키 이름 사용)
    await Promise.all([
      saveParam("access_token", access_token),
      saveParam("refresh_token", refresh_token),
      saveParam("access_token_expires_at", String(expiresAtMs)),
    ]);
    console.log('[OAUTH] ✓ Tokens saved, expires at:', new Date(expiresAtMs).toISOString());

    // HTTP-only 쿠키 설정
    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/success`);
    // access_token 쿠키: 전체 경로
    response.cookies.set("access_token", access_token, {
      httpOnly: true,
      secure: true,
      path: "/",
      maxAge: Number(expires_in),
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
