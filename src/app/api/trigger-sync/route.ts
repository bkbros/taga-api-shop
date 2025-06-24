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
import { NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

export async function GET() {
  const client = new LambdaClient({ region: process.env.AWS_REGION });
  try {
    // 비동기 호출: InvocationType="Event"
    await client.send(
      new InvokeCommand({
        FunctionName: process.env.SYNC_LAMBDA_ARN, // env 에 arn:sync-cafe24-customers
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({})),
      }),
    );
    return NextResponse.json({ status: "sync started" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed to start sync" }, { status: 500 });
  }
}
