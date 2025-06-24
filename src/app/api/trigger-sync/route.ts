// import { NextResponse } from "next/server";
// import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

// export async function GET() {
//   try {
//     const client = new SFNClient({ region: process.env.AWS_REGION });
//     const stateMachineArn = process.env.STATE_MACHINE_ARN!;
//     const name = `sync-cafe24-${Date.now()}`; // 실행마다 유니크하게
//     const command = new StartExecutionCommand({
//       stateMachineArn,
//       name,
//       input: JSON.stringify({}), // 필요하다면 파라미터 추가
//     });
//     const res = await client.send(command);
//     return NextResponse.json({
//       started: true,
//       executionArn: res.executionArn,
//     });
//   } catch (err) {
//     console.error("trigger-sync error:", err);
//     return NextResponse.json({ error: (err as Error).message }, { status: 500 });
//   }
// }
// src/app/api/trigger-sync/route.ts
import { NextResponse } from "next/server";
import { SFNClient, StartSyncExecutionCommand } from "@aws-sdk/client-sfn";

export async function GET() {
  try {
    const client = new SFNClient({ region: process.env.AWS_REGION });
    const stateMachineArn = process.env.STATE_MACHINE_ARN!; // 반드시 "stateMachine:SyncCafe24Customers" ARN
    const name = `sync-cafe24-${Date.now()}`;

    const command = new StartSyncExecutionCommand({
      stateMachineArn,
      name,
      input: JSON.stringify({}), // 필요하면 여기에 페이로드 추가
    });

    const res = await client.send(command);

    // res.output 은 문자열이니까 JSON.parse
    const output = res.output ? JSON.parse(res.output) : {};

    return NextResponse.json({
      next_start: output.next_start,
      updated: output.processed, // 또는 output.count, 핸들러에서 내보낸 필드 이름 그대로
    });
  } catch (err) {
    console.error("trigger-sync error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
