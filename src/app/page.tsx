"use client";
export default function HomePage() {
  const handleConnect = () => {
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const clientId = process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!;
    const redirectUri = encodeURIComponent(`${process.env.NEXT_PUBLIC_BASE_URL}/oauth/callback`);
    const scope = encodeURIComponent("mall.read_product product");
    const state = "admin_access";
    const url = `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}`;
    window.location.href = url;
  };
  return (
    <main className="p-10">
      <h1 className="text-xl font-bold">카페24 관리자 연결</h1>
      <button onClick={handleConnect} className="mt-4 p-2 bg-blue-500 text-white rounded">
        카페24 로그인 & 동의
      </button>
    </main>
  );
}
