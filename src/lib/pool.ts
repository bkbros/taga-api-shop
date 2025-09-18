/**
 * 동시성 제한이 있는 비동기 풀 매핑 유틸리티
 * 대량의 작업을 제한된 동시성으로 처리합니다.
 */

/**
 * 간단하고 안정적인 동시성 제한 매핑 함수
 * @param items 처리할 아이템 배열
 * @param concurrency 최대 동시 실행 개수
 * @param fn 각 아이템을 처리할 비동기 함수
 * @returns 모든 결과의 배열 (순서 보장)
 */
export async function mapPoolSimple<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  console.log(`[MAP_POOL_SIMPLE] 시작: ${items.length}개 아이템, 동시성: ${concurrency}`);

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    console.log(`[MAP_POOL_SIMPLE] 배치 ${Math.floor(i / concurrency) + 1}: ${batch.length}개 처리`);

    const batchPromises = batch.map(async (item, batchIndex) => {
      const globalIndex = i + batchIndex;
      try {
        console.log(`[MAP_POOL_SIMPLE] 시작: ${globalIndex + 1}/${items.length}`);
        const result = await fn(item, globalIndex);
        console.log(`[MAP_POOL_SIMPLE] 완료: ${globalIndex + 1}/${items.length}`);
        return result;
      } catch (error) {
        console.error(`[MAP_POOL_SIMPLE] 에러: ${globalIndex + 1}/${items.length}`, error);
        throw error; // 에러를 다시 던져서 호출자가 처리하도록
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    console.log(`[MAP_POOL_SIMPLE] 배치 완료: ${results.length}/${items.length}`);
  }

  console.log(`[MAP_POOL_SIMPLE] 전체 완료: ${results.length}개`);
  return results;
}

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

  console.log(`[MAP_POOL] 시작: ${items.length}개 아이템, 동시성: ${concurrency}`);

  const results: (R | undefined)[] = new Array(items.length);
  let completed = 0;

  const processItem = async (index: number): Promise<void> => {
    if (index >= items.length) return;

    console.log(`[MAP_POOL] 처리 시작: ${index + 1}/${items.length}`);

    try {
      const result = await fn(items[index], index);
      results[index] = result;
      console.log(`[MAP_POOL] 성공: ${index + 1}/${items.length}`);
    } catch (error) {
      console.error(`[MAP_POOL] 에러: ${index + 1}/${items.length}`, error);
      // 에러 발생 시 undefined로 설정 (계속 진행)
      results[index] = undefined;
    }

    completed++;
    console.log(`[MAP_POOL] 진행률: ${completed}/${items.length}`);
  };

  // Promise.all을 사용한 간단한 동시성 제어
  const promises: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const promise = processItem(i);
    promises.push(promise);

    // concurrency만큼 채워지면 일부 완료를 기다림
    if (promises.length >= concurrency) {
      await Promise.race(promises);
      // 완료된 promise 제거
      for (let j = promises.length - 1; j >= 0; j--) {
        if (await Promise.race([promises[j], Promise.resolve('not-done')]) !== 'not-done') {
          promises.splice(j, 1);
        }
      }
    }
  }

  // 남은 모든 작업 완료 대기
  await Promise.all(promises);

  console.log(`[MAP_POOL] 완료: 총 ${items.length}개 처리`);
  return results.filter((r): r is R => r !== undefined);
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