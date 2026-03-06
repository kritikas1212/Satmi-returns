# SSL/TLS Fix for Shopify API

## Quick Fix Solutions

### Option 1: Update Node.js (Recommended)
```bash
# Check your current Node.js version
node --version

# If you're using Node.js 16 or older, update to 18+
nvm install 18
nvm use 18

# Or download from https://nodejs.org
```

### Option 2: Environment Variables
Add these to your `.env` file:
```env
# Allow SSL connections (temporary fix)
NODE_TLS_REJECT_UNAUTHORIZED=0

# Keep your existing variables
SHOPIFY_STORE_DOMAIN="your-store.myshopify.com"
SHOPIFY_ACCESS_TOKEN="shpat_xxx"
```

### Option 3: Next.js Configuration
Create or update `next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NODE_TLS_REJECT_UNAUTHORIZED: '0'
  },
  experimental: {
    serverComponentsExternalPackages: []
  }
};

module.exports = nextConfig;
```

### Option 4: Use Node.js HTTPS Agent (Advanced)
Create a new file `src/lib/shopifyClient.js`:
```javascript
import https from 'https';

// Create a custom HTTPS agent that handles SSL properly
const shopifyAgent = new https.Agent({
  rejectUnauthorized: false, // Only for development
  secureProtocol: 'TLSv1_2_method',
  ciphers: [
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-SHA256',
    'ECDHE-RSA-AES256-SHA384',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA256',
    'AES256-SHA256'
  ].join(':'),
  honorCipherOrder: true
});

export { shopifyAgent };
```

### Option 5: Test Your Shopify Credentials
```bash
# Test your Shopify API connection
curl -X GET "https://your-store.myshopify.com/admin/api/2023-10/orders/count.json" \
  -H "X-Shopify-Access-Token: shpat_your_token"
```

## Most Likely Solution

The issue is probably that you're using an older Node.js version. 

**Step 1: Check your Node.js version**
```bash
node --version
```

**Step 2: If it's less than 18, update it**
```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Or download from nodejs.org
```

**Step 3: Restart your development server**
```bash
npm run dev
```

## If Still Not Working

Try this temporary fix in your `.env` file:
```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Then restart your server:
```bash
npm run dev
```

## Verify the Fix

After applying the fix, test the order ID login:
1. Enter a valid order ID
2. Check the browser console for errors
3. Check the terminal for API response logs

The fix should resolve the SSL handshake failure and allow Shopify API calls to work properly.
