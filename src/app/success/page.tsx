"use client";

import Link from "next/link";

export default function SuccessPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-10 bg-gradient-to-br from-green-50 to-blue-50">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
        {/* 성공 아이콘 */}
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <svg
              className="w-10 h-10 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        {/* 메시지 */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          연결이 완료되었습니다!
        </h1>
        <p className="text-gray-600 mb-8">
          Cafe24 관리자 API 연동이 성공적으로 설정되었습니다.
        </p>

        {/* 관리자 페이지 이동 버튼 */}
        <Link
          href="/admin"
          className="inline-block w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          관리자 페이지로 이동 →
        </Link>

        {/* 추가 안내 */}
        <p className="text-sm text-gray-500 mt-6">
          관리자 페이지에서 회원 정보 검증 및 상품 구매 확인을 할 수 있습니다.
        </p>
      </div>
    </main>
  );
}
