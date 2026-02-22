import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    // 1. SECURITY: Check for Bearer Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized request.' }, { status: 401 });
    }

    const body = await request.json();
    const { phoneNumber } = body;

    if (!phoneNumber) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN } = process.env;
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Shopify not configured." }, { status: 500 });
    }

    // ---------------------------------------------------------
    // 2. NORMALIZE PHONE — Shopify stores E.164 / digits in various formats
    // ---------------------------------------------------------
    // Input: "+91 999-999-9999" or "9999999999" -> digits only, then last 10 (India mobile)
    const rawDigits = String(phoneNumber).replace(/\D/g, "");
    const last10Digits = rawDigits.slice(-10);
    if (last10Digits.length < 10) {
      return NextResponse.json({ error: "Enter a valid 10-digit phone number." }, { status: 400 });
    }

    // Customer search query variants (Shopify expects proper encoding; + must be %2B in URL)
    const searchQueries = [
      `phone:${last10Digits}`,           // 9876543210
      `phone:${rawDigits}`,              // 919876543210
      `phone:+91${last10Digits}`,         // E.164 India
      `phone:+${rawDigits}`,
      `phone:91${last10Digits}`,
      `phone:0${last10Digits}`,          // some stores store with leading 0
    ];

    let customerId = null;
    let orders = [];

    // ---------------------------------------------------------
    // 3. STRATEGY A: CUSTOMER SEARCH (encode query so + is not lost)
    // ---------------------------------------------------------
    const headers = { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN };
    for (const query of searchQueries) {
      const searchUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/search.json?query=${encodeURIComponent(query)}`;
      const res = await fetch(searchUrl, { headers });
      const data = await res.json();
      if (data.customers?.length > 0) {
        customerId = data.customers[0].id;
        break;
      }
    }

    // ---------------------------------------------------------
    // 4. STRATEGY B: ORDERS BY CUSTOMER OR PAGINATED ORDER SEARCH
    // ---------------------------------------------------------
    if (customerId) {
      const historyUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${customerId}/orders.json?status=any&limit=250`;
      const historyRes = await fetch(historyUrl, { headers });
      const historyData = await historyRes.json();
      orders = historyData.orders || [];
    } else {
      // Guest / no customer match: fetch multiple pages of orders and match by phone
      const allRecentOrders = [];
      let nextPageUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?status=any&limit=250`;
      const maxPages = 5;
      for (let page = 0; page < maxPages; page++) {
        const res = await fetch(nextPageUrl, { headers });
        const data = await res.json();
        const list = data.orders || [];
        allRecentOrders.push(...list);
        const linkHeader = res.headers.get("Link");
        const nextMatch = linkHeader && linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (!nextMatch || list.length < 250) break;
        nextPageUrl = nextMatch[1];
      }

      const matchByPhone = (phoneStr) => {
        const digits = (phoneStr || "").replace(/\D/g, "");
        return digits.includes(last10Digits) || last10Digits === digits.slice(-10);
      };

      orders = allRecentOrders.filter((o) => {
        const orderPhone = o.phone || "";
        const shipPhone = o.shipping_address?.phone || "";
        const billingPhone = o.billing_address?.phone || "";
        return matchByPhone(orderPhone) || matchByPhone(shipPhone) || matchByPhone(billingPhone);
      });
    }

    // ---------------------------------------------------------
    // 5. ENRICH ORDERS (Delivery Status Logic)
    // ---------------------------------------------------------
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const fulfillment = (order.fulfillments || []).find((f) => f.tracking_number);
      
      let deliveredDate = null;
      let isReturnable = false;
      let statusMessage = "Processing";

      if (fulfillment && fulfillment.shipment_status === 'delivered') {
        try {
           const eventsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${order.id}/fulfillments/${fulfillment.id}/events.json`;
           const eventsRes = await fetch(eventsUrl, { headers });
           const eventsData = await eventsRes.json();
           
           const deliveredEvent = (eventsData.fulfillment_events || []).find((e) => e.status === "delivered");
           if (deliveredEvent) {
             deliveredDate = deliveredEvent.happened_at; 
             const deliveryTime = new Date(deliveredDate).getTime();
             const threeDaysLater = deliveryTime + (3 * 24 * 60 * 60 * 1000);
             const now = Date.now();

             if (now <= threeDaysLater) {
               isReturnable = true;
               statusMessage = "Eligible for Return";
             } else {
               isReturnable = false;
               statusMessage = "Return Window Closed (Over 3 Days)";
             }
           } else {
             // If marked delivered but no event date found, allow return if recent creation
             statusMessage = "Delivered";
             isReturnable = true;
           }
        } catch (e) {
           statusMessage = "Delivered (Date Verify Failed)";
           isReturnable = true; // Fallback to allow return if API fails
        }
      } else if (fulfillment && fulfillment.status === 'success') {
         statusMessage = "Delivered"; 
         isReturnable = true; 
      } else if (fulfillment) {
         statusMessage = "In Transit";
      } else {
         statusMessage = "Not Shipped Yet";
      }

      return {
        ...order,
        delivery_status: {
          delivered_date: deliveredDate,
          is_returnable: isReturnable,
          message: statusMessage
        }
      };
    }));

    return NextResponse.json({ orders: enrichedOrders });

  } catch (error) {
    console.error('Server Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}