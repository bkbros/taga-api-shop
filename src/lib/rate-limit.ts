import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

/**
 * 토큰 버킷 알고리즘을 사용한 Rate Limiter
 * API 호출 빈도를 제한하여 서버 부하를 방지합니다.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly refillRate: number;
  private readonly maxTokens: number;
  private readonly queue: Array<() => void> = [];
  private processing = false;

  /**
   * @param tokensPerSecond 초당 허용 토큰 수 (RPS)
   * @param maxTokens 최대 토큰 수 (버스트 허용량)
   */
  constructor(tokensPerSecond: number, maxTokens: number) {
    this.refillRate = tokensPerSecond;
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * 토큰을 보충합니다 (시간에 따라 자동 보충)
   */
  private refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * 토큰을 얻을 때까지 대기합니다
   */
  private async waitForToken(): Promise<void> {
    return new Promise<void>((resolve) => {
      const tryAcquire = () => {
        this.refillTokens();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          console.log(`[RATE_LIMITER] 토큰 사용: 남은 토큰 ${this.tokens.toFixed(2)}`);
          resolve();
        } else {
          // 다음 토큰이 생성될 때까지 대기
          const waitTime = (1 - this.tokens) / this.refillRate * 1000;
          console.log(`[RATE_LIMITER] 토큰 부족, ${waitTime.toFixed(0)}ms 대기`);
          setTimeout(tryAcquire, Math.max(50, waitTime));
        }
      };

      tryAcquire();
    });
  }

  /**
   * Rate limit을 적용하여 함수를 실행합니다
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForToken();
    return fn();
  }

  /**
   * Rate limiter를 정리합니다 (현재는 특별한 정리 작업 없음)
   */
  dispose(): void {
    // 큐 정리 등 필요시 구현
    this.queue.length = 0;
  }
}

/**
 * Rate limit이 적용된 Cafe24 API GET 요청
 */
export async function cafe24Get<T = unknown>(
  limiter: RateLimiter,
  url: string,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse<T>> {
  return limiter.execute(async () => {
    const response = await axios.get<T>(url, {
      ...config,
      validateStatus: (status) => status < 500, // 5xx만 에러로 처리
    });

    // 429 Rate Limit 처리
    if (response.status === 429) {
      const retryAfter = response.headers['retry-after'];
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : 2000;

      console.log(`[RATE LIMIT] 429 응답, ${delay}ms 후 재시도`);
      await new Promise(resolve => setTimeout(resolve, delay));

      // 재귀적으로 재시도
      return cafe24Get<T>(limiter, url, config);
    }

    return response;
  });
}

/**
 * Rate limit이 적용된 Cafe24 API POST 요청
 */
export async function cafe24Post<T = unknown>(
  limiter: RateLimiter,
  url: string,
  data?: unknown,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse<T>> {
  return limiter.execute(async () => {
    const response = await axios.post<T>(url, data, {
      ...config,
      validateStatus: (status) => status < 500,
    });

    if (response.status === 429) {
      const retryAfter = response.headers['retry-after'];
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : 2000;

      console.log(`[RATE LIMIT] 429 응답, ${delay}ms 후 재시도`);
      await new Promise(resolve => setTimeout(resolve, delay));

      return cafe24Post<T>(limiter, url, data, config);
    }

    return response;
  });
}