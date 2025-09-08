// src/lib/cafe24Auth.ts
import axios from "axios";
import { loadParams, saveParams } from "@/lib/ssm";

const SKEW_MS = 60_000; // 만료 60초 전이면 갱신

function now() {
  return Date.now();
}

export async function getAccessToken(): Promise<string> {
  const { access_token, access_token_expires_at, refresh_token } = await loadParams([
    "access_token",
    "access_token_expires_at",
    "refresh_token",
  ]).catch(() => ({} as any));

  const exp = Number(access_token_expires_at || 0);
  if (access_token && exp && now() < exp - SKEW_MS) {
    return access_token;
  }
  if (!refresh_token) {
    throw new Error("Missing refresh_token in SSM");
  }
  return refreshAccessToken(refresh_token);
}

export async function forceRefresh(): Promise<string> {
  const { refresh_token } = await loadParams(["refresh_token"]);
  if (!refresh_token) throw new Error("Missing refresh_token in SSM");
  return refreshAccessToken(refresh_token);
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
  const clientId = process.env.CAFE24_CLIENT_ID!;
  const clientSecret = process.env.CAFE24_CLIENT_SECRET!;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const resp = await axios.post(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    timeout: 15000,
  });

  const { access_token, expires_in, refresh_token: new_refresh_token } = resp.data;
  const expires_at = (now() + Number(expires_in) * 1000).toString();

  // ✅ 여러 키를 한 번에 SSM 저장
  await saveParams({
    access_token,
    access_token_expires_at: expires_at,
    ...(new_refresh_token ? { refresh_token: new_refresh_token } : {}),
  });

  return access_token as string;
}
