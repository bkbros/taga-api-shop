// src/app/api/tokens/route.ts
import { NextResponse } from "next/server";
import { loadParams } from "@/lib/ssm";

export async function GET() {
  const tokens = await loadParams(["access_token", "refresh_token"]);
  return NextResponse.json(tokens);
}
