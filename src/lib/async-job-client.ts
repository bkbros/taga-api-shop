/**
 * 클라이언트 측에서 비동기 작업을 처리하기 위한 헬퍼 함수들
 */

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  current: number;
  total: number;
  message: string;
  elapsedTime: number;
  estimatedRemainingTime: number;
  result?: unknown;
  error?: string;
}

export interface JobStartResponse {
  success: boolean;
  jobId: string;
  message: string;
  totalMembers: number;
}

/**
 * 회원 검증 작업을 시작합니다
 */
export async function startVerificationJob(params: {
  spreadsheetId: string;
  sheetName: string;
  useEnvCredentials?: boolean;
  serviceAccountKey?: string;
}): Promise<JobStartResponse> {
  const response = await fetch('/api/sheets/verify-members/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`작업 시작 실패 (${response.status}): ${error.error || error.message}`);
  }

  return response.json();
}

/**
 * 작업 진행률을 조회합니다
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`/api/sheets/verify-members/status?jobId=${encodeURIComponent(jobId)}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`진행률 조회 실패 (${response.status}): ${error.error || error.message}`);
  }

  return response.json();
}

/**
 * 작업이 완료될 때까지 주기적으로 진행률을 폴링합니다
 */
export async function pollJobUntilComplete(
  jobId: string,
  onProgress?: (status: JobStatus) => void,
  pollInterval: number = 2000
): Promise<JobStatus> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const status = await getJobStatus(jobId);

        // 진행률 콜백 호출
        if (onProgress) {
          onProgress(status);
        }

        if (status.status === 'completed') {
          resolve(status);
        } else if (status.status === 'failed') {
          reject(new Error(status.error || '작업이 실패했습니다'));
        } else {
          // 아직 진행 중이면 다음 폴링 예약
          setTimeout(poll, pollInterval);
        }
      } catch (error) {
        reject(error);
      }
    };

    // 첫 번째 폴링 시작
    poll();
  });
}

/**
 * 시간을 사람이 읽기 쉬운 형태로 포맷팅
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}초`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}분 ${remainingSeconds}초`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}시간 ${minutes}분`;
  }
}

/**
 * 전체 회원 검증 프로세스를 실행하는 통합 함수
 */
export async function runMemberVerification(
  params: {
    spreadsheetId: string;
    sheetName: string;
    useEnvCredentials?: boolean;
    serviceAccountKey?: string;
  },
  onProgress?: (status: JobStatus) => void
): Promise<unknown> {
  // 1. 작업 시작
  console.log('회원 검증 작업 시작...');
  const startResponse = await startVerificationJob(params);

  console.log(`작업 시작됨: ${startResponse.jobId} (${startResponse.totalMembers}명)`);

  // 2. 완료까지 폴링
  const finalStatus = await pollJobUntilComplete(startResponse.jobId, onProgress);

  console.log('회원 검증 완료:', finalStatus.result);
  return finalStatus.result;
}

// 사용 예시를 위한 데모 함수
export function createProgressHandler() {
  return (status: JobStatus) => {
    console.log(`[${status.status.toUpperCase()}] ${status.progress}% (${status.current}/${status.total}) - ${status.message}`);

    if (status.estimatedRemainingTime > 0) {
      console.log(`예상 남은 시간: ${formatTime(status.estimatedRemainingTime)}`);
    }
  };
}