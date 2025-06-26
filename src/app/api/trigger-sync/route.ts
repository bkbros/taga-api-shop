// import { NextResponse } from "next/server";
// import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

// export async function GET() {
//   const client = new SFNClient({ region: process.env.AWS_REGION });
//   const command = new StartExecutionCommand({
//     stateMachineArn: process.env.STATE_MACHINE_ARN!,
//     name: `sync-${Date.now()}`,
//     input: "{}",
//   });
//   const res = await client.send(command);
//   return NextResponse.json({
//     started: true,
//     executionArn: res.executionArn,
//   });
// }
import { NextResponse } from "next/server";
import { SFNClient, StartExecutionCommand, DescribeStateMachineCommand } from "@aws-sdk/client-sfn";

export async function GET() {
  const arn = process.env.STATE_MACHINE_ARN!;
  const client = new SFNClient({ region: process.env.AWS_REGION });

  // 1) State Machine 메타데이터 조회
  const desc = await client.send(new DescribeStateMachineCommand({ stateMachineArn: arn }));
  const machineType = desc.type; // "STANDARD" or "EXPRESS"

  // 2) 실행 트리거
  const start = await client.send(
    new StartExecutionCommand({
      stateMachineArn: arn,
      name: `sync-${Date.now()}`,
      input: "{}",
    }),
  );

  return NextResponse.json({
    started: true,
    executionArn: start.executionArn,
    stateMachineType: machineType, // 여기 추가
  });
}
