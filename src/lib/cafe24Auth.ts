// src/lib/cafe24Auth.ts
import axios, { AxiosResponse } from "axios";
import { loadParams, saveParam } from "@/lib/ssm";

const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
const clientId = process.env.CAFE24_CLIENT_ID!;
const clientSecret = process.env.CAFE24_CLIENT_SECRET!;

// Cafe24 토큰 응답 타입
type TokenResponse = {
  access_token: string;
  token_type: string; // 보통 "Bearer"
  expires_in: number; // 초 단위
  scope?: string;
  refresh_token?: string;
};

const EXPIRY_SKEW_SEC = 60; // 만료 버퍼(초)

/** 내부: refresh_token으로 새 access_token 발급 + SSM 갱신 */
async function refreshAccessToken(): Promise<{ token: string; expiresAtMs: number }> {
  console.log('[AUTH] Attempting to refresh access token...');
  const { refresh_token } = await loadParams(["refresh_token"]);
  if (!refresh_token) {
    console.error('[AUTH] ❌ No refresh_token found in SSM - OAuth login required!');
    throw new Error("Missing refresh_token in SSM - please re-authenticate via OAuth");
  }
  console.log('[AUTH] ✓ Refresh token found, calling Cafe24...');

  const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refresh_token);
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);

  const resp: AxiosResponse<TokenResponse> = await axios.post(url, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });

  const { access_token, expires_in, refresh_token: newRefresh } = resp.data;
  const expiresAtMs = Date.now() + Math.max(0, (expires_in - EXPIRY_SKEW_SEC) * 1000);

  await Promise.all([
    saveParam("access_token", access_token),
    saveParam("access_token_expires_at", String(expiresAtMs)),
    ...(newRefresh ? [saveParam("refresh_token", newRefresh)] : []),
  ]);

  return { token: access_token, expiresAtMs };
}

/** 만료 전이면 기존 토큰, 아니면 자동으로 새로 받아서 리턴 */
export async function getAccessToken(): Promise<string> {
  try {
    console.log('[AUTH] Loading tokens from SSM...');
    const { access_token, access_token_expires_at } = await loadParams(["access_token", "access_token_expires_at"]);
    const expMs = Number(access_token_expires_at || "0");
    const now = Date.now();

    console.log('[AUTH] Token status:', {
      hasToken: !!access_token,
      expiresAt: expMs ? new Date(expMs).toISOString() : 'none',
      isExpired: now >= expMs,
      remainingSeconds: Math.floor((expMs - now) / 1000)
    });

    if (!access_token || !expMs || Date.now() >= expMs) {
      console.log('[AUTH] Token missing or expired, attempting refresh...');
      const { token } = await refreshAccessToken();
      return token;
    }
    console.log('[AUTH] Using existing valid token');
    return access_token;
  } catch (error) {
    console.error('[AUTH] Error loading token:', error);
    console.log('[AUTH] Attempting to refresh token...');
    // 저장된 값이 없거나 에러면 강제 리프레시 후 반환
    const { token } = await refreshAccessToken();
    return token;
  }
}

/** 무조건 새로 받아서 리턴 (401 등에서 재시도용) */
export async function forceRefresh(): Promise<string> {
  const { token } = await refreshAccessToken();
  return token;
}
