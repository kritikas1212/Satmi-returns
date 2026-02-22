import { NextResponse } from 'next/server';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';

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

    // Save to Firestore for manual review
    try {
      const returnDoc = {
        orderId,
        customerName,
        email,
        itemTitle,
        phone,
        reason,
        comments: comments || "No comments",
        videoUrl,
        originalCourier,
        status: "Pending",
        createdAt: serverTimestamp(),
        warehouseAddress: {
          shipping_customer_name: "Satmi Warehouse",
          shipping_address: "Plot No 519, Roja Yaqubpur, Sec 16B",
          shipping_address_2: "Greater Noida",
          shipping_city: "Greater Noida",
          shipping_state: "Uttar Pradesh",
          shipping_country: "India",
          shipping_pincode: "201318",
          shipping_phone: "9999999999"
        }
      };
      
      await setDoc(doc(db, "returns", `${orderId}_${Date.now()}`), returnDoc);
    } catch (firestoreErr) {
      console.error("Firestore logging failed:", firestoreErr);
      return NextResponse.json({ error: "Failed to save return request" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Return request submitted successfully. We will review and email you shortly."
    });

  } catch (error) {
    console.error('Submit return error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}