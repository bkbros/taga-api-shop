// "use client";

// import SyncButton from "components/SyncButton";
// import { useState } from "react";

// type SyncStatus = {
//   status: "RUNNING" | "SUCCEEDED" | "FAILED";
// };

// export default function SuccessPage() {
//   const [error, setError] = useState<string | null>(null);
//   const [msg, setMsg] = useState<string>();
//   const [loading, setLoading] = useState<boolean>(false);

//   const handleSync = async () => {
//     setError(null);
//     setMsg(undefined);
//     setLoading(true);

//     try {
//       // 1) 실행 시작
//       const res = await fetch("/api/trigger-sync");
//       if (!res.ok) throw new Error("동기화 시작에 실패했습니다.");
//       const { executionArn } = (await res.json()) as { executionArn: string };

//       // 2) 폴링
//       let json: SyncStatus;
//       do {
//         await new Promise(r => setTimeout(r, 2000)); // 2초 대기
//         const st = await fetch(`/api/sync-status?arn=${executionArn}`);
//         if (!st.ok) throw new Error("상태 조회에 실패했습니다.");
//         json = (await st.json()) as SyncStatus;
//       } while (json.status === "RUNNING");

//       // 3) 완료 메시지
//       setMsg(`✅ 동기화 완료!`);
//     } catch (err: unknown) {
//       setError(err instanceof Error ? err.message : String(err));
//     } finally {
//       // 무조건 로딩 해제
//       setLoading(false);
//     }
//   };

//   return (
//     <main className="flex flex-col items-center justify-center min-h-screen p-10">
//       <h1 className="text-2xl font-bold mb-4">연결이 완료되었습니다!</h1>
//       <p className="text-gray-700 mb-6">카페24 관리자 API 연동이 성공적으로 설정되었습니다.</p>

//       <button
//         onClick={handleSync}
//         disabled={loading}
//         className={`mb-4 px-4 py-2 text-white rounded
//           ${loading ? "bg-gray-400 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-300"}`}
//       >
//         {loading ? "동기화 중..." : "스프레드시트 동기화"}
//       </button>

//       {msg && <p className="mt-4 text-green-600">{msg}</p>}
//       {error && <p className="mt-4 text-red-600">에러: {error}</p>}

//       <section className="mt-12 p-6 bg-white rounded-lg shadow-lg border">
//         <h2 className="text-2xl font-semibold mb-4 text-center">📊 데이터 동기화</h2>
//         <p className="text-gray-600 text-center mb-6">Google Sheets의 데이터를 Notion으로 자동 동기화합니다.</p>
//         <SyncButton />
//       </section>
//     </main>
//   );
// }
"use client";

import SyncButton from "components/SyncButton";
import { useState } from "react";

type SyncStatus = {
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
};

export default function SuccessPage() {
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>();
  const [loading, setLoading] = useState<boolean>(false);

  // 기존 AWS Step Functions 동기화
  const handleAwsSync = async () => {
    setError(null);
    setMsg(undefined);
    setLoading(true);

    try {
      // 1) 실행 시작 (기존 AWS Step Functions)
      const res = await fetch("/api/trigger-sync");
      if (!res.ok) throw new Error("동기화 시작에 실패했습니다.");
      const { executionArn } = (await res.json()) as { executionArn: string };

      // 2) 폴링
      let json: SyncStatus;
      do {
        await new Promise(r => setTimeout(r, 2000)); // 2초 대기
        const st = await fetch(`/api/sync-status?arn=${executionArn}`);
        if (!st.ok) throw new Error("상태 조회에 실패했습니다.");
        json = (await st.json()) as SyncStatus;
      } while (json.status === "RUNNING");

      // 3) 완료 메시지
      setMsg(`✅ AWS 동기화 완료!`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // 무조건 로딩 해제
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-10">
      <h1 className="text-2xl font-bold mb-4">연결이 완료되었습니다!</h1>
      <p className="text-gray-700 mb-6">카페24 관리자 API 연동이 성공적으로 설정되었습니다.</p>

      {/* 기존 AWS Step Functions 동기화 */}
      <div className="mb-8 p-6 bg-yellow-50 rounded-lg border border-yellow-200">
        <h3 className="text-lg font-semibold mb-4">🟡 AWS 스프레드시트 동기화</h3>
        <button
          onClick={handleAwsSync}
          disabled={loading}
          className={`mb-4 px-4 py-2 text-white rounded
            ${loading ? "bg-gray-400 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-300"}`}
        >
          {loading ? "AWS 동기화 중..." : "AWS 스프레드시트 동기화"}
        </button>

        {msg && <p className="mt-4 text-green-600">{msg}</p>}
        {error && <p className="mt-4 text-red-600">에러: {error}</p>}
      </div>

      {/* 새로운 GitHub Actions 동기화 */}
      <section className="mt-4 p-6 bg-blue-50 rounded-lg shadow-lg border border-blue-200">
        <h2 className="text-2xl font-semibold mb-4 text-center">🔵 GitHub Actions 데이터 동기화</h2>
        <p className="text-gray-600 text-center mb-6">
          Google Sheets의 데이터를 GitHub Actions를 통해 Notion으로 자동 동기화합니다.
        </p>
        <SyncButton />
      </section>
    </main>
  );
}
