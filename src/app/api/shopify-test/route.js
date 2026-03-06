import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
    const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Shopify credentials not configured" },
        { status: 500 }
      );
    }

    // Clean domain
    const rawDomain = SHOPIFY_STORE_DOMAIN.replace('.myshopify.com', '');
    
    // Test GraphQL connection
    const graphqlEndpoint = `https://${rawDomain}.myshopify.com/admin/api/2025-01/graphql.json`;
    
    const testQuery = `
      query {
        shop {
          name
          email
          currencyCode
        }
      }
    `;

    console.log(`Testing Shopify connection to: ${graphqlEndpoint}`);
    console.log(`Access token starts with: ${SHOPIFY_ACCESS_TOKEN.substring(0, 10)}...`);

    const response = await fetch(graphqlEndpoint, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'Satmi-Returns/1.0'
      },
      body: JSON.stringify({
        query: testQuery
      }),
      cache: 'no-store'
    });

    console.log(`Test response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Shopify test failed: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { 
          success: false, 
          error: "Shopify connection failed",
          details: {
            status: response.status,
            error: errorText,
            endpoint: graphqlEndpoint
          }
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error(`GraphQL errors:`, data.errors);
      return NextResponse.json(
        { 
          success: false, 
          error: "GraphQL query failed",
          details: data.errors
        },
        { status: 400 }
      );
    }

    const shopData = data.data?.shop;
    
    return NextResponse.json({
      success: true,
      message: "Shopify connection successful",
      shop: shopData,
      details: {
        endpoint: graphqlEndpoint,
        domain: rawDomain,
        tokenPrefix: SHOPIFY_ACCESS_TOKEN.substring(0, 10) + "..."
      }
    });

  } catch (error) {
    console.error('Shopify test error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Internal server error",
        details: error.message 
      },
      { status: 500 }
    );
  }
}
