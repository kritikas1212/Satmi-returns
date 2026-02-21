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

    // ---------------------------------------------------------
    // 2. AGGRESSIVE PHONE CLEANING
    // ---------------------------------------------------------
    // Input: "+91 999-999-9999" -> Clean: "9999999999" (Last 10 digits)
    const rawDigits = phoneNumber.replace(/\D/g, ''); 
    const last10Digits = rawDigits.slice(-10); 
    
    // We will search for these variations in Shopify
    const searchQueries = [
      `phone:${rawDigits}`,          // 919999999999
      `phone:+${rawDigits}`,         // +919999999999
      `phone:${last10Digits}`,       // 9999999999
      `phone:+91${last10Digits}`     // +919999999999 (Standard India)
    ];

    let customerId = null;
    let orders = [];

    // ---------------------------------------------------------
    // 3. STRATEGY A: CUSTOMER SEARCH API (Fastest)
    // ---------------------------------------------------------
    // We try to find the specific customer profile first.
    for (const query of searchQueries) {
      const searchUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/search.json?query=${query}`;
      const res = await fetch(searchUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
      const data = await res.json();
      
      if (data.customers?.length > 0) {
        customerId = data.customers[0].id;
        break; // Found them!
      }
    }

    // ---------------------------------------------------------
    // 4. STRATEGY B: FETCH ORDERS (The "No Orders" Fix)
    // ---------------------------------------------------------
    if (customerId) {
        // If we found a customer ID, fetch ALL their orders.
        const historyUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${customerId}/orders.json?status=any&limit=250`;
        const historyRes = await fetch(historyUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
        const historyData = await historyRes.json();
        orders = historyData.orders || [];
    } else {
        // FALLBACK: If customer lookup failed, manually search the last 250 orders.
        // This fixes the issue where guest checkouts don't link to a "Customer Profile" easily.
        const recentUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?status=any&limit=250`;
        const recentRes = await fetch(recentUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
        const recentData = await recentRes.json();
        
        const allRecentOrders = recentData.orders || [];

        // Manual Filter: Check if the order's phone or shipping phone contains our 10 digits
        orders = allRecentOrders.filter(o => {
            const orderPhone = (o.phone || "").replace(/\D/g, '');
            const shipPhone = (o.shipping_address?.phone || "").replace(/\D/g, '');
            
            return orderPhone.includes(last10Digits) || shipPhone.includes(last10Digits);
        });
    }

    // ---------------------------------------------------------
    // 5. ENRICH ORDERS (Delivery Status Logic)
    // ---------------------------------------------------------
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const fulfillment = order.fulfillments.find(f => f.tracking_number);
      
      let deliveredDate = null;
      let isReturnable = false;
      let statusMessage = "Processing";

      if (fulfillment && fulfillment.shipment_status === 'delivered') {
        try {
           const eventsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${order.id}/fulfillments/${fulfillment.id}/events.json`;
           const eventsRes = await fetch(eventsUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
           const eventsData = await eventsRes.json();
           
           const deliveredEvent = eventsData.fulfillment_events.find(e => e.status === 'delivered');
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