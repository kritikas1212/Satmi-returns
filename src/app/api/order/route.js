import { NextResponse } from "next/server";

/**
 * GET /api/order?orderNumber=1001
 * Fetches a single Shopify order by order name (number) for dashboard display.
 * Does not require customer auth; protect this route in production (e.g. admin-only).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderNumber = searchParams.get("orderNumber");
    if (!orderNumber) {
      return NextResponse.json(
        { error: "orderNumber query is required" },
        { status: 400 }
      );
    }

    const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
    const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: "Shopify not configured" },
        { status: 500 }
      );
    }

    const nameQuery = orderNumber.replace(/^#/, "");
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?name=${encodeURIComponent(nameQuery)}&limit=1`;
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN },
    });
    const data = await res.json();
    const orders = data.orders || [];
    const order = orders[0] || null;

    return NextResponse.json({ order });
  } catch (error) {
    console.error("Order fetch error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
