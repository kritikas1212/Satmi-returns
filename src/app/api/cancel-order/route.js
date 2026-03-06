import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const { shopifyOrderId, orderName } = body;

    if (!shopifyOrderId) {
      return NextResponse.json(
        { success: false, error: 'Shopify order ID is required', code: 'MISSING_ORDER_ID' },
        { status: 400 }
      );
    }

    const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN } = process.env;
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Shopify not configured', code: 'SHOPIFY_CONFIG_MISSING' },
        { status: 500 }
      );
    }

    // Ensure domain ends with .myshopify.com
    const rawDomain = SHOPIFY_STORE_DOMAIN.replace('.myshopify.com', '');
    const shopDomain = `${rawDomain}.myshopify.com`;

    // Shopify REST API needs a numeric ID.
    // GraphQL GIDs look like "gid://shopify/Order/12345678" — extract the number.
    const numericOrderId = String(shopifyOrderId).includes('gid://')
      ? String(shopifyOrderId).split('/').pop()
      : String(shopifyOrderId);

    if (!numericOrderId || !/^\d+$/.test(numericOrderId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid order ID format', code: 'INVALID_ORDER_ID' },
        { status: 400 }
      );
    }

    const headers = {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
      'User-Agent': 'Satmi-Returns/1.0',
    };

    // ---------------------------------------------------------------
    // 1. Fetch the order from Shopify to validate the 1-hour window
    //    server-side (never trust the frontend alone).
    // ---------------------------------------------------------------
    const orderUrl = `https://${shopDomain}/admin/api/2025-01/orders/${numericOrderId}.json`;
    const orderRes = await fetch(orderUrl, { headers });

    if (!orderRes.ok) {
      const errText = await orderRes.text();
      console.error('Failed to fetch order for cancellation:', errText);
      return NextResponse.json(
        { success: false, error: 'Could not fetch order from Shopify', code: 'FETCH_FAILED' },
        { status: 502 }
      );
    }

    const orderData = await orderRes.json();
    const order = orderData.order;

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found', code: 'ORDER_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Already cancelled?
    if (order.cancelled_at) {
      return NextResponse.json(
        { success: false, error: 'This order has already been cancelled', code: 'ALREADY_CANCELLED' },
        { status: 409 }
      );
    }

    // Already fulfilled?
    if (order.fulfillment_status === 'fulfilled' || order.fulfillment_status === 'partial') {
      return NextResponse.json(
        { success: false, error: 'Fulfilled orders cannot be cancelled. Please initiate a return instead.', code: 'ALREADY_FULFILLED' },
        { status: 409 }
      );
    }

    // ---------------------------------------------------------------
    // 2. Server-side 1-hour window validation
    // ---------------------------------------------------------------
    const createdAt = new Date(order.created_at).getTime();
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    if (now - createdAt > ONE_HOUR_MS) {
      return NextResponse.json(
        {
          success: false,
          error: 'The 1-hour cancellation window has expired for this order.',
          code: 'WINDOW_EXPIRED',
        },
        { status: 403 }
      );
    }

    // ---------------------------------------------------------------
    // 3. Cancel order via Shopify REST API.
    //    CRITICAL: restock is explicitly false — we do NOT have
    //    inventory permissions (no read_inventory / write_inventory).
    //    If REST cancel returns Not Found (deprecated endpoint), fall
    //    back to GraphQL orderCancel mutation.
    // ---------------------------------------------------------------
    const cancelUrl = `https://${shopDomain}/admin/api/2025-01/orders/${numericOrderId}/cancel.json`;
    const cancelRes = await fetch(cancelUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'customer',
        restock: false,       // CRITICAL — prevents 403 from missing inventory scope
        email: true,          // Shopify sends a cancellation email to the customer
      }),
    });

    if (!cancelRes.ok) {
      const cancelErr = await cancelRes.text();
      console.error('REST cancel failed, trying GraphQL fallback:', cancelErr);

      // ---------- GraphQL fallback ----------
      const gqlEndpoint = `https://${shopDomain}/admin/api/2025-01/graphql.json`;
      const gqlMutation = `
        mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
          orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
            job { id }
            orderCancelUserErrors { field message }
          }
        }
      `;
      const gqlRes = await fetch(gqlEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: gqlMutation,
          variables: {
            orderId: `gid://shopify/Order/${numericOrderId}`,
            reason: 'CUSTOMER',
            refund: true,
            restock: false,
          },
        }),
      });

      const gqlData = await gqlRes.json();
      const userErrors = gqlData?.data?.orderCancel?.orderCancelUserErrors || [];

      if (!gqlRes.ok || gqlData.errors || userErrors.length > 0) {
        const errMsg = userErrors.map(e => e.message).join('; ') ||
                       JSON.stringify(gqlData.errors) ||
                       cancelErr;
        console.error('GraphQL cancel also failed:', errMsg);
        return NextResponse.json(
          { success: false, error: 'Failed to cancel order with Shopify', code: 'CANCEL_FAILED', details: errMsg },
          { status: 502 }
        );
      }

      // GraphQL cancel succeeded
      return NextResponse.json({
        success: true,
        message: `Order ${orderName || shopifyOrderId} has been cancelled successfully.`,
        order: {
          id: numericOrderId,
          name: orderName || order.name,
          cancelled_at: new Date().toISOString(),
        },
      });
    }

    const cancelData = await cancelRes.json();

    return NextResponse.json({
      success: true,
      message: `Order ${orderName || shopifyOrderId} has been cancelled successfully.`,
      order: {
        id: cancelData.order?.id,
        name: cancelData.order?.name,
        cancelled_at: cancelData.order?.cancelled_at,
      },
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR', details: error.message },
      { status: 500 }
    );
  }
}
