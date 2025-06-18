// src/app/api/trigger-sync/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const lambdaUrl = process.env.LAMBDA_URL!;
  if (!lambdaUrl) {
    return NextResponse.json({ error: "LAMBDA_URL not set" }, { status: 500 });
  }

  try {
    const res = await fetch(lambdaUrl);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Lambda 호출 실패 (${res.status})`);
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: unknown) {
    console.error("trigger-sync error:", e);
    return NextResponse.json({ error: e }, { status: 500 });
  }
}
