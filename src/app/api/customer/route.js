import { NextResponse } from 'next/server';
import { query, where, getDocs, collection } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { z } from 'zod';

// Validation schemas
const OrderIdSchema = z.object({
  orderId: z.string().min(1, "Order ID is required").max(50, "Order ID too long"),
  action: z.enum(["GET_CUSTOMER_DETAILS", "CHECK_STATUS"], {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_enum_value) {
        return { message: "Invalid action specified" };
      }
      return { message: ctx.defaultError };
    }
  }).optional().default("GET_CUSTOMER_DETAILS")
});

const CheckStatusSchema = z.object({
  orderId: z.string().min(1, "Order ID is required").max(50, "Order ID too long"),
  action: z.literal("CHECK_STATUS")
});

/**
 * Normalizes a Shopify GraphQL order into the REST-like flat format
 * the frontend expects. Orders already in REST format are returned as-is.
 */
function normalizeGraphQLOrder(order) {
  // Already REST format? (has snake_case line_items array)
  if (Array.isArray(order.line_items)) return order;

  const extractNumericId = (gid) => {
    if (!gid) return null;
    const s = String(gid);
    return s.includes('gid://') ? s.split('/').pop() : s;
  };

  const line_items = (order.lineItems?.edges || []).map((edge) => {
    const n = edge.node;
    return {
      id: extractNumericId(n.id),
      title: n.title,
      name: n.title,
      quantity: n.quantity || 1,
      price: n.originalUnitPriceSet?.shopMoney?.amount || '0.00',
      product_id: n.product?.id ? extractNumericId(n.product.id) : null,
      variant_id: n.variant?.id ? extractNumericId(n.variant.id) : null,
      variant_title: n.variant?.title || null,
      sku: n.variant?.sku || null,
      image: n.image?.url ? { src: n.image.url } : null,
    };
  });

  const fulfillments = (order.fulfillments || []).map((f) => {
    const t = f.trackingInfo?.[0] || {};
    return {
      id: extractNumericId(f.id),
      created_at: f.createdAt,
      tracking_company: t.company || null,
      tracking_number: t.number || null,
      tracking_url: t.url || null,
      status: 'success',
    };
  });

  const fMap = {
    PAID: 'paid', PENDING: 'pending', REFUNDED: 'refunded',
    VOIDED: 'voided', AUTHORIZED: 'authorized',
    PARTIALLY_PAID: 'partially_paid', PARTIALLY_REFUNDED: 'partially_refunded',
  };
  const ffMap = {
    FULFILLED: 'fulfilled', UNFULFILLED: null,
    PARTIALLY_FULFILLED: 'partial', IN_PROGRESS: 'partial',
  };

  return {
    id: extractNumericId(order.id),
    name: order.name,
    order_number: order.orderNumber || null,
    created_at: order.createdAt,
    cancelled_at: order.cancelledAt || null,
    financial_status: fMap[order.displayFinancialStatus] || (order.displayFinancialStatus || '').toLowerCase() || 'paid',
    fulfillment_status: ffMap[order.displayFulfillmentStatus] ?? null,
    phone: order.phone,
    customer: order.customer
      ? {
          id: extractNumericId(order.customer.id),
          first_name: order.customer.firstName,
          last_name: order.customer.lastName,
          email: order.customer.email,
          phone: order.customer.phone,
        }
      : null,
    billing_address: order.billingAddress
      ? { name: order.billingAddress.name, phone: order.billingAddress.phone, email: order.billingAddress.email }
      : null,
    shipping_address: order.shippingAddress
      ? { name: order.shippingAddress.name, phone: order.shippingAddress.phone }
      : null,
    line_items,
    fulfillments,
  };
}

// Check return status by order ID
export async function POST(request) {
  try {
    const body = await request.json();
    
    // Validate request body based on action
    let validationResult;
    if (body.action === 'CHECK_STATUS') {
      validationResult = CheckStatusSchema.safeParse(body);
    } else {
      validationResult = OrderIdSchema.safeParse(body);
    }
    
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join(', ');
      return NextResponse.json(
        { 
          success: false, 
          error: "Invalid request format", 
          code: "VALIDATION_ERROR",
          details: errorMessages 
        },
        { status: 400 }
      );
    }
    
    const { orderId, action } = validationResult.data;

    // Handle different actions
    if (action === 'CHECK_STATUS') {
      const returnsQuery = query(
        collection(db, "returns"),
        where("orderId", "==", orderId)
      );
      const querySnapshot = await getDocs(returnsQuery);
      const returns = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      if (returns.length === 0) {
        return NextResponse.json(
          { success: false, error: "No return requests found for this order", code: "NO_RETURNS_FOUND" },
          { status: 404 }
        );
      }

      // Return all return requests for this order with their status
      const returnStatuses = returns.map(returnDoc => ({
        id: returnDoc.id,
        status: returnDoc.status || "Pending",
        items: returnDoc.items || [],
        createdAt: returnDoc.createdAt?.toDate ? returnDoc.createdAt.toDate() : new Date(),
        refundAmount: returnDoc.shopifyOrderData?.refundAmount || 0,
        currency: returnDoc.shopifyOrderData?.currency || "INR"
      }));

      return NextResponse.json({
        success: true,
        orderId,
        returns: returnStatuses
      });
    } else {
      // Default action: Get customer details for login
      return await GET_CUSTOMER_DETAILS(orderId);
    }

  } catch (error) {
    console.error('Customer API error:', error);
    return NextResponse.json({ 
      success: false, 
      error: "Internal server error", 
      code: "INTERNAL_ERROR",
      details: error.message 
    }, { status: 500 });
  }
}

// Get customer details by order ID using Shopify GraphQL API
async function GET_CUSTOMER_DETAILS(orderId) {
  try {
    // Clean order ID - remove # if present
    const cleanOrderId = orderId.replace('#', '').trim();
    
    if (!cleanOrderId) {
      return NextResponse.json(
        { success: false, error: "Order ID is required", code: "MISSING_ORDER_ID" },
        { status: 400 }
      );
    }
    
    // Fetch from Shopify GraphQL to get customer phone number
    const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
    const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Shopify credentials not configured", code: "SHOPIFY_CONFIG_MISSING" },
        { status: 500 }
      );
    }

    console.log(`Processing order ID: ${cleanOrderId}`);

    // Clean domain - remove .myshopify.com if it's already included
    const rawDomain = SHOPIFY_STORE_DOMAIN.replace('.myshopify.com', '');
    const graphqlEndpoint = `https://${rawDomain}.myshopify.com/admin/api/2025-01/graphql.json`;

    // GraphQL query to search orders by name (handles both order ID and order name)
    const graphqlQuery = `
      query getOrderByNumber($query: String!) {
        orders(first: 10, query: $query) {
          edges {
            node {
              id
              name
              displayFinancialStatus
              displayFulfillmentStatus
              createdAt
              cancelledAt
              phone
              customer {
                id
                firstName
                lastName
                email
                phone
              }
              billingAddress {
                name
                phone
                email
              }
              shippingAddress {
                name
                phone
              }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    quantity
                    image {
                      url
                    }
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    variant {
                      id
                      sku
                      title
                    }
                  }
                }
              }
              fulfillments(first: 10) {
                createdAt
                trackingInfo {
                  company
                  number
                  url
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    // Optimized: only 2 most likely queries instead of 7 sequential ones
    const searchQueries = [
      `name:#${cleanOrderId}`,           // Most common: #1001
      `name:${cleanOrderId}`,            // Fallback: 1001
    ];

    let orderData = null;
    let phoneNumber = null;

    // Try primary queries first
    for (const query of searchQueries) {
      try {
        const response = await fetch(graphqlEndpoint, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
            'User-Agent': 'Satmi-Returns/1.0'
          },
          body: JSON.stringify({
            query: graphqlQuery,
            variables: { query }
          }),
          cache: 'no-store'
        });

        if (!response.ok) continue;

        const data = await response.json();
        if (data.errors) continue;

        const orders = data.data?.orders?.edges?.map(edge => edge.node) || [];

        if (orders.length > 0) {
          orderData = orders[0];
          phoneNumber = orderData.phone ||
                       orderData.customer?.phone ||
                       orderData.billingAddress?.phone ||
                       orderData.shippingAddress?.phone ||
                       "";
          break;
        }
      } catch (error) {
        console.error(`GraphQL query failed for ${query}:`, error.message);
        continue;
      }
    }

    if (!orderData) {
      // Fallback: Try REST API as backup
      try {
        const restEndpoint = `https://${rawDomain}.myshopify.com/admin/api/2025-01/orders.json?status=any&name=${encodeURIComponent(cleanOrderId)}&limit=1`;
        
        const restResponse = await fetch(restEndpoint, {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
            'User-Agent': 'Satmi-Returns/1.0'
          },
          cache: 'no-store'
        });

        if (restResponse.ok) {
          const restData = await restResponse.json();
          
          if (restData.orders && restData.orders.length > 0) {
            const restOrder = restData.orders[0];
            phoneNumber = restOrder.phone ||
                         restOrder.customer?.phone ||
                         restOrder.billing_address?.phone ||
                         restOrder.shipping_address?.phone ||
                         "";
            orderData = restOrder;
          }
        }
      } catch (restError) {
        console.error('REST fallback error:', restError.message);
      }
    }

    if (!orderData) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Order not found. Please verify the Order ID and try again.", 
          code: "ORDER_NOT_FOUND"
        },
        { status: 404 }
      );
    }

    if (!phoneNumber) {
      return NextResponse.json(
        { success: false, error: "No phone number found for this order. Please contact customer support.", code: "NO_PHONE_FOUND" },
        { status: 404 }
      );
    }

    // Fetch all orders for this phone in parallel (non-blocking for OTP)
    const allOrders = await fetchAllOrdersForPhoneGraphQL(phoneNumber, rawDomain, SHOPIFY_ACCESS_TOKEN);
    
    // Verify the original order is in the results (compare by name — works for both formats)
    const originalOrderName = orderData.name || `#${cleanOrderId}`;
    const originalOrderExists = allOrders.some(o => o.name === originalOrderName);
    
    if (!originalOrderExists) {
      // Add the original order to the results
      allOrders.push(orderData);
    }
    
    // Normalize all orders to REST-like flat format for the frontend
    const normalizedOrders = allOrders.map(normalizeGraphQLOrder);
    
    // Mask phone number for security
    const maskedPhone = phoneNumber.length > 4 
      ? `***-***-${phoneNumber.slice(-4)}` 
      : phoneNumber;

    // Extract customer info (handle both GraphQL and REST field names)
    const customerName = orderData.customer
      ? `${orderData.customer.firstName || orderData.customer.first_name || ''} ${orderData.customer.lastName || orderData.customer.last_name || ''}`.trim()
      : (orderData.billingAddress?.name || orderData.billing_address?.name || "Customer");

    return NextResponse.json({
      success: true,
      customer: {
        name: customerName || "Customer",
        email: orderData.customer?.email || orderData.billingAddress?.email || orderData.billing_address?.email || "",
        phone: phoneNumber,
        maskedPhone: maskedPhone,
        orderId: orderData.name || orderData.order_number || cleanOrderId
      },
      orders: normalizedOrders
    });

  } catch (error) {
    console.error('Get customer details error:', error);
    return NextResponse.json({ 
      success: false, 
      error: "Failed to process order. Please try again.", 
      code: "PROCESSING_ERROR",
      details: error.message 
    }, { status: 500 });
  }
}

// Fetch all orders for a phone number using Shopify GraphQL API
async function fetchAllOrdersForPhoneGraphQL(phoneNumber, domain, token) {
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  const last4 = cleanPhone.slice(-4);
  const last6 = cleanPhone.slice(-6);
  const last8 = cleanPhone.slice(-8);
  
  console.log(`Fetching orders for phone: ${cleanPhone.slice(-4)}`);
  
  const graphqlEndpoint = `https://${domain}.myshopify.com/admin/api/2025-01/graphql.json`;
  
  // GraphQL query to search orders by phone number
  const phoneSearchQuery = `
    query searchOrdersByPhone($query: String!) {
      orders(first: 50, query: $query) {
        edges {
          node {
            id
            name
            displayFinancialStatus
            displayFulfillmentStatus
            createdAt
            cancelledAt
            phone
            customer {
              id
              firstName
              lastName
              email
              phone
            }
            billingAddress {
              name
              phone
              email
            }
            shippingAddress {
              name
              phone
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  image {
                    url
                  }
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  variant {
                    id
                    sku
                    title
                  }
                }
              }
            }
            fulfillments(first: 10) {
              createdAt
              trackingInfo {
                company
                number
                url
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  let allOrders = [];
  
  // Optimized: only 2 most-likely queries instead of 5
  const searchQueries = [
    `phone:${cleanPhone}`,
    `phone:${phoneNumber}`,
  ];

  for (const query of searchQueries) {
    try {
      const response = await fetch(graphqlEndpoint, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          'User-Agent': 'Satmi-Returns/1.0'
        },
        body: JSON.stringify({
          query: phoneSearchQuery,
          variables: { query }
        }),
        cache: 'no-store'
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (data.errors) continue;

      const orders = data.data?.orders?.edges?.map(edge => edge.node) || [];
      
      if (orders.length > 0) {
        allOrders.push(...orders);
        break;
      }
    } catch (error) {
      console.error(`Phone search failed for query ${query}:`, error.message);
      continue;
    }
  }

  // Remove duplicates by order ID
  const uniqueOrders = allOrders.filter((order, index, self) => 
    index === self.findIndex((o) => o.id === order.id)
  );
  
  return uniqueOrders;
}
