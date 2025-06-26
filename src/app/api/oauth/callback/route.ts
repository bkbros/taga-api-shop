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
    // ← 서버 전용 env 변수 사용
    const mallId = process.env.CAFE24_MALL_ID!;
    const clientId = process.env.CAFE24_CLIENT_ID!;
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

    // 발급된 토큰과 유효기간(expires_in)을 가져옵니다.
    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // SSM에 저장
    await saveParam("access_token", access_token);
    await saveParam("refresh_token", refresh_token);
    // 만료 시각(Unix timestamp)도 기록
    const expiryTs = Math.floor(Date.now() / 1000) + Number(expires_in);
    await saveParam("token_expiry", expiryTs.toString());

    // 클라이언트 리다이렉트
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/success`);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      console.error("Cafe24 token error status:", e);
    } else {
      console.error("Unknown error in OAuth callback:", e);
    }
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/error`);
  }
}
