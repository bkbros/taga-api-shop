// src/app/api/tokens/route.ts
import { NextResponse } from "next/server";
import { loadParams } from "@/lib/ssm";

export async function GET() {
  try {
    const params = await loadParams(["access_token", "refresh_token", "access_token_expires_at"]);
    const expiresAt = Number(params.access_token_expires_at || "0");
    const now = Date.now();

    return NextResponse.json({
      hasAccessToken: !!params.access_token,
      hasRefreshToken: !!params.refresh_token,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      isExpired: expiresAt ? now >= expiresAt : true,
      expiresInSeconds: expiresAt ? Math.floor((expiresAt - now) / 1000) : 0,
      accessTokenPreview: params.access_token ? params.access_token.substring(0, 20) + "..." : null,
      refreshTokenPreview: params.refresh_token ? params.refresh_token.substring(0, 20) + "..." : null,
    });
  } catch (error) {
    console.error("[TOKENS] Error loading tokens:", error);
    return NextResponse.json({
      error: "Failed to load tokens",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
