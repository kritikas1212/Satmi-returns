import { NextResponse } from 'next/server';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';

const FROM_EMAIL = "Satmi Support <support@satmi.in>";

// Fetch Shopify order details
async function fetchShopifyOrder(orderId) {
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    console.warn("Shopify credentials not configured");
    return null;
  }

  try {
    const response = await fetch(`https://${SHOPIFY_STORE_DOMAIN}.myshopify.com/admin/api/2023-10/orders/${orderId}.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error(`Shopify API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return data.order;
  } catch (error) {
    console.error("Error fetching Shopify order:", error);
    return null;
  }
}

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

    // Fetch Shopify order details for accurate refund amount
    const shopifyOrder = await fetchShopifyOrder(orderId);
    
    // Calculate accurate refund amount from Shopify order
    let orderTotal = 0;
    let refundAmount = 0;
    
    if (shopifyOrder) {
      orderTotal = parseFloat(shopifyOrder.total_price || 0);
      // Calculate refund amount based on returned items (for now assume full order)
      // TODO: Calculate based on specific items being returned
      refundAmount = orderTotal;
    }

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
        // Shopify order details
        shopifyOrderData: {
          orderTotal: orderTotal,
          refundAmount: refundAmount,
          currency: shopifyOrder?.currency || "INR",
          orderDate: shopifyOrder?.created_at || null,
          financialStatus: shopifyOrder?.financial_status || "paid"
        },
        warehouseAddress: {
          shipping_customer_name: "Satmi Warehouse",
          shipping_address: "Plot No 519, Roja Yaqubpur, Sec 16B",
          shipping_address_2: "Greater Noida",
          shipping_city: "Greater Noida",
          shipping_state: "Uttar Pradesh",
          shipping_country: "India",
          shipping_pincode: "201306",
          shipping_phone: "9523776843"
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