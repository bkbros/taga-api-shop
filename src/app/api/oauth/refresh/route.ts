// src/app/api/oauth/refresh/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams, saveParam } from "@/lib/ssm";

export async function GET() {
  // 1) SSM에서 리프레시 토큰 조회
  const { refresh_token } = await loadParams(["refresh_token"]);

  // 2) mall ID, client_id/secret 환경변수 확인
  const mall = process.env.CAFE24_MALL_ID!;
  const clientId = process.env.CAFE24_CLIENT_ID!;
  const clientSecret = process.env.CAFE24_CLIENT_SECRET!;
  if (!mall || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "환경변수 CAFE24_MALL_ID, CAFE24_CLIENT_ID, CAFE24_CLIENT_SECRET을 확인해주세요." },
      { status: 500 },
    );
  }

  // 3) 카페24 토큰 갱신 API 호출
  const data = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const res = await axios.post(`https://${mall}.cafe24api.com/api/v2/oauth/token`, data.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const tokens = res.data;

    // 4) 새 토큰 SSM에 저장
    await saveParam("access_token", tokens.access_token);
    await saveParam("refresh_token", tokens.refresh_token);

    // 5) 파이썬 쪽 refresh_token()이 기대하는 형태로 반환
    return NextResponse.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
