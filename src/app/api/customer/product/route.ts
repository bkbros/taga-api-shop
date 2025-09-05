// src/app/api/customer/product/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

type Hints = { group?: string };

export async function POST(req: Request) {
  // ✅ memberKey 아예 받지 않음
  const body = (await req.json()) as { hints?: Hints } | null;
  const hints = body?.hints;

  // 테스트용 고정 아이디
  const memberId = "sda0125";

  const { access_token } = await loadParams(["access_token"]);
  const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;

  const orders = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
    params: { member_id: memberId, limit: 20, embed: "items" },
    headers: { Authorization: `Bearer ${access_token}` },
  });

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
  res.headers.set("Cache-Control", "private, max-age=120");
  return res;
}
