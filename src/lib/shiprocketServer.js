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
  let url = `https://${shopifyDomain}/admin/api/2024-01/orders.json?name=${encodeURIComponent(
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
    let nextUrl = `https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&limit=250`;
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

/** Warehouse (return destination) details from env; city/state from pincode if not set. */
async function getWarehouseDetails() {
  const pincode = String(process.env.WAREHOUSE_PINCODE || "201318").replace(/\D/g, "").slice(0, 6);
  const name = (process.env.WAREHOUSE_NAME || "Satmi Warehouse").trim();
  const address = (process.env.WAREHOUSE_ADDRESS || "Warehouse").trim();
  const phone = (process.env.WAREHOUSE_PHONE || "").trim() || "9999999999";
  const pincodeDetails = await getPincodeDetails(pincode);
  return {
    shipping_customer_name: name,
    shipping_address: address,
    shipping_address_2: (process.env.WAREHOUSE_ADDRESS_2 || "").trim(),
    shipping_city: (pincodeDetails?.city || process.env.WAREHOUSE_CITY || "").trim() || "Noida",
    shipping_state: (pincodeDetails?.state || process.env.WAREHOUSE_STATE || "").trim() || "Uttar Pradesh",
    shipping_country: pincodeDetails?.country || process.env.WAREHOUSE_COUNTRY || "India",
    shipping_pincode: pincode,
    shipping_phone: phone,
  };
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
 */
export async function createReturnOrder(params) {
  const { orderId, customerName, email, phone, originalCourier, testMode = false } = params;

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
  const surface = couriers.filter((c) => c.mode_name && c.mode_name.toLowerCase() === "surface");
  const validCouriers = surface.length > 0 ? surface : couriers;
  validCouriers.sort((a, b) => a.rate - b.rate);
  const cheapest = validCouriers[0];
  let selected = cheapest;
  const delhivery = validCouriers.find((c) => c.courier_name.toLowerCase().includes("delhivery"));
  if (delhivery && delhivery.rate - cheapest.rate <= 5) selected = delhivery;

  if (testMode) {
    return {
      success: true,
      mode: "TEST",
      courier: selected.courier_name,
      awb: "TEST-AWB-" + Date.now(),
      shipmentId: null,
    };
  }

  const warehouse = await getWarehouseDetails();
  const orderDate = (pickup.order?.created_at && new Date(pickup.order.created_at).toISOString().split("T")[0]) || new Date().toISOString().split("T")[0];
  const firstLineItem = pickup.order?.line_items?.[0];
  const itemName = (firstLineItem?.name || "Return").slice(0, 100);
  const itemPrice = Number(firstLineItem?.price) || 100;
  const subTotal = Math.max(1, Math.round(itemPrice));

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
    ...warehouse,
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
