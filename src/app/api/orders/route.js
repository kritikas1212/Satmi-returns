import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const { phoneNumber } = body;

    if (!phoneNumber) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN } = process.env;

    // 1. Prepare Phone Variants
    const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, ''); 
    const noPlus = cleanPhone.replace(/^\+/, ''); 
    const queries = [
      `phone:${cleanPhone}`, 
      `phone:${noPlus}`,     
      `phone:${noPlus.substring(2)}` 
    ];

    console.log("1. Searching Customer with variants:", queries);

    let customerId = null;

    // 2. Find Customer ID
    for (const query of queries) {
      const searchUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/search.json?query=${query}`;
      const res = await fetch(searchUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
      const data = await res.json();
      if (data.customers?.length > 0) {
        customerId = data.customers[0].id;
        break; 
      }
    }

    let orders = [];

    // 3. Fetch Orders (Either by ID or Fallback Search)
    if (!customerId) {
        const recentUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?status=any&limit=50`;
        const recentRes = await fetch(recentUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
        const recentData = await recentRes.json();
        orders = (recentData.orders || []).filter(o => 
            JSON.stringify(o).includes(noPlus) || JSON.stringify(o).includes(cleanPhone)
        );
    } else {
        const historyUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${customerId}/orders.json?status=any&limit=100`;
        const historyRes = await fetch(historyUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
        const historyData = await historyRes.json();
        orders = historyData.orders || [];
    }

    // ======================================================
    // 4. CHECK DELIVERY DATES (USING SHOPIFY DATA)
    // ======================================================
    
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      // Find the fulfillment that has a tracking number
      const fulfillment = order.fulfillments.find(f => f.tracking_number);
      
      let deliveredDate = null;
      let isReturnable = false;
      let statusMessage = "Processing";

      // If Shopify says it's delivered (Matches your screenshot)
      if (fulfillment && fulfillment.shipment_status === 'delivered') {
        
        // We need the EXACT date. We fetch the "Events" for this fulfillment.
        try {
           const eventsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${order.id}/fulfillments/${fulfillment.id}/events.json`;
           const eventsRes = await fetch(eventsUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
           const eventsData = await eventsRes.json();
           
           // Find the 'delivered' event
           const deliveredEvent = eventsData.fulfillment_events.find(e => e.status === 'delivered');
           
           if (deliveredEvent) {
             deliveredDate = deliveredEvent.happened_at; // This is the "Friday, Jan 30" date
             
             // 3-Day Window Check
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
           }
        } catch (e) {
           console.error("Error fetching events:", e);
           // Fallback: If we can't get the date but status is delivered, assume expired if old
           statusMessage = "Delivered (Date Verify Failed)";
        }

      } else if (fulfillment && fulfillment.status === 'success') {
         // Sometimes 'success' is used instead of 'delivered'
         statusMessage = "Delivered"; 
         // Without a specific date event, we might default to isReturnable = true or false depending on policy
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