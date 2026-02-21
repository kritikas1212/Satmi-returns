'use client';

import { useState, useEffect } from "react";
import { auth, storage, db } from "../lib/firebaseConfig"; // Added db
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc, serverTimestamp } from "firebase/firestore"; // Firestore Imports

export default function ReturnPortal() {
  // --- STATE ---
  const [phoneNumber, setPhoneNumber] = useState("+91");
  const [otp, setOtp] = useState("");
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [user, setUser] = useState(null);
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // BULK SELECTION STATE
  const [selectedItems, setSelectedItems] = useState([]); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // FORM STATE
  const [commonReason, setCommonReason] = useState("Size issue");
  const [comments, setComments] = useState(""); 
  const [userEmail, setUserEmail] = useState(""); 
  const [videoFile, setVideoFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // --- AUTHENTICATION ---
  // Single RecaptchaVerifier instance; creating a new one in the same container causes "already rendered" error.
  const getRecaptchaVerifier = () => {
    if (typeof window === "undefined") return null;
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        "recaptcha-container",
        { size: "invisible", callback: () => {} }
      );
    }
    return window.recaptchaVerifier;
  };

  const sendOtp = async () => {
    setError("");
    try {
      const verifier = getRecaptchaVerifier();
      if (!verifier) throw new Error("reCAPTCHA not ready");
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
      setConfirmationResult(confirmation);
      alert("OTP Sent!");
    } catch (err) {
      console.error(err);
      const code = err?.code;
      if (code === "auth/invalid-app-credential") {
        setError("Phone sign-in is misconfigured. Add this domain in Firebase Console → Authentication → Authorized domains.");
      } else {
        setError(err?.message || "Failed to send OTP. Try reloading.");
      }
    }
  };

  const verifyOtp = async () => {
    if (!confirmationResult) {
      setError("Session expired. Please request a new OTP.");
      return;
    }
    setError("");
    try {
      const res = await confirmationResult.confirm(otp);
      setUser(res.user);
      const token = await res.user.getIdToken();
      fetchOrders(phoneNumber, token);
    } catch (err) {
      console.error(err);
      setError(err?.code === "auth/invalid-verification-code" ? "Invalid OTP. Try again." : "Invalid OTP.");
    }
  };

  // --- ORDER FETCHING ---
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
        // Capture Courier info for automation
        originalCourier: order.fulfillments?.[0]?.tracking_company || "Unknown",
        customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
        title: item.name,
        price: item.price,
      }]);
    }
  };

  const handleSelectOrder = (order) => {
    const returnableItems = order.line_items.filter(() => {
        const status = order.delivery_status || {};
        return status.is_returnable;
    });
    if (returnableItems.length === 0) return;

    const allSelected = returnableItems.every(item => 
      selectedItems.some(sel => sel.uniqueId === `${order.name}-${item.id}`)
    );

    if (allSelected) {
      const idsToRemove = returnableItems.map(item => `${order.name}-${item.id}`);
      setSelectedItems(selectedItems.filter(i => !idsToRemove.includes(i.uniqueId)));
    } else {
      const newItems = [];
      returnableItems.forEach(item => {
        const uniqueId = `${order.name}-${item.id}`;
        if (!selectedItems.some(sel => sel.uniqueId === uniqueId)) {
          newItems.push({
            uniqueId: uniqueId,
            orderId: order.name,
            originalCourier: order.fulfillments?.[0]?.tracking_company || "Unknown",
            customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
            title: item.name,
            price: item.price,
          });
        }
      });
      setSelectedItems([...selectedItems, ...newItems]);
    }
  };

  // --- NUCLEAR SUBMIT (SAVES TO FIRESTORE) ---
  const handleBulkSubmit = async () => {
    if (!videoFile) { alert("Please upload a video showing all items."); return; }
    if (!userEmail) { alert("Please enter your email address."); return; }

    setUploading(true);
    try {
      // 1. Upload Video
      const storageRef = ref(storage, `returns/${user.uid}/${Date.now()}_bulk_return`);
      await uploadBytes(storageRef, videoFile);
      const videoUrl = await getDownloadURL(storageRef);

      // 2. Prepare Data for Firestore
      const returnData = {
        status: "Pending", // Used in Admin Dashboard
        createdAt: serverTimestamp(),
        userId: user.uid,
        customerName: selectedItems[0].customerName,
        email: userEmail,
        phone: phoneNumber,
        orderId: selectedItems[0].orderId,
        // Save courier info for automation
        originalCourier: selectedItems[0].originalCourier || "Unknown",
        items: selectedItems,
        reason: commonReason,
        comments: comments,
        videoUrl: videoUrl,
        pincode: "201318" // Hardcoded for warehouse logic
      };

      // 3. Save to Firestore (The Reliable Step)
      await addDoc(collection(db, "returns"), returnData);

      alert("Return Request Submitted Successfully! We will review and email you shortly.");
      
      // Reset Form
      setSelectedItems([]);
      setIsModalOpen(false);
      setVideoFile(null);
      setComments("");
      setUserEmail("");

    } catch (err) {
      console.error(err);
      alert("Error: " + err.message);
    } finally {
      setUploading(false);
    }
  };

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
            <p className="text-gray-500 text-xs md:text-sm uppercase tracking-wide">Enter phone number to login</p>
          </div>
          <div id="recaptcha-container"></div>
          {!confirmationResult ? (
            <div className="space-y-6">
              <input type="text" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="w-full border border-gray-300 px-4 py-4 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] transition-colors text-base" placeholder="+919999999999" style={{ color: 'black' }} />
              <button onClick={sendOtp} className="w-full bg-[#7A1E1E] text-white py-4 rounded font-bold tracking-wider hover:bg-[#5e1717] transition-colors shadow-sm text-sm uppercase">Send OTP</button>
            </div>
          ) : (
            <div className="space-y-6">
              <input type="text" value={otp} onChange={(e) => setOtp(e.target.value)} className="w-full border border-gray-300 px-4 py-4 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] text-center tracking-widest text-xl" placeholder="• • • • • •" style={{ color: 'black' }} />
              <button onClick={verifyOtp} className="w-full bg-[#7A1E1E] text-white py-4 rounded font-bold tracking-wider hover:bg-[#5e1717] transition-colors shadow-sm text-sm uppercase">Verify & Login</button>
            </div>
          )}
          {error && <div className="mt-6 text-red-600 text-xs text-center bg-red-50 p-2 rounded">{error}</div>}
        </div>
      </div>
    );
  }

  // --- RENDER: MAIN DASHBOARD ---
  return (
    <div className="min-h-screen bg-[#F9F6F2] p-4 md:p-8 pb-24 relative overflow-x-hidden">
      {/* MANDALAS RESTORED */}
      <img src="/mandala.png" alt="" className="absolute top-0 left-0 opacity-80 pointer-events-none z-0 w-[35vw] md:w-[21vw]" style={{ transform: 'translate(-20%, -20%) rotate(-15deg)' }} />
      <img src="/mandala.png" alt="" className="absolute bottom-0 right-0 opacity-80 pointer-events-none z-0 w-[35vw] md:w-[21vw]" style={{ transform: 'translate(20%, 20%) rotate(165deg)' }} />
       
      <div className="max-w-4xl mx-auto relative z-10">
        <div className="flex justify-between items-end mb-6 border-b border-[#e5e0d8] pb-3">
          <h1 className="font-serif text-2xl font-normal text-[#3a3a3a] tracking-wide uppercase">Your Orders</h1>
          <button onClick={() => window.location.reload()} className="text-xs font-bold text-[#7A1E1E] hover:underline uppercase tracking-wide">Logout</button>
        </div>

        {loading && <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#7A1E1E]"></div></div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">{error}</div>}
        
        <div className="space-y-4">
          {orders.map((order) => {
            const status = order.delivery_status || { is_returnable: false, message: "Status Unknown" };
            const isEligible = status.is_returnable;
            const allItemsSelected = order.line_items.length > 0 && order.line_items.every(item => selectedItems.some(sel => sel.uniqueId === `${order.name}-${item.id}`));

            return (
              <div key={order.id} className={`bg-white rounded shadow-sm border ${isEligible ? 'border-gray-100' : 'border-red-50 bg-red-50/20'}`}>
                <div className={`px-4 py-3 border-b flex justify-between items-center ${isEligible ? 'bg-gray-50/40' : 'bg-red-50/40'}`}>
                  <div className="flex items-center gap-3">
                    {isEligible && <input type="checkbox" checked={allItemsSelected} onChange={() => handleSelectOrder(order)} className="w-5 h-5 rounded border-gray-300 text-[#7A1E1E] focus:ring-[#7A1E1E] accent-[#7A1E1E] cursor-pointer" />}
                    <div>
                        <h3 className="font-bold text-base text-gray-800 font-serif tracking-wide">{order.name}</h3>
                        <p className={`text-[10px] font-bold mt-0.5 uppercase tracking-wider ${isEligible ? "text-green-700" : "text-red-700"}`}>{status.message}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-900 font-medium">{new Date(order.created_at).toLocaleDateString()}</p>
                    {status.delivered_date && <p className="text-[10px] text-gray-500">Delivered: {new Date(status.delivered_date).toLocaleDateString()}</p>}
                  </div>
                </div>
                <div className="divide-y divide-gray-100">
                  {order.line_items.map((item) => {
                    const uniqueId = `${order.name}-${item.id}`;
                    const isSelected = selectedItems.find(i => i.uniqueId === uniqueId);
                    return (
                      <div key={item.id} className="p-4 flex flex-col md:flex-row justify-between items-center hover:bg-[#faf9f6] transition-colors">
                        <div className="flex-1 mb-2 md:mb-0 w-full">
                          <p className="font-medium text-gray-900 text-sm md:text-base">{item.name}</p>
                          <p className="text-xs text-gray-500 mt-1">Qty: {item.quantity}</p>
                        </div>
                        <div className="w-full md:w-auto flex justify-end">
                        {isEligible ? (
                          <label className="flex items-center space-x-2 cursor-pointer select-none bg-gray-50 px-3 py-1.5 rounded border border-gray-200 hover:border-[#7A1E1E] transition-colors">
                            <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">Return</span>
                            <input type="checkbox" checked={!!isSelected} onChange={() => handleCheckboxChange(order, item)} className="w-4 h-4 rounded border-gray-300 text-[#7A1E1E] focus:ring-[#7A1E1E] accent-[#7A1E1E]" />
                          </label>
                        ) : (<span className="px-2 py-1 bg-gray-100 text-gray-400 text-[10px] font-bold rounded uppercase tracking-wider">Not Eligible</span>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedItems.length > 0 && (
        <div className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 p-3 md:p-4 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] flex justify-between items-center px-4 md:px-12 z-40">
          <div><p className="font-serif font-bold text-lg text-[#7A1E1E]">{selectedItems.length} Items</p><p className="text-[10px] text-gray-500 uppercase tracking-wider hidden md:block">Ready to process</p></div>
          <button onClick={() => setIsModalOpen(true)} className="bg-[#7A1E1E] text-white px-6 py-2.5 rounded font-bold hover:bg-[#5e1717] transition-all shadow-lg uppercase tracking-wider text-xs md:text-sm">Proceed</button>
        </div>
      )}

      {/* --- BULK RETURN MODAL (EMAIL INPUT INCLUDED) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#3a3a3a]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity">
          <div className="bg-white rounded shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto flex flex-col border border-gray-100">
            <div className="p-5 border-b border-gray-100 bg-[#F9F6F2]">
              <h2 className="text-lg font-serif font-bold text-[#3a3a3a] uppercase tracking-wide">Confirm Return</h2>
              <p className="text-xs text-gray-500 mt-1">Returning {selectedItems.length} items</p>
            </div>
            <div className="p-5 space-y-4">
              
              {/* EMAIL INPUT */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">Email Address <span className="text-red-500">*</span></label>
                <input 
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  className="w-full border border-gray-300 px-3 py-2.5 rounded text-gray-900 placeholder-gray-400 focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] outline-none text-sm"
                  placeholder="yourname@example.com"
                  style={{ color: 'black' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">Reason</label>
                <div className="relative"><select className="w-full border border-gray-300 px-3 py-2.5 rounded text-gray-900 bg-white focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] outline-none text-sm" value={commonReason} onChange={(e) => setCommonReason(e.target.value)} style={{ color: 'black' }}><option>Size issue</option><option>Defective product</option><option>Wrong item received</option><option>Other</option></select></div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">Comments</label>
                <textarea className="w-full border border-gray-300 px-3 py-2.5 rounded text-gray-900 placeholder-gray-400 focus:ring-1 focus:ring-[#7A1E1E] focus:border-[#7A1E1E] outline-none min-h-[60px] text-sm" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Details regarding all items..." style={{ color: 'black' }} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">Unboxing Video <span className="text-red-500 normal-case">(Required)</span></label>
                <div className="border-2 border-dashed border-gray-300 rounded p-4 text-center hover:bg-gray-50 transition-colors cursor-pointer">
                  <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files[0])} className="block w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-[#7A1E1E]/10 file:text-[#7A1E1E] hover:file:bg-[#7A1E1E]/20 cursor-pointer" />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 bg-[#F9F6F2] rounded-b flex gap-3">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded hover:bg-gray-50 uppercase tracking-wide text-xs" disabled={uploading}>Cancel</button>
              <button onClick={handleBulkSubmit} disabled={uploading} className="flex-1 px-4 py-2.5 bg-[#7A1E1E] text-white font-bold rounded hover:bg-[#5e1717] disabled:bg-gray-400 flex justify-center items-center uppercase tracking-wide text-xs">{uploading ? "Uploading..." : "Submit"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}