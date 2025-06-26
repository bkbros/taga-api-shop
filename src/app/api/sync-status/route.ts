// app/api/sync-status/route.ts
import { NextResponse } from "next/server";
import { SFNClient, DescribeExecutionCommand } from "@aws-sdk/client-sfn";

const client = new SFNClient({ region: process.env.AWS_REGION });

export async function GET(request: Request) {
  const { arn } = Object.fromEntries(new URL(request.url).searchParams);
  const res = await client.send(new DescribeExecutionCommand({ executionArn: arn as string }));

  if (res.status === "RUNNING") {
    return NextResponse.json({ status: "RUNNING" });
  }

  // 완료된 경우 output(JSON 문자열)을 파싱
  const result = JSON.parse(res.output!);
  // result.updated, result.next_start 등이 있다고 가정
  return NextResponse.json({
    status: res.status,
    updated: result.updated,
    next_start: result.next_start,
  });
}
