// import { NextResponse } from "next/server";
// import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// // 이 API는 Node.js 런타임이어야 AWS SDK가 동작합니다.
// export const runtime = "nodejs";

// const lambda = new LambdaClient({
//   region: process.env.AWS_REGION, // e.g. "ap-northeast-2"
// });
// const FUNCTION_NAME = process.env.SYNC_LAMBDA_NAME;
// // Vercel 환경변수에 "SYNC_LAMBDA_NAME=sync-cafe24-customers" 로 설정하세요.

// export async function GET() {
//   if (!FUNCTION_NAME) {
//     console.error("▶ SYNC_LAMBDA_NAME(env)가 없습니다");
//     return NextResponse.json({ error: "FunctionName not configured" }, { status: 500 });
//   }

//   try {
//     const cmd = new InvokeCommand({
//       FunctionName: FUNCTION_NAME, // 여기에 함수 이름을 꼭 명시해야 합니다
//       InvocationType: "Event", // 비동기로 동작시키려면 Event
//       // Lambda URL이 아니라 Function ARN을 쓰는 경우 Payload를 안 써도 됩니다
//     });
//     await lambda.send(cmd);
//     return NextResponse.json({ status: "sync started" });
//   } catch (e) {
//     console.error("▶ Lambda invoke error:", e);
//     return NextResponse.json({ error: "failed to start sync" }, { status: 500 });
//   }
// }

// src/app/api/trigger-sync/route.ts

//--------------------------2차수정--------------------------------------//
// import { NextResponse } from "next/server";
// import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

// const sfn = new SFNClient({ region: process.env.AWS_REGION });
// const SM_ARN = process.env.STATE_MACHINE_ARN!; // Vercel env 설정에 추가

// export async function GET() {
//   try {
//     await sfn.send(
//       new StartExecutionCommand({
//         stateMachineArn: SM_ARN,
//         input: "{}",
//       }),
//     );
//     return NextResponse.json({ message: "동기화 시작됨" });
//   } catch (e) {
//     console.error(e);
//     return NextResponse.json({ error: "동기화 실패" }, { status: 500 });
//   }
// }
// src/app/api/trigger-sync/route.ts
import { NextResponse } from "next/server";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

export async function GET() {
  try {
    const client = new SFNClient({ region: process.env.AWS_REGION });
    const stateMachineArn = process.env.STATE_MACHINE_ARN!;
    const name = `sync-cafe24-${Date.now()}`; // 실행마다 유니크하게
    const command = new StartExecutionCommand({
      stateMachineArn,
      name,
      input: JSON.stringify({}), // 필요하다면 파라미터 추가
    });
    const res = await client.send(command);
    return NextResponse.json({
      started: true,
      executionArn: res.executionArn,
    });
  } catch (err) {
    console.error("trigger-sync error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
