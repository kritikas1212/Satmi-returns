'use client';

import { useState, useEffect } from "react";
import { auth, storage } from "../lib/firebaseConfig"; 
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

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
  const [videoFile, setVideoFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // --- AUTHENTICATION ---
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          'size': 'invisible', 'callback': () => {}
        });
      } catch (e) { console.error(e); }
    }
  }, []);

  const sendOtp = async () => {
    setError("");
    try {
      const verify = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, verify);
      setConfirmationResult(confirmation);
      alert("OTP Sent!");
    } catch (err) {
      console.error(err);
      setError("Failed to send OTP. Try reloading.");
    }
  };

  const verifyOtp = async () => {
    try {
      const res = await confirmationResult.confirm(otp);
      setUser(res.user);
      fetchOrders(phoneNumber); 
    } catch (err) {
      setError("Invalid OTP");
    }
  };

  // --- ORDER FETCHING ---
  const fetchOrders = async (phone) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // --- CHECKBOX HANDLER ---
  const handleCheckboxChange = (order, item) => {
    const uniqueId = `${order.name}-${item.id}`;
    const exists = selectedItems.find(i => i.uniqueId === uniqueId);

    if (exists) {
      // Remove if already checked
      setSelectedItems(selectedItems.filter(i => i.uniqueId !== uniqueId));
    } else {
      // Add to selection
      setSelectedItems([...selectedItems, {
        uniqueId: uniqueId,
        orderId: order.name,
        customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
        email: order.contact_email || order.email || "support@satmi.in",
        title: item.name,
        price: item.price,
        // We set the reason later in the modal
      }]);
    }
  };

  // --- BULK SUBMIT HANDLER ---
  const handleBulkSubmit = async () => {
    if (!videoFile) {
      alert("Please upload a video showing all items.");
      return;
    }

    setUploading(true);
    try {
      // 1. Upload Video (One video for all items)
      const storageRef = ref(storage, `returns/${user.uid}/${Date.now()}_bulk_return`);
      await uploadBytes(storageRef, videoFile);
      const videoUrl = await getDownloadURL(storageRef);

      // 2. Prepare items with the selected reason
      const finalItems = selectedItems.map(i => ({ 
        ...i, 
        reason: commonReason 
      }));

      // 3. Submit to API
      const res = await fetch('/api/submit-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnItems: finalItems, // Sending ARRAY
          customerName: finalItems[0].customerName, 
          email: finalItems[0].email,
          phone: phoneNumber,
          comments: comments,
          videoUrl: videoUrl
        }),
      });

      if (!res.ok) throw new Error("Submission Failed");

      alert("Bulk Return Submitted Successfully!");
      setSelectedItems([]);
      setIsModalOpen(false);
      setVideoFile(null);
      setComments("");

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-200">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Satmi Returns</h1>
            <p className="text-gray-500 mt-2 text-sm">Enter your phone number to find your order</p>
          </div>
          
          <div id="recaptcha-container"></div>
          
          {!confirmationResult ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
                <input 
                  type="text" 
                  value={phoneNumber} 
                  onChange={(e) => setPhoneNumber(e.target.value)} 
                  className="w-full border border-gray-300 px-4 py-3 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                  placeholder="+919999999999"
                />
              </div>
              <button 
                onClick={sendOtp} 
                className="w-full bg-black text-white py-3 rounded-lg font-bold hover:bg-gray-800 transition-colors shadow-md"
              >
                Send OTP
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">One-Time Password</label>
                <input 
                  type="text" 
                  value={otp} 
                  onChange={(e) => setOtp(e.target.value)} 
                  className="w-full border border-gray-300 px-4 py-3 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all text-center tracking-widest text-lg"
                  placeholder="• • • • • •"
                />
              </div>
              <button 
                onClick={verifyOtp} 
                className="w-full bg-black text-white py-3 rounded-lg font-bold hover:bg-gray-800 transition-colors shadow-md"
              >
                Verify & Login
              </button>
            </div>
          )}
          {error && (
            <div className="mt-6 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm text-center">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- RENDER: MAIN DASHBOARD ---
  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-12 pb-32">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-end mb-10 border-b border-gray-200 pb-4">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900">Your Orders</h1>
            <p className="text-gray-500 mt-1">Select items to return.</p>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="text-sm font-medium text-gray-600 hover:text-black hover:underline"
          >
            Logout
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        )}
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}
        
        {/* ORDERS LIST */}
        <div className="space-y-8">
          {orders.map((order) => {
            // Get Status from Backend (Real Shiprocket Data)
            const status = order.delivery_status || { is_returnable: false, message: "Status Unknown" };
            const isEligible = status.is_returnable;

            return (
              <div key={order.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${isEligible ? 'border-gray-200' : 'border-red-100'}`}>
                
                {/* Header */}
                <div className={`px-6 py-4 border-b flex justify-between items-center ${isEligible ? 'bg-gray-50' : 'bg-red-50'}`}>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{order.name}</h3>
                    <p className={`text-xs font-bold mt-1 ${isEligible ? "text-green-600" : "text-red-500"}`}>
                      {status.message} 
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-900 font-medium">{new Date(order.created_at).toLocaleDateString()}</p>
                    {status.delivered_date && (
                       <p className="text-xs text-gray-500">Delivered: {new Date(status.delivered_date).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>
                
                {/* Items */}
                <div className="divide-y divide-gray-100">
                  {order.line_items.map((item) => {
                    const uniqueId = `${order.name}-${item.id}`;
                    const isSelected = selectedItems.find(i => i.uniqueId === uniqueId);
                    
                    return (
                      <div key={item.id} className="p-6 flex flex-col md:flex-row justify-between items-center hover:bg-gray-50 transition-colors">
                        <div className="flex-1 mb-2 md:mb-0">
                          <p className="font-semibold text-gray-900 text-lg">{item.name}</p>
                          <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                        </div>
                        
                        {/* CHECKBOX LOGIC */}
                        {isEligible ? (
                          <label className="flex items-center space-x-3 cursor-pointer">
                            <span className="text-sm font-medium text-gray-700">Select Return</span>
                            <input 
                              type="checkbox"
                              checked={!!isSelected}
                              onChange={() => handleCheckboxChange(order, item)}
                              className="w-6 h-6 rounded border-gray-300 text-black focus:ring-black"
                            />
                          </label>
                        ) : (
                          <span className="px-3 py-1 bg-gray-100 text-gray-400 text-xs font-bold rounded-full uppercase tracking-wider">
                            Not Returnable
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FLOATING ACTION BAR (Only shows when items are selected) */}
      {selectedItems.length > 0 && (
        <div className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 p-4 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] flex justify-between items-center px-6 md:px-12 z-40 slide-up-animation">
          <div>
            <p className="font-bold text-lg text-gray-900">{selectedItems.length} Items Selected</p>
            <p className="text-sm text-gray-500">Ready to verify</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-black text-white px-8 py-3 rounded-lg font-bold hover:bg-gray-800 transition-all shadow-lg"
          >
            Proceed to Return
          </button>
        </div>
      )}

      {/* BULK RETURN MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Confirm Return</h2>
              <p className="text-sm text-gray-500 mt-1">You are returning {selectedItems.length} items</p>
            </div>
            
            <div className="p-6 space-y-5">
              {/* Selected Items List */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 max-h-32 overflow-y-auto">
                {selectedItems.map(i => (
                  <div key={i.uniqueId} className="text-sm font-medium text-gray-800 py-1 border-b border-gray-100 last:border-0">
                    • {i.title} <span className="text-gray-400 text-xs">({i.orderId})</span>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Reason for Return</label>
                <div className="relative">
                  <select 
                    className="w-full appearance-none border border-gray-300 px-4 py-3 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none bg-white"
                    value={commonReason}
                    onChange={(e) => setCommonReason(e.target.value)}
                  >
                    <option>Size issue</option>
                    <option>Defective product</option>
                    <option>Wrong item received</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Comments</label>
                <textarea 
                  className="w-full border border-gray-300 px-4 py-3 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none min-h-[80px]"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Details regarding all items..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Single Unboxing Video <span className="text-red-500 text-xs font-normal ml-1">(Required for all items)</span>
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-gray-50 transition-colors">
                  <input 
                    type="file" 
                    accept="video/*"
                    onChange={(e) => setVideoFile(e.target.files[0])}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50"
                disabled={uploading}
              >
                Cancel
              </button>
              <button 
                onClick={handleBulkSubmit}
                disabled={uploading}
                className="flex-1 px-4 py-3 bg-black text-white font-bold rounded-lg hover:bg-gray-800 disabled:bg-gray-400 flex justify-center items-center"
              >
                {uploading ? "Uploading..." : "Submit All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}