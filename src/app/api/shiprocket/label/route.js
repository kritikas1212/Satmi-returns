import { NextResponse } from "next/server";

async function getShiprocketToken() {
  const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error("Shiprocket login failed");
  const data = await res.json();
  return data.token;
}

/**
 * POST body: { shipmentId: number } or { shipmentIds: number[] }
 * Returns: { success, labelUrl } or { success: false, error }
 * Shiprocket: Generate label for return order(s).
 */
export async function POST(request) {
  try {
    const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
    const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;
    if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
      return NextResponse.json(
        { success: false, error: "Shiprocket credentials not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const shipmentId = body.shipmentId ?? body.shipment_id;
    const shipmentIds = body.shipmentIds ?? body.order_id;
    const orderIds = shipmentIds
      ? (Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds])
      : shipmentId != null
      ? [Number(shipmentId)]
      : null;

    if (!orderIds?.length) {
      return NextResponse.json(
        { success: false, error: "shipmentId or shipmentIds required" },
        { status: 400 }
      );
    }

    const token = await getShiprocketToken();

    const labelRes = await fetch(
      "https://apiv2.shiprocket.in/v1/external/courier/generate/label",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ order_id: orderIds }),
      }
    );

    const labelData = await labelRes.json();

    if (!labelRes.ok) {
      return NextResponse.json(
        { success: false, error: labelData.message || JSON.stringify(labelData) },
        { status: labelRes.status }
      );
    }

    const labelUrl =
      labelData.label_url ||
      labelData.label_urls?.[0] ||
      labelData.url ||
      labelData.shipment_label_url;

    return NextResponse.json({
      success: true,
      labelUrl: labelUrl || null,
      raw: labelData,
    });
  } catch (error) {
    console.error("Shiprocket label error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
