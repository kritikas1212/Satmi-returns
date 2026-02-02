// src/lib/firebaseConfig.js
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage"; // <--- 1. Added this import

const firebaseConfig = {
  apiKey: "AIzaSyDnMQX9UgtD3tqZLVk1j6h9giF9zaWMrSw",
  authDomain: "satmi-485912.firebaseapp.com",
  projectId: "satmi-485912",
  storageBucket: "satmi-485912.firebasestorage.app", // <--- This bucket handles your videos
  messagingSenderId: "613527699749",
  appId: "1:613527699749:web:aee23b360593c388a5dacc",
  measurementId: "G-N15S5BH69L"
};

// Initialize Firebase (Singleton Pattern)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Export Auth & Storage
export const auth = getAuth(app);
export const storage = getStorage(app); // <--- 2. Added this export