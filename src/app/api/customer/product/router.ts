// src/app/api/customers/product/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

export async function POST(req: Request) {
  const { memberKey, hints } = await req.json();

  // 🔹 테스트용: 항상 sda0125를 사용
  const memberId = "sda0125";

  const { access_token } = await loadParams(["access_token"]);
  const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

  // 최근 주문 20건 + items 임베드
  const orders = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
    params: { member_id: memberId, limit: 20, embed: "items" },
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  });

  // 요약 가공
  const skus = new Set<string>();
  for (const od of orders.data.orders ?? []) {
    for (const it of od.items ?? []) {
      if (it.product_no) skus.add(String(it.product_no));
    }
  }

  const payload = {
    isVip: hints?.group === "GREEN" || hints?.group === "BLUE",
    recentBoughtSkus: Array.from(skus).slice(0, 10),
    couponEligible: skus.size > 0,
  };

  const res = NextResponse.json(payload);
  res.headers.set("Cache-Control", "private, max-age=120"); // 2분 캐시
  return res;
}
