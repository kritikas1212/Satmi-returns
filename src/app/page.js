'use client';

import { useState, useEffect } from "react";
import { auth, storage, db } from "../lib/firebaseConfig";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc, serverTimestamp, query, where, getDocs } from "firebase/firestore";

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

  // DUPLICATE RETURN TRACKING STATE
  const [returnedLineItemIds, setReturnedLineItemIds] = useState(new Set());
  const [duplicateReturnWarning, setDuplicateReturnWarning] = useState("");

  // CANCELLATION STATE
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState(null); // order object for cancel modal

  // MENU & NAVIGATION STATE
  const [openKebabMenu, setOpenKebabMenu] = useState(null); // Track which order's menu is open
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  
  // MODIFICATION STATE
  const [modifyingOrder, setModifyingOrder] = useState(null); // Order being modified
  const [editedAddress, setEditedAddress] = useState("");
  const [editedAddress2, setEditedAddress2] = useState("");
  const [editedCity, setEditedCity] = useState("");
  const [editedState, setEditedState] = useState("");
  const [editedZip, setEditedZip] = useState("");
  const [editedPhone, setEditedPhone] = useState("");
  const [isSavingModification, setIsSavingModification] = useState(false);

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
          const code = otpErr?.code;
          if (code === "auth/too-many-requests") {
            setError("Too many requests. Please wait a few minutes before trying again.");
          } else if (code === "auth/invalid-phone-number") {
            setError("Invalid phone number on file. Please contact support.");
          } else if (code === "auth/quota-exceeded") {
            setError("SMS quota exceeded. Please try again later.");
          } else if (code === "auth/captcha-check-failed") {
            setError("reCAPTCHA verification failed. Please refresh and try again.");
          } else if (code === "auth/network-request-failed") {
            setError("Network error. Please check your connection and try again.");
          } else {
            setError(otpErr?.message || "Failed to send OTP. Please try again.");
          }
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

  // --- FETCH RETURN HISTORY FROM FIREBASE ---
  const fetchReturnHistory = async (phone) => {
    if (!db) return;
    setLoadingReturns(true);
    try {
      const returnsQuery = query(
        collection(db, "returns"),
        where("phone", "==", phone)
      );
      const querySnapshot = await getDocs(returnsQuery);
      const returns = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReturnHistory(returns);

      // Build a set of all line item IDs that already have returns
      const returnedIds = new Set();
      returns.forEach(returnDoc => {
        if (returnDoc.items && Array.isArray(returnDoc.items)) {
          returnDoc.items.forEach(item => {
            if (item.lineItemId) {
              returnedIds.add(item.lineItemId);
            }
          });
        }
      });
      setReturnedLineItemIds(returnedIds);
    } catch (err) {
      console.error("Error fetching return history:", err);
    } finally {
      setLoadingReturns(false);
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

  // Check if a specific line item already has an existing return
  const isItemAlreadyReturned = (item) => {
    const itemId = item.node?.id || item.id;
    return returnedLineItemIds.has(String(itemId));
  };

  // --- 3-HOUR EDIT WINDOW HELPER ---
  const canEditOrder = (order) => {
    if (!order || !order.created_at) return false;
    const createdAt = new Date(order.created_at).getTime();
    const now = Date.now();
    const threeHoursMs = 3 * 60 * 60 * 1000;
    const timeRemaining = threeHoursMs - (now - createdAt);
    return {
      canEdit: timeRemaining > 0,
      timeRemaining: Math.max(0, timeRemaining),
      expired: timeRemaining <= 0
    };
  };

  // Format time remaining as human-readable
  const formatTimeRemaining = (ms) => {
    if (ms <= 0) return "Expired";
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return `${hours}h ${minutes}m left`;
  };

  // --- CENTRALIZED ORDER ACTION PERMISSIONS ---
  const getOrderActions = (order) => {
    const isCancelled = !!order.cancelled_at;
    const fulfillmentStatus = (order.fulfillment_status || order.displayFulfillmentStatus || '').toUpperCase();
    const isFulfilled = fulfillmentStatus === 'FULFILLED' || fulfillmentStatus === 'DELIVERED';
    const isShipped = isFulfilled || fulfillmentStatus === 'PARTIAL' || fulfillmentStatus === 'IN_PROGRESS'
      || (Array.isArray(order.fulfillments) && order.fulfillments.length > 0 && order.fulfillments[0]?.status === 'success');
    const isDelivered = isFulfilled
      || (order.delivery_status?.message === 'Eligible for Return')
      || (order.delivery_status?.message === 'Delivered')
      || (order.delivery_status?.message === 'Return Window Closed')
      || (order.delivery_status?.message === 'Delivered (Date Unknown)');

    const editWindow = canEditOrder(order);
    const cancelWindow = canCancelOrder(order);
    const eligibility = checkEligibility((order.line_items || [])[0], order);
    const hasReturnableItems = (order.line_items || []).some(item => {
      const elig = checkEligibility(item, order);
      return elig.eligible && !isItemAlreadyReturned(item);
    });

    // Modify action
    let modify = { visible: true, enabled: false, reason: '' };
    if (isCancelled) {
      modify.reason = 'Order already cancelled';
    } else if (isShipped) {
      modify.reason = 'Order has already been shipped';
    } else if (!editWindow.canEdit) {
      modify.reason = 'Modification window (3 hours) has expired';
    } else {
      modify.enabled = true;
    }

    // Cancel action
    let cancel = { visible: true, enabled: false, reason: '' };
    if (isCancelled) {
      cancel.reason = 'Order already cancelled';
    } else if (isShipped) {
      cancel.reason = 'Cannot cancel a shipped order';
    } else if (!cancelWindow) {
      cancel.reason = 'Cancellation window (1 hour) has expired';
    } else {
      cancel.enabled = true;
    }

    // Return action
    let returnAction = { visible: true, enabled: false, reason: '' };
    if (isCancelled) {
      returnAction.visible = false; // hide entirely per business rule
      returnAction.reason = 'Order already cancelled';
    } else if (!isDelivered) {
      returnAction.enabled = false;
      returnAction.reason = 'Order must be delivered before a return can be requested';
    } else if (!hasReturnableItems) {
      returnAction.enabled = false;
      returnAction.reason = eligibility.reason || 'No items eligible for return';
    } else {
      returnAction.enabled = true;
    }

    return { modify, cancel, return: returnAction };
  };

  // --- NAVIGATION HANDLERS ---
  const handleOrderAction = (order, action) => {
    setOpenKebabMenu(null); // Close menu
    
    if (action === 'cancel') {
      handleCancelOrder(order);
    } else if (action === 'modify') {
      const editWindow = canEditOrder(order);
      if (!editWindow.canEdit) {
        setError("Modification window expired. Orders can only be modified within 3 hours of placement.");
        return;
      }
      // Set modification state
      setModifyingOrder(order);
      setEditedAddress(order.shipping_address?.address1 || "");
      setEditedAddress2(order.shipping_address?.address2 || "");
      setEditedCity(order.shipping_address?.city || "");
      setEditedState(order.shipping_address?.province || order.shipping_address?.province_code || "");
      setEditedZip(order.shipping_address?.zip || "");
      setEditedPhone(order.phone || order.shipping_address?.phone || "");
    } else if (action === 'return') {
      // Auto-select all eligible items from this order
      const eligibleItems = (order.line_items || []).filter(item => {
        const eligibility = checkEligibility(item, order);
        return eligibility.eligible && !isItemAlreadyReturned(item);
      });
      
      if (eligibleItems.length === 0) {
        setError("No items in this order are eligible for return.");
        return;
      }
      
      // Select all eligible items
      const newSelections = eligibleItems.map(item => ({
        uniqueId: `${order.name}-${item.id}`,
        orderId: order.name,
        lineItemId: item.id,
        id: item.id,
        title: item.name,
        price: item.price,
        quantity: item.quantity,
        customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
        originalCourier: order.fulfillments?.[0]?.tracking_company || "Unknown",
      }));
      
      setGlobalSelectedItems(newSelections);
      setSelectedItems(newSelections);
      setIsModalOpen(true);
    }
  };

  // Save order modifications via Shopify API
  const handleSaveModification = async () => {
    if (!modifyingOrder) return;
    setError("");
    setSuccessMessage("");
    setIsSavingModification(true);
    
    try {
      // Use the order name (e.g. "#1023") to identify the order
      const orderIdentifier = modifyingOrder.name || modifyingOrder.id;
      
      const res = await fetch('/api/order/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: String(orderIdentifier).replace('#', ''),
          shippingAddress: {
            address1: editedAddress,
            address2: editedAddress2,
            city: editedCity,
            province: editedState,
            zip: editedZip,
            phone: editedPhone,
          },
          phone: editedPhone,
        }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        const errorMessages = {
          'VALIDATION_ERROR': data.details || 'Invalid data. Please check your input.',
          'ORDER_NOT_FOUND': 'Order not found on Shopify.',
          'ORDER_CANCELLED': 'Cannot modify a cancelled order.',
          'ORDER_FULFILLED': 'Cannot modify an order that has been shipped.',
          'EDIT_WINDOW_EXPIRED': 'Modification window expired. Orders can only be modified within 3 hours.',
          'SHOPIFY_UPDATE_FAILED': data.error || 'Failed to update order on Shopify.',
        };
        setError(errorMessages[data.code] || data.error || 'Failed to update order.');
        return;
      }
      
      // Update local state with the response from Shopify
      setOrders(prev => prev.map(o => 
        o.id === modifyingOrder.id 
          ? {
              ...o,
              phone: data.order?.phone || editedPhone,
              shipping_address: {
                ...o.shipping_address,
                ...(data.order?.shipping_address || {}),
              }
            }
          : o
      ));
      
      setSuccessMessage(`Order ${data.order?.name || orderIdentifier} updated successfully!`);
      setModifyingOrder(null);
    } catch (err) {
      console.error('Modification error:', err);
      setError("Network error while updating order. Please try again.");
    } finally {
      setIsSavingModification(false);
    }
  };

  const handleGlobalItemSelection = (order, item) => {
    // Check for duplicate return
    if (isItemAlreadyReturned(item)) {
      setDuplicateReturnWarning("A return request has already been created for this product. Please contact Satmi support at support@satmi.in for further assistance.");
      return;
    }
    setDuplicateReturnWarning("");

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
      setGlobalSelectedItems([]);
      setIsModalOpen(false);
      setVideoFile(null);
      setComments("");
      setUserEmail("");
      setDuplicateReturnWarning("");

      // Refresh return history to update duplicate tracking
      fetchReturnHistory(phoneNumber);
      
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
        fetchReturnHistory(phoneNumber); // Fetch existing returns for duplicate detection
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
        
        <div className="bg-white p-8 md:p-12 rounded-2xl shadow-sm z-10 border border-gray-100 w-[88vw] max-w-120">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-5">
              <a href="https://satmi.in" target="_blank" rel="noopener noreferrer">
                <img src="/logo.png" alt="Satmi" className="h-12 md:h-16 w-auto object-contain" />
              </a>
            </div>
            <h1 className="text-xl md:text-2xl text-gray-800 tracking-wide font-semibold mb-2">Welcome to SATMI</h1>
            <p className="text-[#96572A] text-xs tracking-wider uppercase">Order Management Portal</p>
          </div>
          
          <div className="space-y-6">
            {/* Auth Mode Toggle */}
            <div className="flex justify-center space-x-3 mb-6">
              <button
                onClick={() => {
                  setAuthMode("phone");
                  setError("");
                  setSuccessMessage("");
                }}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  authMode === "phone" 
                    ? "bg-[#96572A] text-white shadow-sm" 
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                Phone
              </button>
              <button
                onClick={() => {
                  setAuthMode("orderId");
                  setError("");
                  setSuccessMessage("");
                  setPhoneNumber("+91");
                }}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  authMode === "orderId" 
                    ? "bg-[#96572A] text-white shadow-sm" 
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                Order ID
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

  // Satmi.in navigation links
  const satmiNavLinks = [
    { label: 'Home', href: 'https://satmi.in/' },
    { label: 'About', href: 'https://satmi.in/pages/about-us' },
    { label: 'Products', href: 'https://satmi.in/collections/all-products' },
    { label: 'Certification', href: 'https://satmi.in/pages/certification' },
    { label: 'Contact', href: 'https://satmi.in/pages/contact' },
    { label: 'Collection', href: 'https://satmi.in/collections' },
    { label: 'Track Your Order', href: 'https://satmi.in/pages/track-your-order' },
  ];

  // --- RENDER: DASHBOARD ---
  if (user) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] pb-20">
        {/* ===== HEADER (matches satmi.in reference) ===== */}
        <header className="bg-white sticky top-0 z-40">
          {/* Desktop Header */}
          <div className="hidden md:block border-b border-gray-200">
            <div className="max-w-350 mx-auto px-6 py-3 flex items-center justify-between">
              {/* Logo - left */}
              <a href="https://satmi.in" className="shrink-0 hover:opacity-80 transition-opacity">
                <img src="/logo.png" alt="Satmi" className="h-10 w-auto object-contain" />
              </a>

              {/* Navigation - center */}
              <nav className="flex items-center space-x-6 lg:space-x-8">
                {satmiNavLinks.map(link => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="text-sm text-[#3a3a3a] hover:text-[#96572A] transition-colors whitespace-nowrap font-medium"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>

              {/* Right icons */}
              <div className="flex items-center space-x-4">
                {/* Account Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
                    className="p-1.5 hover:opacity-70 transition-opacity"
                    title="Account"
                  >
                    <svg className="w-5.5 h-5.5 text-[#3a3a3a]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                  </button>

                  {accountDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAccountDropdownOpen(false)} />
                      <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                        <div className="px-4 py-3 border-b border-gray-100">
                          <p className="text-xs text-gray-500">Signed in as</p>
                          <p className="text-sm font-medium text-gray-900 truncate">{phoneNumber}</p>
                        </div>
                        <button
                          onClick={() => { setAccountDropdownOpen(false); auth.signOut(); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center space-x-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          <span>Logout</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Mobile Header — hamburger LEFT, logo CENTER, account RIGHT */}
          <div className="md:hidden border-b border-gray-200">
            <div className="flex items-center justify-between px-4 py-3">
              {/* Left: Hamburger */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="p-1.5 -ml-1.5 hover:opacity-70 transition-opacity"
                aria-label="Open menu"
              >
                <svg className="w-6 h-6 text-[#3a3a3a]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>

              {/* Center: Logo */}
              <a href="https://satmi.in" className="absolute left-1/2 -translate-x-1/2 hover:opacity-80 transition-opacity">
                <img src="/logo.png" alt="Satmi" className="h-9 w-auto object-contain" />
              </a>

              {/* Right: Account */}
              <div className="relative">
                <button
                  onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
                  className="p-1.5 -mr-1.5 hover:opacity-70 transition-opacity"
                  title="Account"
                >
                  <svg className="w-5.5 h-5.5 text-[#3a3a3a]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </button>

                {accountDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setAccountDropdownOpen(false)} />
                    <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-xs text-gray-500">Signed in as</p>
                        <p className="text-sm font-medium text-gray-900 truncate">{phoneNumber}</p>
                      </div>
                      <button
                        onClick={() => { setAccountDropdownOpen(false); auth.signOut(); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center space-x-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        <span>Logout</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Accent Border - warm gradient bar beneath header (like satmi.in) */}
          <div className="h-0.75 bg-linear-to-r from-[#C8956C] via-[#96572A] to-[#C8956C]"></div>
        </header>

        {/* ===== MOBILE SLIDE-OUT MENU (from LEFT, matches reference) ===== */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            {/* Overlay */}
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* Panel — slides from left */}
            <div className="absolute inset-y-0 left-0 w-[85vw] max-w-sm bg-[#FBF7F2] shadow-2xl flex flex-col animate-slideInLeft">
              {/* Close button */}
              <div className="flex justify-end p-5">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 hover:opacity-70 transition-opacity"
                  aria-label="Close menu"
                >
                  <svg className="w-6 h-6 text-[#3a3a3a]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Nav Links */}
              <nav className="flex-1 px-6 space-y-1">
                {satmiNavLinks.map(link => (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block py-4 text-lg font-semibold text-[#96572A] hover:text-[#7A4422] transition-colors border-b border-[#EDE5DA] last:border-0"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>

              {/* Bottom: account info */}
              <div className="p-6 border-t border-[#EDE5DA]">
                <div className="text-xs text-gray-500 mb-1">Signed in as</div>
                <div className="text-sm font-medium text-[#3a3a3a] mb-3">{phoneNumber}</div>
                <button
                  onClick={() => { setMobileMenuOpen(false); auth.signOut(); }}
                  className="w-full py-2.5 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Controls Bar */}
        <div className="bg-white/80 backdrop-blur-sm border-b border-gray-100 px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            {/* Tabs */}
            <div className="flex space-x-6">
              <button
                onClick={() => setDashboardView("eligible-orders")}
                className={`pb-1.5 border-b-2 text-sm tracking-wide transition-colors ${
                  dashboardView === "eligible-orders"
                    ? "border-[#96572A] text-[#96572A] font-semibold"
                    : "border-transparent text-gray-400 hover:text-gray-600 font-medium"
                }`}
              >
                Orders
              </button>
              <button
                onClick={() => setDashboardView("my-returns")}
                className={`pb-1.5 border-b-2 text-sm tracking-wide transition-colors ${
                  dashboardView === "my-returns"
                    ? "border-[#96572A] text-[#96572A] font-semibold"
                    : "border-transparent text-gray-400 hover:text-gray-600 font-medium"
                }`}
              >
                Returns
              </button>
            </div>

            {/* View Toggle — icons only */}
            <div className="flex items-center bg-gray-50 rounded-full p-0.5 border border-gray-100">
              <button
                onClick={() => setViewMode("card")}
                className={`p-2 rounded-full transition-all ${
                  viewMode === "card"
                    ? "bg-white text-[#96572A] shadow-sm"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                title="Card View"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`p-2 rounded-full transition-all ${
                  viewMode === "table"
                    ? "bg-white text-[#96572A] shadow-sm"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                title="Table View"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        {successMessage && (
          <div className="max-w-7xl mx-auto mt-4 px-4">
            <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 px-4 py-3 rounded-xl text-sm">
              {successMessage}
            </div>
          </div>
        )}
        {error && (
          <div className="max-w-7xl mx-auto mt-4 px-4">
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          </div>
        )}
        {duplicateReturnWarning && (
          <div className="max-w-7xl mx-auto mt-4 px-4">
            <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2.5">
              <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <span>{duplicateReturnWarning}</span>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-4 py-5">
          {/* Orders View */}
          {dashboardView === "eligible-orders" && (
            <>
              {loading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-7 w-7 border-2 border-[#96572A] border-t-transparent mx-auto"></div>
                  <p className="text-gray-400 mt-3 text-sm">Loading orders...</p>
                </div>
              ) : orders.length > 0 ? (
                <>
                  {/* Card View */}
                  {viewMode === "card" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {orders.map((order) => (
                        <div key={order.name} className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow duration-200">
                          {/* Card Header */}
                          <div className="px-5 py-4 border-b border-gray-50">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-semibold text-gray-900 text-sm tracking-wide">{order.name}</h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {order.created_at ? new Date(order.created_at).toLocaleDateString('en-US', { 
                                    month: 'long', 
                                    day: 'numeric', 
                                    year: 'numeric' 
                                  }) : ''}
                                </p>
                                {order.cancelled_at && (
                                  <span className="inline-flex mt-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-red-50 text-red-600 border border-red-100">
                                    Cancelled
                                  </span>
                                )}
                              </div>
                              {/* Actions Menu */}
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenKebabMenu(openKebabMenu === order.id ? null : order.id);
                                  }}
                                  className="p-1.5 rounded-full hover:bg-gray-50 transition-colors"
                                  title="Actions"
                                >
                                  <svg className="w-4.5 h-4.5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                                  </svg>
                                </button>
                                
                                {openKebabMenu === order.id && (() => {
                                  const actions = getOrderActions(order);
                                  return (
                                  <>
                                    <div className="fixed inset-0 z-10" onClick={() => setOpenKebabMenu(null)} />
                                    <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 z-20">
                                      {/* Modify Order */}
                                      <div className="relative group">
                                        <button
                                          onClick={() => actions.modify.enabled && handleOrderAction(order, 'modify')}
                                          disabled={!actions.modify.enabled}
                                          className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2.5 transition-colors ${
                                            actions.modify.enabled
                                              ? 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer'
                                              : 'text-gray-300 cursor-not-allowed'
                                          }`}
                                        >
                                          <svg className={`w-4 h-4 ${actions.modify.enabled ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                                          </svg>
                                          <span>Modify Order</span>
                                        </button>
                                        {!actions.modify.enabled && (
                                          <div className="hidden group-hover:block absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg whitespace-nowrap z-30 shadow-lg">
                                            {actions.modify.reason}
                                            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                                          </div>
                                        )}
                                      </div>
                                      {/* Cancel Order */}
                                      <div className="relative group">
                                        <button
                                          onClick={() => actions.cancel.enabled && handleOrderAction(order, 'cancel')}
                                          disabled={!actions.cancel.enabled}
                                          className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2.5 transition-colors ${
                                            actions.cancel.enabled
                                              ? 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer'
                                              : 'text-gray-300 cursor-not-allowed'
                                          }`}
                                        >
                                          <svg className={`w-4 h-4 ${actions.cancel.enabled ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                          <span>Cancel Order</span>
                                        </button>
                                        {!actions.cancel.enabled && (
                                          <div className="hidden group-hover:block absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg whitespace-nowrap z-30 shadow-lg">
                                            {actions.cancel.reason}
                                            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                                          </div>
                                        )}
                                      </div>
                                      {/* Return Order — hidden entirely when cancelled */}
                                      {actions.return.visible && (
                                        <div className="relative group">
                                          <button
                                            onClick={() => actions.return.enabled && handleOrderAction(order, 'return')}
                                            disabled={!actions.return.enabled}
                                            className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2.5 transition-colors ${
                                              actions.return.enabled
                                                ? 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer'
                                                : 'text-gray-300 cursor-not-allowed'
                                            }`}
                                          >
                                            <svg className={`w-4 h-4 ${actions.return.enabled ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                                            </svg>
                                            <span>Return Order</span>
                                          </button>
                                          {!actions.return.enabled && (
                                            <div className="hidden group-hover:block absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg whitespace-nowrap z-30 shadow-lg">
                                              {actions.return.reason}
                                              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>

                          {/* Edit Window Banner */}
                          {!order.cancelled_at && canEditOrder(order).canEdit && (
                            <div className="mx-5 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50/60 border border-blue-100">
                              <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <p className="text-[11px] text-blue-600">
                                <span className="font-medium">{formatTimeRemaining(canEditOrder(order).timeRemaining)}</span> to modify address/phone
                              </p>
                            </div>
                          )}
                          
                          {/* Line Items */}
                          <div className="px-5 py-3 space-y-2.5">
                            {(order.line_items || order.lineItems?.edges?.map(e => e.node) || []).map((item, index) => {
                              const eligibility = checkEligibility(item, order);
                              const itemId = item.node?.id || item.id;
                              const isSelected = globalSelectedItems.some(i => i.uniqueId === `${order.name}-${itemId}`);
                              const alreadyReturned = isItemAlreadyReturned(item);
                              const isDisabled = !eligibility.eligible || alreadyReturned;
                              const thumbSrc = item.image?.src || item.image?.url || item.node?.image?.url || null;
                              
                              return (
                                <div key={item.id || item.node?.id || index} className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${alreadyReturned ? 'bg-amber-50/60 border border-amber-100' : isSelected ? 'bg-[#F9F6F2] border border-[#C8956C]/30' : 'hover:bg-gray-50/50 border border-transparent'}`}>
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected}
                                    disabled={isDisabled}
                                    onChange={() => handleGlobalItemSelection(order, item)}
                                    className={`rounded border-gray-200 text-[#96572A] focus:ring-[#96572A] h-4 w-4 ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                  />
                                  
                                  {/* Thumbnail */}
                                  <div className="w-14 h-14 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden shrink-0 border border-gray-100">
                                    {thumbSrc ? (
                                      <img src={thumbSrc} alt={item.name || item.title} className="w-full h-full object-cover" />
                                    ) : (
                                      <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                                      </svg>
                                    )}
                                  </div>
                                  
                                  {/* Product Details */}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-800 text-sm leading-snug">{item.name || item.title}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">₹{item.price}</p>
                                  </div>
                                  
                                  {/* Status */}
                                  <div className="text-right shrink-0">
                                    <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full tracking-wide ${
                                      alreadyReturned
                                        ? "bg-amber-50 text-amber-600 border border-amber-200"
                                        : eligibility.eligible
                                          ? "bg-emerald-50 text-emerald-600 border border-emerald-200" 
                                          : "bg-gray-50 text-gray-400 border border-gray-200"
                                    }`}>
                                      {alreadyReturned ? "Returned" :
                                       eligibility.eligible ? "Eligible" : 
                                       eligibility.reason === "Return window closed" ? "Window Closed" : 
                                       "Pending Delivery"}
                                    </span>
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
                    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Select</th>
                              <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Order</th>
                              <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                              <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Product</th>
                              <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Price</th>
                              <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                              <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {orders.map((order) => 
                              (order.line_items || []).map((item, index) => {
                                const eligibility = checkEligibility(item, order);
                                const itemId = item.id;
                                const isSelected = globalSelectedItems.some(i => i.uniqueId === `${order.name}-${itemId}`);
                                const alreadyReturned = isItemAlreadyReturned(item);
                                const isDisabled = !eligibility.eligible || alreadyReturned;
                                
                                return (
                                  <tr key={`${order.name}-${itemId || index}`} className={`border-b border-gray-50 last:border-0 transition-colors ${alreadyReturned ? 'bg-amber-50/40' : 'hover:bg-gray-50/50'}`}>
                                    <td className="px-4 py-3.5">
                                      <input 
                                        type="checkbox" 
                                        checked={isSelected}
                                        disabled={isDisabled}
                                        onChange={() => handleGlobalItemSelection(order, item)}
                                        className={`rounded border-gray-200 text-[#96572A] focus:ring-[#96572A] h-4 w-4 ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                      />
                                    </td>
                                    <td className="px-4 py-3.5 text-sm font-medium text-gray-800">{order.name}</td>
                                    <td className="px-4 py-3.5 text-xs text-gray-400">
                                      {order.created_at ? new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <div className="flex items-center space-x-2.5">
                                        <div className="w-9 h-9 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden border border-gray-100 shrink-0">
                                          {(item.image?.src || item.image?.url) ? (
                                            <img src={item.image?.src || item.image?.url} alt={item.name || item.title} className="w-full h-full object-cover" />
                                          ) : (
                                            <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                                            </svg>
                                          )}
                                        </div>
                                        <div>
                                          <p className="text-sm font-medium text-gray-800 leading-snug">{item.name || item.title}</p>
                                          <p className="text-[11px] text-gray-400">Qty: {item.quantity}</p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-sm text-gray-600">₹{item.price}</td>
                                    <td className="px-4 py-3.5">
                                      <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full tracking-wide ${
                                        alreadyReturned
                                          ? "bg-amber-50 text-amber-600 border border-amber-200"
                                          : eligibility.eligible
                                            ? "bg-emerald-50 text-emerald-600 border border-emerald-200" 
                                            : "bg-gray-50 text-gray-400 border border-gray-200"
                                      }`}>
                                        {alreadyReturned ? "Returned" :
                                         eligibility.eligible ? "Eligible" : 
                                         eligibility.reason === "Return window closed" ? "Closed" : 
                                         "Pending"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      {index === 0 && (
                                        <div className="relative">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenKebabMenu(openKebabMenu === order.id ? null : order.id);
                                            }}
                                            className="p-1.5 rounded-full hover:bg-gray-50 transition-colors"
                                          >
                                            <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                                              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                                            </svg>
                                          </button>
                                          
                                          {openKebabMenu === order.id && (() => {
                                            const actions = getOrderActions(order);
                                            return (
                                            <>
                                              <div className="fixed inset-0 z-10" onClick={() => setOpenKebabMenu(null)} />
                                              <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 z-20">
                                                {/* Modify Order */}
                                                <div className="relative group">
                                                  <button
                                                    onClick={() => actions.modify.enabled && handleOrderAction(order, 'modify')}
                                                    disabled={!actions.modify.enabled}
                                                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2.5 transition-colors ${
                                                      actions.modify.enabled
                                                        ? 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer'
                                                        : 'text-gray-300 cursor-not-allowed'
                                                    }`}
                                                  >
                                                    <svg className={`w-4 h-4 ${actions.modify.enabled ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                                                    </svg>
                                                    <span>Modify Order</span>
                                                  </button>
                                                  {!actions.modify.enabled && (
                                                    <div className="hidden group-hover:block absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg whitespace-nowrap z-30 shadow-lg">
                                                      {actions.modify.reason}
                                                      <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                                                    </div>
                                                  )}
                                                </div>
                                                {/* Cancel Order */}
                                                <div className="relative group">
                                                  <button
                                                    onClick={() => actions.cancel.enabled && handleOrderAction(order, 'cancel')}
                                                    disabled={!actions.cancel.enabled}
                                                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2.5 transition-colors ${
                                                      actions.cancel.enabled
                                                        ? 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer'
                                                        : 'text-gray-300 cursor-not-allowed'
                                                    }`}
                                                  >
                                                    <svg className={`w-4 h-4 ${actions.cancel.enabled ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                    <span>Cancel Order</span>
                                                  </button>
                                                  {!actions.cancel.enabled && (
                                                    <div className="hidden group-hover:block absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg whitespace-nowrap z-30 shadow-lg">
                                                      {actions.cancel.reason}
                                                      <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                                                    </div>
                                                  )}
                                                </div>
                                                {/* Return Order — hidden entirely when cancelled */}
                                                {actions.return.visible && (
                                                  <div className="relative group">
                                                    <button
                                                      onClick={() => actions.return.enabled && handleOrderAction(order, 'return')}
                                                      disabled={!actions.return.enabled}
                                                      className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2.5 transition-colors ${
                                                        actions.return.enabled
                                                          ? 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer'
                                                          : 'text-gray-300 cursor-not-allowed'
                                                      }`}
                                                    >
                                                      <svg className={`w-4 h-4 ${actions.return.enabled ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                                                      </svg>
                                                      <span>Return Order</span>
                                                    </button>
                                                    {!actions.return.enabled && (
                                                      <div className="hidden group-hover:block absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg whitespace-nowrap z-30 shadow-lg">
                                                        {actions.return.reason}
                                                        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            </>
                                            );
                                          })()}
                                        </div>
                                      )}
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
                <div className="text-center py-20">
                  <svg className="w-12 h-12 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                  </svg>
                  <p className="text-gray-400 text-sm">No orders found</p>
                  <p className="text-gray-300 text-xs mt-1">Check your phone number or contact support</p>
                </div>
              )}
            </>
          )}

          {/* Returns View */}
          {dashboardView === "my-returns" && (
            <div className="space-y-4">
              {loadingReturns ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-7 w-7 border-2 border-[#96572A] border-t-transparent mx-auto"></div>
                  <p className="text-gray-400 mt-3 text-sm">Loading returns...</p>
                </div>
              ) : returnHistory.length > 0 ? (
                returnHistory.map((returnRequest, index) => (
                  <div key={index} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-sm transition-shadow">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-800 text-sm">{returnRequest.orderId}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(returnRequest.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border ${
                        returnRequest.status === 'processing' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                        returnRequest.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                        returnRequest.status === 'rejected' ? 'bg-red-50 text-red-500 border-red-200' :
                        'bg-gray-50 text-gray-500 border-gray-200'
                      }`}>
                        {returnRequest.status?.charAt(0).toUpperCase() + returnRequest.status?.slice(1) || 'Pending'}
                      </span>
                    </div>
                    
                    <div className="space-y-2">
                      {returnRequest.items?.map((item, itemIndex) => (
                        <div key={itemIndex} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                          <span className="text-sm text-gray-700">{item.title}</span>
                          <span className="text-xs text-gray-400">Qty: {item.quantity}</span>
                        </div>
                      ))}
                    </div>
                    
                    {returnRequest.refundAmount && (
                      <div className="pt-3 mt-2 border-t border-gray-50">
                        <p className="text-sm font-medium text-gray-600">
                          Refund: {returnRequest.currency || '₹'}{returnRequest.refundAmount}
                        </p>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-20">
                  <svg className="w-12 h-12 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                  </svg>
                  <p className="text-gray-400 text-sm">No return requests yet</p>
                  <p className="text-gray-300 text-xs mt-1">Your returns will appear here</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Floating Footer */}
        {globalSelectedItems.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-50">
            <div className="max-w-7xl mx-auto px-4 py-3.5 flex justify-between items-center">
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{globalSelectedItems.length}</span> item{globalSelectedItems.length > 1 ? 's' : ''} selected
              </span>
              <button 
                onClick={() => {
                  setSelectedItems(globalSelectedItems);
                  setIsModalOpen(true);
                }}
                className="px-5 py-2 bg-[#96572A] text-white rounded-full text-sm font-medium hover:bg-[#7A4422] transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Return Modal */}
        {isModalOpen && selectedItems.length > 0 && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-semibold text-gray-900">Return Request</h3>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-2">
                {selectedItems.map((item, index) => (
                  <div key={item.uniqueId} className="flex items-center justify-between p-3 rounded-lg bg-gray-50/80 border border-gray-100">
                    <div className="flex items-center space-x-3">
                      <span className="text-sm font-medium text-gray-800">{item.title}</span>
                      <span className="text-xs text-gray-400">₹{item.price}</span>
                    </div>
                    <button 
                      onClick={() => {
                        setSelectedItems(selectedItems.filter(i => i.uniqueId !== item.uniqueId));
                        setGlobalSelectedItems(globalSelectedItems.filter(i => i.uniqueId !== item.uniqueId));
                      }}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              {/* Return Form */}
              <div className="space-y-4 mt-5 pt-5 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Reason</label>
                  <select 
                    value={commonReason} 
                    onChange={(e) => setCommonReason(e.target.value)} 
                    className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors bg-white"
                  >
                    <option value="Size issue">Size issue</option>
                    <option value="Quality issue">Quality issue</option>
                    <option value="Wrong item">Wrong item</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Comments</label>
                  <textarea 
                    value={comments} 
                    onChange={(e) => setComments(e.target.value)} 
                    className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors" 
                    rows={3}
                    placeholder="Describe the issue..."
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
                  <input 
                    type="email" 
                    value={userEmail} 
                    onChange={(e) => setUserEmail(e.target.value)} 
                    className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors" 
                    placeholder="your@email.com"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Video Evidence</label>
                  <input 
                    type="file" 
                    accept="video/*" 
                    onChange={(e) => setVideoFile(e.target.files[0])} 
                    className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-[#F9F6F2] file:text-[#96572A]"
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-full hover:bg-gray-50 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleBulkSubmit} 
                  disabled={uploading}
                  className="px-5 py-2.5 bg-[#96572A] text-white rounded-full hover:bg-[#7A4422] disabled:opacity-60 text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  {uploading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
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

        {/* Order Modification Modal */}
        {modifyingOrder && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#F9F6F2] flex items-center justify-center shrink-0">
                    <svg className="w-4.5 h-4.5 text-[#96572A]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">Modify Order {modifyingOrder.name}</h3>
                </div>
                <button
                  onClick={() => setModifyingOrder(null)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Edit Window Timer */}
              {(() => {
                const editWindow = canEditOrder(modifyingOrder);
                return (
                  <div className="mb-5 flex items-center gap-2 px-3 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl">
                    <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-blue-700">
                      <span className="font-semibold">{formatTimeRemaining(editWindow.timeRemaining)}</span> to modify this order
                    </p>
                  </div>
                );
              })()}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Address Line 1</label>
                  <input
                    type="text"
                    value={editedAddress}
                    onChange={(e) => setEditedAddress(e.target.value)}
                    className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                    placeholder="Street address, apartment, etc."
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Address Line 2</label>
                  <input
                    type="text"
                    value={editedAddress2}
                    onChange={(e) => setEditedAddress2(e.target.value)}
                    className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                    placeholder="Landmark, floor, building (optional)"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">City</label>
                    <input
                      type="text"
                      value={editedCity}
                      onChange={(e) => setEditedCity(e.target.value)}
                      className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">State</label>
                    <input
                      type="text"
                      value={editedState}
                      onChange={(e) => setEditedState(e.target.value)}
                      className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                      placeholder="State / Province"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">PIN Code</label>
                    <input
                      type="text"
                      value={editedZip}
                      onChange={(e) => setEditedZip(e.target.value)}
                      className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                      placeholder="PIN code"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Phone</label>
                    <input
                      type="tel"
                      value={editedPhone}
                      onChange={(e) => setEditedPhone(e.target.value)}
                      className="w-full border border-gray-200 px-4 py-3 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                      placeholder="+91 XXXXXXXXXX"
                    />
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end mt-6">
                <button
                  onClick={() => setModifyingOrder(null)}
                  className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-full hover:bg-gray-50 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveModification}
                  disabled={isSavingModification}
                  className="px-5 py-2.5 bg-[#96572A] text-white rounded-full hover:bg-[#7A4422] text-sm font-medium disabled:opacity-60 flex items-center gap-2 transition-colors"
                >
                  {isSavingModification ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cancel Order Modal */}
        {cancelConfirmOrder && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                  <svg className="w-4.5 h-4.5 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-gray-900">Cancel Order</h3>
              </div>
              <p className="text-sm text-gray-600 mb-1.5">
                Cancel order <span className="font-semibold text-gray-900">{cancelConfirmOrder.name}</span>?
              </p>
              <p className="text-xs text-gray-400 mb-6">This action cannot be reversed. A refund will be initiated.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setCancelConfirmOrder(null)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-full hover:bg-gray-50 text-sm font-medium transition-colors">Go Back</button>
                <button onClick={executeCancelOrder} className="px-5 py-2 bg-red-600 text-white rounded-full hover:bg-red-700 text-sm font-medium transition-colors">Yes, Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F6F2] flex items-center justify-center">
      <div className="text-center">
        <div className="mb-8">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Satmi" className="h-14 w-auto object-contain" />
          </div>
          <p className="text-[#96572A] text-sm tracking-wide">Loading your orders...</p>
        </div>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#96572A] mx-auto"></div>
      </div>
    </div>
  );
}
