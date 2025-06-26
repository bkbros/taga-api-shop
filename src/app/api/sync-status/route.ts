// app/api/sync-status/route.ts
import { NextResponse } from "next/server";
import { SFNClient, DescribeExecutionCommand } from "@aws-sdk/client-sfn";

type SyncPayload = {
  updated?: number;
  next_start?: string | null;
};

const client = new SFNClient({ region: process.env.AWS_REGION });

export async function GET(request: Request) {
  // 1) arn 파라미터 확인
  const arn = new URL(request.url).searchParams.get("arn");
  if (!arn) {
    return NextResponse.json({ error: "arn 파라미터가 없습니다." }, { status: 400 });
  }

  try {
    // 2) 실행 상태 조회
    const res = await client.send(new DescribeExecutionCommand({ executionArn: arn }));

    // 3) 아직 실행 중이면 RUNNING만 반환
    if (res.status === "RUNNING") {
      return NextResponse.json({ status: "RUNNING" });
    }

    // 4) 완료된 경우 output 파싱
    let payload: SyncPayload = {};
    if (typeof res.output === "string" && res.output.trim() !== "") {
      try {
        payload = JSON.parse(res.output) as SyncPayload;
      } catch (e) {
        console.error("[sync-status] output parse error:", e, "raw output:", res.output);
        return NextResponse.json({ error: "실행 결과를 파싱하는 중 오류가 발생했습니다." }, { status: 500 });
      }
    }

    // 5) 업데이트 개수와 next_start 내려주기
    return NextResponse.json({
      status: res.status,
      updated: payload.updated ?? 0,
      next_start: payload.next_start ?? null,
    });
  } catch (e) {
    console.error("[sync-status] describeExecution error:", e);
    return NextResponse.json({ error: "동기화 상태 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
