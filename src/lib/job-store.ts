/**
 * 메모리 기반 작업 상태 관리
 * 실제 프로덕션에서는 Redis나 DB를 사용해야 하지만,
 * 간단한 데모용으로 메모리 스토어 사용
 */

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobProgress {
  jobId: string;
  status: JobStatus;
  progress: number; // 0-100
  current: number;
  total: number;
  message: string;
  startTime: number;
  endTime?: number;
  result?: unknown;
  error?: string;
}

class JobStore {
  private jobs = new Map<string, JobProgress>();

  createJob(jobId: string, total: number, message: string): JobProgress {
    const job: JobProgress = {
      jobId,
      status: 'pending',
      progress: 0,
      current: 0,
      total,
      message,
      startTime: Date.now(),
    };

    this.jobs.set(jobId, job);
    console.log(`[JOB_STORE] 작업 생성: ${jobId} (${total}개 아이템)`);
    return job;
  }

  updateProgress(jobId: string, current: number, message?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.current = current;
    job.progress = Math.round((current / job.total) * 100);
    job.status = 'running';

    if (message) {
      job.message = message;
    }

    console.log(`[JOB_STORE] 진행률 업데이트: ${jobId} (${job.progress}%)`);
  }

  completeJob(jobId: string, result: unknown): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.progress = 100;
    job.current = job.total;
    job.endTime = Date.now();
    job.result = result;

    console.log(`[JOB_STORE] 작업 완료: ${jobId}`);
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.endTime = Date.now();
    job.error = error;

    console.log(`[JOB_STORE] 작업 실패: ${jobId} - ${error}`);
  }

  getJob(jobId: string): JobProgress | undefined {
    return this.jobs.get(jobId);
  }

  // 메모리 정리 (1시간 후 자동 삭제)
  cleanup(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.endTime && (now - job.endTime) > oneHour) {
        this.jobs.delete(jobId);
        console.log(`[JOB_STORE] 작업 정리: ${jobId}`);
      }
    }
  }
}

export const jobStore = new JobStore();

// 1시간마다 정리
setInterval(() => {
  jobStore.cleanup();
}, 60 * 60 * 1000);

// 고유 Job ID 생성
export function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}