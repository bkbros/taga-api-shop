/**
 * 파일 기반 작업 상태 관리
 * Vercel 서버리스 환경에서 메모리 공유 문제를 해결하기 위해
 * 임시 파일 시스템을 사용
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
  private getJobFilePath(jobId: string): string {
    return join(tmpdir(), `job_${jobId}.json`);
  }

  private saveJob(job: JobProgress): void {
    try {
      const filePath = this.getJobFilePath(job.jobId);
      writeFileSync(filePath, JSON.stringify(job), 'utf8');
    } catch (error) {
      console.error(`[JOB_STORE] 파일 저장 실패: ${job.jobId}`, error);
    }
  }

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

    this.saveJob(job);
    console.log(`[JOB_STORE] 작업 생성: ${jobId} (${total}개 아이템)`);
    return job;
  }

  updateProgress(jobId: string, current: number, message?: string): void {
    const job = this.getJob(jobId);
    if (!job) return;

    job.current = current;
    job.progress = Math.round((current / job.total) * 100);
    job.status = 'running';

    if (message) {
      job.message = message;
    }

    this.saveJob(job);
    console.log(`[JOB_STORE] 진행률 업데이트: ${jobId} (${job.progress}%)`);
  }

  completeJob(jobId: string, result: unknown): void {
    const job = this.getJob(jobId);
    if (!job) return;

    job.status = 'completed';
    job.progress = 100;
    job.current = job.total;
    job.endTime = Date.now();
    job.result = result;

    this.saveJob(job);
    console.log(`[JOB_STORE] 작업 완료: ${jobId}`);
  }

  failJob(jobId: string, error: string): void {
    const job = this.getJob(jobId);
    if (!job) return;

    job.status = 'failed';
    job.endTime = Date.now();
    job.error = error;

    this.saveJob(job);
    console.log(`[JOB_STORE] 작업 실패: ${jobId} - ${error}`);
  }

  getJob(jobId: string): JobProgress | undefined {
    try {
      const filePath = this.getJobFilePath(jobId);
      if (!existsSync(filePath)) {
        return undefined;
      }
      const data = readFileSync(filePath, 'utf8');
      return JSON.parse(data) as JobProgress;
    } catch (error) {
      console.error(`[JOB_STORE] 파일 읽기 실패: ${jobId}`, error);
      return undefined;
    }
  }

  // 파일 정리 (1시간 후 자동 삭제)
  cleanup(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    try {
      const files = readdirSync(tmpdir()).filter((file: string) => file.startsWith('job_') && file.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = join(tmpdir(), file);
          const data = readFileSync(filePath, 'utf8');
          const job = JSON.parse(data) as JobProgress;

          if (job.endTime && (now - job.endTime) > oneHour) {
            unlinkSync(filePath);
            console.log(`[JOB_STORE] 작업 정리: ${job.jobId}`);
          }
        } catch (error) {
          console.error(`[JOB_STORE] 파일 정리 실패: ${file}`, error);
        }
      }
    } catch (error) {
      console.error(`[JOB_STORE] 전체 정리 실패:`, error);
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