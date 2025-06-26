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
