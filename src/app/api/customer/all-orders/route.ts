// src/app/api/customer/all-orders/route.ts
import { NextResponse } from "next/server";
import axios from "axios";
import { loadParams } from "@/lib/ssm";

type Cafe24Order = {
  order_id: string;
  created_date?: string;
  items?: Array<{
    order_item_code: string;
    product_no?: number;
    product_name?: string;
    option_value?: string;
    quantity?: number;
  }>;
};

export async function GET() {
  const memberId = "sda0125"; // 테스트용 고정값 (실서비스에선 식별로직으로 치환)
  const { access_token } = await loadParams(["access_token"]);
  const mallId = process.env.NEXT_PUBLIC_CAFE24_MALL_ID!;
  const headers = { Authorization: `Bearer ${access_token}` };

  const limit = 100;
  let page = 1; // 또는 offset 기반이면 offset=0부터 시작
  const all: Cafe24Order[] = [];

  while (true) {
    const resp = await axios.get(`https://${mallId}.cafe24api.com/api/v2/admin/orders`, {
      headers,
      params: {
        member_id: memberId,
        embed: "items",
        limit,
        page, // 만약 offset 방식이면 offset: (page-1) * limit 로 교체
        // created_start_date: "2020-01-01",
        // created_end_date: "2025-12-31",
      },
    });

    const batch: Cafe24Order[] = resp.data?.orders ?? [];
    all.push(...batch);

    if (batch.length < limit) break; // 마지막 페이지
    page += 1;
  }

  // 원하면 주문별 아이템만 평탄화해서 돌려주기
  const flattenedItems = all.flatMap(o =>
    (o.items ?? []).map(it => ({
      orderId: o.order_id,
      createdDate: o.created_date,
      orderItemCode: it.order_item_code,
      productNo: it.product_no,
      productName: it.product_name,
      optionValue: it.option_value,
      qty: it.quantity,
    })),
  );

  return NextResponse.json({
    totalOrders: all.length,
    totalItems: flattenedItems.length,
    orders: all,
    items: flattenedItems,
  });
}
