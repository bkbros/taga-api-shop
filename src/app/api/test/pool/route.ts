import { NextResponse } from "next/server";
import { mapPool } from "@/lib/pool";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { count = 20, delay = 100 } = body;

    console.log(`[TEST] 테스트 시작: ${count}개 아이템, ${delay}ms 지연`);

    const items = Array.from({ length: count }, (_, i) => `item-${i + 1}`);

    const results = await mapPool(items, 2, async (item, index) => {
      console.log(`[TEST] 처리 중: ${index + 1}/${count} - ${item}`);

      // 인위적 지연
      await new Promise(resolve => setTimeout(resolve, delay));

      // 10% 확률로 에러 발생
      if (Math.random() < 0.1) {
        throw new Error(`Random error for ${item}`);
      }

      console.log(`[TEST] 완료: ${index + 1}/${count} - ${item}`);
      return { item, index, success: true };
    });

    console.log(`[TEST] 전체 완료: ${results.length}개 결과`);

    return NextResponse.json({
      success: true,
      total: results.length,
      results: results.slice(0, 5), // 처음 5개만 반환
      summary: {
        requested: count,
        processed: results.length,
        successful: results.filter(r => r).length
      }
    });

  } catch (error) {
    console.error(`[TEST] 에러:`, error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}