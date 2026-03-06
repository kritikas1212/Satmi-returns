# Satmi Returns Engine - Complete Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [Expected Behavior](#expected-behavior)
3. [Technologies Used](#technologies-used)
4. [API Endpoints](#api-endpoints)
5. [Execution Flow](#execution-flow)
6. [Current Implementation](#current-implementation)
7. [Error Analysis](#error-analysis)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Environment Configuration](#environment-configuration)

---

## Overview

The Satmi Returns Engine is a comprehensive e-commerce return management system built with Next.js and Firebase. It allows customers to initiate returns for their Shopify orders through two authentication methods: phone number login and order ID login.

### Key Features
- **Dual Authentication**: Phone number and Order ID based login
- **OTP Verification**: Firebase Authentication for secure user verification
- **Order Management**: Fetch and display customer orders from Shopify
- **Return Processing**: Submit return requests with item selection
- **Status Tracking**: Check return status by order ID
- **Real-time Updates**: On-screen success and error messages

---

## Expected Behavior

### 1. Phone Number Login Flow
1. **User enters phone number** → System validates format
2. **Click "Send OTP"** → Firebase sends OTP to phone
3. **OTP screen appears** → User enters 6-digit OTP
4. **Click "Verify & Login"** → Firebase verifies OTP
5. **Orders fetched** → System searches Shopify for all orders with this phone
6. **Dashboard displayed** → User sees all eligible orders and can select items for return

### 2. Order ID Login Flow
1. **User enters order ID** → System fetches order from Shopify
2. **Extract phone number** → Get phone number from order data
3. **Auto-send OTP** → Send OTP to extracted phone number
4. **OTP screen appears** → User enters 6-digit OTP
5. **Click "Verify & Login"** → Firebase verifies OTP
6. **Orders fetched** → System searches Shopify for all orders with this phone
7. **Dashboard displayed** → User sees all eligible orders and can select items for return

### 3. Return Submission Flow
1. **Select order** → User clicks on an order to view items
2. **Select items** → Check items to return (only returnable items)
3. **Upload video** → Required video showing all items
4. **Enter email** → Customer email for return confirmation
5. **Click "Submit Return"** → System processes return request
6. **Success message** → Confirmation email sent to customer

### 4. Return Status Check
1. **Enter order ID** → User types order ID in dashboard
2. **Press Enter** → System checks Firestore for return records
3. **Display status** → Shows return status, items, refund amount, submission date

---

## Technologies Used

### Frontend
- **Next.js 14** - React framework for server-side rendering
- **React 18** - UI library with hooks for state management
- **Firebase Authentication** - Phone number OTP verification
- **TailwindCSS** - Utility-first CSS framework
- **JavaScript ES6+** - Modern JavaScript features

### Backend
- **Next.js API Routes** - Serverless API endpoints
- **Firebase Firestore** - NoSQL database for return records
- **Shopify Admin API** - E-commerce platform integration
- **Node.js** - JavaScript runtime environment

### External Services
- **Firebase Auth** - Authentication service
- **Shopify API** - E-commerce data source
- **Resend** - Email service for notifications
- **Shiprocket** - Shipping and logistics (future integration)

---

## API Endpoints

### 1. `/api/customer` - Customer Authentication
**Method**: POST
**Purpose**: Handle customer login and phone number extraction

#### Request Body:
```json
{
  "action": "GET_CUSTOMER_DETAILS",
  "orderId": "SI071967"
}
```

#### Response:
```json
{
  "success": true,
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "maskedPhone": "***-***-3210",
    "orderId": "SI071967"
  },
  "orders": [...]
}
```

### 2. `/api/orders` - Order Search
**Method**: POST
**Purpose**: Search orders by phone number

#### Request Body:
```json
{
  "action": "SEARCH_ORDERS",
  "phoneNumber": "+919876543210"
}
```

#### Response:
```json
{
  "success": true,
  "orders": [...],
  "customer": {...}
}
```

### 3. `/api/submit-return` - Return Processing
**Method**: POST
**Purpose**: Process return requests

#### Request Body:
```json
{
  "action": "SUBMIT_RETURN",
  "orderId": "SI071967",
  "items": [...],
  "email": "customer@example.com",
  "videoUrl": "https://example.com/video.mp4"
}
```

---

## Execution Flow

### Phase 1: User Authentication

#### Phone Number Login
```
1. User enters phone number
2. Frontend validates format (10-13 digits)
3. Firebase reCAPTCHA verification
4. Firebase sends OTP to phone
5. User receives OTP via SMS
6. User enters OTP in UI
7. Firebase verifies OTP
8. User authenticated successfully
```

#### Order ID Login
```
1. User enters order ID (e.g., SI071967)
2. API call to /api/customer with orderId
3. Shopify Admin API fetch: GET /admin/api/2023-10/orders/{orderId}.json
4. Extract phone number from order data
5. Firebase sends OTP to extracted phone
6. User enters OTP in UI
7. Firebase verifies OTP
8. User authenticated successfully
```

### Phase 2: Order Fetching

#### After OTP Verification
```
1. Firebase auth token obtained
2. API call to fetch orders by phone number
3. Shopify Admin API search strategies:
   - Strategy 1: Customer search by phone
   - Strategy 2: Direct order search by phone
   - Strategy 3: Paginated order search with filtering
4. Orders enriched with delivery status
5. Orders displayed in dashboard
```

### Phase 3: Return Processing

#### Item Selection
```
1. User selects order from dashboard
2. System displays order items with return eligibility
3. User checks items to return
4. System validates item selection
```

#### Return Submission
```
1. User uploads video (required)
2. User enters email address
3. Form validation performed
4. API call to /api/submit-return
5. Return record created in Firestore
6. Email notification sent via Resend
7. Success message displayed
```

---

## Current Implementation

### Frontend Components

#### State Management
```javascript
const [user, setUser] = useState(null);
const [phoneNumber, setPhoneNumber] = useState("");
const [orderId, setOrderId] = useState("");
const [otp, setOtp] = useState("");
const [orders, setOrders] = useState([]);
const [selectedItems, setSelectedItems] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
const [successMessage, setSuccessMessage] = useState("");
const [authMode, setAuthMode] = useState("phone");
const [confirmationResult, setConfirmationResult] = useState(null);
```

#### Key Functions
- `sendOtp()` - Initiates Firebase OTP sending
- `verifyOtp()` - Verifies OTP and authenticates user
- `handleOrderIdLogin()` - Fetches order by ID and extracts phone
- `fetchOrders()` - Retrieves orders by phone number
- `handleSelectOrder()` - Displays order items for selection
- `handleBulkSubmit()` - Processes return submission

### Backend Implementation

#### Customer API (`/api/customer`)
```javascript
// Main function for order ID login
async function GET_CUSTOMER_DETAILS(orderId) {
  // 1. Clean order ID
  // 2. Fetch from Shopify Admin API
  // 3. Extract phone number from order
  // 4. Search all orders by phone number
  // 5. Return customer and orders data
}
```

#### Shopify Integration
```javascript
// Enhanced fetch with retry logic
async function fetchShopifyOrderWithRetry(orderId, domain, token, maxRetries = 5) {
  // 1. Clean domain (remove duplicate .myshopify.com)
  // 2. Try multiple API versions
  // 3. Try different header configurations
  // 4. Implement exponential backoff
  // 5. Handle SSL/TLS errors
}
```

#### Phone Search Logic
```javascript
// Multi-strategy order search
async function fetchAllOrdersForPhone(phoneNumber, domain, token) {
  // Strategy 1: Customer search by phone
  // Strategy 2: Direct order search by phone
  // Strategy 3: Paginated search with filtering
}
```

---

## Error Analysis

### Current Persistent Error

#### Error Message
```
Failed to fetch order from Shopify: Failed to fetch order after 5 attempts
```

#### Error Location
- **File**: `/src/app/api/customer/route.js`
- **Function**: `fetchShopifyOrderWithRetry()`
- **Trigger**: Order ID login flow

#### Root Cause Analysis

##### 1. Domain Duplication Issue (FIXED)
**Problem**: 
```
Original URL: https://uismgu-m5.myshopify.com.myshopify.com/admin/api/2023-10/orders/SI071967.json
```
**Solution**: Domain cleaning implemented
```javascript
const cleanDomain = domain.replace('.myshopify.com', '');
```

##### 2. SSL/TLS Handshake Failures
**Symptoms**: 
- `ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE`
- Network connection timeouts
- Certificate validation errors

**Potential Causes**:
- Node.js version incompatibility with Shopify's TLS
- Outdated SSL/TLS protocols
- Network proxy or firewall issues
- Shopify API rate limiting

##### 3. API Authentication Issues
**Potential Problems**:
- Invalid access token
- Expired Shopify credentials
- Incorrect API permissions
- Store domain configuration

##### 4. Network Connectivity
**Possible Issues**:
- DNS resolution problems
- Firewall blocking outbound requests
- Proxy server interference
- Internet connectivity issues

### Error Handling Strategy

#### Current Implementation
```javascript
// Multi-attempt retry with different configurations
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    // Try different API versions
    // Try different header configs
    // Implement exponential backoff
  } catch (error) {
    if (attempt === maxRetries) {
      throw new Error(`Failed to fetch order after ${maxRetries} attempts: ${error.message}`);
    }
  }
}
```

#### Missing Error Scenarios
1. **Specific SSL Error Handling**: Need to detect and handle SSL-specific errors
2. **Rate Limiting**: Need to handle Shopify API rate limits (429 responses)
3. **Authentication Errors**: Need to detect 401/403 responses
4. **Network Timeouts**: Need to implement timeout handling

---

## Troubleshooting Guide

### 1. Verify Shopify Credentials
```bash
# Check environment variables
echo $SHOPIFY_STORE_DOMAIN
echo $SHOPIFY_ACCESS_TOKEN
```

### 2. Test Shopify API Connection
```javascript
// Test endpoint: /api/test-shopify
curl -X POST http://localhost:3000/api/test-shopify
```

### 3. Check Domain Configuration
- Ensure store domain is correct (without .myshopify.com suffix)
- Verify access token has proper permissions
- Check API rate limits in Shopify Admin

### 4. Network Diagnostics
```bash
# Test Shopify API connectivity
curl -H "X-Shopify-Access-Token: YOUR_TOKEN" \
     "https://your-store.myshopify.com/admin/api/2023-10/orders/count.json"
```

### 5. SSL/TLS Configuration
```bash
# Check Node.js version
node --version

# Update Node.js if needed
nvm install --lts
```

---

## Environment Configuration

### Required Environment Variables

#### Shopify Configuration
```env
SHOPIFY_STORE_DOMAIN=uismgu-m5
SHOPIFY_ACCESS_TOKEN=your-access-token
```

#### Firebase Configuration
```env
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
```

#### Email Service
```env
RESEND_API_KEY=re_your_api_key
FROM_EMAIL=noreply@yourdomain.com
```

#### Application Settings
```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### API Permissions Required

#### Shopify Admin API Scopes
- `read_orders` - Access order data
- `read_customers` - Access customer information
- `write_orders` - Update order status (if needed)

#### Firebase Authentication
- Phone number authentication enabled
- reCAPTCHA verification configured

---

## Current Status and Next Steps

### Working Components
✅ Phone number login and OTP verification
✅ Order fetching by phone number
✅ Return submission process
✅ On-screen messaging system
✅ UI/UX improvements

### Issues to Resolve
❌ Order ID login Shopify API failures
❌ SSL/TLS handshake errors
❌ Domain configuration problems

### Recommended Actions

1. **Immediate**: Test with corrected domain configuration
2. **Short-term**: Implement better SSL error handling
3. **Medium-term**: Add comprehensive error logging
4. **Long-term**: Consider Shopify GraphQL API as alternative

### Testing Checklist

- [ ] Test phone number login flow
- [ ] Test order ID login with corrected domain
- [ ] Verify OTP sending and verification
- [ ] Test return submission process
- [ ] Check email notifications
- [ ] Verify return status tracking

---

## Conclusion

The Satmi Returns Engine is a sophisticated system with multiple integration points. The current error appears to be related to Shopify API connectivity issues, specifically around domain configuration and SSL/TLS handling. The recent domain cleaning fix should resolve the duplication issue, but additional SSL error handling may be necessary for 100% reliability.

The system architecture is sound, with proper separation of concerns, error handling, and user experience considerations. Once the Shopify API connectivity is stabilized, the system should function as designed.
