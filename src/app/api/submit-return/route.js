import { NextResponse } from 'next/server';
import { doc, setDoc, serverTimestamp, query, where, getDocs, collection } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { z } from 'zod';
import { Resend } from 'resend';

// Use RESEND_FROM_EMAIL env var once satmi.in is verified in Resend dashboard.
// Until then, Resend's shared domain is used so emails actually deliver.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Satmi Returns <onboarding@resend.dev>";
const MAX_RETURN_REQUESTS_PER_USER = 2;

// Validation schemas
const SubmitReturnSchema = z.object({
  orderId: z.string().min(1, "Order ID is required").max(50, "Order ID too long"),
  customerName: z.string().min(1, "Customer name is required").max(100, "Customer name too long"),
  email: z.string().email("Invalid email format").min(1, "Email is required"),
  items: z.array(z.object({
    lineItemId: z.string().min(1, "Line item ID is required"),
    id: z.string().min(1, "Item ID is required"),
    title: z.string().min(1, "Item title is required"),
    quantity: z.number().min(1, "Quantity must be at least 1").max(100, "Quantity too high"),
    price: z.number().min(0, "Price must be positive").max(999999, "Price too high")
  })).min(1, "At least one item is required").max(20, "Too many items"),
  phone: z.string().min(10, "Phone number is required").max(20, "Phone number too long"),
  reason: z.string().min(1, "Return reason is required").max(500, "Return reason too long"),
  comments: z.string().max(1000, "Comments too long").optional(),
  videoUrl: z.string().url("Invalid video URL").min(1, "Video URL is required"),
  originalCourier: z.string().max(100, "Courier name too long").optional()
});

// Check if line items already have returns (idempotency check)
async function checkExistingReturns(orderId, lineItemIds) {
  try {
    const returnsQuery = query(
      collection(db, "returns"),
      where("orderId", "==", orderId)
    );
    const querySnapshot = await getDocs(returnsQuery);
    const existingReturns = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Check if any selected line items already have an active return workflow.
    const existingLineItemIds = new Set();
    existingReturns.forEach(returnDoc => {
      const workflow = String(returnDoc.workflowStatus || '').toUpperCase();
      const legacy = String(returnDoc.status || '').toLowerCase();
      const isRejected = workflow === 'RETURN_REJECTED' || legacy === 'rejected';
      if (isRejected) return;

      if (returnDoc.items && Array.isArray(returnDoc.items)) {
        returnDoc.items.forEach(item => {
          if (item.lineItemId) {
            existingLineItemIds.add(item.lineItemId);
          }
        });
      }
    });
    
    // Find which items have already been returned
    const alreadyReturned = lineItemIds.filter(id => existingLineItemIds.has(id));
    
    return {
      hasExistingReturns: alreadyReturned.length > 0,
      alreadyReturned,
      existingReturns
    };
  } catch (error) {
    console.error("Error checking existing returns:", error);
    return { hasExistingReturns: false, alreadyReturned: [] };
  }
}

// Enforce a hard per-user limit (includes all requests, even rejected)
async function checkUserReturnLimit(phone) {
  try {
    const returnsQuery = query(
      collection(db, "returns"),
      where("phone", "==", phone)
    );
    const querySnapshot = await getDocs(returnsQuery);
    const totalReturns = querySnapshot.size;

    return {
      exceeded: totalReturns >= MAX_RETURN_REQUESTS_PER_USER,
      totalReturns
    };
  } catch (error) {
    console.error("Error checking user return limit:", error);
    return { exceeded: false, totalReturns: 0 };
  }
}

// Fetch Shopify order details using GraphQL
async function fetchShopifyOrder(orderId) {
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    console.warn("Shopify credentials not configured");
    return null;
  }

  // Clean domain - remove .myshopify.com if it's already included
  const rawDomain = SHOPIFY_STORE_DOMAIN.replace('.myshopify.com', '');
  const graphqlEndpoint = `https://${rawDomain}.myshopify.com/admin/api/2025-01/graphql.json`;

  const graphqlQuery = `
    query getOrderByNumber($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
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
      }
    }
  `;

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
        variables: { query: `name:${orderId}` }
      }),
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error(`Shopify GraphQL error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
      return null;
    }

    const orders = data.data?.orders?.edges?.map(edge => edge.node) || [];
    return orders.length > 0 ? orders[0] : null;
  } catch (error) {
    console.error("Error fetching Shopify order:", error);
    return null;
  }
}

export async function POST(request) {
  try {
    if (!db) {
      console.error('Firestore not configured — Firebase client SDK missing or env vars not set');
      return NextResponse.json(
        { success: false, error: 'Server configuration error. Please contact support.', code: 'DB_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    const body = await request.json();
    
    // Validate request body
    const validationResult = SubmitReturnSchema.safeParse(body);
    
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
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
    
    const { 
      orderId, 
      customerName, 
      email, 
      items, // Array of items being returned with lineItemId
      phone, 
      reason, 
      comments, 
      videoUrl, // Now this is the public URL from direct upload
      originalCourier
    } = validationResult.data;

    // Validate items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Items array is required and cannot be empty", code: "MISSING_ITEMS" },
        { status: 400 }
      );
    }

    // Extract line item IDs for idempotency check
    const lineItemIds = items.map(item => item.lineItemId).filter(Boolean);
    
    if (lineItemIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "Items must include lineItemId for idempotency check", code: "MISSING_LINE_ITEM_IDS" },
        { status: 400 }
      );
    }

    // Hard cap: max 2 return requests per user (including rejected requests)
    const userLimitCheck = await checkUserReturnLimit(phone);
    if (userLimitCheck.exceeded) {
      return NextResponse.json(
        {
          success: false,
          error: "You have reached the maximum limit of 2 return requests. Please contact support@satmi.in for further assistance.",
          code: "RETURN_LIMIT_REACHED",
          details: {
            totalReturns: userLimitCheck.totalReturns,
            maxAllowed: MAX_RETURN_REQUESTS_PER_USER
          }
        },
        { status: 429 }
      );
    }

    // Check for existing returns (idempotency)
    const existingCheck = await checkExistingReturns(orderId, lineItemIds);
    
    if (existingCheck.hasExistingReturns) {
      const itemTitles = existingCheck.alreadyReturned.map(id => {
        const item = items.find(i => i.lineItemId === id);
        return item?.title || id;
      }).join(', ');
      
      return NextResponse.json(
        { 
          success: false, 
          error: `Return request already exists for: ${itemTitles}`, 
          code: "DUPLICATE_RETURN",
          details: {
            alreadyReturnedItems: existingCheck.alreadyReturned,
            existingReturns: existingCheck.existingReturns
          }
        },
        { status: 409 }
      );
    }

    // Fetch Shopify order details for accurate refund amount
    const shopifyOrder = await fetchShopifyOrder(orderId);
    
    // Calculate accurate refund amount from Shopify order
    let orderTotal = 0;
    let refundAmount = 0;
    
    if (shopifyOrder) {
      orderTotal = parseFloat(shopifyOrder.totalPriceSet?.shopMoney?.amount || 0);
      
      // Calculate refund amount based on returned items
      if (items.length > 0) {
        refundAmount = 0;
        for (const returnItem of items) {
          const lineItem = shopifyOrder.lineItems?.edges?.find(
            edge => edge.node.id === returnItem.lineItemId
          );
          
          if (lineItem) {
            const itemPrice = parseFloat(lineItem.node.originalUnitPriceSet?.shopMoney?.amount || 0);
            refundAmount += itemPrice * (returnItem.quantity || 1);
          }
        }
      }
    }

    // Save to Firestore for manual review
    try {
      const returnDoc = {
        orderId,
        customerName,
        email,
        items: items.map(item => ({
          ...item,
          lineItemId: item.lineItemId // Store line item ID for idempotency
        })),
        phone,
        reason,
        comments: comments || "No comments",
        videoUrl, // This is now the public URL from Firebase Storage
        originalCourier: originalCourier || null,
        status: "Pending",
        workflowStatus: "RETURN_REQUESTED",
        createdAt: serverTimestamp(),
        // Shopify order details
        shopifyOrderData: {
          orderTotal: orderTotal,
          refundAmount: refundAmount,
          currency: shopifyOrder?.totalPriceSet?.shopMoney?.currencyCode || "INR",
          orderDate: shopifyOrder?.createdAt || null,
          financialStatus: "paid"
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
      console.error("Firestore write failed:", firestoreErr);
      return NextResponse.json(
        { success: false, error: "Failed to save return request", code: "FIRESTORE_ERROR", details: firestoreErr.message }, 
        { status: 500 }
      );
    }

    // Send confirmation email to customer
    let emailSent = false;
    let emailError = null;

    if (email && process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const itemsList = items.map(item => `<li>${item.title} (Qty: ${item.quantity}) — ₹${item.price}</li>`).join('');
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #7A1E1E; padding: 20px; text-align: center;">
              <h1 style="color: #fff; margin: 0; font-size: 20px;">Return Request Received</h1>
            </div>
            <div style="padding: 24px; background: #fff;">
              <p>Hi ${customerName || 'Customer'},</p>
              <p>We have received your return request for order <strong>${orderId}</strong>. Our team will review it and get back to you shortly.</p>
              <p><strong>Items requested for return:</strong></p>
              <ul>${itemsList}</ul>
              <p><strong>Reason:</strong> ${reason}</p>
              ${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 13px; color: #666;">You will receive another email once your return request has been reviewed. If approved, a return shipping label will be sent to this email address.</p>
              <p style="font-size: 13px; color: #666;">If you have any questions, please contact us at <a href="mailto:support@satmi.in">support@satmi.in</a>.</p>
              <p>— Satmi Support</p>
            </div>
          </div>
        `;
        const emailResult = await resend.emails.send({
          from: FROM_EMAIL,
          to: [email],
          subject: `Return Request Received - Order ${orderId} - Satmi`,
          html,
        });
        if (emailResult.error) {
          throw new Error(emailResult.error.message || 'Resend API error');
        }
        emailSent = true;
        console.log('Confirmation email sent, id:', emailResult.data?.id);
      } catch (emailErr) {
        emailError = emailErr?.message || 'Confirmation email failed';
        console.error('Confirmation email failed:', emailErr);
      }
    } else {
      emailError = !process.env.RESEND_API_KEY ? 'RESEND_API_KEY not configured' : 'Customer email not provided';
    }

    return NextResponse.json({
      success: true,
      message: "Return request submitted successfully. We will review and email you shortly.",
      data: {
        refundAmount,
        currency: shopifyOrder?.totalPriceSet?.shopMoney?.currencyCode || "INR",
        orderId,
        itemCount: items.length,
        emailSent,
        emailError
      }
    });

  } catch (error) {
    console.error('Submit return error:', error);
    return NextResponse.json(
      { success: false, error: "Internal server error", code: "INTERNAL_ERROR", details: error.message }, 
      { status: 500 }
    );
  }
}
