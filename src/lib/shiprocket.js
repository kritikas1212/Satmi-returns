// src/lib/shiprocket.js
let tokenCache = null;
let tokenExpiry = 0;

export async function getShiprocketToken() {
  // Return cached token if still valid (prevents banning)
  if (tokenCache && Date.now() < tokenExpiry) return tokenCache;

  const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error("Shiprocket Login Failed");

  tokenCache = data.token;
  tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // Cache for 24 hours
  return tokenCache;
}

export async function checkDeliveryDate(awbCode) {
  if (!awbCode) return null;

  try {
    const token = await getShiprocketToken();
    
    // Fetch Tracking Data
    const res = await fetch(`https://apiv2.shiprocket.in/v1/external/courier/track/awb/${awbCode}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    
    const data = await res.json();
    const trackData = data?.tracking_data?.track_url; // Adjust based on actual response structure if needed
    
    // Shiprocket tracking response structure is tricky. 
    // Usually: data.tracking_data.shipment_track[0].delivered_date
    const shipment = data?.tracking_data?.shipment_track?.[0];

    if (shipment && shipment.current_status === "DELIVERED") {
      return shipment.delivered_date; // Format: "2024-02-01 14:30:00"
    }
    
    return null; // Not delivered yet
  } catch (error) {
    console.error("Tracking Error:", error);
    return null;
  }
}