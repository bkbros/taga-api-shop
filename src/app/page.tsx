"use client";
export default function HomePage() {
  const handleConnect = () => {
    const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
    const clientId = process.env.NEXT_PUBLIC_CAFE24_CLIENT_ID!;
    const redirectUri = encodeURIComponent(`${process.env.NEXT_PUBLIC_BASE_URL}/oauth/callback`);
    const scopes = [
      // 앱 권한
      "mall.read_application",
      "mall.write_application",

      // 상품분류
      "mall.read_category",
      "mall.write_category",

      // 상품
      "mall.read_product",
      "mall.write_product",

      // 주문
      "mall.read_order",
      "mall.write_order",

      // 회원
      "mall.read_customer",
      "mall.write_customer",

      // 프로모션
      "mall.read_promotion",
      "mall.write_promotion",

      // 개인정보
      "mall.read_privacy",
      "mall.write_privacy",

      // 배송
      "mall.read_shipping",
      "mall.write_shipping",

      // 추가 권한들
      "mall.read_notification",
      "mall.write_notification",
      "mall.read_store",
      "mall.write_store",
      "mall.read_design",
      "mall.write_design",
      "mall.read_salesreport",
      "mall.read_mileage",
      "mall.write_mileage",
      "mall.read_translation",
    ];

    // OAuth URL 생성 시
    const scopeParam = encodeURIComponent(scopes.join(","));

    const state = "admin_access";
    const url = `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scopeParam}`;
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
