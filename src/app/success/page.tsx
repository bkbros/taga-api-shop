// src/app/success/page.tsx
"use client";

import { useState } from "react";

interface Product {
  product_id: string;
  product_name: string;
  price: number;
}

export default function SuccessPage() {
  const [data, setData] = useState<Product[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>();
  const [didi, setDidi] = useState<string>();

  const calldidi = async () => {
    const res = await fetch(`/api/admin/customers`);
    // ② JSON 을 읽고
    const json = await res.json();

    // ③ exists 프로퍼티를 보고 메시지를 정리하세요.
    if (res.ok) {
      setDidi(json.exists ? "✅ 회원이 존재합니다" : "❌ 해당 회원이 없습니다");
    } else {
      setDidi(`오류: ${json.error}`);
    }
  };

  const handleSync = async () => {
    const res = await fetch("/api/trigger-sync");
    const json = await res.json();
    if (res.ok && json.started) {
      setMsg("동기화가 시작되었습니다 🎉");
    } else {
      setMsg(`오류: ${json.error || "상태 머신 실행 실패"}`);
    }
  };

  const handleTestApi = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/products");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "API 호출 실패");
      }
      const json = await res.json();
      // json 구조에 맞게 타입 단언
      const products = (json.products ?? json) as Product[];
      setData(products);
    } catch (err: unknown) {
      // unknown → Error 로 좁혀서 처리
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-10">
      <h1 className="text-2xl font-bold mb-4">연결이 완료되었습니다!</h1>
      <p className="text-gray-700 mb-6">카페24 관리자 API 연동이 성공적으로 설정되었습니다.</p>
      <button onClick={calldidi} className="mb-4 px-4 py-2 bg-blue-500 text-white rounded">
        회원 조회 테스트
      </button>
      {didi && <p className="mt-4">{didi}</p>}
      <button onClick={handleSync} className="mb-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
        스프레드시트 동기화
      </button>
      {msg && <p>{msg}</p>}
      <button
        onClick={handleTestApi}
        className="mb-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        disabled={loading}
      >
        {loading ? "호출 중…" : "상품 조회 API 테스트"}
      </button>
      {error && <div className="text-red-500 mb-4">에러: {error}</div>}
      {data && (
        <div className="w-full max-w-3xl overflow-auto">
          <table className="w-full table-auto border-collapse">
            <thead>
              <tr>
                <th className="border px-2 py-1">상품ID</th>
                <th className="border px-2 py-1">상품명</th>
                <th className="border px-2 py-1">판매가</th>
              </tr>
            </thead>
            <tbody>
              {data.map(item => (
                <tr key={item.product_id}>
                  <td className="border px-2 py-1">{item.product_id}</td>
                  <td className="border px-2 py-1">{item.product_name}</td>
                  <td className="border px-2 py-1">{item.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
