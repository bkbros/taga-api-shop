"use client";

import SyncButton from "components/SyncButton";
import { useState } from "react";

type SyncStatus = {
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
};

type AllOrdersItem = {
  orderId: string;
  createdDate?: string;
  orderItemCode: string;
  productNo?: number | string;
  productName?: string;
  optionValue?: string;
  qty?: number;
};

type AllOrdersOrder = {
  order_id: string;
  created_date?: string;
  order_status?: string; // 몰/버전에 따라 다를 수 있으니 여유롭게
  status?: string;
};

type AllOrdersResponse = {
  totalOrders: number;
  totalItems: number;
  orders: AllOrdersOrder[];
  items: AllOrdersItem[];
};

type ProductRow = {
  productNo: string;
  name?: string;
  variants: string[]; // 포함된 옵션(고유값)
  totalQty: number; // 누적 수량
  ordersCount: number; // 주문 건수
  firstPurchased?: string; // YYYY-MM-DD
  lastPurchased?: string; // YYYY-MM-DD
};

const DEFAULT_ALLOWED_STATUSES = new Set(["DELIVERY_COMPLETE", "PURCHASE_CONFIRM"]);

function ymd(d?: string) {
  if (!d) return undefined;
  const t = new Date(d);
  if (Number.isNaN(+t)) return undefined;
  return t.toISOString().slice(0, 10);
}

/** 상품 리스트 집계(옵션 합산 or 옵션별) */
function buildProductList(
  data: AllOrdersResponse,
  opts?: {
    allowedStatuses?: Set<string>;
    from?: string; // "YYYY-MM-DD"
    to?: string; // "YYYY-MM-DD"
    groupByVariant?: boolean; // true=옵션별, false=상품단위 합산
    sortBy?: "lastPurchased" | "totalQty" | "ordersCount";
  },
): ProductRow[] {
  const {
    allowedStatuses = DEFAULT_ALLOWED_STATUSES,
    from,
    to,
    groupByVariant = false,
    sortBy = "lastPurchased",
  } = opts || {};

  // 주문 인덱스(상태/주문일)
  const orderIndex = new Map<string, { status?: string; date?: string }>();
  for (const o of data.orders || []) {
    const st = o.order_status ?? o.status;
    orderIndex.set(o.order_id, { status: st, date: o.created_date });
  }

  // 아이템 필터(상태·기간)
  const filtered = (data.items || []).filter(it => {
    if (!it.productNo) return false;
    const oi = orderIndex.get(it.orderId);
    // 상태 필터: 상태가 존재할 때만 적용(없으면 통과)
    if (oi?.status && !allowedStatuses.has(oi.status)) return false;

    const d = ymd(it.createdDate) || ymd(oi?.date);
    if (from && d && d < from) return false;
    if (to && d && d > to) return false;
    return true;
  });

  type Agg = {
    productNo: string;
    name?: string;
    variants: Set<string>;
    totalQty: number;
    orders: Set<string>;
    firstPurchased?: string;
    lastPurchased?: string;
  };
  const map = new Map<string, Agg>();

  for (const it of filtered) {
    const key = groupByVariant ? `${it.productNo}||${it.optionValue ?? ""}` : String(it.productNo);

    const d = ymd(it.createdDate) || ymd(orderIndex.get(it.orderId)?.date);
    const prev = map.get(key);

    if (!prev) {
      map.set(key, {
        productNo: String(it.productNo),
        name: it.productName,
        variants: new Set([it.optionValue || ""]),
        totalQty: Number(it.qty || 0),
        orders: new Set([it.orderId]),
        firstPurchased: d,
        lastPurchased: d,
      });
    } else {
      prev.totalQty += Number(it.qty || 0);
      prev.variants.add(it.optionValue || "");
      prev.orders.add(it.orderId);
      if (d) {
        if (!prev.firstPurchased || d < prev.firstPurchased) prev.firstPurchased = d;
        if (!prev.lastPurchased || d > prev.lastPurchased) prev.lastPurchased = d;
      }
    }
  }

  // 결과 + 정렬
  const rows: ProductRow[] = Array.from(map.values()).map(a => ({
    productNo: a.productNo,
    name: a.name,
    variants: Array.from(a.variants).filter(v => v !== ""),
    totalQty: a.totalQty,
    ordersCount: a.orders.size,
    firstPurchased: a.firstPurchased,
    lastPurchased: a.lastPurchased,
  }));

  rows.sort((a, b) => {
    switch (sortBy) {
      case "totalQty":
        return b.totalQty - a.totalQty;
      case "ordersCount":
        return b.ordersCount - a.ordersCount;
      case "lastPurchased":
      default:
        return (b.lastPurchased || "").localeCompare(a.lastPurchased || "");
    }
  });

  return rows;
}

export default function SuccessPage() {
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>();
  const [loading, setLoading] = useState<boolean>(false);

  const [raw, setRaw] = useState<AllOrdersResponse | null>(null); // 원본 응답
  const [products, setProducts] = useState<ProductRow[]>([]); // 집계 결과

  // (기존) AWS Step Functions 동기화 버튼
  const handleSync = async () => {
    setError(null);
    setMsg(undefined);
    setLoading(true);

    try {
      const res = await fetch("/api/trigger-sync");
      if (!res.ok) throw new Error("동기화 시작에 실패했습니다.");
      const { executionArn } = (await res.json()) as { executionArn: string };

      let json: SyncStatus;
      do {
        await new Promise(r => setTimeout(r, 2000));
        const st = await fetch(`/api/sync-status?arn=${executionArn}`);
        if (!st.ok) throw new Error("상태 조회에 실패했습니다.");
        json = (await st.json()) as SyncStatus;
      } while (json.status === "RUNNING");

      setMsg("✅ 동기화 완료!");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // “데이터 가져오기” 버튼: sda0125 전체 주문 + 상품 리스트 집계
  const handleFetchData = async () => {
    setError(null);
    setMsg(undefined);
    setLoading(true);
    setRaw(null);
    setProducts([]);

    try {
      const res = await fetch("/api/customer/all-orders?status=delivered", { method: "GET" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`데이터 가져오기에 실패했습니다. (${res.status}) ${t}`);
      }
      const json = (await res.json()) as AllOrdersResponse;
      setRaw(json);

      // 상품단위(옵션 합산), 완료건만, 최근 구매일 순 정렬
      const list = buildProductList(json, {
        // allowedStatuses: DEFAULT_ALLOWED_STATUSES, // 상태 기준 안 쓰려면 주석 유지
        groupByVariant: false,
        sortBy: "lastPurchased",
        // from: "2023-01-01", to: "2025-12-31", // 기간 제한이 필요하면 사용
      });
      setProducts(list);

      setMsg("📥 상품 리스트 생성 완료!");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-10">
      <h1 className="text-2xl font-bold mb-4">연결이 완료되었습니다!</h1>
      <p className="text-gray-700 mb-6">카페24 관리자 API 연동이 성공적으로 설정되었습니다.</p>

      <button
        onClick={handleSync}
        disabled={loading}
        className={`mb-4 px-4 py-2 text-white rounded
          ${loading ? "bg-gray-400 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-300"}`}
      >
        {loading ? "동기화 중..." : "스프레드시트 동기화"}
      </button>

      <button
        onClick={handleFetchData}
        disabled={loading}
        className={`mb-4 px-4 py-2 text-white rounded
          ${loading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-400"}`}
      >
        {loading ? "가져오는 중..." : "데이터 가져오기"}
      </button>

      {msg && <p className="mt-2 text-green-600">{msg}</p>}
      {error && <p className="mt-2 text-red-600">에러: {error}</p>}

      {/* 집계된 상품 리스트 */}
      {products.length > 0 && (
        <div className="mt-6 w-full max-w-3xl text-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="font-medium">총 상품 수: {products.length}</span>
            <span className="text-gray-500">상위 50개 미리보기</span>
          </div>
          <ul className="divide-y rounded border bg-white">
            {products.slice(0, 50).map(p => (
              <li key={p.productNo} className="p-3">
                <div className="font-medium">
                  {p.name || "(상품명 없음)"} <span className="text-gray-500">#{p.productNo}</span>
                </div>
                <div className="text-gray-600">
                  최근구매: {p.lastPurchased || "-"} · 총수량: {p.totalQty} · 주문건수: {p.ordersCount}
                  {p.variants.length > 0 && (
                    <span>
                      {" "}
                      · 옵션: {p.variants.slice(0, 3).join(", ")}
                      {p.variants.length > 3 ? " …" : ""}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 원본 JSON 미리보기(필요 시 참고) */}
      {raw && (
        <div className="mt-8 w-full max-w-3xl">
          <p className="mb-2 font-medium">원본 응답(일부):</p>
          <pre className="p-4 bg-gray-100 rounded text-xs max-h-80 overflow-auto">
            {JSON.stringify(
              {
                totalOrders: raw.totalOrders,
                totalItems: raw.totalItems,
                sampleItems: raw.items.slice(0, 5),
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}

      <section className="mt-12 p-6 bg-white rounded-lg shadow-lg border">
        <h2 className="text-2xl font-semibold mb-4 text-center">📊 데이터 동기화</h2>
        <p className="text-gray-600 text-center mb-6">Google Sheets의 데이터를 Notion으로 자동 동기화합니다.</p>
        <SyncButton />
      </section>
    </main>
  );
}

// "use client";

// import SyncButton from "components/SyncButton";
// import { useState } from "react";

// type SyncStatus = {
//   status: "RUNNING" | "SUCCEEDED" | "FAILED";
// };
// type AllOrdersItem = {
//   orderId: string;
//   createdDate?: string;
//   orderItemCode: string;
//   productNo?: number | string;
//   productName?: string;
//   optionValue?: string;
//   qty?: number;
// };

// type AllOrdersResponse = {
//   totalOrders: number;
//   totalItems: number;
//   orders: unknown[]; // ← any 대신 unknown 사용
//   items: AllOrdersItem[];
// };

// export default function SuccessPage() {
//   const [error, setError] = useState<string | null>(null);
//   const [msg, setMsg] = useState<string>();
//   const [loading, setLoading] = useState<boolean>(false);
//   // ❌ any -> ✅ 명시 타입
//   const [data, setData] = useState<AllOrdersResponse | null>(null);

//   const handleSync = async () => {
//     setError(null);
//     setMsg(undefined);
//     setLoading(true);

//     try {
//       const res = await fetch("/api/trigger-sync");
//       if (!res.ok) throw new Error("동기화 시작에 실패했습니다.");
//       const { executionArn } = (await res.json()) as { executionArn: string };

//       let json: SyncStatus;
//       do {
//         await new Promise(r => setTimeout(r, 2000));
//         const st = await fetch(`/api/sync-status?arn=${executionArn}`);
//         if (!st.ok) throw new Error("상태 조회에 실패했습니다.");
//         json = (await st.json()) as SyncStatus;
//       } while (json.status === "RUNNING");

//       setMsg("✅ 동기화 완료!");
//     } catch (err) {
//       setError(err instanceof Error ? err.message : String(err));
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleFetchData = async () => {
//     setError(null);
//     setMsg(undefined);
//     setLoading(true);
//     setData(null);

//     try {
//       const res = await fetch("/api/customer/all-orders", {
//         method: "GET",
//       });

//       if (!res.ok) {
//         const t = await res.text();
//         throw new Error(`데이터 가져오기에 실패했습니다. (${res.status}) ${t}`);
//       }

//       const json = (await res.json()) as AllOrdersResponse;
//       setData(json);
//       setMsg("📥 데이터 가져오기 성공!");
//     } catch (err) {
//       setError(err instanceof Error ? err.message : String(err));
//     } finally {
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

//       <button
//         onClick={handleFetchData}
//         disabled={loading}
//         className={`mb-4 px-4 py-2 text-white rounded
//           ${loading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-400"}`}
//       >
//         {loading ? "가져오는 중..." : "데이터 가져오기"}
//       </button>

//       {msg && <p className="mt-4 text-green-600">{msg}</p>}
//       {error && <p className="mt-4 text-red-600">에러: {error}</p>}
//       {data && (
//         <pre className="mt-6 p-4 bg-gray-100 rounded text-sm max-w-xl overflow-x-auto text-left">
//           {JSON.stringify(data, null, 2)}
//         </pre>
//       )}
//       {data && (
//         <>
//           <p className="mt-4">
//             총 주문수: {data.totalOrders} / 총 아이템수: {data.totalItems}
//           </p>
//           <pre className="mt-6 p-4 bg-gray-100 rounded text-sm max-w-xl overflow-x-auto text-left">
//             {JSON.stringify(data.items.slice(0, 5), null, 2)} {/* 미리보기 */}
//           </pre>
//         </>
//       )}
//       <section className="mt-12 p-6 bg-white rounded-lg shadow-lg border">
//         <h2 className="text-2xl font-semibold mb-4 text-center">📊 데이터 동기화</h2>
//         <p className="text-gray-600 text-center mb-6">Google Sheets의 데이터를 Notion으로 자동 동기화합니다.</p>
//         <SyncButton />
//       </section>
//     </main>
//   );
// }

// ================DEFAULT=================================

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

// ================AWS=================================
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

//   // 기존 AWS Step Functions 동기화
//   const handleAwsSync = async () => {
//     setError(null);
//     setMsg(undefined);
//     setLoading(true);

//     try {
//       // 1) 실행 시작 (기존 AWS Step Functions)
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
//       setMsg(`✅ AWS 동기화 완료!`);
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

//       {/* 기존 AWS Step Functions 동기화 */}
//       <div className="mb-8 p-6 bg-yellow-50 rounded-lg border border-yellow-200">
//         <h3 className="text-lg font-semibold mb-4">🟡 AWS 스프레드시트 동기화</h3>
//         <button
//           onClick={handleAwsSync}
//           disabled={loading}
//           className={`mb-4 px-4 py-2 text-white rounded
//             ${loading ? "bg-gray-400 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-300"}`}
//         >
//           {loading ? "AWS 동기화 중..." : "AWS 스프레드시트 동기화"}
//         </button>

//         {msg && <p className="mt-4 text-green-600">{msg}</p>}
//         {error && <p className="mt-4 text-red-600">에러: {error}</p>}
//       </div>

//       {/* 새로운 GitHub Actions 동기화 */}
//       <section className="mt-4 p-6 bg-blue-50 rounded-lg shadow-lg border border-blue-200">
//         <h2 className="text-2xl font-semibold mb-4 text-center">🔵 GitHub Actions 데이터 동기화</h2>
//         <p className="text-gray-600 text-center mb-6">
//           Google Sheets의 데이터를 GitHub Actions를 통해 Notion으로 자동 동기화합니다.
//         </p>
//         <SyncButton />
//       </section>
//     </main>
//   );
// }
