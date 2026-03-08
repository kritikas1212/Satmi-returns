# Satmi Returns — Technical Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Authentication Flow](#authentication-flow)
5. [API Reference](#api-reference)
6. [Order Status & Business Logic](#order-status--business-logic)
7. [Frontend State Management](#frontend-state-management)
8. [External Integrations](#external-integrations)
9. [Database Schema](#database-schema)
10. [Performance Optimizations](#performance-optimizations)
11. [Environment Variables](#environment-variables)

---

## Architecture Overview

Satmi Returns is a **Next.js 16 App Router** application providing two portals:

| Portal | Route | Purpose |
|--------|-------|---------|
| **Customer Portal** | `/` | Customers log in with phone or order ID, view orders, modify addresses, cancel orders, and submit return requests |
| **Admin Dashboard** | `/admin` | Support staff review/approve/reject returns, generate Shiprocket labels, edit warehouse addresses |

**Data flow:** Browser ⇆ Next.js API Routes ⇆ Shopify Admin API / Firebase / Shiprocket / Resend

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Framework** | Next.js (App Router) | 16.1.6 | Full-stack React framework |
| **UI** | React | 19.2.3 | Component rendering |
| **Styling** | Tailwind CSS | 4.x | Utility-first CSS |
| **Auth** | Firebase Authentication | 12.8.0 | Phone OTP via `signInWithPhoneNumber` |
| **Database** | Firebase Firestore | 12.8.0 | Return request storage |
| **File Storage** | Firebase Storage | 12.8.0 | Video evidence uploads |
| **E-commerce** | Shopify Admin API | 2025-01 | Order data, cancellation, address updates |
| **Shipping** | Shiprocket API | — | RTO creation, label generation |
| **Email** | Resend | 6.9.2 | Return label email delivery |
| **Validation** | Zod | 4.3.6 | Request body validation |
| **Build** | PostCSS | — | Tailwind CSS processing |
| **Linting** | ESLint | 9.x | Code quality |

---

## Project Structure

```
satmi-returns/
├── public/
│   ├── favicon.ico              # Browser tab icon
│   ├── apple-touch-icon.png     # iOS bookmark icon
│   ├── logo.png                 # Satmi brand logo
│   └── mandala.png              # Decorative login background
├── src/
│   ├── app/
│   │   ├── layout.js            # Root layout (Inter font, metadata)
│   │   ├── page.js              # Customer portal (login + dashboard)
│   │   ├── globals.css          # Global Tailwind styles
│   │   ├── admin/
│   │   │   ├── page.js          # Admin returns dashboard
│   │   │   └── login/
│   │   │       └── page.js      # Admin email/password login
│   │   └── api/
│   │       ├── customer/route.js         # Order lookup by ID → phone extraction
│   │       ├── orders/route.js           # Fetch all orders by phone number
│   │       ├── order/route.js            # Fetch single order by number
│   │       ├── order/update/route.js     # Modify order address/phone (PUT)
│   │       ├── cancel-order/route.js     # Cancel order within 1-hour window
│   │       ├── submit-return/route.js    # Submit new return request
│   │       ├── returns/approve-and-send/route.js  # Approve return + create RTO
│   │       ├── shiprocket/route.js       # Create Shiprocket RTO
│   │       ├── shiprocket/label/route.js # Generate shipping label
│   │       └── upload-url/route.js       # Signed upload URL for videos
│   └── lib/
│       ├── firebaseConfig.js     # Firebase client SDK initialization
│       ├── adminConfig.js        # Admin email whitelist
│       ├── shiprocket.js         # Shiprocket client helpers
│       └── shiprocketServer.js   # Shiprocket server-side API wrapper
├── package.json
├── next.config.mjs
├── eslint.config.mjs
├── postcss.config.mjs
└── jsconfig.json
```

---

## Authentication Flow

### Customer Authentication (Phone OTP)

```
┌──────────────┐    ┌──────────────────┐    ┌────────────┐
│  Customer     │───►│ Firebase Auth    │───►│ SMS Gateway│
│  enters phone │    │ RecaptchaVerifier│    │ (OTP sent) │
│  or Order ID  │    │ signInWithPhone  │    │            │
└──────────────┘    └──────────────────┘    └────────────┘
        │                                        │
        ▼                                        ▼
┌──────────────┐    ┌──────────────────┐    ┌────────────┐
│  Enter OTP   │───►│ confirm(otp)     │───►│ Auth token │
│  (6 digits)  │    │ Sets user state  │    │ issued     │
└──────────────┘    └──────────────────┘    └────────────┘
```

**Two login paths:**

| Path | Flow |
|------|------|
| **Phone Login** | User enters phone → `sendOtp()` → Firebase sends SMS → User enters OTP → `verifyOtp()` → fetch orders via `/api/orders` |
| **Order ID Login** | User enters order ID → `/api/customer` finds phone from Shopify → sends OTP to that phone → same OTP verification → uses pre-fetched orders from API response |

### Admin Authentication (Email/Password)

- Firebase `signInWithEmailAndPassword`
- Authorized emails checked against whitelist in `adminConfig.js` via `isAdminEmail()`
- Route: `/admin/login`

---

## API Reference

### `POST /api/customer`

Looks up an order by ID on Shopify, extracts the associated phone number, and fetches all orders for that customer.

| Field | Type | Description |
|-------|------|-------------|
| `orderId` | string | Shopify order name (e.g. "1001" or "#1001") |
| `action` | enum | `"GET_CUSTOMER_DETAILS"` (default) or `"CHECK_STATUS"` |

**Response (GET_CUSTOMER_DETAILS):**
```json
{
  "success": true,
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+919999999999",
    "maskedPhone": "***-***-9999",
    "orderId": "#1001"
  },
  "orders": [/* normalized order objects */]
}
```

**Response (CHECK_STATUS):**
```json
{
  "success": true,
  "orderId": "1001",
  "returns": [
    { "id": "abc", "status": "Pending", "items": [...], "createdAt": "..." }
  ]
}
```

**Shopify queries used:**
1. GraphQL: `name:#ORDER_ID` (primary)
2. GraphQL: `name:ORDER_ID` (fallback)
3. REST: `/orders.json?name=ORDER_ID` (final fallback)

---

### `POST /api/orders`

Fetches all orders for a phone number. Requires bearer token (Firebase auth token).

| Field | Type | Description |
|-------|------|-------------|
| `phoneNumber` | string | Customer phone (any format) |

**Strategy:**
1. Search Shopify customers by phone (6 query variants)
2. If customer found → fetch customer orders
3. If not → paginate recent orders and filter by phone match

**Response enrichment:** Each order gets a `delivery_status` object:
```json
{
  "delivery_status": {
    "delivered_date": "2025-01-15T10:00:00Z",
    "is_returnable": true,
    "message": "Eligible for Return",
    "eligibility_reason": "Delivered recently and eligible"
  }
}
```

---

### `PUT /api/order/update`

Modifies shipping address/phone on a Shopify order within 3-hour window.

| Field | Type | Description |
|-------|------|-------------|
| `orderId` | string | Order name (e.g. "1001") |
| `shippingAddress` | object | `{ address1, address2?, city?, province?, zip?, phone? }` |
| `phone` | string | New phone number |

**Business rules enforced:**
- Order must exist
- Not cancelled
- Not fulfilled (unfulfilled only)
- Within 3 hours of `created_at`

---

### `POST /api/cancel-order`

Cancels a Shopify order within 1-hour window.

| Field | Type | Description |
|-------|------|-------------|
| `shopifyOrderId` | string | Numeric Shopify order ID or GraphQL GID |
| `orderName` | string | Optional human-readable name |

**Error codes:** `ALREADY_CANCELLED`, `ALREADY_FULFILLED`, `CANCEL_WINDOW_EXPIRED`, `FETCH_FAILED`

---

### `POST /api/submit-return`

Creates a new return request in Firestore.

| Field | Type | Description |
|-------|------|-------------|
| `orderId` | string | Order name |
| `customerName` | string | Customer full name |
| `email` | string | Customer email |
| `items` | array | `[{ lineItemId, id, title, quantity, price }]` |
| `phone` | string | Customer phone |
| `reason` | string | Return reason |
| `comments` | string | Optional comments |
| `videoUrl` | string | Firebase Storage video URL |
| `originalCourier` | string | Shipping carrier name |

**Validation:** Zod schema, duplicate check by `lineItemId` in Firestore.

---

### `POST /api/returns/approve-and-send`

Admin action: approves a return and creates an RTO shipment.

| Field | Type | Description |
|-------|------|-------------|
| `returnId` | string | Firestore return document ID |
| `orderId` | string | Order name |
| `customerName` | string | Customer name |
| `email` | string | Email to send label to |
| `phone` | string | Customer phone |
| `originalCourier` | string | Original shipping carrier |

**Side effects:**
1. Creates Shiprocket RTO order
2. Generates shipping label PDF
3. Emails label to customer via Resend (`support@satmi.in`)
4. Updates Firestore return doc status → `"approved"`

---

### `POST /api/shiprocket`

Creates a Shiprocket return (RTO) order.

### `POST /api/shiprocket/label`

Generates a shipping label PDF for a Shiprocket shipment.

### `POST /api/upload-url`

Generates a signed Firebase Storage upload URL for video files (mp4/mov/avi/webm), valid 15 minutes.

---

## Order Status & Business Logic

### Order Lifecycle States

```
Created → Unfulfilled → Shipped → In Transit → Delivered → Return Window (3 days)
   │                                                              │
   │ (within 1hr)                                                 └── Return Window Closed
   └── Cancelled
```

### Action Permission Matrix

| Order State | Modify Order | Cancel Order | Return Order |
|-------------|:------------:|:------------:|:------------:|
| Unfulfilled (within 1hr) | ✅ (if < 3hr) | ✅ | ❌ Hidden (not delivered) |
| Unfulfilled (after 1hr) | ✅ (if < 3hr) | ❌ Disabled | ❌ Hidden (not delivered) |
| Unfulfilled (after 3hr) | ❌ Disabled | ❌ Disabled | ❌ Hidden (not delivered) |
| Shipped / In Transit | ❌ Disabled | ❌ Disabled | ❌ Disabled (not delivered) |
| Delivered (within 3 days) | ❌ Disabled | ❌ Disabled | ✅ |
| Delivered (after 3 days) | ❌ Disabled | ❌ Disabled | ❌ Disabled (window closed) |
| Cancelled | ❌ Disabled | ❌ Disabled | ❌ Hidden |

### Centralized Permission Helper

The `getOrderActions(order)` function in `/src/app/page.js` computes the state for all three actions in a single call, returning:
```js
{
  modify: { visible: true, enabled: false, reason: "Modification window (3 hours) has expired" },
  cancel: { visible: true, enabled: false, reason: "Cancellation window (1 hour) has expired" },
  return: { visible: true, enabled: true,  reason: "" }
}
```

Disabled actions render in greyed-out style with a hover tooltip showing the reason.

### Time Windows

| Window | Duration | Measured From |
|--------|----------|---------------|
| **Modification** | 3 hours | `order.created_at` |
| **Cancellation** | 1 hour | `order.created_at` |
| **Return** | 3 days | Delivery date (via Shopify fulfillment events) |

---

## Frontend State Management

All state is managed via React `useState` hooks in a single `ReturnPortal` component (`page.js`).

### State Categories

| Category | Variables | Purpose |
|----------|-----------|---------|
| **Auth** | `phoneNumber`, `otp`, `confirmationResult`, `user`, `authMode` | OTP login flow |
| **Orders** | `orders`, `loading`, `error`, `successMessage` | Order data display |
| **Selection** | `selectedItems`, `globalSelectedItems`, `isModalOpen` | Bulk item selection for returns |
| **Dashboard** | `dashboardView`, `viewMode` | Tab and card/table toggle |
| **Returns** | `returnHistory`, `loadingReturns`, `returnedLineItemIds` | Return tracking + duplicate detection |
| **Cancellation** | `isCancelling`, `cancellingOrderId`, `cancelConfirmOrder` | Cancel flow |
| **Modification** | `modifyingOrder`, `editedAddress`, `editedAddress2`, `editedCity`, `editedState`, `editedZip`, `editedPhone`, `isSavingModification` | Address edit flow |
| **Form** | `commonReason`, `comments`, `userEmail`, `videoFile` | Return form fields |
| **UI** | `openKebabMenu`, `mobileMenuOpen`, `accountDropdownOpen` | Menu/dropdown state |

---

## External Integrations

### Shopify Admin API (2025-01)

| Protocol | Used For |
|----------|----------|
| **GraphQL** | Order search by name, order search by phone, submit-return price validation |
| **REST** | Order fetch by ID, order update (PUT), order cancel, customer search by phone, product image enrichment |

**Auth:** `X-Shopify-Access-Token` header with private app token.

### Firebase

| Service | Used For |
|---------|----------|
| **Authentication** | Phone OTP (customer), Email/Password (admin) |
| **Firestore** | Return request documents (`returns` collection) |
| **Storage** | Video evidence files (`returns/` bucket prefix) |

### Shiprocket

| Endpoint | Used For |
|----------|----------|
| Token auth | `shiprocketServer.js` handles token acquisition/caching |
| Create RTO | Reverse pickup order with customer as pickup and warehouse as delivery |
| Generate Label | PDF shipping label for the return shipment |

### Resend

| From | Purpose |
|------|---------|
| `support@satmi.in` | Sends return label PDF link to customer email |

---

## Database Schema

### Firestore: `returns` Collection

```typescript
{
  // Identifiers
  orderId: string;           // Shopify order name (e.g. "#1001")
  phone: string;             // Customer phone (E.164)
  email: string;             // Customer email

  // Return details
  customerName: string;
  reason: string;            // "Size issue", "Quality issue", etc.
  comments: string;
  videoUrl: string;          // Firebase Storage URL
  originalCourier: string;   // "Delhivery", "BlueDart", etc.

  // Items
  items: [{
    lineItemId: string;
    id: string;
    title: string;
    quantity: number;
    price: number;
  }];

  // Shopify data snapshot
  shopifyOrderData: {
    refundAmount: number;
    currency: string;        // "INR"
  };

  // Status tracking
  status: string;            // "Pending" | "approved" | "rejected"
  createdAt: Timestamp;      // Firestore server timestamp

  // Shiprocket (populated on approval)
  shiprocketAwb?: string;
  shiprocketShipmentId?: string;
  labelUrl?: string;

  // Warehouse address (editable by admin)
  warehouseAddress?: {
    shipping_customer_name: string;
    shipping_address: string;
    shipping_address_2: string;
    shipping_city: string;
    shipping_state: string;
    shipping_pincode: string;
    shipping_phone: string;
  };
}
```

---

## Performance Optimizations

### OTP Flow (applied)

| Bottleneck | Before | After | Impact |
|-----------|--------|-------|--------|
| Artificial delay before `signInWithPhoneNumber` | 500ms sleep | Removed | **-500ms per OTP request** |
| Shopify GraphQL retries (customer API) | 7 sequential queries | 2 prioritized queries + REST fallback | **-3-5 API round-trips** |
| Phone search queries | 5 sequential queries | 2 queries | **-3 API round-trips** |
| Verbose `console.log` with `JSON.stringify` | Full order data logged | Minimal logging | **Reduced I/O latency** |

### Orders Fetch (existing)

| Optimization | Description |
|------------|-------------|
| Fulfillment event skip | Only fetches delivery events for actually-delivered orders, not all orders |
| Old order skip | Orders with fulfillments older than 10 days skip event fetch entirely |
| Batch product images | Single Shopify API call for all product images (up to 250) |

---

## Environment Variables

### Required (`.env.local`)

```bash
# Firebase Client SDK (NEXT_PUBLIC_ prefix = available in browser)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Shopify Admin API
SHOPIFY_STORE_DOMAIN=           # e.g. "my-store" (without .myshopify.com)
SHOPIFY_ACCESS_TOKEN=           # Private app access token

# Shiprocket
SHIPROCKET_EMAIL=
SHIPROCKET_PASSWORD=

# Resend (email)
RESEND_API_KEY=

# Firebase Admin (server-side, for signed upload URLs)
FIREBASE_SERVICE_ACCOUNT_KEY=   # Base64-encoded service account JSON
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Start dev server
npm run dev -- -p 3001

# Build for production
npm run build

# Start production server
npm start
```

---

## Brand Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#96572A` | Buttons, active states, focus rings |
| Primary hover | `#7A4623` | Button hover states |
| Legacy red | `#7A1E1E` | Login screen accents (being migrated) |
| Accent | `#C8956C` | Header gradient bar, secondary highlights |
| Background | `#FAFAF8` | Dashboard background |
| Login background | `#F9F6F2` | Login screen, mobile menu |
| Card background | `#F9F6F2` | Selected items, form areas |
