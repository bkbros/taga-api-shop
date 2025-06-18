// src/app/api/trigger-sync/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch(process.env.LAMBDA_URL!);
  const data = await res.json();
  return NextResponse.json(data);
}
