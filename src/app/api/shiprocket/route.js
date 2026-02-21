import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      orderId, customerName, email, phone, 
      pincode, originalCourier, testMode 
    } = body;

    // CREDENTIALS
    const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
    const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;
    const WAREHOUSE_PINCODE = process.env.WAREHOUSE_PINCODE || "201318";
    
    if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
      return NextResponse.json({ success: false, error: "Shiprocket credentials not configured" }, { status: 500 });
    }

    // 1. Authenticate with Shiprocket
    const loginRes = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD })
    });
    
    if (!loginRes.ok) throw new Error("Shiprocket Login Failed");
    const loginData = await loginRes.json();
    const token = loginData.token;

    // 2. Check Courier Serviceability
    const rateUrl = `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=${pincode}&delivery_postcode=${WAREHOUSE_PINCODE}&weight=0.5&cod=0`;
    const rateRes = await fetch(rateUrl, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const rateData = await rateRes.json();

    if (!rateData.data || !rateData.data.available_courier_companies) {
      return NextResponse.json({ success: false, error: "No couriers available for this pincode." });
    }

    // 3. INTELLIGENT COURIER SELECTION (Surface + 5 Rupee Rule)
    let couriers = rateData.data.available_courier_companies;
    
    // Filter for SURFACE mode only
    const surface = couriers.filter(c => c.mode_name && c.mode_name.toLowerCase() === "surface");
    const validCouriers = surface.length > 0 ? surface : couriers; // Fallback to air if no surface

    // Sort by Price (Lowest to Highest)
    validCouriers.sort((a, b) => a.rate - b.rate);
    const cheapest = validCouriers[0];
    let selected = cheapest;

    // Apply 5 Rupee Rule for Delhivery preference
    if (originalCourier || true) { // Defaulting to prefer Delhivery if close enough
       const match = validCouriers.find(c => c.courier_name.toLowerCase().includes("delhivery"));
       if (match && (match.rate - cheapest.rate) <= 5) {
         selected = match;
       }
    }

    // 4. TEST MODE (Don't create real order)
    if (testMode) {
      return NextResponse.json({
        success: true,
        mode: "TEST",
        courier: selected.courier_name,
        awb: "TEST-AWB-" + Date.now(),
        rate: selected.rate
      });
    }

    // 5. LIVE MODE (Create Real Order)
    const orderPayload = {
      order_id: orderId,
      order_date: new Date().toISOString().split('T')[0],
      pickup_customer_name: customerName,
      pickup_pincode: pincode,
      pickup_phone: phone,
      pickup_email: email,
      length: 10, breadth: 10, height: 10, weight: 0.5,
      order_items: [{ name: "Return", sku: "RET", units: 1, selling_price: "100" }],
      payment_method: "Prepaid",
      courier_id: selected.courier_company_id // Force the intelligent selection
    };

    const createRes = await fetch("https://apiv2.shiprocket.in/v1/external/orders/create/return", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(orderPayload)
    });
    const createData = await createRes.json();

    if (!createData.shipment_id) {
       return NextResponse.json({ success: false, error: JSON.stringify(createData) });
    }

    return NextResponse.json({
      success: true,
      mode: "LIVE",
      courier: selected.courier_name,
      awb: createData.awb_code || "PENDING",
      shipmentId: createData.shipment_id,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}