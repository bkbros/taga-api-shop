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
import { NextResponse } from "next/server";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

export async function GET() {
  const client = new SFNClient({ region: process.env.AWS_REGION });
  const command = new StartExecutionCommand({
    stateMachineArn: process.env.STATE_MACHINE_ARN!,
    name: `sync-${Date.now()}`,
    input: "{}",
  });
  const res = await client.send(command);
  return NextResponse.json({
    started: true,
    executionArn: res.executionArn,
  });
}
