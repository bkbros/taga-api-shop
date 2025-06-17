// src/app/api/oauth/callback/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { saveParam } from "@/lib/ssm";

export async function GET(req: Request) {
  const { code } = Object.fromEntries(new URL(req.url).searchParams);
  if (!code) return NextResponse.json({ error: "code missing" }, { status: 400 });

  const mall = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
  const data = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!,
    client_secret: process.env.CAFE24_CLIENT_SECRET!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth/callback`,
  });

  const { data: tokens } = await axios.post(`https://${mall}.cafe24api.com/api/v2/oauth/token`, data.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  // access_token, refresh_token 저장
  await saveParam("access_token", tokens.access_token);
  await saveParam("refresh_token", tokens.refresh_token);

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/success`);
}
