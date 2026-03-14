'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/firebaseConfig";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { isAdminEmail } from "@/lib/adminConfig";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe = () => {};

    const initAuth = async () => {
      if (!auth) {
        if (isMounted) {
          setError("Auth service unavailable. Please check Firebase config.");
          setAuthChecking(false);
        }
        return;
      }

      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (err) {
        console.error("[Admin Login] Failed to enforce auth persistence:", err);
      }

      if (!isMounted) return;

      unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user && isAdminEmail(user.email)) {
          router.replace("/admin");
          return;
        }
        setAuthChecking(false);
      });
    };

    initAuth();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Please enter email and password.");
      return;
    }
    setLoading(true);
    try {
      await setPersistence(auth, browserLocalPersistence);
      const userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (!isAdminEmail(userCred.user.email)) {
        await auth.signOut();
        setError("Access denied. This account is not authorized for the support dashboard.");
        setLoading(false);
        return;
      }
      router.replace("/admin");
    } catch (err) {
      const msg =
        err.code === "auth/user-not-found"
          ? "No account found with this email."
          : err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
          ? "Invalid email or password."
          : err.code === "auth/invalid-email"
          ? "Invalid email format."
          : err.message || "Login failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAFAF8]">
        <img src="/logo.png" alt="Satmi" className="h-8 mb-4 opacity-60" />
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#96572A]/20 border-t-[#96572A]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAFAF8] p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Satmi" className="h-10 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900">Support Dashboard</h1>
          <p className="text-xs text-gray-400 mt-1">Sign in to manage replacements</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
              placeholder="your@email.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#96572A] text-white py-2.5 rounded-full font-medium text-sm hover:bg-[#7A4623] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <p className="mt-6 text-center text-[10px] text-gray-400">
          Authorized support users only
        </p>
        <div className="mt-3 text-center">
          <Link href="/" className="text-xs text-[#96572A] hover:underline">
            ← Back to replacements portal
          </Link>
        </div>
      </div>
    </div>
  );
}
