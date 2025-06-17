// src/app/api/oauth/refresh/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams, saveParam } from "@/lib/ssm";

export async function GET() {
  const { refresh_token } = await loadParams(["refresh_token"]);
  const mall = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
  const data = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!,
    client_secret: process.env.CAFE24_CLIENT_SECRET!,
  });

  const { data: tokens } = await axios.post(`https://${mall}.cafe24api.com/api/v2/oauth/token`, data.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  await saveParam("access_token", tokens.access_token);
  await saveParam("refresh_token", tokens.refresh_token);

  return NextResponse.json({ ok: true });
}
