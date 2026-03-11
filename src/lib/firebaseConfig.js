// src/lib/firebaseConfig.js
// Firebase client config — uses NEXT_PUBLIC_* env vars so phone OTP auth works correctly.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
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

if (typeof window !== "undefined") {
  if (missing.length > 0) {
    console.error("[Firebase] CRITICAL: Missing environment variables:", missing.join(", "));
    console.error("[Firebase] Please set these in your .env.local file:");
    missing.forEach(key => {
      console.error(`  NEXT_PUBLIC_${key.toUpperCase()}`);
    });
  } else {
    console.log("[Firebase] Configuration loaded successfully:", {
      hasApiKey: !!firebaseConfig.apiKey,
      hasAuthDomain: !!firebaseConfig.authDomain,
      hasProjectId: !!firebaseConfig.projectId,
      hasAppId: !!firebaseConfig.appId,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId
    });
  }
}

// Only initialize Firebase if we have the required config
let app;
let auth;
let storage;
let db;

if (missing.length === 0) {
  try {
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    // Explicitly set persistence so sessions survive page refresh and browser restart
    if (typeof window !== "undefined") {
      setPersistence(auth, browserLocalPersistence).catch((err) =>
        console.error("[Firebase] Failed to set auth persistence:", err)
      );
    }
    storage = getStorage(app);
    db = getFirestore(app);
    console.log("[Firebase] App initialized successfully");
  } catch (error) {
    console.error("[Firebase] Failed to initialize Firebase app:", error);
  }
} else {
  console.error("[Firebase] Skipping Firebase initialization due to missing configuration");
}

export { auth, storage, db };
