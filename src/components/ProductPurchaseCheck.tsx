"use client";

import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";

// 열 문자를 숫자로 변환 (A=1, B=2, ..., Z=26, AA=27, AB=28, ...)
function columnLetterToNumber(col: string): number {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

// 숫자를 열 문자로 변환 (1=A, 2=B, ..., 26=Z, 27=AA, 28=AB, ...)
function getColumnLetter(num: number): string {
  let letter = "";
  while (num > 0) {
    const mod = (num - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    num = Math.floor((num - 1) / 26);
  }
  return letter;
}

type VerificationStats = {
  total: number;
  hasPurchased: number;
  notPurchased: number;
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

export default function ProductPurchaseCheck() {
  // UI 상태
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // 마지막 배치 응답 & 누적 통계
  const [lastBatch, setLastBatch] = useState<BatchResponse | null>(null);
  const [aggStats, setAggStats] = useState<VerificationStats>({
    total: 0,
    hasPurchased: 0,
    notPurchased: 0,
    errors: 0,
  });

  // 폼 상태 (기본값 포함)
  const [spreadsheetId, setSpreadsheetId] = useState("1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg");
  const [sheetName, setSheetName] = useState("Smore-5pURyYjo8l-HRG");
  const [memberIdColumn, setMemberIdColumn] = useState("AC");
  const [outputStartColumn, setOutputStartColumn] = useState("AH");
  const [shopNo, setShopNo] = useState<number>(1);

  // 상품 조회 관련
  const [productNos, setProductNos] = useState(""); // 상품 번호들 (쉼표로 구분)
  const [startDate, setStartDate] = useState(""); // YYYY-MM-DD
  const [endDate, setEndDate] = useState(""); // YYYY-MM-DD
  const [orderStatus, setOrderStatus] = useState("N40,N50"); // 기본: 배송완료/구매확정

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
    setAggStats({ total: 0, hasPurchased: 0, notPurchased: 0, errors: 0 });
  }, []);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    addLog("사용자 취소 요청됨. 현재 배치가 끝나면 중단합니다.");
  }, [addLog]);

  const runOneBatch = useCallback(
    async (cursorStartRow: number): Promise<BatchResponse> => {
      const body: Record<string, unknown> = {
        spreadsheetId,
        sheetName,
        memberIdColumn,
        outputStartColumn,
        productNos,
        serviceAccountKey: useEnvCredentials ? undefined : serviceAccountKey,
        useEnvCredentials,
        shopNo,
        startRow: cursorStartRow,
        limit,
        concurrency,
        orderStatus,
      };

      // 선택적 날짜 추가
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;

      const res = await fetch("/api/sheets/check-product-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    [
      spreadsheetId,
      sheetName,
      memberIdColumn,
      outputStartColumn,
      productNos,
      useEnvCredentials,
      serviceAccountKey,
      shopNo,
      limit,
      concurrency,
      startDate,
      endDate,
      orderStatus,
    ],
  );

  const handleRunAll = useCallback(async () => {
    // 검증
    if (!spreadsheetId) {
      setError("스프레드시트 ID를 입력하세요");
      return;
    }
    if (!memberIdColumn) {
      setError("회원 ID 열을 입력하세요 (예: AC)");
      return;
    }
    if (!outputStartColumn) {
      setError("출력 시작 열을 입력하세요 (예: AH)");
      return;
    }
    if (!productNos) {
      setError("상품 번호를 입력하세요 (쉼표로 구분)");
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
    setAggStats({ total: 0, hasPurchased: 0, notPurchased: 0, errors: 0 });

    addLog(
      `배치 시작: startRow=${startRow}, limit=${limit}, concurrency=${concurrency}, shopNo=${shopNo}, productNos=${productNos}`,
    );
    if (startDate || endDate) {
      addLog(`조회 기간: ${startDate || "3개월 전"} ~ ${endDate || "오늘"}`);
    }

    let cursor = startRow;
    try {
      while (true) {
        if (cancelRef.current) break;

        addLog(`요청 → /check-product-purchases (startRow=${cursor})`);
        const batch = await runOneBatch(cursor);
        setLastBatch(batch);

        addLog(batch.message);
        if (batch.used) addLog(`사용한 설정: limit=${batch.used.limit}, concurrency=${batch.used.concurrency}`);
        if (batch.processedRange) {
          const colStart = outputStartColumn.toUpperCase();
          const colEnd = getColumnLetter(columnLetterToNumber(colStart) + 3);
          addLog(`시트 반영 범위: ${colStart}${batch.processedRange.startRow}~${colEnd}${batch.processedRange.endRow}`);
        }

        // 누적 통계 업데이트
        setAggStats(prev => ({
          total: prev.total + (batch.statistics?.total ?? 0),
          hasPurchased: prev.hasPurchased + (batch.statistics?.hasPurchased ?? 0),
          notPurchased: prev.notPurchased + (batch.statistics?.notPurchased ?? 0),
          errors: prev.errors + (batch.statistics?.errors ?? 0),
        }));

        if (batch.nextStartRow == null) {
          addLog("더 이상 처리할 행이 없습니다. 종료합니다.");
          break;
        } else {
          cursor = batch.nextStartRow;
          await new Promise(r => setTimeout(r, 500)); // API 보호용 대기
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
  }, [
    addLog,
    runOneBatch,
    startRow,
    limit,
    concurrency,
    shopNo,
    spreadsheetId,
    memberIdColumn,
    outputStartColumn,
    productNos,
    useEnvCredentials,
    serviceAccountKey,
    startDate,
    endDate,
  ]);

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
      <h2 className="text-2xl font-bold mb-6 text-center">🛒 상품 구매 확인 (배치 자동 실행)</h2>
      <p className="text-gray-600 mb-6 text-center">
        Google Sheets의 회원 ID 목록을 읽어 특정 상품 구매 여부를 Cafe24 API로 확인합니다.
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">회원 ID 열 *</label>
            <input
              type="text"
              value={memberIdColumn}
              onChange={e => setMemberIdColumn(e.target.value.toUpperCase())}
              placeholder="AC"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">회원 ID가 있는 열 (예: A, AC, Z)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">출력 시작 열 *</label>
            <input
              type="text"
              value={outputStartColumn}
              onChange={e => setOutputStartColumn(e.target.value.toUpperCase())}
              placeholder="AH"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">결과를 쓸 시작 열 (예: AH, Z, AA)</p>
          </div>
        </div>

        {/* 상품 조회 설정 */}
        <div className="border-t pt-4">
          <h3 className="text-lg font-semibold mb-3">📦 상품 조회 설정</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">상품 번호 *</label>
            <input
              type="text"
              value={productNos}
              onChange={e => setProductNos(e.target.value)}
              placeholder="123,456,789"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">확인할 상품 번호들을 쉼표로 구분 (예: 123,456,789)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">시작일 (선택)</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">비우면 3개월 전부터</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">종료일 (선택)</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">비우면 오늘까지</p>
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">주문 상태 필터 (선택)</label>
            <input
              type="text"
              value={orderStatus}
              onChange={e => setOrderStatus(e.target.value)}
              placeholder="N40,N50"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              N40=배송완료, N50=구매확정 (기본: N40,N50, 전체 조회: 비우기)
            </p>
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
          <div className="text-2xl font-bold text-green-600">{aggStats.hasPurchased}</div>
          <div className="text-sm text-green-800">구매함(⭕)</div>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-yellow-600">{aggStats.notPurchased}</div>
          <div className="text-sm text-yellow-800">미구매(❌)</div>
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
        <h4 className="font-semibold mb-2">📌 출력 열 정보</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>{outputStartColumn}</b>: 지정 상품 구매 목록 (지정한 상품 중 실제 구매한 상품명)
          </li>
          <li>
            <b>{getColumnLetter(columnLetterToNumber(outputStartColumn) + 1)}</b>: 전체 구매 총 수량 (지정 기간 내
            모든 상품)
          </li>
          <li>
            <b>{getColumnLetter(columnLetterToNumber(outputStartColumn) + 2)}</b>: 전체 주문 건수 (지정 기간 내 모든
            주문)
          </li>
          <li>
            <b>{getColumnLetter(columnLetterToNumber(outputStartColumn) + 3)}</b>: 전체 구매 상품 목록 (기간 내 구매한
            모든 상품명, 최대 10개)
          </li>
          <li>
            <b>{getColumnLetter(columnLetterToNumber(outputStartColumn) + 4)}</b>: 전체 구매 금액 (지정 기간 내 모든
            주문 금액 합계)
          </li>
        </ul>
        <h4 className="font-semibold mt-4 mb-2">📊 출력 예시</h4>
        <div className="bg-white p-3 rounded border text-xs overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-1">{outputStartColumn}</th>
                <th className="text-left p-1">{getColumnLetter(columnLetterToNumber(outputStartColumn) + 1)}</th>
                <th className="text-left p-1">{getColumnLetter(columnLetterToNumber(outputStartColumn) + 2)}</th>
                <th className="text-left p-1">{getColumnLetter(columnLetterToNumber(outputStartColumn) + 3)}</th>
                <th className="text-left p-1">{getColumnLetter(columnLetterToNumber(outputStartColumn) + 4)}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="p-1">상품A, 상품B</td>
                <td className="p-1">12</td>
                <td className="p-1">5</td>
                <td className="p-1">상품A, 상품B, 상품C, 상품D</td>
                <td className="p-1">150000</td>
              </tr>
              <tr>
                <td className="p-1">없음</td>
                <td className="p-1">8</td>
                <td className="p-1">3</td>
                <td className="p-1">상품X, 상품Y, 상품Z</td>
                <td className="p-1">85000</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h4 className="font-semibold mt-4 mb-2">💡 사용 팁</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>회원 정보 검증 후 AC 열에 회원ID가 있어야 합니다.</li>
          <li>상품 번호는 Cafe24 관리자에서 확인할 수 있습니다.</li>
          <li>기간을 지정하지 않으면 최근 3개월 데이터를 조회합니다.</li>
          <li>Cafe24 레이트리밋이 잦으면 concurrency를 낮춰서 실행하세요.</li>
          <li>
            <b>AI, AJ, AL 열</b>은 지정한 상품과 무관하게 해당 기간 동안의 <b>전체 구매 통계</b>입니다.
          </li>
        </ul>
      </div>
    </div>
  );
}
