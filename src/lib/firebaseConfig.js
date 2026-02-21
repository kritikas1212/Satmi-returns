// src/lib/firebaseConfig.js
// Firebase client config — uses NEXT_PUBLIC_* env vars so phone OTP auth works correctly.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Validate required client credentials (avoid invalid-app-credential)
const required = ["apiKey", "authDomain", "projectId", "appId"];
const missing = required.filter((key) => !firebaseConfig[key]);
if (typeof window !== "undefined" && missing.length > 0) {
  console.warn("[Firebase] Missing env:", missing.join(", "), "— set NEXT_PUBLIC_FIREBASE_* in .env.local");
}

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const storage = getStorage(app);
export const db = getFirestore(app);
