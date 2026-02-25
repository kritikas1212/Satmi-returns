import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createReturnOrder, generateLabel } from "@/lib/shiprocketServer";

const FROM_EMAIL = "Satmi Support <support@satmi.in>";

/**
 * POST /api/returns/approve-and-send
 * Body: { returnId, orderId, customerName, email, phone, originalCourier }
 *
 * 1. Create RTO (pickup = customer delivery address, delivery = warehouse)
 * 2. Generate label
 * 3. Email customer from support@satmi.in with label link
 * No self-fetch; uses shiprocketServer lib directly.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { returnId, orderId, customerName, email, phone, originalCourier } = body;

    if (!orderId || !email) {
      return NextResponse.json(
        { success: false, error: "orderId and email are required" },
        { status: 400 }
      );
    }

    // Get return request details to fetch warehouse address and Shopify data
    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebaseConfig');
    const returnDoc = await getDoc(doc(db, "returns", returnId));
    const returnData = returnDoc.data();
    const warehouseAddress = returnData?.warehouseAddress;
    const shopifyOrderData = returnData?.shopifyOrderData;

    // 1. Create RTO (server-side; no fetch to self)
    const createData = await createReturnOrder({
      orderId,
      customerName,
      email,
      phone,
      originalCourier,
      warehouseAddress,
      shopifyOrderData,
      testMode: false,
    });

    if (!createData.success) {
      return NextResponse.json(
        { success: false, error: createData.error || "Shiprocket create failed" },
        { status: 400 }
      );
    }

    const { shipmentId, awb, courier } = createData;

    // 2. Generate label
    let labelUrl = null;
    if (shipmentId != null) {
      const labelResult = await generateLabel(shipmentId);
      if (labelResult.success && labelResult.labelUrl) {
        labelUrl = labelResult.labelUrl;
      } else if (labelResult.raw?.label_url) {
        labelUrl = labelResult.raw.label_url;
      }
    }

    // 3. Send email to customer (from support@satmi.in)
    if (email && process.env.RESEND_API_KEY) {
      const customerNameStr = customerName || "Customer";
      const html = `
        <p>Hi ${customerNameStr},</p>
        <p>Your return request for order <strong>${orderId}</strong> has been approved.</p>
        <p><strong>Courier:</strong> ${courier || "—"}</p>
        <p><strong>AWB:</strong> ${awb || "—"}</p>
        ${labelUrl ? `<p><a href="${labelUrl}" style="display:inline-block;background:#7A1E1E;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Download return shipping label</a></p>` : ""}
        ${labelUrl ? `<p>Or copy this link: <a href="${labelUrl}">${labelUrl}</a></p>` : ""}
        <p>Please pack the item securely and hand it over to the courier. Our team will process the return once received at our warehouse.</p>
        <p>— Satmi Support</p>
      `;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: [email],
          subject: `Return label for order ${orderId} – Satmi`,
          html,
        });
      } catch (emailErr) {
        console.error("Return label email failed:", emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      awb: awb || "PENDING",
      shipmentId: shipmentId ?? null,
      labelUrl,
      courier: courier || "Unknown",
      returnId,
    });
  } catch (error) {
    console.error("approve-and-send error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
