// // src/app/api/trigger-sync/route.ts
// import { NextResponse } from "next/server";

// export async function GET() {
//   const lambdaUrl = process.env.LAMBDA_URL;
//   console.log("▶️ trigger-sync called, LAMBDA_URL=", lambdaUrl);

//   if (!lambdaUrl) {
//     console.error("[trigger-sync] LAMBDA_URL is not set");
//     return NextResponse.json({ error: "LAMBDA_URL not set in environment" }, { status: 500 });
//   }

//   try {
//     const res = await fetch(lambdaUrl);
//     console.log("[trigger-sync] Lambda response status=", res.status);
//     const text = await res.text();
//     console.log("[trigger-sync] Lambda response body=", text);

//     if (!res.ok) {
//       throw new Error(`Lambda 호출 실패 (${res.status}): ${text}`);
//     }

//     const data = JSON.parse(text);
//     return NextResponse.json(data);
//   } catch (e: unknown) {
//     console.error("[trigger-sync] error:", e);
//     return NextResponse.json({ error: e || "Unknown error" }, { status: 500 });
//   }
// }
// src/app/api/trigger-sync/route.ts
// src/app/api/trigger-sync/route.ts
import { NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// 이 API는 Node.js 런타임이어야 AWS SDK가 동작합니다.
export const runtime = "nodejs";

const lambda = new LambdaClient({
  region: process.env.AWS_REGION, // e.g. "ap-northeast-2"
});
const FUNCTION_NAME = process.env.SYNC_LAMBDA_NAME;
// Vercel 환경변수에 "SYNC_LAMBDA_NAME=sync-cafe24-customers" 로 설정하세요.

export async function GET() {
  if (!FUNCTION_NAME) {
    console.error("▶ SYNC_LAMBDA_NAME(env)가 없습니다");
    return NextResponse.json({ error: "FunctionName not configured" }, { status: 500 });
  }

  try {
    const cmd = new InvokeCommand({
      FunctionName: FUNCTION_NAME, // 여기에 함수 이름을 꼭 명시해야 합니다
      InvocationType: "Event", // 비동기로 동작시키려면 Event
      // Lambda URL이 아니라 Function ARN을 쓰는 경우 Payload를 안 써도 됩니다
    });
    await lambda.send(cmd);
    return NextResponse.json({ status: "sync started" });
  } catch (e) {
    console.error("▶ Lambda invoke error:", e);
    return NextResponse.json({ error: "failed to start sync" }, { status: 500 });
  }
}
