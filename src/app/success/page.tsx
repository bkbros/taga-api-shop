// src/app/success/page.tsx
"use client";

import { useState } from "react";

export default function SuccessPage() {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setData(Array.isArray(json) ? json : json.products || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-10">
      <h1 className="text-2xl font-bold mb-4">연결이 완료되었습니다!</h1>
      <p className="text-gray-700 mb-6">카페24 관리자 API 연동이 성공적으로 설정되었습니다.</p>
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
