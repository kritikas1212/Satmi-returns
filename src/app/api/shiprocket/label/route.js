import { NextResponse } from "next/server";
import { generateLabel } from "@/lib/shiprocketServer";

/**
 * POST body: { shipmentId } or { shipmentIds }
 * Generate label for Shiprocket return order.
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
      ? Array.isArray(shipmentIds)
        ? shipmentIds
        : [shipmentIds]
      : shipmentId != null
      ? [Number(shipmentId)]
      : null;

    if (!orderIds?.length) {
      return NextResponse.json(
        { success: false, error: "shipmentId or shipmentIds required" },
        { status: 400 }
      );
    }

    const result = await generateLabel(orderIds[0]);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    return NextResponse.json({
      success: true,
      labelUrl: result.labelUrl,
      raw: result.raw,
    });
  } catch (error) {
    console.error("Shiprocket label error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
