// "use client";

// import { useState } from "react";

// type VerificationStats = {
//   total: number;
//   registered: number;
//   unregistered: number;
//   errors: number;
// };

// export default function SheetsVerification() {
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState<string | null>(null);
//   const [result, setResult] = useState<{
//     success: boolean;
//     statistics: VerificationStats;
//     message: string;
//   } | null>(null);

//   // 폼 상태
//   const [spreadsheetId, setSpreadsheetId] = useState("1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg");
//   const [sheetName, setSheetName] = useState("Smore-5pURyYjo8l-HRG");
//   const [serviceAccountKey, setServiceAccountKey] = useState("");
//   const [useEnvCredentials, setUseEnvCredentials] = useState(true);

//   const handleVerification = async () => {
//     if (!spreadsheetId) {
//       setError("스프레드시트 ID를 입력하세요");
//       return;
//     }

//     if (!useEnvCredentials && !serviceAccountKey) {
//       setError("서비스 계정 키를 입력하세요");
//       return;
//     }

//     setLoading(true);
//     setError(null);
//     setResult(null);

//     try {
//       console.log("회원 검증 시작:", {
//         spreadsheetId,
//         sheetName,
//         useEnvCredentials,
//         hasServiceAccountKey: !!serviceAccountKey
//       });

//       const response = await fetch("/api/sheets/verify-members/start", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           spreadsheetId,
//           sheetName,
//           serviceAccountKey: useEnvCredentials ? undefined : serviceAccountKey,
//           useEnvCredentials,
//         }),
//       });

//       console.log("API 응답 상태:", response.status);

//       if (!response.ok) {
//         const errorText = await response.text();
//         console.error("API 에러 응답:", errorText);
//         let errorData;
//         try {
//           errorData = JSON.parse(errorText);
//         } catch {
//           throw new Error(`API 요청 실패 (${response.status}): ${errorText}`);
//         }
//         throw new Error(errorData.error || "검증 요청 실패");
//       }

//       const data = await response.json();
//       console.log("API 성공 응답:", data);
//       setResult(data);
//     } catch (err) {
//       console.error("검증 에러:", err);
//       setError(err instanceof Error ? err.message : "알 수 없는 오류 발생");
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
//       <h2 className="text-2xl font-bold mb-6 text-center">📊 회원 정보 검증</h2>
//       <p className="text-gray-600 mb-6 text-center">
//         Google Sheets의 회원 목록을 Cafe24 API로 검증하여 가입 여부와 구매 정보를 확인합니다.
//       </p>

//       <div className="space-y-4 mb-6">
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             스프레드시트 ID *
//           </label>
//           <input
//             type="text"
//             value={spreadsheetId}
//             onChange={(e) => setSpreadsheetId(e.target.value)}
//             placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
//             className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
//           />
//           <p className="text-xs text-gray-500 mt-1">
//             URL에서 /d/ 다음 부분만 입력하세요
//           </p>
//         </div>

//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             시트 이름
//           </label>
//           <input
//             type="text"
//             value={sheetName}
//             onChange={(e) => setSheetName(e.target.value)}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
//           />
//           <p className="text-xs text-gray-500 mt-1">
//             스프레드시트 하단의 탭 이름 (예: Smore-5pURyYjo8l-HRG)
//           </p>
//         </div>

//         <div>
//           <div className="flex items-center mb-3">
//             <input
//               type="checkbox"
//               id="useEnvCredentials"
//               checked={useEnvCredentials}
//               onChange={(e) => setUseEnvCredentials(e.target.checked)}
//               className="mr-2"
//             />
//             <label htmlFor="useEnvCredentials" className="text-sm font-medium text-gray-700">
//               환경변수의 Google 인증 정보 사용
//             </label>
//           </div>

//           {!useEnvCredentials && (
//             <>
//               <label className="block text-sm font-medium text-gray-700 mb-2">
//                 Google Service Account Key (JSON) *
//               </label>
//               <textarea
//                 value={serviceAccountKey}
//                 onChange={(e) => setServiceAccountKey(e.target.value)}
//                 placeholder='{"type": "service_account", "project_id": "...", ...}'
//                 rows={6}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
//               />
//               <p className="text-xs text-gray-500 mt-1">
//                 Google Cloud Console에서 생성한 서비스 계정 JSON 키를 붙여넣으세요
//               </p>
//             </>
//           )}
//         </div>
//       </div>

//       <div className="mb-6">
//         <h3 className="text-lg font-semibold mb-3">📋 스프레드시트 형식</h3>
//         <div className="bg-gray-50 p-4 rounded-lg">
//           <p className="text-sm text-gray-700 mb-2">읽기 대상:</p>
//           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
//             <div>
//               <h4 className="font-medium">입력 데이터</h4>
//               <ul className="text-xs text-gray-600">
//                 <li>• I열: 이름</li>
//                 <li>• J열: 연락처</li>
//               </ul>
//             </div>
//             <div>
//               <h4 className="font-medium">출력 위치 (AC~AG열)</h4>
//               <ul className="text-xs text-gray-600">
//                 <li>• AC: 회원ID</li>
//                 <li>• AD: 가입여부 (O/X)</li>
//                 <li>• AE: 회원등급</li>
//                 <li>• AF: 가입일</li>
//                 <li>• AG: 총구매금액</li>
//               </ul>
//             </div>
//           </div>
//         </div>
//       </div>

//       <button
//         onClick={handleVerification}
//         disabled={loading}
//         className={`w-full py-3 px-4 rounded-md text-white font-semibold ${
//           loading
//             ? "bg-gray-400 cursor-not-allowed"
//             : "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
//         }`}
//       >
//         {loading ? "검증 중..." : "회원 정보 검증 시작"}
//       </button>

//       {error && (
//         <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
//           <p className="text-red-600">❌ {error}</p>
//         </div>
//       )}

//       {result && (
//         <div className="mt-6 space-y-4">
//           <div className="p-4 bg-green-50 border border-green-200 rounded-md">
//             <p className="text-green-700 font-semibold">✅ {result.message}</p>
//           </div>

//           <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
//             <div className="bg-blue-50 p-4 rounded-lg text-center">
//               <div className="text-2xl font-bold text-blue-600">
//                 {result.statistics.total}
//               </div>
//               <div className="text-sm text-blue-800">전체</div>
//             </div>
//             <div className="bg-green-50 p-4 rounded-lg text-center">
//               <div className="text-2xl font-bold text-green-600">
//                 {result.statistics.registered}
//               </div>
//               <div className="text-sm text-green-800">가입됨</div>
//             </div>
//             <div className="bg-yellow-50 p-4 rounded-lg text-center">
//               <div className="text-2xl font-bold text-yellow-600">
//                 {result.statistics.unregistered}
//               </div>
//               <div className="text-sm text-yellow-800">미가입</div>
//             </div>
//             <div className="bg-red-50 p-4 rounded-lg text-center">
//               <div className="text-2xl font-bold text-red-600">
//                 {result.statistics.errors}
//               </div>
//               <div className="text-sm text-red-800">오류</div>
//             </div>
//           </div>

//           <div className="p-4 bg-gray-50 rounded-lg">
//             <p className="text-sm text-gray-700">
//               📝 검증 결과가 AC~AG열에 저장되었습니다.
//             </p>
//             <p className="text-xs text-gray-600 mt-1">
//               AC: 회원ID, AD: 가입여부, AE: 회원등급, AF: 가입일, AG: 총구매금액
//             </p>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }

"use client";

import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";

type VerificationStats = {
  total: number;
  registered: number;
  unregistered: number;
  errors: number;
};

type BatchResponse = {
  success: boolean;
  message: string;
  statistics: VerificationStats;
  nextStartRow: number | null;
  processedRange?: { startRow: number; endRow: number };
  used?: { limit: number; concurrency: number };
};

export default function SheetsVerification() {
  // UI 상태
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // 마지막 배치 응답 & 누적 통계
  const [lastBatch, setLastBatch] = useState<BatchResponse | null>(null);
  const [aggStats, setAggStats] = useState<VerificationStats>({
    total: 0,
    registered: 0,
    unregistered: 0,
    errors: 0,
  });

  // 폼 상태 (기본값 포함)
  const [spreadsheetId, setSpreadsheetId] = useState("1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg");
  const [sheetName, setSheetName] = useState("Smore-5pURyYjo8l-HRG");
  const [shopNo, setShopNo] = useState<number>(1);

  const [serviceAccountKey, setServiceAccountKey] = useState("");
  const [useEnvCredentials, setUseEnvCredentials] = useState(true);

  // 배치 제어 파라미터
  const [startRow, setStartRow] = useState<number>(2); // 헤더 다음행
  const [limit, setLimit] = useState<number>(100); // 배치 크기
  const [concurrency, setConcurrency] = useState<number>(2); // 동시성

  // 진행률(총 행수를 모를 수 있어 누적 처리건만 표시)
  const processedSoFar = useMemo(() => aggStats.total, [aggStats]);

  const addLog = useCallback((line: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  const resetAll = useCallback(() => {
    setLoading(false);
    cancelRef.current = false;
    setError(null);
    setLogs([]);
    setLastBatch(null);
    setAggStats({ total: 0, registered: 0, unregistered: 0, errors: 0 });
  }, []);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    addLog("사용자 취소 요청됨. 현재 배치가 끝나면 중단합니다.");
  }, [addLog]);

  const runOneBatch = useCallback(
    async (cursorStartRow: number): Promise<BatchResponse> => {
      const res = await fetch("/api/sheets/verify-members/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId,
          sheetName,
          serviceAccountKey: useEnvCredentials ? undefined : serviceAccountKey,
          useEnvCredentials,
          shopNo,
          startRow: cursorStartRow,
          limit,
          concurrency,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = `API ${res.status}`;
        try {
          const j = JSON.parse(text);
          msg = j.error || msg;
        } catch {
          /* noop */
        }
        throw new Error(msg);
      }

      const data = (await res.json()) as BatchResponse;
      return data;
    },
    [spreadsheetId, sheetName, useEnvCredentials, serviceAccountKey, shopNo, limit, concurrency],
  );

  const handleRunAll = useCallback(async () => {
    // 검증
    if (!spreadsheetId) {
      setError("스프레드시트 ID를 입력하세요");
      return;
    }
    if (!useEnvCredentials && !serviceAccountKey) {
      setError("서비스 계정 키를 입력하세요");
      return;
    }

    // 초기화
    setError(null);
    cancelRef.current = false;
    setLoading(true);
    setLogs([]);
    setLastBatch(null);
    setAggStats({ total: 0, registered: 0, unregistered: 0, errors: 0 });

    addLog(`배치 시작: startRow=${startRow}, limit=${limit}, concurrency=${concurrency}, shopNo=${shopNo}`);

    let cursor = startRow;
    try {
      while (true) {
        if (cancelRef.current) break;

        addLog(`요청 → /start (startRow=${cursor})`);
        const batch = await runOneBatch(cursor);
        setLastBatch(batch);

        addLog(batch.message);
        if (batch.used) addLog(`사용한 설정: limit=${batch.used.limit}, concurrency=${batch.used.concurrency}`);
        if (batch.processedRange)
          addLog(`시트 반영 범위: AC${batch.processedRange.startRow}~AG${batch.processedRange.endRow}`);

        // 누적 통계 업데이트
        setAggStats(prev => ({
          total: prev.total + (batch.statistics?.total ?? 0),
          registered: prev.registered + (batch.statistics?.registered ?? 0),
          unregistered: prev.unregistered + (batch.statistics?.unregistered ?? 0),
          errors: prev.errors + (batch.statistics?.errors ?? 0),
        }));

        if (batch.nextStartRow == null) {
          addLog("더 이상 처리할 행이 없습니다. 종료합니다.");
          break;
        } else {
          cursor = batch.nextStartRow;
          await new Promise(r => setTimeout(r, 250)); // API 보호용 소폭 대기
        }
      }

      addLog(cancelRef.current ? "사용자 취소로 중단되었습니다." : "모든 배치 처리가 완료되었습니다.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(`오류: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [addLog, runOneBatch, startRow, limit, concurrency, shopNo, spreadsheetId, useEnvCredentials, serviceAccountKey]);

  // 숫자 입력 헬퍼(빈값/NaN 방지)
  const onNumberChange =
    (setter: (n: number) => void, fallback: number, min?: number, max?: number) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      let n = Number(e.currentTarget.value);
      if (!Number.isFinite(n)) n = fallback;
      if (min !== undefined) n = Math.max(min, n);
      if (max !== undefined) n = Math.min(max, n);
      setter(n);
    };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6 text-center">📊 회원 정보 검증 (배치 자동 실행)</h2>
      <p className="text-gray-600 mb-6 text-center">
        Google Sheets의 회원 목록을 Cafe24 API로 검증합니다. 대량 데이터는 startRow/limit로 배치 처리하며 자동
        루프합니다.
      </p>

      {/* 폼 */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">스프레드시트 ID *</label>
          <input
            type="text"
            value={spreadsheetId}
            onChange={e => setSpreadsheetId(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">URL에서 /d/ 다음 부분만 입력하세요</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">시트 이름</label>
            <input
              type="text"
              value={sheetName}
              onChange={e => setSheetName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Shop No</label>
            <input
              type="number"
              value={shopNo}
              onChange={onNumberChange(setShopNo, 1, 1)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              min={1}
            />
          </div>
        </div>

        <div className="rounded-md border p-3">
          <div className="flex items-center mb-3">
            <input
              type="checkbox"
              id="useEnvCredentials"
              checked={useEnvCredentials}
              onChange={e => setUseEnvCredentials(e.target.checked)}
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
                onChange={e => setServiceAccountKey(e.target.value)}
                placeholder='{"type": "service_account", "project_id": "...", ...}'
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
            </>
          )}
        </div>

        {/* 배치 옵션 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">시작 행 (startRow)</label>
            <input
              type="number"
              value={startRow}
              onChange={onNumberChange(setStartRow, 2, 2)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              min={2}
            />
            <p className="text-xs text-gray-500 mt-1">헤더 다음이 2</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">배치 크기 (limit)</label>
            <input
              type="number"
              value={limit}
              onChange={onNumberChange(setLimit, 100, 1, 200)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              min={1}
              max={200}
            />
            <p className="text-xs text-gray-500 mt-1">권장 80~120</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">동시성 (concurrency)</label>
            <input
              type="number"
              value={concurrency}
              onChange={onNumberChange(setConcurrency, 2, 1, 5)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              min={1}
              max={5}
            />
            <p className="text-xs text-gray-500 mt-1">권장 2~3</p>
          </div>
        </div>
      </div>

      {/* 컨트롤 버튼 */}
      <div className="flex gap-3">
        <button
          onClick={handleRunAll}
          disabled={loading}
          className={`flex-1 py-3 px-4 rounded-md text-white font-semibold ${
            loading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {loading ? "실행 중..." : "배치 실행 (끝까지 자동 진행)"}
        </button>

        <button
          onClick={loading ? handleCancel : resetAll}
          className={`px-4 py-3 rounded-md font-semibold ${
            loading ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-gray-100 hover:bg-gray-200"
          }`}
        >
          {loading ? "중단" : "초기화"}
        </button>
      </div>

      {/* 진행 상태 */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-blue-600">{processedSoFar}</div>
          <div className="text-sm text-blue-800">누적 처리 행</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-600">{aggStats.registered}</div>
          <div className="text-sm text-green-800">가입(⭕)</div>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-yellow-600">{aggStats.unregistered}</div>
          <div className="text-sm text-yellow-800">미가입(❌)</div>
        </div>
        <div className="bg-red-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-red-600">{aggStats.errors}</div>
          <div className="text-sm text-red-800">오류</div>
        </div>
      </div>

      {/* 마지막 배치 요약 */}
      {lastBatch && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-md">
          <p className="text-green-700 font-semibold">✅ {lastBatch.message}</p>
          {lastBatch.nextStartRow != null ? (
            <p className="text-sm text-green-700 mt-1">다음 시작 행: {lastBatch.nextStartRow}</p>
          ) : (
            <p className="text-sm text-green-700 mt-1">모든 배치 완료</p>
          )}
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-600">❌ {error}</p>
        </div>
      )}

      {/* 로그 */}
      {logs.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-2">실행 로그</h3>
          <div className="bg-gray-50 p-3 rounded-md h-48 overflow-auto text-sm font-mono">
            {logs.map((l, i) => (
              <div key={i} className="text-gray-700">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 안내 */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-700">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            이 컴포넌트는 서버 라우트 <code>/api/sheets/verify-members/start</code> 를 배치로 여러 번 호출합니다.
          </li>
          <li>
            배치마다 시트의 AC~AG만 “부분 저장”하고, 다음 시작 행을 응답(<code>nextStartRow</code>)으로 받습니다.
          </li>
          <li>
            Cafe24 레이트리밋이 잦으면 <b>limit</b> 또는 <b>concurrency</b>를 낮춰서 실행하세요.
          </li>
          <li>
            중간에 멈춰도, <b>startRow</b>를 마지막 <b>nextStartRow</b>로 넣고 다시 실행하면 이어서 진행돼요.
          </li>
        </ul>
      </div>
    </div>
  );
}
