import { google } from 'googleapis';
import { NextResponse } from 'next/server';

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
      videoUrl 
    } = body;

    // 1. Authenticate with Google
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 2. Prepare Row Data
    // We map the data EXACTLY to your Sheet headers:
    // A: Timestamp, B: Email, C: Order#, D: Product, E: Phone, F: Name, G: Email, H: Reason, I: Comments, J: Video, K: Status
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
      "Pending Review",             // K: Status (Triggers your manual review)
      "",                           // L: Shiprocket ID (Empty)
      "",                           // M: Label Link (Empty)
      ""                            // N: Automation Log (Empty)
    ];

    // 3. Append to Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:N', // Target columns A to N
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowData] },
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Sheet Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}