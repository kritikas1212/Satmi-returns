import { NextResponse } from "next/server";
import { z } from "zod";

// Validation schema for order modification
const UpdateOrderSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  shippingAddress: z.object({
    address1: z.string().min(1, "Address is required").max(255),
    address2: z.string().max(255).optional().default(""),
    city: z.string().max(100).optional(),
    province: z.string().max(100).optional(),
    zip: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
    phone: z.string().max(30).optional(),
  }).optional(),
  phone: z.string().max(30).optional(),
});

/**
 * PUT /api/order/update
 *
 * Updates the shipping address and/or phone number of a Shopify order.
 * Business rules enforced:
 *   1. Order must exist
 *   2. Order must be UNFULFILLED (not yet shipped)
 *   3. Order must be within 3 hours of creation
 *   4. Order must not be cancelled
 */
export async function PUT(request) {
  try {
    const body = await request.json();

    // Validate request
    const validation = UpdateOrderSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors.map((e) => e.message).join(", ");
      return NextResponse.json(
        { success: false, error: "Validation failed", code: "VALIDATION_ERROR", details: errors },
        { status: 400 }
      );
    }

    const { orderId, shippingAddress, phone } = validation.data;

    const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
    const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Shopify credentials not configured", code: "CONFIG_ERROR" },
        { status: 500 }
      );
    }

    const rawDomain = SHOPIFY_STORE_DOMAIN.replace(".myshopify.com", "");

    // --- Step 1: Fetch the order to validate business rules ---
    const cleanOrderId = String(orderId).replace("#", "").trim();

    // The orderId coming from the frontend could be the order name (e.g. "1023") or
    // a numeric Shopify REST ID. We search by name first and fall back to direct ID lookup.
    let shopifyOrder = null;

    // Try searching by name (handles both "1023" and "#1023")
    const searchUrl = `https://${rawDomain}.myshopify.com/admin/api/2025-01/orders.json?status=any&name=${encodeURIComponent(cleanOrderId)}&limit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.orders && searchData.orders.length > 0) {
        shopifyOrder = searchData.orders[0];
      }
    }

    // Fallback: try direct ID lookup (if orderId is a numeric Shopify ID)
    if (!shopifyOrder && /^\d+$/.test(cleanOrderId)) {
      const directUrl = `https://${rawDomain}.myshopify.com/admin/api/2025-01/orders/${cleanOrderId}.json`;
      const directRes = await fetch(directUrl, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (directRes.ok) {
        const directData = await directRes.json();
        shopifyOrder = directData.order || null;
      }
    }

    if (!shopifyOrder) {
      return NextResponse.json(
        { success: false, error: "Order not found", code: "ORDER_NOT_FOUND" },
        { status: 404 }
      );
    }

    // --- Step 2: Enforce business rules ---

    // 2a. Check if cancelled
    if (shopifyOrder.cancelled_at) {
      return NextResponse.json(
        { success: false, error: "Cannot modify a cancelled order", code: "ORDER_CANCELLED" },
        { status: 400 }
      );
    }

    // 2b. Check fulfillment status — only unfulfilled orders can be modified
    const fulfillmentStatus = shopifyOrder.fulfillment_status;
    if (fulfillmentStatus === "fulfilled" || fulfillmentStatus === "partial") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot modify an order that has already been shipped or partially shipped",
          code: "ORDER_FULFILLED",
        },
        { status: 400 }
      );
    }

    // 2c. Check 3-hour edit window
    const createdAt = new Date(shopifyOrder.created_at).getTime();
    const now = Date.now();
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    const timeRemaining = THREE_HOURS_MS - (now - createdAt);

    if (timeRemaining <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Modification window expired. Orders can only be modified within 3 hours of placement.",
          code: "EDIT_WINDOW_EXPIRED",
        },
        { status: 400 }
      );
    }

    // --- Step 3: Build the update payload ---
    const updatePayload = { order: {} };

    if (phone) {
      updatePayload.order.phone = phone;
    }

    if (shippingAddress) {
      updatePayload.order.shipping_address = {
        ...shopifyOrder.shipping_address,
        address1: shippingAddress.address1 || shopifyOrder.shipping_address?.address1,
        address2: shippingAddress.address2 ?? shopifyOrder.shipping_address?.address2 ?? "",
        city: shippingAddress.city || shopifyOrder.shipping_address?.city,
        province: shippingAddress.province || shopifyOrder.shipping_address?.province,
        zip: shippingAddress.zip || shopifyOrder.shipping_address?.zip,
        country: shippingAddress.country || shopifyOrder.shipping_address?.country,
        phone: shippingAddress.phone || phone || shopifyOrder.shipping_address?.phone,
      };
    }

    // --- Step 4: Send the update to Shopify ---
    const updateUrl = `https://${rawDomain}.myshopify.com/admin/api/2025-01/orders/${shopifyOrder.id}.json`;

    console.log(`Updating order ${shopifyOrder.id} (${shopifyOrder.name}):`, JSON.stringify(updatePayload, null, 2));

    const updateRes = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatePayload),
    });

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      console.error(`Shopify update error (${updateRes.status}):`, errorText);

      let errorMessage = "Failed to update order on Shopify";
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.errors) {
          errorMessage = typeof errorJson.errors === "string"
            ? errorJson.errors
            : JSON.stringify(errorJson.errors);
        }
      } catch (_) {
        // Use default error message
      }

      return NextResponse.json(
        { success: false, error: errorMessage, code: "SHOPIFY_UPDATE_FAILED" },
        { status: updateRes.status }
      );
    }

    const updatedData = await updateRes.json();
    const updatedOrder = updatedData.order;

    console.log(`Order ${updatedOrder.name} updated successfully`);

    return NextResponse.json({
      success: true,
      message: `Order ${updatedOrder.name} updated successfully`,
      order: {
        id: updatedOrder.id,
        name: updatedOrder.name,
        phone: updatedOrder.phone,
        shipping_address: updatedOrder.shipping_address
          ? {
              address1: updatedOrder.shipping_address.address1,
              address2: updatedOrder.shipping_address.address2,
              city: updatedOrder.shipping_address.city,
              province: updatedOrder.shipping_address.province,
              zip: updatedOrder.shipping_address.zip,
              country: updatedOrder.shipping_address.country,
              phone: updatedOrder.shipping_address.phone,
              name: updatedOrder.shipping_address.name,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Order update error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        code: "INTERNAL_ERROR",
        details: error.message,
      },
      { status: 500 }
    );
  }
}
