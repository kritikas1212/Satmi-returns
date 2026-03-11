// src/lib/firebaseAdmin.js
// Firebase Admin SDK — for server-side API routes only.
// Firestore reads/writes bypass client security rules entirely.
import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  // 1. Service account JSON string in env var (recommended for Vercel / CI)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      return initializeApp({ credential: cert(serviceAccount), projectId });
    } catch (e) {
      console.error("[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", e.message);
    }
  }

  // 2. Individual service-account fields in env vars
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }

  // 3. Service account JSON file path (GOOGLE_APPLICATION_CREDENTIALS)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault(), projectId });
  }

  // 4. Auto-discover on GCP / Firebase infrastructure
  try {
    return initializeApp({ credential: applicationDefault(), projectId });
  } catch {
    // Fallback: project-ID only init — will fail on first Firestore call
    // if no credentials are discoverable at all.
    console.warn(
      "[firebaseAdmin] No credentials found. Set FIREBASE_SERVICE_ACCOUNT_KEY, " +
      "FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS."
    );
    return initializeApp({ projectId });
  }
}

const adminApp = getAdminApp();
const adminDb = getFirestore(adminApp);

// Allow undefined fields in documents instead of throwing.
// The client SDK silently stripped undefined values; the Admin SDK does not.
adminDb.settings({ ignoreUndefinedProperties: true });

export { adminDb };
