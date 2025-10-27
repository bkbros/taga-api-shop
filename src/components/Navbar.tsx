"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

export default function Navbar() {
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Navbar를 보여주지 않을 페이지 목록
  const hideNavbarPages = ["/", "/error"];

  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/tokens");
        setIsAuthenticated(res.ok);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [pathname]); // pathname이 바뀔 때마다 다시 체크

  // 특정 페이지에서는 Navbar 숨김
  if (hideNavbarPages.includes(pathname)) {
    return null;
  }

  // 로딩 중이거나 인증되지 않았으면 Navbar 숨김
  if (isLoading || !isAuthenticated) {
    return null;
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            {/* 로고 */}
            <div className="flex-shrink-0 flex items-center">
              <Link href="/" className="text-xl font-bold text-blue-600 hover:text-blue-700">
                Cafe24 Admin
              </Link>
            </div>

            {/* 네비게이션 링크 */}
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <Link
                href="/admin"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  pathname === "/admin"
                    ? "border-blue-500 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                📊 관리자
              </Link>
              <Link
                href="/success"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  pathname === "/success"
                    ? "border-blue-500 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                ✅ OAuth 연동
              </Link>
            </div>
          </div>

          {/* 우측 메뉴 */}
          <div className="flex items-center">
            <span className="text-sm text-gray-500">Cafe24 API Shop</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
