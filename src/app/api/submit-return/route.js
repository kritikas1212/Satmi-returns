import { NextResponse } from 'next/server';
import { createReturnOrder, generateLabel } from '@/lib/shiprocketServer';
import { Resend } from 'resend';

const FROM_EMAIL = "Satmi Support <support@satmi.in>";

export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      orderId, 
      customerName, 
      email, 
      itemTitle, 
      phone, 
      reason, 
      comments, 
      videoUrl,
      originalCourier
    } = body;

    // 1. Create RTO directly (server-side; no fetch to self)
    const createData = await createReturnOrder({
      orderId,
      customerName,
      email,
      phone,
      originalCourier,
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

    // 3. Send confirmation email to customer
    if (email && process.env.RESEND_API_KEY) {
      const customerNameStr = customerName || "Customer";
      const html = `
        <p>Hi ${customerNameStr},</p>
        <p>Your return request for order <strong>${orderId}</strong> has been automatically approved and processed.</p>
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

    // 4. Save to Google Sheets for record keeping
    const { google } = await import('googleapis');
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });

      const rowData = [
        new Date().toLocaleString('en-IN'), // A: Timestamp
        email,                        // B: Email address
        orderId,                      // C: Order Number
        itemTitle,                    // D: Product Name
        phone,                        // E: Phone Number
        customerName,                 // F: Full Name
        email,                        // G: Email Address (Duplicate as per your sheet)
        reason,                       // H: Reason For Return
        comments || "No comments",    // I: Comments
        videoUrl,                     // J: Unboxing Video Link
        "Auto-Approved",             // K: Status (Auto-approved)
        shipmentId || "",             // L: Shiprocket ID
        labelUrl || "",               // M: Label Link
        `Courier: ${courier}, AWB: ${awb}` // N: Automation Log
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:N', // Target columns A to N
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] },
      });
    } catch (sheetErr) {
      console.error("Google Sheets logging failed:", sheetErr);
      // Don't fail the request if sheet logging fails
    }

    return NextResponse.json({
      success: true,
      awb: awb || "PENDING",
      shipmentId: shipmentId ?? null,
      labelUrl,
      courier: courier || "Unknown",
      message: "Return order created and label sent successfully"
    });

  } catch (error) {
    console.error('Sheet Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}