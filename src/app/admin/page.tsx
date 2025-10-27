"use client";

import SheetsVerification from "@/components/SheetsVerification";
import ProductPurchaseCheck from "@/components/ProductPurchaseCheck";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"verify" | "products">("verify");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // 인증 확인
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/tokens");
        if (!res.ok) {
          throw new Error("Not authenticated");
        }
        setIsAuthenticated(true);
      } catch (error) {
        console.error("Authentication check failed:", error);
        router.push("/");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  // 로딩 중
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">인증 확인 중...</p>
        </div>
      </div>
    );
  }

  // 인증되지 않음
  if (!isAuthenticated) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      {/* 헤더 */}
      <div className="max-w-7xl mx-auto mb-8">
        <h1 className="text-3xl font-bold text-gray-900">관리자 대시보드</h1>
        <p className="text-gray-600 mt-2">Cafe24 고객 데이터 관리</p>
      </div>

      {/* 통계 카드 */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <span className="text-2xl">👥</span>
                </div>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">회원 검증</h3>
                <p className="text-2xl font-bold text-gray-900">Google Sheets</p>
                <p className="text-xs text-gray-500 mt-1">배치 자동 처리</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <span className="text-2xl">🛒</span>
                </div>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">구매 확인</h3>
                <p className="text-2xl font-bold text-gray-900">상품별 분석</p>
                <p className="text-xs text-gray-500 mt-1">기간별 조회</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <span className="text-2xl">⚡</span>
                </div>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Cafe24 API</h3>
                <p className="text-2xl font-bold text-gray-900">연동 완료</p>
                <p className="text-xs text-gray-500 mt-1">자동 토큰 갱신</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab("verify")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "verify"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              👥 회원 정보 검증
            </button>
            <button
              onClick={() => setActiveTab("products")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "products"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              🛒 상품 구매 확인
            </button>
          </nav>
        </div>
      </div>

      {/* 탭 컨텐츠 */}
      <div className="max-w-7xl mx-auto">
        {activeTab === "verify" && (
          <div className="bg-white rounded-lg shadow p-6">
            <SheetsVerification />
          </div>
        )}
        {activeTab === "products" && (
          <div className="bg-white rounded-lg shadow p-6">
            <ProductPurchaseCheck />
          </div>
        )}
      </div>
    </main>
  );
}
