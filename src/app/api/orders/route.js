import { NextResponse } from 'next/server';
import { trackShipmentByAwb, getShiprocketToken } from '@/lib/shiprocketServer';

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
    const headers = { 
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      'User-Agent': 'Satmi-Returns/1.0'
    };
    
    for (const query of searchQueries) {
      try {
        const searchUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/customers/search.json?query=${encodeURIComponent(query)}`;
        const res = await fetch(searchUrl, { headers });
        const data = await res.json();
        if (data.customers?.length > 0) {
          customerId = data.customers[0].id;
          break;
        }
      } catch (error) {
        console.error('Customer search error:', error);
        // Continue to next query if SSL fails
        continue;
      }
    }

    // ---------------------------------------------------------
    // 4. STRATEGY B: ORDERS BY CUSTOMER OR PAGINATED ORDER SEARCH
    // ---------------------------------------------------------
    if (customerId) {
      try {
        const historyUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/customers/${customerId}/orders.json?status=any&limit=250`;
        const historyRes = await fetch(historyUrl, { headers });
        const historyData = await historyRes.json();
        orders = historyData.orders || [];
      } catch (error) {
        console.error('Customer orders fetch error:', error);
        // Fall back to paginated search if customer orders fail
      }
    }
    
    if (orders.length === 0) {
      // Guest / no customer match: fetch multiple pages of orders and match by phone
      const allRecentOrders = [];
      let nextPageUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/orders.json?status=any&limit=250`;
      const maxPages = 5;
      for (let page = 0; page < maxPages; page++) {
        try {
          const res = await fetch(nextPageUrl, { headers });
          const data = await res.json();
          const list = data.orders || [];
          allRecentOrders.push(...list);
          const linkHeader = res.headers.get("Link");
          const nextMatch = linkHeader && linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (!nextMatch || list.length < 250) break;
          nextPageUrl = nextMatch[1];
        } catch (error) {
          console.error(`Page ${page + 1} fetch error:`, error);
          break; // Stop pagination on error
        }
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
    // 5. ENRICH LINE ITEMS WITH PRODUCT IMAGES
    //    Shopify REST line_items don't always include images.
    //    Batch-fetch products by ID in a single call to get images.
    // ---------------------------------------------------------
    const productIds = new Set();
    orders.forEach(order => {
      (order.line_items || []).forEach(item => {
        if (item.product_id) productIds.add(item.product_id);
      });
    });

    const productImageMap = {};
    if (productIds.size > 0) {
      try {
        const idsParam = Array.from(productIds).slice(0, 250).join(',');
        const productsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/products.json?ids=${idsParam}&fields=id,images`;
        const productsRes = await fetch(productsUrl, { headers });
        if (productsRes.ok) {
          const productsData = await productsRes.json();
          (productsData.products || []).forEach(product => {
            if (product.images?.[0]?.src) {
              productImageMap[product.id] = product.images[0].src;
            }
          });
        }
      } catch (e) {
        console.error('Product images fetch error (non-fatal):', e);
      }
    }

    // Attach images to line items that are missing them
    orders.forEach(order => {
      (order.line_items || []).forEach(item => {
        if (!item.image && item.product_id && productImageMap[item.product_id]) {
          item.image = { src: productImageMap[item.product_id] };
        }
      });
    });

    // ---------------------------------------------------------
    // 6. ENRICH ORDERS (Delivery Status via Shiprocket + Shopify fallback)
    //    For each order with a tracking number (AWB), query Shiprocket
    //    for the real delivery status. Deduplicate AWBs so each is
    //    fetched only once. Fall back to Shopify if Shiprocket fails.
    // ---------------------------------------------------------

    // Collect unique AWBs across all orders
    const awbSet = new Set();
    orders.forEach(order => {
      const fulfillment = (order.fulfillments || []).find(f => f.tracking_number);
      if (fulfillment?.tracking_number) awbSet.add(fulfillment.tracking_number);
    });

    // Batch-fetch Shiprocket tracking (one token, parallel per AWB, max 5 concurrent)
    const shiprocketTrackingMap = {};
    if (awbSet.size > 0) {
      let srToken = null;
      try {
        srToken = await getShiprocketToken();
      } catch (e) {
        console.error('Shiprocket token error (will fall back to Shopify):', e);
      }

      if (srToken) {
        const awbArray = Array.from(awbSet);
        const BATCH = 5;
        for (let i = 0; i < awbArray.length; i += BATCH) {
          const batch = awbArray.slice(i, i + BATCH);
          const results = await Promise.all(
            batch.map(awb => trackShipmentByAwb(awb, srToken))
          );
          batch.forEach((awb, idx) => {
            if (results[idx]) shiprocketTrackingMap[awb] = results[idx];
          });
        }
      }
    }

    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const fulfillment = (order.fulfillments || []).find((f) => f.tracking_number);
      const awb = fulfillment?.tracking_number || null;
      const srTracking = awb ? shiprocketTrackingMap[awb] : null;

      let deliveredDate = null;
      let isReturnable = false;
      let statusMessage = "Not Shipped";
      let returnEligibilityReason = "";

      // Check order financial status first
      if (order.financial_status === 'refunded') {
        statusMessage = "Order Refunded";
        returnEligibilityReason = "This order has been fully refunded and is not eligible for returns";
        isReturnable = false;
      } else if (order.financial_status === 'voided') {
        statusMessage = "Order Voided";
        returnEligibilityReason = "This order was voided and is not eligible for returns";
        isReturnable = false;
      } else if (order.cancelled_at) {
        statusMessage = "Order Cancelled";
        returnEligibilityReason = "This order was cancelled and is not eligible for returns";
        isReturnable = false;
      } else if (srTracking) {
        // ---- Shiprocket-based status (primary) ----
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        if (srTracking.status === "DELIVERED") {
          deliveredDate = srTracking.deliveredDate;
          if (deliveredDate) {
            const deliveryTime = new Date(deliveredDate).getTime();
            if (now <= deliveryTime + threeDaysMs) {
              isReturnable = true;
              statusMessage = "Delivered";
              returnEligibilityReason = "This item was delivered recently and is eligible for return";
            } else {
              isReturnable = false;
              statusMessage = "Return Window Closed";
              returnEligibilityReason = `Return window closed. Delivered more than 3 days ago (${new Date(deliveredDate).toLocaleDateString()})`;
            }
          } else {
            // Delivered but no date from Shiprocket — use fulfillment date
            const fulfillmentCreated = new Date(fulfillment.created_at || order.created_at).getTime();
            if (now <= fulfillmentCreated + 7 * 24 * 60 * 60 * 1000) {
              statusMessage = "Delivered";
              isReturnable = true;
              returnEligibilityReason = "This item was delivered recently and is eligible for return";
            } else {
              statusMessage = "Delivered (Date Unknown)";
              isReturnable = false;
              returnEligibilityReason = "This item was delivered too long ago and is not eligible for return";
            }
          }
        } else if (srTracking.status === "OUT_FOR_DELIVERY") {
          statusMessage = "Out for Delivery";
          returnEligibilityReason = "This item is out for delivery and not yet eligible for return";
          isReturnable = false;
        } else if (srTracking.status === "IN_TRANSIT" || srTracking.status === "PICKED_UP") {
          statusMessage = "In Transit";
          returnEligibilityReason = "This item is currently in transit and not yet eligible for return";
          isReturnable = false;
        } else if (srTracking.status === "RTO") {
          statusMessage = "Return to Origin";
          returnEligibilityReason = "This shipment is being returned to the seller";
          isReturnable = false;
        } else if (srTracking.status === "CANCELLED") {
          statusMessage = "Shipment Cancelled";
          returnEligibilityReason = "This shipment was cancelled";
          isReturnable = false;
        } else {
          statusMessage = "Shipped";
          returnEligibilityReason = "This item has been shipped and delivery status is being updated";
          isReturnable = false;
        }
      } else if (fulfillment && fulfillment.shipment_status === 'delivered') {
        // ---- Shopify fallback (when Shiprocket tracking unavailable) ----
        const fulfillmentCreated = new Date(fulfillment.created_at || order.created_at).getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        if (now - fulfillmentCreated > 10 * 24 * 60 * 60 * 1000) {
          statusMessage = "Return Window Closed";
          returnEligibilityReason = "Return window closed. Delivered more than 3 days ago";
          isReturnable = false;
        } else {
          try {
            const eventsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/orders/${order.id}/fulfillments/${fulfillment.id}/events.json`;
            const eventsRes = await fetch(eventsUrl, { headers });
            const eventsData = await eventsRes.json();

            const deliveredEvent = (eventsData.fulfillment_events || []).find((e) => e.status === "delivered");
            if (deliveredEvent) {
              deliveredDate = deliveredEvent.happened_at;
              const deliveryTime = new Date(deliveredDate).getTime();

              if (now <= deliveryTime + threeDaysMs) {
                isReturnable = true;
                statusMessage = "Delivered";
                returnEligibilityReason = "This item was delivered recently and is eligible for return";
              } else {
                isReturnable = false;
                statusMessage = "Return Window Closed";
                returnEligibilityReason = `Return window closed. Delivered more than 3 days ago (${new Date(deliveredDate).toLocaleDateString()})`;
              }
            } else {
              if (now <= fulfillmentCreated + 7 * 24 * 60 * 60 * 1000) {
                statusMessage = "Delivered";
                isReturnable = true;
                returnEligibilityReason = "This item was delivered recently and is eligible for return";
              } else {
                statusMessage = "Delivered (Date Unknown)";
                isReturnable = false;
                returnEligibilityReason = "This item was delivered too long ago and is not eligible for return";
              }
            }
          } catch (e) {
            console.error('Fulfillment events fetch error:', e);
            if (now <= fulfillmentCreated + threeDaysMs) {
              statusMessage = "Delivered";
              isReturnable = true;
              returnEligibilityReason = "This item was delivered recently and is eligible for return";
            } else {
              statusMessage = "Delivered (Status Check Failed)";
              returnEligibilityReason = "Unable to verify delivery date. Please contact support";
              isReturnable = false;
            }
          }
        }
      } else if (fulfillment && fulfillment.status === 'success') {
         statusMessage = "Shipped"; 
         returnEligibilityReason = "This item has been shipped but not yet delivered";
         isReturnable = false; 
      } else if (fulfillment) {
         statusMessage = "In Transit";
         returnEligibilityReason = "This item is currently in transit and not yet eligible for return";
         isReturnable = false;
      } else {
        statusMessage = "Not Shipped";
         returnEligibilityReason = "This item has not been shipped yet and is not eligible for return";
         isReturnable = false;
      }

      return {
        ...order,
        delivery_status: {
          delivered_date: deliveredDate,
          is_returnable: isReturnable,
          message: statusMessage,
          eligibility_reason: returnEligibilityReason
        }
      };
    }));

    return NextResponse.json({ orders: enrichedOrders });

  } catch (error) {
    console.error('Server Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
