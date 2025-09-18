"use client";

import { useState, useRef } from "react";
import { startVerificationJob, pollJobUntilComplete, formatTime, type JobStatus } from "@/lib/async-job-client";

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

  // 진행률 상태 추가
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 폼 상태
  const [spreadsheetId, setSpreadsheetId] = useState("1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg");
  const [sheetName, setSheetName] = useState("Smore-5pURyYjo8l-HRG");
  const [serviceAccountKey, setServiceAccountKey] = useState("");
  const [useEnvCredentials, setUseEnvCredentials] = useState(true);

  const handleVerification = async () => {
    if (!spreadsheetId) {
      setError("스프레드시트 ID를 입력하세요");
      return;
    }

    if (!useEnvCredentials && !serviceAccountKey) {
      setError("서비스 계정 키를 입력하세요");
      return;
    }

    // 기존 작업 취소
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setIsPolling(true);
    setError(null);
    setResult(null);
    setJobStatus(null);

    try {
      console.log("비동기 회원 검증 작업 시작:", {
        spreadsheetId,
        sheetName,
        useEnvCredentials,
        hasServiceAccountKey: !!serviceAccountKey
      });

      // 1. 비동기 작업 시작
      const startResponse = await startVerificationJob({
        spreadsheetId,
        sheetName,
        serviceAccountKey: useEnvCredentials ? undefined : serviceAccountKey,
        useEnvCredentials,
      });

      console.log("작업 시작됨:", startResponse);
      setLoading(false); // 작업이 시작되었으므로 로딩 해제

      // 2. 진행률 폴링 시작
      const finalStatus = await pollJobUntilComplete(
        startResponse.jobId,
        (status: JobStatus) => {
          setJobStatus(status);
          console.log(`진행률: ${status.progress}% (${status.current}/${status.total}) - ${status.message}`);
        }
      );

      // 3. 완료 시 결과 설정
      if (finalStatus.result) {
        const statistics = finalStatus.result as VerificationStats;
        setResult({
          success: true,
          statistics,
          message: `검증 완료: 총 ${statistics.total}명 처리 (가입 ${statistics.registered}명, 미가입 ${statistics.unregistered}명)`
        });
      }

      console.log("회원 검증 완료:", finalStatus.result);
    } catch (err) {
      console.error("검증 에러:", err);
      setError(err instanceof Error ? err.message : "알 수 없는 오류 발생");
    } finally {
      setLoading(false);
      setIsPolling(false);
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setLoading(false);
    setIsPolling(false);
    setJobStatus(null);
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
            시트 이름
          </label>
          <input
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            스프레드시트 하단의 탭 이름 (예: Smore-5pURyYjo8l-HRG)
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

      <div className="space-y-3">
        <button
          onClick={handleVerification}
          disabled={loading || isPolling}
          className={`w-full py-3 px-4 rounded-md text-white font-semibold ${
            loading || isPolling
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          }`}
        >
          {loading ? "작업 시작 중..." : isPolling ? "검증 진행 중..." : "회원 정보 검증 시작"}
        </button>

        {isPolling && (
          <button
            onClick={handleCancel}
            className="w-full py-2 px-4 rounded-md text-red-600 border border-red-300 hover:bg-red-50"
          >
            작업 취소
          </button>
        )}
      </div>

      {/* 진행률 표시 */}
      {jobStatus && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-blue-800">검증 진행 상황</h3>
            <span className="text-sm text-blue-600">
              {jobStatus.status === 'running' ? '🔄 진행 중' :
               jobStatus.status === 'completed' ? '✅ 완료' :
               jobStatus.status === 'failed' ? '❌ 실패' : '⏳ 대기 중'}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{jobStatus.current}/{jobStatus.total}</span>
              <span>{jobStatus.progress}%</span>
            </div>

            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${jobStatus.progress}%` }}
              ></div>
            </div>

            <p className="text-sm text-blue-700">{jobStatus.message}</p>

            {jobStatus.elapsedTime > 0 && (
              <div className="text-xs text-blue-600 flex justify-between">
                <span>경과: {formatTime(jobStatus.elapsedTime)}</span>
                {jobStatus.estimatedRemainingTime > 0 && (
                  <span>예상 남은 시간: {formatTime(jobStatus.estimatedRemainingTime)}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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