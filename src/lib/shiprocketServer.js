/**
 * Server-only Shiprocket helpers. All RTO data is auto-filled from Shopify order + env.
 *
 * RTO semantics:
 * - Pickup = address the order was delivered to (customer's shipping address from Shopify).
 * - Shipping = warehouse (return is received at warehouse). From env WAREHOUSE_*.
 */

async function getPincodeDetails(pincode) {
  const digits = String(pincode).replace(/\D/g, "").slice(0, 6);
  if (!digits) return null;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${digits}`, {
      next: { revalidate: 86400 },
    });
    const data = await res.json();
    const first = data?.[0];
    if (first?.Status !== "Success" || !first?.PostOffice?.length) return null;
    const po = first.PostOffice[0];
    return {
      city: po.District || po.Name || "",
      state: po.State || "",
      country: "India",
    };
  } catch {
    return null;
  }
}

async function getShopifyOrderAddress(orderId, shopifyDomain, shopifyToken) {
  const rawId = String(orderId).trim();
  const nameQuery = rawId.replace(/^#/, "").trim();
  if (!nameQuery) return null;

  // 1) Try direct lookup by order name (fast path)
  let url = `https://${shopifyDomain}/admin/api/2025-01/orders.json?name=${encodeURIComponent(
    nameQuery
  )}&limit=1`;
  let res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": shopifyToken },
  });
  let data = await res.json();
  let order = (data.orders || [])[0];

  // 2) Fallback: scan recent orders if direct name lookup fails
  if (!order) {
    const allOrders = [];
    let nextUrl = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&limit=250`;
    const maxPages = 5;

    for (let page = 0; page < maxPages; page++) {
      res = await fetch(nextUrl, {
        headers: { "X-Shopify-Access-Token": shopifyToken },
      });
      data = await res.json();
      const list = data.orders || [];
      allOrders.push(...list);

      const linkHeader = res.headers.get("Link");
      const nextMatch = linkHeader && linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (!nextMatch || list.length < 250) break;
      nextUrl = nextMatch[1];
    }

    const normalized = nameQuery;
    const withHash = rawId.startsWith("#") ? rawId : `#${normalized}`;
    const orderNumber = Number(normalized);

    order =
      allOrders.find(
        (o) =>
          o.name === rawId ||
          o.name === withHash ||
          o.name === normalized ||
          (orderNumber && o.order_number === orderNumber)
      ) || null;
    if (!order) return null;
  }

  const addr = order.shipping_address || order.billing_address;
  if (!addr) return null;
  return {
    first_name: addr.first_name || order.customer?.first_name || "",
    last_name: addr.last_name || order.customer?.last_name || "",
    address1: addr.address1 || "",
    address2: addr.address2 || "",
    city: addr.city || "",
    province: addr.province || addr.province_code || "",
    zip: (addr.zip || "").replace(/\s/g, ""),
    country: addr.country_name || addr.country || "India",
    phone: addr.phone || order.phone || "",
    email: order.email || "",
    order, // full order for items/weight if needed
  };
}

/** Warehouse (return destination) details - hardcoded Greater Noida address */
async function getWarehouseDetails() {
  return {
    shipping_customer_name: "Satmi Warehouse",
    shipping_address: "Plot No 519, Roja Yaqubpur, Sec 16B",
    shipping_address_2: "Greater Noida",
    shipping_city: "Greater Noida",
    shipping_state: "Uttar Pradesh",
    shipping_country: "India",
    shipping_pincode: "201306",
    shipping_phone: "9999999999",
  };
}

/**
 * Track a shipment by AWB number via Shiprocket.
 * Returns { status, deliveredDate } or null on failure.
 * status values: "DELIVERED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "PICKED_UP", "PENDING", etc.
 */
export async function trackShipmentByAwb(awb, token) {
  if (!awb) return null;
  try {
    const srToken = token || await getShiprocketToken();
    const res = await fetch(`https://apiv2.shiprocket.in/v1/external/courier/track/awb/${encodeURIComponent(awb)}`, {
      headers: { Authorization: `Bearer ${srToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const shipment = data?.tracking_data?.shipment_track?.[0];
    if (!shipment) return null;

    const currentStatus = (shipment.current_status || "").toUpperCase();
    const deliveredDate = shipment.delivered_date || null;

    // Normalize Shiprocket status strings
    let normalizedStatus;
    if (currentStatus === "DELIVERED" || currentStatus.includes("DELIVERED")) {
      normalizedStatus = "DELIVERED";
    } else if (currentStatus.includes("OUT FOR DELIVERY") || currentStatus === "OUT_FOR_DELIVERY") {
      normalizedStatus = "OUT_FOR_DELIVERY";
    } else if (currentStatus.includes("IN TRANSIT") || currentStatus === "IN_TRANSIT" || currentStatus === "SHIPPED") {
      normalizedStatus = "IN_TRANSIT";
    } else if (currentStatus.includes("PICKED UP") || currentStatus === "PICKED_UP") {
      normalizedStatus = "PICKED_UP";
    } else if (currentStatus === "RTO" || currentStatus.includes("RETURN")) {
      normalizedStatus = "RTO";
    } else if (currentStatus === "CANCELLED") {
      normalizedStatus = "CANCELLED";
    } else {
      normalizedStatus = "PENDING";
    }

    return { status: normalizedStatus, deliveredDate, rawStatus: shipment.current_status };
  } catch (e) {
    console.error("Shiprocket tracking error for AWB", awb, e);
    return null;
  }
}

export async function getShiprocketToken() {
  const email = (process.env.SHIPROCKET_EMAIL || "").trim();
  const password = (process.env.SHIPROCKET_PASSWORD || "").trim();
  if (!email || !password) {
    throw new Error("Shiprocket credentials missing. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in .env (wrap password in double quotes if it contains $ % ^ & !).");
  }

  const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.message || data.msg || data.error || (typeof data === "string" ? data : null);
    throw new Error(msg || `Shiprocket login failed (${res.status}). Check email/password and use an API user from Shiprocket Dashboard → Settings → API.`);
  }
  if (!data.token) {
    throw new Error("Shiprocket did not return a token. Use an API user from Shiprocket Dashboard → Settings → API.");
  }
  return data.token;
}

/**
 * Create RTO in Shiprocket.
 * Pickup = customer address (where order was delivered). Delivery = warehouse.
 * Returns { success, shipmentId, awb, courier } or { success: false, error }.
 * 
 * NOTE: For zero human intervention to work, ensure the following in Shiprocket Dashboard:
 * 1. Go to Settings → API & Webhooks → API Settings
 * 2. Enable "Auto-approve return requests" if available
 * 3. Ensure your API user has "Returns Management" permissions
 * 4. Some Shiprocket plans may require manual approval - contact Shiprocket support
 *    to enable automatic return order creation without manual review
 */
export async function createReturnOrder(params) {
  const { orderId, customerName, email, phone, originalCourier, testMode = false, warehouseAddress, shopifyOrderData } = params;

  const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
  const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;
  const WAREHOUSE_PINCODE = process.env.WAREHOUSE_PINCODE || "201318";
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
    return { success: false, error: "Shiprocket credentials not configured" };
  }
  if (!orderId) {
    return { success: false, error: "orderId is required" };
  }

  let pickup = null;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    return {
      success: false,
      error: "Shopify not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN.",
    };
  }
  pickup = await getShopifyOrderAddress(orderId, SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN);
  if (!pickup || !pickup.zip) {
    return {
      success: false,
      error:
        "Could not get customer address from Shopify order. Ensure the order exists and has a shipping/billing address.",
    };
  }

  const pickupPincode = String(pickup.zip).replace(/\D/g, "").slice(0, 6) || pickup.zip;
  const pickupPhone = pickup.phone || phone || "";
  const pickupEmail = pickup.email || email || "";
  const pickupName =
    [pickup.first_name, pickup.last_name].filter(Boolean).join(" ") || customerName || "Customer";

  const pincodeDetails = await getPincodeDetails(pickupPincode);
  const pickupCity = (pincodeDetails?.city || pickup.city || "").trim() || "Unknown";
  const pickupState = (pincodeDetails?.state || pickup.province || "").trim() || "Unknown";
  const pickupAddress1 = (pickup.address1 || "").trim() || "Address not specified";
  const pickupAddress2 = (pickup.address2 || "").trim();

  let token;
  try {
    token = await getShiprocketToken();
  } catch (e) {
    return { success: false, error: e.message || "Shiprocket login failed" };
  }

  const rateUrl = `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${WAREHOUSE_PINCODE}&weight=0.5&cod=0`;
  const rateRes = await fetch(rateUrl, { headers: { Authorization: `Bearer ${token}` } });
  const rateData = await rateRes.json();
  if (!rateData.data || !rateData.data.available_courier_companies) {
    return { success: false, error: `No couriers available for pincode ${pickupPincode}.` };
  }

  let couriers = rateData.data.available_courier_companies;
  
  // Advanced Courier Selection Logic
  // 1. Filter to only include: Delhivery, Xpressbees, Shiprocket, or Ekart
  const allowedCouriers = ['delhivery', 'xpressbees', 'shiprocket', 'ekart'];
  let filteredCouriers = couriers.filter(c => {
    const courierName = c.courier_name.toLowerCase();
    return allowedCouriers.some(allowed => courierName.includes(allowed));
  });
  
  // 2. Filter shipping mode to strictly select Surface Delivery
  const surfaceCouriers = filteredCouriers.filter((c) => c.mode_name && c.mode_name.toLowerCase() === "surface");
  const validCouriers = surfaceCouriers.length > 0 ? surfaceCouriers : filteredCouriers;
  
  // 3. Sort by rate to find cheapest
  validCouriers.sort((a, b) => a.rate - b.rate);
  const cheapestSurfaceCourier = validCouriers[0];
  
  let selected = cheapestSurfaceCourier;
  
  // 4. Find original courier price if available
  let originalCourierPrice = null;
  if (originalCourier) {
    const originalCourierData = couriers.find(c => 
      c.courier_name.toLowerCase().includes(originalCourier.toLowerCase())
    );
    if (originalCourierData) {
      originalCourierPrice = originalCourierData.rate;
    }
  }
  
  // 5. Apply the Math Logic
  if (originalCourierPrice !== null && cheapestSurfaceCourier) {
    const priceDifference = Math.abs(cheapestSurfaceCourier.rate - originalCourierPrice);
    
    // If difference <= ₹5, select Original Courier
    // If difference > ₹5, select Cheapest Surface Courier
    if (priceDifference <= 5) {
      const originalCourierInFiltered = validCouriers.find(c => 
        c.courier_name.toLowerCase().includes(originalCourier.toLowerCase())
      );
      if (originalCourierInFiltered) {
        selected = originalCourierInFiltered;
      }
    }
  }
  
  // Fallback: If no filtered couriers found, use original logic
  if (!selected) {
    const surface = couriers.filter((c) => c.mode_name && c.mode_name.toLowerCase() === "surface");
    const fallbackCouriers = surface.length > 0 ? surface : couriers;
    fallbackCouriers.sort((a, b) => a.rate - b.rate);
    selected = fallbackCouriers[0];
  }

  if (testMode) {
    return {
      success: true,
      mode: "TEST",
      courier: selected.courier_name,
      awb: "TEST-AWB-" + Date.now(),
      shipmentId: null,
    };
  }

  const warehouse = warehouseAddress || await getWarehouseDetails();
  const orderDate = (pickup.order?.created_at && new Date(pickup.order.created_at).toISOString().split("T")[0]) || new Date().toISOString().split("T")[0];
  const firstLineItem = pickup.order?.line_items?.[0];
  const itemName = (firstLineItem?.name || "Return").slice(0, 100);
  
  // Use accurate refund amount from Shopify data or fallback to item price
  let subTotal = 100; // Default fallback
  if (shopifyOrderData?.refundAmount) {
    subTotal = Math.max(1, Math.round(parseFloat(shopifyOrderData.refundAmount)));
  } else if (firstLineItem?.price) {
    subTotal = Math.max(1, Math.round(Number(firstLineItem.price)));
  }

  const orderPayload = {
    order_id: String(orderId).slice(0, 50),
    order_date: orderDate,
    pickup_customer_name: pickupName,
    pickup_address: pickupAddress1,
    pickup_address_2: pickupAddress2,
    pickup_city: pickupCity,
    pickup_state: pickupState,
    pickup_country: pincodeDetails?.country || pickup.country || "India",
    pickup_pincode: String(pickupPincode),
    pickup_phone: String(pickupPhone).replace(/\D/g, "").slice(-10) || pickupPhone,
    pickup_email: pickupEmail,
    shipping_customer_name: warehouse.shipping_customer_name || warehouse.name,
    shipping_address: warehouse.shipping_address || warehouse.address,
    shipping_address_2: warehouse.shipping_address_2 || warehouse.address2,
    shipping_city: warehouse.shipping_city || warehouse.city,
    shipping_state: warehouse.shipping_state || warehouse.state,
    shipping_country: warehouse.shipping_country || warehouse.country || "India",
    shipping_pincode: String(warehouse.shipping_pincode || warehouse.pincode),
    shipping_phone: String(warehouse.shipping_phone || warehouse.phone),
    length: 10,
    breadth: 10,
    height: 10,
    weight: 0.5,
    sub_total: subTotal,
    order_items: [{ name: itemName, sku: "RET", units: 1, selling_price: subTotal }],
    payment_method: "Prepaid",
    courier_id: selected.courier_company_id,
  };

  const createRes = await fetch("https://apiv2.shiprocket.in/v1/external/orders/create/return", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(orderPayload),
  });
  const createData = await createRes.json();

  if (!createData.shipment_id) {
    const errMsg =
      createData.message ||
      createData.msg ||
      (Array.isArray(createData.errors) ? createData.errors.join(", ") : null) ||
      (createData.errors && typeof createData.errors === "object" ? JSON.stringify(createData.errors) : null);
    return {
      success: false,
      error: errMsg || JSON.stringify(createData),
    };
  }

  return {
    success: true,
    mode: "LIVE",
    courier: selected.courier_name,
    awb: createData.awb_code || "PENDING",
    shipmentId: createData.shipment_id,
  };
}

/**
 * Generate label for a Shiprocket return order. Returns { success, labelUrl } or { success: false, error }.
 */
export async function generateLabel(shipmentId) {
  if (shipmentId == null) return { success: false, error: "shipmentId required" };
  const orderIds = [Number(shipmentId)];
  const token = await getShiprocketToken();
  const labelRes = await fetch(
    "https://apiv2.shiprocket.in/v1/external/courier/generate/label",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ order_id: orderIds }),
    }
  );
  const labelData = await labelRes.json();
  if (!labelRes.ok) {
    return {
      success: false,
      error: labelData.message || JSON.stringify(labelData),
    };
  }
  // Try all common locations for label URL
  let labelUrl =
    labelData.label_url ||
    labelData.label_urls?.[0] ||
    labelData.url ||
    labelData.shipment_label_url ||
    labelData.data?.label_url ||
    labelData.data?.label_urls?.[0];

  // Heuristic fallback: search recursively for the first http(s) URL (often a PDF)
  if (!labelUrl) {
    const seen = new Set();
    const stack = [labelData];
    while (stack.length && !labelUrl) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      for (const value of Object.values(current)) {
        if (typeof value === "string") {
          if (/^https?:\/\//i.test(value)) {
            labelUrl = value;
            break;
          }
        } else if (value && typeof value === "object") {
          stack.push(value);
        }
      }
    }
  }

  return { success: true, labelUrl: labelUrl || null, raw: labelData };
}
