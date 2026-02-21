'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/firebaseConfig";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { isAdminEmail } from "@/lib/adminConfig";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && isAdminEmail(user.email)) {
        router.replace("/admin");
        return;
      }
      setAuthChecking(false);
    });
    return () => unsubscribe();
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
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#7A1E1E]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-gray-200 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Satmi Support</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to access the returns dashboard</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] outline-none"
              placeholder="support@satmi.in"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] outline-none"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#7A1E1E] text-white py-2.5 rounded-lg font-semibold hover:bg-[#5e1717] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-gray-500">
          Authorized support users only. Create accounts in Firebase Console (Authentication).
        </p>
        <div className="mt-4 text-center">
          <Link href="/" className="text-sm text-[#7A1E1E] hover:underline">
            ← Back to returns portal
          </Link>
        </div>
      </div>
    </div>
  );
}
