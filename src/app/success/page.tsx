"use client";

import { useState } from "react";

export default function SuccessPage() {
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>();

  const handleSync = async () => {
    setError(null);
    setMsg(undefined);
    try {
      const res = await fetch("/api/trigger-sync");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "동기화 실패");

      // next_start 가 null 이면 끝까지 돌린 것
      if (json.next_start === null) {
        setMsg(`✅ 동기화 완료되었습니다! 총 ${json.updated}개 업데이트`);
      } else {
        setMsg(`🔄 업데이트 ${json.updated}개 완료… 다음 배치 진행 중`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-10">
      <h1 className="text-2xl font-bold mb-4">연결이 완료되었습니다!</h1>
      <p className="text-gray-700 mb-6">카페24 관리자 API 연동이 성공적으로 설정되었습니다.</p>

      <button onClick={handleSync} className="mb-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
        스프레드시트 동기화
      </button>

      {/* 여기부터 메시지 렌더링 */}
      {msg && <p className="mt-4 text-green-600">{msg}</p>}
      {error && <p className="mt-4 text-red-600">에러: {error}</p>}
    </main>
  );
}
