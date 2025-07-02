"use client";

import { useState } from "react";

interface SyncButtonProps {
  className?: string;
}

export default function SyncButton({ className = "" }: SyncButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSync = async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/trigger-sync/notion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          testOffset: "0",
          testLimit: "10", // 원하는 값으로 설정
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage("✅ " + data.message);
        setTimeout(() => {
          setMessage(prev => prev + "\n🔄 GitHub에서 진행 상황을 확인하세요!");
        }, 1000);
      } else {
        setMessage("❌ " + data.message);
      }
    } catch (error: any) {
      setMessage(`❌ 네트워크 오류: ${error.message}`);
    }

    setLoading(false);
  };

  return (
    <div className={`p-6 text-center ${className}`}>
      <button
        onClick={handleSync}
        disabled={loading}
        className={`
          px-8 py-4 text-lg font-semibold rounded-lg shadow-lg transition-all duration-200
          ${
            loading
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 hover:shadow-xl transform hover:scale-105"
          }
          text-white border-none
        `}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                strokeDasharray="32"
                strokeDashoffset="32"
              >
                <animate
                  attributeName="stroke-dasharray"
                  dur="2s"
                  values="0 32;16 16;0 32;0 32"
                  repeatCount="indefinite"
                />
                <animate attributeName="stroke-dashoffset" dur="2s" values="0;-16;-32;-32" repeatCount="indefinite" />
              </circle>
            </svg>
            처리 중...
          </span>
        ) : (
          "🚀 Google → Notion 동기화 시작"
        )}
      </button>

      {message && <div className="mt-4 p-4 bg-gray-50 rounded-lg border text-sm whitespace-pre-line">{message}</div>}

      <div className="mt-3 text-sm text-gray-600">
        <a
          href="https://github.com/bkbros/google-to-notion-automation/actions"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline"
        >
          📊 GitHub Actions에서 실행 상태 확인하기
        </a>
      </div>
    </div>
  );
}
