import { NextResponse } from "next/server";
import { jobStore } from "@/lib/job-store";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: "jobId 파라미터가 필요합니다" }, { status: 400 });
    }

    const job = jobStore.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "해당 작업을 찾을 수 없습니다" }, { status: 404 });
    }

    // 진행 시간 계산
    const now = Date.now();
    const elapsedTime = now - job.startTime;
    const estimatedTotalTime = job.progress > 0 ? (elapsedTime / job.progress) * 100 : 0;
    const remainingTime = Math.max(0, estimatedTotalTime - elapsedTime);

    return NextResponse.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      current: job.current,
      total: job.total,
      message: job.message,
      elapsedTime: Math.round(elapsedTime / 1000), // 초 단위
      estimatedRemainingTime: Math.round(remainingTime / 1000), // 초 단위
      result: job.result,
      error: job.error
    });

  } catch (error) {
    console.error("진행률 조회 실패:", error);
    return NextResponse.json(
      { error: "진행률 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}