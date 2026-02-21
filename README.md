# Satmi Returns Portal

A Next.js application for managing product returns with Firebase authentication, Shopify integration, and Shiprocket shipping.

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Firebase project configured
- Shopify store with API access
- Google Sheets API credentials (for return tracking)
- Shiprocket account credentials

### Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```bash
# Shopify Configuration
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your-shopify-access-token

# Google Sheets API Configuration
GOOGLE_CLIENT_EMAIL=your-service-account-email@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=your-private-key-here
GOOGLE_SHEET_ID=your-google-sheet-id

# Shiprocket Configuration
SHIPROCKET_EMAIL=your-email@satmi.in
SHIPROCKET_PASSWORD=your-shiprocket-password
WAREHOUSE_PINCODE=201318
```

### Installation

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Features

- **Phone-based Authentication**: Firebase phone authentication with OTP (customer portal)
- **Order Lookup**: Fetches orders from Shopify by phone number
- **Return Management**: Customers select items, add reason/video, submit to Firestore
- **Support Dashboard**: Satmi support logs in with email/password, accepts or rejects returns, generates Shiprocket labels
- **Shiprocket**: Create return order and generate shipping label from the dashboard
- **Video Upload**: Customers upload unboxing videos for return requests

### Support dashboard (backend)

1. **Create support users** in Firebase Console:
   - Authentication → Sign-in method → enable **Email/Password**
   - Authentication → Users → Add user: use an allowed email (e.g. `kritika@satmi.in`, `support@satmi.in`) and set a password.
2. **Allowed emails** are defined in `src/lib/adminConfig.js`. Only these emails can open the dashboard.
3. Open **[/admin/login](http://localhost:3000/admin/login)** → sign in with that email/password → you are redirected to **[/admin](http://localhost:3000/admin)**.
4. **Approve**: Choose “Approve”, optionally set pickup pincode (customer’s pincode for pickup), then confirm. This creates the return order in Shiprocket and stores AWB/shipment ID in Firestore.
5. **Get label**: For approved requests, use “Get label” to generate the shipping label PDF; the link is saved and available as “Download label”.
6. **Reject**: Choose “Reject” and optionally add a reason; status is stored in Firestore.

## Project Structure

- `/src/app/page.js` - Main return portal (customer-facing, OTP auth)
- `/src/app/admin/page.js` - Support dashboard (accept/reject, labels)
- `/src/app/admin/login/page.js` - Support login (email/password)
- `/src/app/api/orders/route.js` - Fetch Shopify orders by phone (customer auth)
- `/src/app/api/order/route.js` - Fetch single Shopify order by order number (for dashboard)
- `/src/app/api/shiprocket/route.js` - Create Shiprocket return order
- `/src/app/api/shiprocket/label/route.js` - Generate Shiprocket shipping label
- `/src/app/api/submit-return/route.js` - Submit return to Google Sheets
- `/src/lib/firebaseConfig.js` - Firebase config
- `/src/lib/adminConfig.js` - Allowed support emails
- `/src/lib/shiprocket.js` - Shiprocket helpers

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
