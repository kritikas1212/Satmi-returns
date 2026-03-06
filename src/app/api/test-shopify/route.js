import { NextResponse } from 'next/server';

// Simple test endpoint to verify Shopify API connection
export async function GET() {
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    return NextResponse.json({
      success: false,
      error: "Shopify credentials not configured",
      domain: SHOPIFY_STORE_DOMAIN || "NOT_SET",
      token: SHOPIFY_ACCESS_TOKEN ? "SET" : "NOT_SET"
    });
  }

  try {
    console.log('Testing Shopify API connection...');
    console.log('Domain:', SHOPIFY_STORE_DOMAIN);
    console.log('Token:', SHOPIFY_ACCESS_TOKEN.substring(0, 10) + '...');
    
    // Test with a simple API call
    const testUrl = `https://${SHOPIFY_STORE_DOMAIN}.myshopify.com/admin/api/2023-10/shop.json`;
    
    const response = await fetch(testUrl, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'Satmi-Returns-Test/1.0'
      }
    });
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', errorText);
      
      return NextResponse.json({
        success: false,
        error: `Shopify API error: ${response.status}`,
        details: errorText,
        url: testUrl
      });
    }
    
    const data = await response.json();
    
    return NextResponse.json({
      success: true,
      message: "Shopify API connection successful",
      shop: data.shop?.name || "Unknown",
      domain: SHOPIFY_STORE_DOMAIN,
      responseStatus: response.status
    });
    
  } catch (error) {
    console.error('Connection test error:', error);
    
    return NextResponse.json({
      success: false,
      error: `Connection failed: ${error.message}`,
      code: error.code,
      stack: error.stack
    });
  }
}
