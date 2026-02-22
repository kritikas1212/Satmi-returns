import { NextResponse } from "next/server";
import { createReturnOrder } from "@/lib/shiprocketServer";

/**
 * POST /api/shiprocket
 * Creates RTO: pickup = customer address (where order was delivered), delivery = warehouse.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const result = await createReturnOrder({
      orderId: body.orderId,
      customerName: body.customerName,
      email: body.email,
      phone: body.phone,
      originalCourier: body.originalCourier,
      testMode: body.testMode === true,
    });
    if (!result.success) {
      const status = result.error?.includes("credentials") ? 500 : 400;
      return NextResponse.json({ success: false, error: result.error }, { status });
    }
    return NextResponse.json({
      success: true,
      mode: result.mode || "LIVE",
      courier: result.courier,
      awb: result.awb,
      shipmentId: result.shipmentId,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
