/**
 * 동시성 제한이 있는 비동기 풀 매핑 유틸리티
 * 대량의 작업을 제한된 동시성으로 처리합니다.
 */

/**
 * 배열의 각 요소에 대해 비동기 함수를 실행하되, 최대 동시성을 제한합니다.
 * 개별 작업 실패 시에도 전체 처리를 계속합니다.
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
  if (items.length === 0) return [];
  if (concurrency <= 0) concurrency = 1;

  const results: R[] = new Array(items.length);
  const errors: Array<{ index: number; error: unknown }> = [];

  console.log(`[MAP_POOL] 시작: ${items.length}개 아이템, 동시성: ${concurrency}`);

  return new Promise((resolve) => {
    let index = 0;
    let running = 0;
    let completed = 0;

    const processNext = async (): Promise<void> => {
      if (index >= items.length) return;

      const currentIndex = index++;
      running++;

      console.log(`[MAP_POOL] 처리 시작: ${currentIndex + 1}/${items.length}`);

      try {
        const result = await fn(items[currentIndex], currentIndex);
        results[currentIndex] = result;
        console.log(`[MAP_POOL] 성공: ${currentIndex + 1}/${items.length}`);
      } catch (error) {
        console.error(`[MAP_POOL] 에러: ${currentIndex + 1}/${items.length}`, error);
        errors.push({ index: currentIndex, error });
        // 에러가 발생해도 계속 진행
      }

      running--;
      completed++;

      console.log(`[MAP_POOL] 진행률: ${completed}/${items.length} (실행중: ${running})`);

      if (completed === items.length) {
        console.log(`[MAP_POOL] 완료: 총 ${items.length}개, 에러 ${errors.length}개`);
        resolve(results);
        return;
      }

      // 다음 작업이 있고 동시성 한도 내라면 새 작업 시작
      if (index < items.length && running < concurrency) {
        setImmediate(() => processNext());
      }
    };

    // 초기 동시성만큼 작업 시작
    const initialTasks = Math.min(concurrency, items.length);
    for (let i = 0; i < initialTasks; i++) {
      setImmediate(() => processNext());
    }
  });
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