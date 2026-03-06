'use client';

import { useState, useEffect } from "react";
import { auth, storage, db } from "../lib/firebaseConfig";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export default function ReturnPortal() {
  // --- STATE ---
  const [phoneNumber, setPhoneNumber] = useState("+91");
  const [otp, setOtp] = useState("");
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [authMode, setAuthMode] = useState("phone"); // "phone", "orderId", or "otp"
  const [orderId, setOrderId] = useState("");
  
  // BULK SELECTION STATE
  const [selectedItems, setSelectedItems] = useState([]); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // DASHBOARD STATE
  const [dashboardView, setDashboardView] = useState("eligible-orders"); // "eligible-orders" or "my-returns"
  const [viewMode, setViewMode] = useState("card"); // "card" or "table"
  const [globalSelectedItems, setGlobalSelectedItems] = useState([]);
  const [returnHistory, setReturnHistory] = useState([]);
  const [loadingReturns, setLoadingReturns] = useState(false);
  const [uploading, setUploading] = useState(false);

  // FORM STATE
  const [commonReason, setCommonReason] = useState("Size issue");
  const [comments, setComments] = useState(""); 
  const [userEmail, setUserEmail] = useState(""); 
  const [videoFile, setVideoFile] = useState(null);

  // CANCELLATION STATE
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState(null); // order object for cancel modal

  // --- AUTHENTICATION ---
  // Always create a fresh RecaptchaVerifier to avoid "client element has been removed" errors.
  // The old approach cached the verifier, but clearing the container's innerHTML makes the
  // cached verifier reference a destroyed DOM element.
  const getRecaptchaVerifier = () => {
    if (typeof window === "undefined") return null;

    // Clear any existing stale verifier first
    if (window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier.clear();
      } catch (_) {
        // Ignore — element may already be gone
      }
      window.recaptchaVerifier = null;
    }

    // Ensure the container exists and is empty
    const container = document.getElementById('recaptcha-container');
    if (container) container.innerHTML = '';

    window.recaptchaVerifier = new RecaptchaVerifier(
      auth,
      "recaptcha-container",
      { size: "invisible", callback: () => {} }
    );
    return window.recaptchaVerifier;
  };

  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      console.log("Firebase Config Debug:", {
        hasApiKey: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        hasAuthDomain: !!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        hasProjectId: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        hasAppId: !!process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
      });
    }
  }, []);

  // Phone number validation
  const validatePhoneNumber = (phone) => {
    const cleanPhone = phone.replace(/\D/g, ''); // Remove all non-digits
    
    if (cleanPhone.length < 10) {
      return { valid: false, error: "Phone number must have at least 10 digits" };
    }
    
    if (cleanPhone.length > 13) {
      return { valid: false, error: "Phone number cannot have more than 13 digits" };
    }
    
    return { valid: true, formattedPhone: formatPhoneNumber(cleanPhone) };
  };

  // Format phone number with country code
  const formatPhoneNumber = (cleanPhone) => {
    if (cleanPhone.length === 10) {
      return `+91${cleanPhone}`; // Add +91 for 10-digit numbers
    }
    if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      return `+91${cleanPhone.substring(1)}`; // Remove leading 0 and add +91
    }
    if (cleanPhone.length > 10 && !cleanPhone.startsWith('91')) {
      return `+${cleanPhone}`; // Add + for numbers with country code
    }
    return cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`;
  };

  const sendOtp = async () => {
    setError("");
    setSuccessMessage("");
    setLoading(true);
    
    try {
      // Check if Firebase auth is available
      if (!auth) {
        throw new Error("Firebase authentication is not configured. Please check your environment variables.");
      }
      
      // Check Firebase configuration first
      if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) {
        throw new Error("Firebase configuration missing. Please check environment variables.");
      }
      
      // Clear any existing confirmation result
      setConfirmationResult(null);
      
      // Validate phone number
      const validation = validatePhoneNumber(phoneNumber);
      if (!validation.valid) {
        setError(validation.error);
        setLoading(false);
        return;
      }
      
      const formattedPhone = validation.formattedPhone;
      console.log("Sending OTP to:", formattedPhone);
      
      // Get fresh reCAPTCHA verifier (handles container cleanup internally)
      const verifier = getRecaptchaVerifier();
      if (!verifier) {
        throw new Error("reCAPTCHA not ready");
      }
      
      // Small delay to ensure reCAPTCHA is properly initialized
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const confirmation = await signInWithPhoneNumber(auth, formattedPhone, verifier);
      
      // Store confirmation result immediately
      setConfirmationResult(confirmation);
      setPhoneNumber(formattedPhone); // Update with formatted number
      setAuthMode("otp");
      setSuccessMessage("OTP sent successfully!");
      
      console.log("OTP sent successfully, confirmation result stored");
      
    } catch (err) {
      console.error("OTP Error Details:", {
        code: err?.code,
        message: err?.message,
        stack: err?.stack
      });
      
      const code = err?.code;
      
      if (code === "auth/invalid-app-credential") {
        setError("Firebase configuration error. Please contact support.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many requests. Please wait a few minutes before trying again.");
      } else if (code === "auth/invalid-phone-number") {
        setError("Invalid phone number format. Please check and try again.");
      } else if (code === "auth/quota-exceeded") {
        setError("SMS quota exceeded. Please try again later.");
      } else if (code === "auth/captcha-check-failed") {
        setError("reCAPTCHA verification failed. Please refresh and try again.");
      } else if (code === "auth/internal-error") {
        if (err?.message?.includes('Firebase authentication is not configured')) {
          setError("Firebase authentication is not configured. Please check your environment variables.");
        } else {
          setError("Internal error occurred. Please check Firebase configuration and refresh the page.");
        }
      } else if (code === "auth/network-request-failed") {
        setError("Network error. Please check your connection and try again.");
      } else if (err?.message?.includes('reCAPTCHA')) {
        setError("reCAPTCHA initialization failed. Please refresh the page.");
      } else {
        setError(err?.message || "Failed to send OTP. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (!confirmationResult) {
      setError("Session expired. Please request a new OTP.");
      return;
    }
    setError("");
    setSuccessMessage("");
    try {
      const res = await confirmationResult.confirm(otp);
      setUser(res.user);
      const token = await res.user.getIdToken();
      
      // Check if we have pre-fetched orders from order ID login
      if (window.tempOrders && window.tempOrders.length > 0) {
        console.log("Using pre-fetched orders from order ID login");
        setOrders(window.tempOrders);
        // Clear temporary orders
        delete window.tempOrders;
      } else {
        // Fetch orders normally for phone login
        fetchOrders(phoneNumber, token);
      }
    } catch (err) {
      console.error(err);
      if (err?.code === "auth/code-expired") {
        setError("OTP has expired. Please request a new one.");
        setConfirmationResult(null); // force re-send flow
      } else if (err?.code === "auth/invalid-verification-code") {
        setError("Invalid OTP. Please check and try again.");
      } else {
        setError(err?.message || "Verification failed. Please try again.");
      }
    }
  };

  // --- ORDER ID LOGIN ---
  const handleOrderIdLogin = async () => {
    setError("");
    setSuccessMessage("");
    setLoading(true);
    try {
      // Clean order ID - remove # if present
      const cleanOrderId = orderId.replace('#', '').trim();
      
      if (!cleanOrderId) {
        setError("Order ID is required");
        setLoading(false);
        return;
      }
      
      const response = await fetch('/api/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          orderId: cleanOrderId
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Store phone number internally but don't display it in input field
        const customerPhone = data.customer.phone;
        
        // If orders are returned, store them for immediate use after OTP
        if (data.orders && data.orders.length > 0) {
          // Store orders temporarily
          window.tempOrders = data.orders;
          console.log(`Found ${data.orders.length} orders for this customer`);
        }
        
        // Now send OTP to the found phone number
        try {
          // Check if Firebase auth is available
          if (!auth) {
            throw new Error("Firebase authentication is not configured. Please check your environment variables.");
          }
          
          // Check Firebase configuration first
          if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) {
            throw new Error("Firebase configuration missing. Please check environment variables.");
          }
          
          // Clear any existing confirmation result
          setConfirmationResult(null);
          
          // Validate phone number
          const validation = validatePhoneNumber(customerPhone);
          if (!validation.valid) {
            setError("Invalid phone number format. Please contact support.");
            setLoading(false);
            return;
          }
          
          const formattedPhone = validation.formattedPhone;
          
          // Get fresh reCAPTCHA verifier (handles container cleanup internally)
          const verifier = getRecaptchaVerifier();
          if (!verifier) throw new Error("reCAPTCHA not ready");
          
          // Small delay to ensure reCAPTCHA is properly initialized
          await new Promise(resolve => setTimeout(resolve, 500));
          
          console.log("Sending OTP to found phone:", formattedPhone);
          const confirmation = await signInWithPhoneNumber(auth, formattedPhone, verifier);
          
          // Store confirmation result immediately
          setConfirmationResult(confirmation);
          setPhoneNumber(formattedPhone); // Set internally for OTP verification
          setAuthMode("otp");
          setSuccessMessage(`OTP sent to phone ending in ${data.customer.maskedPhone}`);
          
          console.log("OTP sent successfully for Order ID login");
          
        } catch (otpErr) {
          console.error("Failed to send OTP for Order ID login:", otpErr);
          setError("Failed to send OTP. Please try again.");
        }
      } else {
        setError(data.error || "Order not found");
      }
    } catch (err) {
      setError(err.message || "Failed to fetch order details");
    } finally {
      setLoading(false);
    }
  };

  // --- ORDER FETCHING (RESTORED FROM WORKING VERSION) ---
  const fetchOrders = async (phone, token) => {
    setLoading(true);
    setError("");
    try {
      const authToken = token || (user ? await user.getIdToken() : null);
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Failed to fetch orders");
      if (!data.orders || data.orders.length === 0) throw new Error("No orders found for this number.");
      
      setOrders(data.orders);
    } catch (err) { 
      setError(err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  // --- CANCELLATION HELPER ---
  const canCancelOrder = (order) => {
    // Must be unfulfilled and not already cancelled
    const fulfillmentStatus = order.fulfillment_status || order.displayFulfillmentStatus;
    const isFulfilled = fulfillmentStatus === 'fulfilled' || fulfillmentStatus === 'FULFILLED' || fulfillmentStatus === 'partial';
    const isCancelled = !!order.cancelled_at;
    if (isFulfilled || isCancelled) return false;

    // Must be within 1 hour of creation
    const createdAt = new Date(order.created_at || order.createdAt).getTime();
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    return (now - createdAt) < ONE_HOUR_MS;
  };

  const handleCancelOrder = async (order) => {
    // Show in-dashboard confirmation modal instead of browser confirm()
    setCancelConfirmOrder(order);
  };

  const executeCancelOrder = async () => {
    const order = cancelConfirmOrder;
    if (!order) return;
    setCancelConfirmOrder(null); // close modal

    setIsCancelling(true);
    setCancellingOrderId(order.id);
    setError('');
    setSuccessMessage('');

    try {
      // Extract numeric ID from GraphQL GID (e.g. "gid://shopify/Order/12345" -> "12345")
      // REST orders already have a numeric id, so this is safe for both.
      const numericId = String(order.id).includes('gid://')
        ? String(order.id).split('/').pop()
        : String(order.id);

      const res = await fetch('/api/cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopifyOrderId: numericId,
          orderName: order.name,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to cancel order');
        return;
      }

      // Update local state so the UI reflects cancellation immediately
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, cancelled_at: new Date().toISOString() } : o
        )
      );
      setSuccessMessage(data.message || `Order ${order.name} cancelled successfully.`);
    } catch (err) {
      console.error('Cancel order error:', err);
      setError('Network error while cancelling order. Please try again.');
    } finally {
      setIsCancelling(false);
      setCancellingOrderId(null);
    }
  };

  // --- ELIGIBILITY HELPER ---
  const checkEligibility = (item, order) => {
    if (!order) return { eligible: false, reason: "Order data missing" };

    // 1. Determine if delivered/fulfilled
    // Handle both REST (lowercase) and GraphQL (uppercase) status values
    const status = (order.displayFulfillmentStatus || order.fulfillment_status || '').toUpperCase();
    const isFulfilled = 
      status === 'FULFILLED' || 
      status === 'DELIVERED' ||
      status === 'PARTIAL' ||
      (order.fulfillments?.edges && order.fulfillments.edges.length > 0) ||
      (Array.isArray(order.fulfillments) && order.fulfillments.length > 0 && order.fulfillments[0]?.status === 'success');

    if (!isFulfilled) {
      return {
        eligible: false,
        reason: "You can create return after product has been delivered"
      };
    }

    // 2. Calculate the 3-day window securely
    // Fallback chain: fulfillment date → order creation date
    let deliveryDateString = order.created_at || order.createdAt;

    // Safely extract from GraphQL edges or flat array
    if (order.fulfillments?.edges?.[0]?.node?.createdAt) {
      deliveryDateString = order.fulfillments.edges[0].node.createdAt;
    } else if (Array.isArray(order.fulfillments) && order.fulfillments[0]?.created_at) {
      deliveryDateString = order.fulfillments[0].created_at;
    } else if (Array.isArray(order.fulfillments) && order.fulfillments[0]?.createdAt) {
      deliveryDateString = order.fulfillments[0].createdAt;
    }

    const deliveryDate = new Date(deliveryDateString || new Date());
    const today = new Date();

    // Reset times to midnight to avoid timezone/hour math errors
    deliveryDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const daysSinceDelivery = Math.floor((today.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceDelivery > 3) {
      return {
        eligible: false,
        reason: "Return window closed"
      };
    }

    return { eligible: true, reason: null };
  };

  const handleGlobalItemSelection = (order, item) => {
    // Create a unique identifier for this specific line item within this specific order
    const orderIdentifier = order.name || order.orderNumber || order.id;
    // Handle both GraphQL 'node' structure and flat REST structure
    const itemId = item.node ? item.node.id : item.id;
    const uniqueId = `${orderIdentifier}-${itemId}`;

    setGlobalSelectedItems((prevSelected) => {
      // Check if item is already in global selection array
      const isAlreadySelected = prevSelected.some((selectedItem) => selectedItem.uniqueId === uniqueId);

      if (isAlreadySelected) {
        // If it's already selected, remove it (uncheck)
        return prevSelected.filter((selectedItem) => selectedItem.uniqueId !== uniqueId);
      } else {
        // If it's not selected, add it (check)
        // Extract necessary data safely whether it's GraphQL or REST structure
        const itemTitle = item.node ? item.node.title : item.title;
        const itemPrice = item.node?.originalUnitPriceSet?.shopMoney?.amount || item.price || 0;
        
        // Extract customer name from both REST and GraphQL order structures
        const customerName = order.customer
          ? `${order.customer.first_name || order.customer.firstName || ''} ${order.customer.last_name || order.customer.lastName || ''}`.trim()
          : 'Guest';

        // Extract courier from fulfillments (REST or GraphQL)
        const originalCourier = order.fulfillments?.[0]?.tracking_company
          || order.fulfillments?.edges?.[0]?.node?.trackingInfo?.[0]?.company
          || "Unknown";

        const itemQuantity = item.node ? (item.node.quantity || 1) : (item.quantity || 1);

        return [
          ...prevSelected,
          {
            uniqueId,
            orderId: orderIdentifier,
            lineItemId: itemId,
            id: itemId,
            title: itemTitle,
            price: itemPrice,
            quantity: itemQuantity,
            customerName,
            originalCourier,
          },
        ];
      }
    });
  };

  // --- SELECTION HANDLERS ---
  const handleCheckboxChange = (order, item) => {
    const uniqueId = `${order.name}-${item.id}`;
    const exists = selectedItems.find(i => i.uniqueId === uniqueId);
    if (exists) {
      setSelectedItems(selectedItems.filter(i => i.uniqueId !== uniqueId));
    } else {
      setSelectedItems([...selectedItems, {
        uniqueId: uniqueId,
        orderId: order.name,
        originalCourier: order.fulfillments?.[0]?.tracking_company || "Unknown",
        customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
        title: item.name,
        price: item.price,
      }]);
    }
  };

  const handleSelectOrder = (order) => {
    // Check if order has been delivered - fix the delivery status check
    const isDelivered = order.fulfillments && order.fulfillments.length > 0;
    
    if (!isDelivered) {
      setError("This order hasn't been delivered yet. Returns are only available for delivered orders.");
      return;
    }
    
    // Check return window (15 days from fulfillment date)
    const fulfillmentDate = order.fulfillments?.[0]?.createdAt ? new Date(order.fulfillments[0].createdAt) : new Date(order.created_at);
    const daysSinceFulfillment = Math.floor((new Date() - fulfillmentDate) / (1000 * 60 * 60 * 24));
    const isReturnWindowClosed = daysSinceFulfillment > 15;
    
    const returnableItems = order.line_items?.filter((item) => {
      // Check if item is already returned (use returnHistory state)
      const isAlreadyReturned = returnHistory.some(returnReq => 
        returnReq.items?.some(returnItem => returnItem.lineItemId === item.id)
      );
      
      // Check if return window is closed
      const itemReturnWindowClosed = daysSinceFulfillment > 15;
      
      return !isAlreadyReturned && !itemReturnWindowClosed;
    }) || [];
    
    if (returnableItems.length === 0) {
      setError("No items in this order are eligible for return. Items may already be returned or the return window has expired.");
      return;
    }
    
    const allSelected = returnableItems.every(item => 
      selectedItems.some(sel => sel.uniqueId === `${order.name}-${item.id}`)
    );
    
    if (allSelected) {
      // Deselect all items from this order
      const idsToRemove = returnableItems.map(item => `${order.name}-${item.id}`);
      setSelectedItems(selectedItems.filter(i => !idsToRemove.includes(i.uniqueId)));
    } else {
      // Select all returnable items from this order
      const newItems = returnableItems.map(item => ({
        uniqueId: `${order.name}-${item.id}`,
        orderId: order.name,
        originalCourier: order.fulfillments?.[0]?.tracking_company || "Unknown",
        customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
        title: item.name,
        price: item.price,
        lineItemId: item.id, // Add line item ID for tracking
      }));
      setSelectedItems([...selectedItems, ...newItems]);
    }
  };

  // --- BULK SUBMIT ---
  const handleBulkSubmit = async () => {
    if (selectedItems.length === 0) { setError("Please select at least one item to return."); return; }
    if (!userEmail) { setError("Please enter your email address."); return; }
    if (!videoFile) { setError("Please upload a video of the product(s) before submitting."); return; }

    setUploading(true);
    setError("");
    setSuccessMessage("");
    
    try {
      let videoUrl = "";
      
      // 1. Upload video directly to Firebase Storage (client-side SDK)
      if (videoFile) {
        try {
          const timestamp = Date.now();
          const uniqueFileName = `returns/${timestamp}-${videoFile.name}`;
          const storageRef = ref(storage, uniqueFileName);

          // Upload the file directly using the client SDK
          const snapshot = await uploadBytes(storageRef, videoFile);

          // Get the public download URL
          videoUrl = await getDownloadURL(snapshot.ref);
          console.log('Video uploaded successfully:', videoUrl);
        } catch (uploadError) {
          console.error('Video upload failed:', uploadError);
          setError('Failed to upload video. Please try again.');
          return;
        }
      }

      // 2. Prepare items matching the backend Zod schema
      const itemsForApi = selectedItems.map(item => ({
        lineItemId: String(item.lineItemId),
        id: String(item.id || item.lineItemId),
        title: String(item.title),
        quantity: Number(item.quantity) || 1,
        price: parseFloat(item.price) || 0,
      }));

      // 3. Submit return request with video URL
      const response = await fetch('/api/submit-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedItems[0].orderId,
          customerName: selectedItems[0].customerName || 'Guest',
          email: userEmail,
          items: itemsForApi,
          phone: phoneNumber,
          reason: commonReason,
          comments: comments,
          videoUrl: videoUrl,
          originalCourier: selectedItems[0].originalCourier || 'Unknown'
        })
      });
      
      const result = await response.json();
      
      if (!result.success) {
        // Map error codes to user-friendly messages
        const errorMessages = {
          'VALIDATION_ERROR': 'Invalid request format. Please check your input.',
          'DUPLICATE_RETURN': 'Some items have already been returned. Please select different items.',
          'MISSING_LINE_ITEM_IDS': 'Invalid item selection. Please try again.',
          'FIRESTORE_ERROR': 'Failed to save return request. Please try again.',
          'INTERNAL_ERROR': 'Server error. Please try again later.'
        };
        
        const userMessage = errorMessages[result.code] || result.error || 'Return processing failed';
        setError(userMessage);
        return;
      }
      
      setSuccessMessage(result.message || "Return Request Submitted Successfully! We will review and email you shortly.");
      
      // Reset Form
      setSelectedItems([]);
      setIsModalOpen(false);
      setVideoFile(null);
      setComments("");
      setUserEmail("");
      
    } catch (err) {
      console.error(err);
      setError("Error: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  // --- EFFECTS ---
  useEffect(() => {
    if (!auth) return; // Guard against null auth (missing Firebase config)
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchOrders(phoneNumber, null); // Fetch orders when logged in
      }
    });
    return () => unsubscribe();
  }, [phoneNumber]);

  // --- RENDER: LOGIN SCREEN ---
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F9F6F2] flex items-center justify-center relative overflow-hidden p-4">
        {/* MANDALAS RESTORED */}
        <img src="/mandala.png" alt="" className="absolute top-0 left-0 opacity-80 pointer-events-none z-0 w-[35vw] md:w-[21vw]" style={{ transform: 'translate(-20%, -20%) rotate(-15deg)' }} />
        <img src="/mandala.png" alt="" className="absolute bottom-0 right-0 opacity-80 pointer-events-none z-0 w-[35vw] md:w-[21vw]" style={{ transform: 'translate(20%, 20%) rotate(165deg)' }} />
        
        <div className="bg-white p-8 md:p-14 rounded shadow-sm z-10 border border-[#e5e0d8] w-[85vw] md:w-[50vw]">
          <div className="text-center mb-8">
            <h1 className="font-serif text-2xl md:text-3xl text-[#3a3a3a] tracking-widest uppercase mb-3">Satmi Returns</h1>
            <p className="text-gray-300 text-xs md:text-sm uppercase tracking-wide">Enter your details to initiate return</p>
          </div>
          
          <div className="space-y-6">
            {/* Auth Mode Toggle */}
            <div className="flex justify-center space-x-4 mb-6">
              <button
                onClick={() => {
                  setAuthMode("phone");
                  setError("");
                  setSuccessMessage("");
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  authMode === "phone" 
                    ? "bg-[#7A1E1E] text-white" 
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Login with Phone
              </button>
              <button
                onClick={() => {
                  setAuthMode("orderId");
                  setError("");
                  setSuccessMessage("");
                  setPhoneNumber("+91");
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  authMode === "orderId" 
                    ? "bg-[#7A1E1E] text-white" 
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Login with Order ID
              </button>
            </div>

            {/* Phone Number Login */}
            {authMode === "phone" && (
              <div className="space-y-6">
                <input 
                  type="tel" 
                  value={phoneNumber} 
                  onChange={(e) => {
                    setPhoneNumber(e.target.value);
                    setError("");
                    setSuccessMessage("");
                  }} 
                  className="w-full border border-gray-300 px-4 py-4 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors text-base" 
                  placeholder="+919999999999" 
                />
                <button 
                  onClick={sendOtp} 
                  disabled={loading}
                  className="w-full bg-[#7A1E1E] text-white py-4 rounded font-bold tracking-wider hover:bg-[#5e1717] transition-colors shadow-sm text-sm uppercase disabled:opacity-60" 
                >
                  {loading ? "Sending..." : "Send OTP"}
                </button>
              </div>
            )}

            {/* Order ID Login */}
            {authMode === "orderId" && (
              <div className="space-y-6">
                <input 
                  type="text" 
                  value={orderId} 
                  onChange={(e) => {
                    setOrderId(e.target.value);
                    setError("");
                    setSuccessMessage("");
                  }} 
                  className="w-full border border-gray-300 px-4 py-4 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors text-base" 
                  placeholder="Enter your Order ID" 
                />
                <button 
                  onClick={handleOrderIdLogin} 
                  disabled={loading}
                  className="w-full bg-[#7A1E1E] text-white py-4 rounded font-bold tracking-wider hover:bg-[#5e1717] transition-colors shadow-sm text-sm uppercase disabled:opacity-60" 
                >
                  {loading ? "Fetching..." : "Get OTP"}
                </button>
              </div>
            )}

            {/* OTP Verification */}
            {authMode === "otp" && (
              <div className="space-y-6">
                <p className="text-center text-gray-600 mb-4">
                  OTP sent to phone ending in <span className="font-bold">{phoneNumber.slice(-4)}</span>
                </p>
                
                <input 
                  type="text" 
                  value={otp} 
                  onChange={(e) => {
                    setOtp(e.target.value);
                    setError("");
                    setSuccessMessage("");
                  }} 
                  className="w-full border border-gray-300 px-4 py-4 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors text-center text-xl tracking-widest" 
                  placeholder="• • • •" 
                  maxLength={6}
                  style={{ color: 'black' }}
                />
                
                <button 
                  onClick={verifyOtp} 
                  className="w-full bg-[#7A1E1E] text-white py-4 rounded font-bold tracking-wider hover:bg-[#5e1717] transition-colors shadow-sm text-sm uppercase" 
                >
                  Verify & Login
                </button>
                
                <button 
                  onClick={() => {
                    setAuthMode("phone");
                    setOtp("");
                    setConfirmationResult(null);
                    setError("");
                    setSuccessMessage("");
                  }}
                  className="w-full border border-gray-300 text-gray-700 py-4 rounded font-medium hover:bg-gray-50 text-sm"
                >
                  Back to Login Options
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-6 text-red-600 text-xs text-center bg-red-50 p-2 rounded">
              {error}
            </div>
          )}
          
          {successMessage && authMode !== "otp" && (
            <div className="mt-6 text-green-600 text-xs text-center bg-green-50 p-2 rounded">
              {successMessage}
            </div>
          )}
        </div>
        
        <div id="recaptcha-container"></div>
      </div>
    );
  }

  // --- RENDER: DASHBOARD ---
  if (user) {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        {/* Main Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-xl font-bold text-gray-900">Satmi Returns</h1>
            <button 
              onClick={() => auth.signOut()} 
              className="px-4 py-2 border border-[#7A1E1E] text-[#7A1E1E] rounded-lg hover:bg-gray-50 font-medium"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            {/* Tabs */}
            <div className="flex space-x-8">
              <button
                onClick={() => setDashboardView("eligible-orders")}
                className={`pb-2 border-b-2 font-medium text-sm transition-colors ${
                  dashboardView === "eligible-orders"
                    ? "border-[#7A1E1E] text-[#7A1E1E]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Eligible Orders
              </button>
              <button
                onClick={() => setDashboardView("my-returns")}
                className={`pb-2 border-b-2 font-medium text-sm transition-colors ${
                  dashboardView === "my-returns"
                    ? "border-[#7A1E1E] text-[#7A1E1E]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                My Returns
              </button>
            </div>

            {/* View Toggle */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">View:</span>
              <button
                onClick={() => setViewMode("card")}
                className={`px-3 py-1 text-sm font-medium rounded ${
                  viewMode === "card"
                    ? "bg-[#7A1E1E] text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Card
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-1 text-sm font-medium rounded ${
                  viewMode === "table"
                    ? "bg-[#7A1E1E] text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Table
              </button>
            </div>
          </div>
        </div>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="max-w-7xl mx-auto mt-4 px-4">
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded text-sm">
              {successMessage}
            </div>
          </div>
        )}
        {error && (
          <div className="max-w-7xl mx-auto mt-4 px-4">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
              {error}
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* Eligible Orders View */}
          {dashboardView === "eligible-orders" && (
            <>
              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#7A1E1E] mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading your orders...</p>
                </div>
              ) : orders.length > 0 ? (
                <>
                  {/* Card View */}
                  {viewMode === "card" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {orders.map((order) => (
                        <div key={order.name} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                          {/* Card Header */}
                          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                            <div className="flex justify-between items-center">
                              <div>
                                <h3 className="font-semibold text-gray-900">{order.name}</h3>
                                <p className="text-sm text-gray-600">
                                  {order.created_at ? new Date(order.created_at).toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric', 
                                    year: 'numeric' 
                                  }) : 'Order Date'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {order.cancelled_at && (
                                  <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                                    Cancelled
                                  </span>
                                )}
                                {canCancelOrder(order) && (
                                  <button
                                    onClick={() => handleCancelOrder(order)}
                                    disabled={isCancelling && cancellingOrderId === order.id}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors flex items-center gap-1"
                                  >
                                    {isCancelling && cancellingOrderId === order.id ? (
                                      <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                                        Cancelling...
                                      </>
                                    ) : (
                                      'Cancel Order'
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          {/* Line Items */}
                          <div className="p-4 space-y-3">
                            {(order.line_items || order.lineItems?.edges?.map(e => e.node) || []).map((item, index) => {
                              const eligibility = checkEligibility(item, order);
                              const itemId = item.node?.id || item.id;
                              const isSelected = globalSelectedItems.some(i => i.uniqueId === `${order.name}-${itemId}`);
                              // Thumbnail: REST orders have item.image?.src; GraphQL have item.image?.url
                              const thumbSrc = item.image?.src || item.image?.url || item.node?.image?.url || null;
                              
                              return (
                                <div key={item.id || item.node?.id || index} className="flex items-center space-x-3 p-3 border border-gray-100 rounded-lg">
                                  {/* Checkbox */}
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected}
                                    disabled={!eligibility.eligible}
                                    onChange={() => handleGlobalItemSelection(order, item)}
                                    className={`rounded border-gray-300 text-[#7A1E1E] focus:ring-[#7A1E1E] ${
                                      !eligibility.eligible ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                                  />
                                  
                                  {/* Thumbnail */}
                                  <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center overflow-hidden shrink-0">
                                    {thumbSrc ? (
                                      <img src={thumbSrc} alt={item.name || item.title} className="w-full h-full object-cover" />
                                    ) : (
                                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                    )}
                                  </div>
                                  
                                  {/* Product Details */}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 text-sm">{item.name || item.title}</p>
                                    <p className="text-sm text-gray-600">₹{item.price}</p>
                                  </div>
                                  
                                  {/* Status Badge */}
                                  <div className="text-right">
                                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                      eligibility.eligible
                                        ? "bg-green-100 text-green-800" 
                                        : "bg-red-100 text-red-800"
                                    }`}>
                                      {eligibility.eligible ? "Eligible for Return" : 
                                       eligibility.reason === "Return window closed" ? "Return Window Closed" : 
                                       "Not Delivered Yet"}
                                    </span>
                                    {!eligibility.eligible && eligibility.reason === "You can create return after product has been delivered" && (
                                      <p className="text-xs text-red-600 mt-1 max-w-xs">
                                        You can create return after product has been delivered
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Table View */}
                  {viewMode === "table" && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Select</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {orders.map((order) => 
                              (order.line_items || []).map((item, index) => {
                                const eligibility = checkEligibility(item, order);
                                const itemId = item.id;
                                const isSelected = globalSelectedItems.some(i => i.uniqueId === `${order.name}-${itemId}`);
                                
                                return (
                                  <tr key={`${order.name}-${itemId || index}`} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                      <input 
                                        type="checkbox" 
                                        checked={isSelected}
                                        disabled={!eligibility.eligible}
                                        onChange={() => handleGlobalItemSelection(order, item)}
                                        className={`rounded border-gray-300 text-[#7A1E1E] focus:ring-[#7A1E1E] ${
                                          !eligibility.eligible ? 'opacity-50 cursor-not-allowed' : ''
                                        }`}
                                      />
                                    </td>
                                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{order.name}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">
                                      {order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center space-x-3">
                                        <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center overflow-hidden">
                                          {(item.image?.src || item.image?.url) ? (
                                            <img src={item.image?.src || item.image?.url} alt={item.name || item.title} className="w-full h-full object-cover" />
                                          ) : (
                                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                          )}
                                        </div>
                                        <div>
                                          <p className="text-sm font-medium text-gray-900">{item.name || item.title}</p>
                                          <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-900">₹{item.price}</td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                        eligibility.eligible
                                          ? "bg-green-100 text-green-800" 
                                          : "bg-red-100 text-red-800"
                                      }`}>
                                        {eligibility.eligible ? "Eligible" : 
                                         eligibility.reason === "Return window closed" ? "Window Closed" : 
                                         "Not Delivered"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      {order.cancelled_at ? (
                                        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">Cancelled</span>
                                      ) : canCancelOrder(order) && index === 0 ? (
                                        <button
                                          onClick={() => handleCancelOrder(order)}
                                          disabled={isCancelling && cancellingOrderId === order.id}
                                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors flex items-center gap-1"
                                        >
                                          {isCancelling && cancellingOrderId === order.id ? (
                                            <>
                                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                                              Cancelling...
                                            </>
                                          ) : (
                                            'Cancel'
                                          )}
                                        </button>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-600">No orders found for this phone number.</p>
                  <p className="text-sm text-gray-500 mt-2">Please check your phone number or contact support.</p>
                </div>
              )}
            </>
          )}

          {/* My Returns View */}
          {dashboardView === "my-returns" && (
            <div className="space-y-6">
              {loadingReturns ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#7A1E1E] mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading return history...</p>
                </div>
              ) : returnHistory.length > 0 ? (
                returnHistory.map((returnRequest, index) => (
                  <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-semibold text-gray-900 text-lg">Order {returnRequest.orderId}</h3>
                        <p className="text-sm text-gray-600">
                          Return Date: {new Date(returnRequest.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        returnRequest.status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                        returnRequest.status === 'approved' ? 'bg-green-100 text-green-800' :
                        returnRequest.status === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {returnRequest.status?.charAt(0).toUpperCase() + returnRequest.status?.slice(1) || 'Pending'}
                      </span>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-gray-700">Items Returned:</p>
                        <div className="mt-2 space-y-2">
                          {returnRequest.items?.map((item, itemIndex) => (
                            <div key={itemIndex} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                              <span className="text-sm text-gray-900">{item.title}</span>
                              <span className="text-sm text-gray-600">Qty: {item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {returnRequest.refundAmount && (
                        <div className="pt-3 border-t border-gray-200">
                          <p className="text-sm font-medium text-gray-700">
                            Refund Amount: {returnRequest.currency || '₹'}{returnRequest.refundAmount}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-600">No return requests found.</p>
                  <p className="text-sm text-gray-500 mt-2">Your return history will appear here once you submit returns.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fixed Floating Footer */}
        {globalSelectedItems.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#7A1E1E] text-white shadow-lg z-50">
            <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="font-medium">
                  Proceed to Return ({globalSelectedItems.length} items)
                </span>
              </div>
              <button 
                onClick={() => {
                  setSelectedItems(globalSelectedItems);
                  setIsModalOpen(true);
                }}
                className="px-6 py-2 bg-white text-[#7A1E1E] rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Selected Items Modal */}
        {isModalOpen && selectedItems.length > 0 && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Selected Items for Return</h3>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-4">
                {selectedItems.map((item, index) => (
                  <div key={item.uniqueId} className="flex items-center justify-between p-3 border border-gray-100 rounded">
                    <div className="flex items-center space-x-3">
                      <span className="font-medium text-gray-900">{item.title}</span>
                      <span className="text-sm text-gray-500">₹{item.price}</span>
                    </div>
                    <button 
                      onClick={() => {
                        setSelectedItems(selectedItems.filter(i => i.uniqueId !== item.uniqueId));
                        setGlobalSelectedItems(globalSelectedItems.filter(i => i.uniqueId !== item.uniqueId));
                      }}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {/* Return Form */}
              <div className="space-y-4 mt-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Return Reason</label>
                  <select 
                    value={commonReason} 
                    onChange={(e) => setCommonReason(e.target.value)} 
                    className="w-full border border-gray-300 px-4 py-3 rounded text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors"
                  >
                    <option value="Size issue">Size issue</option>
                    <option value="Quality issue">Quality issue</option>
                    <option value="Wrong item">Wrong item</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Additional Comments</label>
                  <textarea 
                    value={comments} 
                    onChange={(e) => setComments(e.target.value)} 
                    className="w-full border border-gray-300 px-4 py-3 rounded text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors" 
                    rows={4}
                    placeholder="Describe the issue in detail..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Your Email</label>
                  <input 
                    type="email" 
                    value={userEmail} 
                    onChange={(e) => setUserEmail(e.target.value)} 
                    className="w-full border border-gray-300 px-4 py-3 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors" 
                    placeholder="your@email.com"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Upload Video (Required)</label>
                  <input 
                    type="file" 
                    accept="video/*" 
                    onChange={(e) => setVideoFile(e.target.files[0])} 
                    className="w-full border border-gray-300 px-4 py-3 rounded text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors"
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleBulkSubmit} 
                  disabled={uploading}
                  className="px-4 py-2 bg-[#7A1E1E] text-white rounded-lg hover:bg-[#5e1717] disabled:opacity-60 font-medium flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Submitting...
                    </>
                  ) : (
                    "Submit Return"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cancel Order Confirmation Modal */}
        {cancelConfirmOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Cancel Order</h3>
              </div>
              <p className="text-gray-600 mb-2">
                Are you sure you want to cancel order <span className="font-semibold text-gray-900">{cancelConfirmOrder.name}</span>?
              </p>
              <p className="text-sm text-red-600 mb-6">This action cannot be reversed. A refund will be initiated to your original payment method.</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setCancelConfirmOrder(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Go Back
                </button>
                <button
                  onClick={executeCancelOrder}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                >
                  Yes, Cancel Order
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F6F2] flex items-center justify-center">
      <div className="text-center text-white">
        <div className="mb-8">
          <h1 className="font-serif text-2xl md:text-3xl text-[#3a3a3a] tracking-widest uppercase mb-3">Satmi Returns</h1>
          <p className="text-gray-300 text-sm">Loading your orders...</p>
        </div>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    </div>
  );
}
