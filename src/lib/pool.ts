/**
 * 동시성 제한이 있는 비동기 풀 매핑 유틸리티
 * 대량의 작업을 제한된 동시성으로 처리합니다.
 */

/**
 * 배열의 각 요소에 대해 비동기 함수를 실행하되, 최대 동시성을 제한합니다.
 * @param items 처리할 아이템 배열
 * @param concurrency 최대 동시 실행 개수
 * @param fn 각 아이템을 처리할 비동기 함수
 * @returns 모든 결과의 배열 (순서 보장)
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing: Promise<void>[] = [];

  let index = 0;

  const processNext = async (): Promise<void> => {
    const currentIndex = index++;
    if (currentIndex >= items.length) return;

    try {
      const result = await fn(items[currentIndex], currentIndex);
      results[currentIndex] = result;
    } catch (error) {
      // 에러를 결과에 포함하거나 다시 throw할 수 있습니다
      throw error;
    }

    // 다음 작업 처리
    await processNext();
  };

  // 초기 동시성만큼 작업 시작
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    executing.push(processNext());
  }

  // 모든 작업 완료 대기
  await Promise.all(executing);

  return results;
}

/**
 * 각 작업 사이에 지연을 두고 순차적으로 실행합니다.
 * @param items 처리할 아이템 배열
 * @param fn 각 아이템을 처리할 비동기 함수
 * @param delayMs 작업 간 지연 시간 (밀리초)
 * @returns 모든 결과의 배열
 */
export async function mapSequential<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  delayMs = 0
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    if (i > 0 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const result = await fn(items[i], i);
    results.push(result);
  }

  return results;
}