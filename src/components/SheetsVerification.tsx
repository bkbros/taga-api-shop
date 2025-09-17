"use client";

import { useState } from "react";

type VerificationStats = {
  total: number;
  registered: number;
  unregistered: number;
  errors: number;
};

export default function SheetsVerification() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    statistics: VerificationStats;
    message: string;
  } | null>(null);

  // 폼 상태
  const [spreadsheetId, setSpreadsheetId] = useState("1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg");
  const [sheetId, setSheetId] = useState("37633012");
  const [serviceAccountKey, setServiceAccountKey] = useState("");
  const [useEnvCredentials, setUseEnvCredentials] = useState(true);

  const handleVerification = async () => {
    if (!spreadsheetId || (!useEnvCredentials && !serviceAccountKey)) {
      setError("스프레드시트 ID와 서비스 계정 키를 입력하세요");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/sheets/verify-members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetId,
          sheetId: parseInt(sheetId),
          serviceAccountKey: useEnvCredentials ? undefined : serviceAccountKey,
          useEnvCredentials,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "검증 요청 실패");
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류 발생");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6 text-center">📊 회원 정보 검증</h2>
      <p className="text-gray-600 mb-6 text-center">
        Google Sheets의 회원 목록을 Cafe24 API로 검증하여 가입 여부와 구매 정보를 확인합니다.
      </p>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            스프레드시트 ID *
          </label>
          <input
            type="text"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            URL에서 /d/ 다음 부분만 입력하세요
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            시트 ID (gid)
          </label>
          <input
            type="text"
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            URL의 gid= 다음 숫자 (예: gid=37633012)
          </p>
        </div>

        <div>
          <div className="flex items-center mb-3">
            <input
              type="checkbox"
              id="useEnvCredentials"
              checked={useEnvCredentials}
              onChange={(e) => setUseEnvCredentials(e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="useEnvCredentials" className="text-sm font-medium text-gray-700">
              환경변수의 Google 인증 정보 사용
            </label>
          </div>

          {!useEnvCredentials && (
            <>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Google Service Account Key (JSON) *
              </label>
              <textarea
                value={serviceAccountKey}
                onChange={(e) => setServiceAccountKey(e.target.value)}
                placeholder='{"type": "service_account", "project_id": "...", ...}'
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Google Cloud Console에서 생성한 서비스 계정 JSON 키를 붙여넣으세요
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">📋 스프레드시트 형식</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-700 mb-2">읽기 대상:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <h4 className="font-medium">입력 데이터</h4>
              <ul className="text-xs text-gray-600">
                <li>• I열: 이름</li>
                <li>• J열: 연락처</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium">출력 위치 (AC~AG열)</h4>
              <ul className="text-xs text-gray-600">
                <li>• AC: 회원ID</li>
                <li>• AD: 가입여부 (O/X)</li>
                <li>• AE: 회원등급</li>
                <li>• AF: 가입일</li>
                <li>• AG: 총구매금액</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleVerification}
        disabled={loading}
        className={`w-full py-3 px-4 rounded-md text-white font-semibold ${
          loading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        }`}
      >
        {loading ? "검증 중..." : "회원 정보 검증 시작"}
      </button>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-600">❌ {error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-green-700 font-semibold">✅ {result.message}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">
                {result.statistics.total}
              </div>
              <div className="text-sm text-blue-800">전체</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600">
                {result.statistics.registered}
              </div>
              <div className="text-sm text-green-800">가입됨</div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {result.statistics.unregistered}
              </div>
              <div className="text-sm text-yellow-800">미가입</div>
            </div>
            <div className="bg-red-50 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-red-600">
                {result.statistics.errors}
              </div>
              <div className="text-sm text-red-800">오류</div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-700">
              📝 검증 결과가 AC~AG열에 저장되었습니다.
            </p>
            <p className="text-xs text-gray-600 mt-1">
              AC: 회원ID, AD: 가입여부, AE: 회원등급, AF: 가입일, AG: 총구매금액
            </p>
          </div>
        </div>
      )}
    </div>
  );
}