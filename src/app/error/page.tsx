// src/app/error/page.tsx
import Link from "next/link";

export default function ErrorPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-10">
      <h1 className="text-3xl font-bold mb-4 text-red-600">앱 연결 중 오류가 발생했습니다</h1>
      <p className="text-gray-700 mb-6">죄송합니다. 인증 처리 중 문제가 발생했습니다.</p>
      <div className="space-x-4">
        <Link href="/" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          홈으로 돌아가기
        </Link>
      </div>
    </main>
  );
}
