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
      setSelectedItems(selectedItems.filter(i => i.uniqueId !== uniqueId));
    } else {
      setSelectedItems([...selectedItems, {
        uniqueId: uniqueId,
        orderId: order.name,
        customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
        email: order.contact_email || order.email || "support@satmi.in",
        title: item.name,
        price: item.price,
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
      const storageRef = ref(storage, `returns/${user.uid}/${Date.now()}_bulk_return`);
      await uploadBytes(storageRef, videoFile);
      const videoUrl = await getDownloadURL(storageRef);

      const finalItems = selectedItems.map(i => ({ ...i, reason: commonReason }));

      const res = await fetch('/api/submit-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnItems: finalItems,
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

  // --- RENDER: LOGIN SCREEN (MATCHING SCREENSHOT) ---
  if (!user) {
    return (
      <div className="min-h-screen bg-[#FFFCF5] flex items-center justify-center relative overflow-hidden p-4">
        {/* MANDALA DECORATIONS */}
        {/* Make sure 'mandala.png' is in your /public folder */}
        <img src="/mandala.png" alt="" className="absolute -top-10 -left-10 w-48 md:w-80 opacity-80 pointer-events-none" />
        <img src="/mandala.png" alt="" className="absolute -bottom-10 -right-10 w-48 md:w-80 opacity-80 pointer-events-none rotate-180" />

        <div className="bg-white p-8 md:p-12 rounded-lg shadow-[0_8px_30px_rgb(0,0,0,0.04)] w-full max-w-lg z-10 border border-gray-50">
          <div className="text-center mb-10">
            <h1 className="font-serif text-3xl md:text-4xl text-[#4a4a4a] tracking-widest uppercase mb-4">
              Track Your Journey
            </h1>
            <p className="text-gray-500 text-sm">Enter your phone number to access your orders.</p>
          </div>
          
          <div id="recaptcha-container"></div>
          
          {!confirmationResult ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                <input 
                  type="text" 
                  value={phoneNumber} 
                  onChange={(e) => setPhoneNumber(e.target.value)} 
                  className="w-full border border-gray-200 px-4 py-3 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#722828] focus:border-[#722828] transition-colors"
                  placeholder="+919999999999"
                  style={{ color: 'black' }} // Force black text
                />
              </div>
              <button 
                onClick={sendOtp} 
                className="w-full bg-[#722828] text-white py-3.5 rounded font-bold tracking-wider hover:bg-[#5a1e1e] transition-colors shadow-sm text-sm uppercase"
              >
                Send OTP
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">One-Time Password</label>
                <input 
                  type="text" 
                  value={otp} 
                  onChange={(e) => setOtp(e.target.value)} 
                  className="w-full border border-gray-200 px-4 py-3 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#722828] focus:border-[#722828] text-center tracking-widest text-lg"
                  placeholder="• • • • • •"
                  style={{ color: 'black' }} 
                />
              </div>
              <button 
                onClick={verifyOtp} 
                className="w-full bg-[#722828] text-white py-3.5 rounded font-bold tracking-wider hover:bg-[#5a1e1e] transition-colors shadow-sm text-sm uppercase"
              >
                Verify & Login
              </button>
            </div>
          )}
          {error && (
            <div className="mt-6 text-red-600 text-sm text-center bg-red-50 p-2 rounded">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- RENDER: MAIN DASHBOARD ---
  return (
    <div className="min-h-screen bg-[#FFFCF5] p-6 md:p-12 pb-32 relative">
       {/* Background Mandalas for Dashboard too */}
       <img src="/mandala.png" alt="" className="absolute top-0 left-0 w-40 opacity-40 pointer-events-none fixed" />
       
      <div className="max-w-4xl mx-auto relative z-10">
        <div className="flex justify-between items-end mb-10 border-b border-[#e5e0d8] pb-4">
          <div>
            <h1 className="font-serif text-3xl font-normal text-[#3a3a3a] tracking-wide uppercase">Your Orders</h1>
            <p className="text-gray-500 mt-1 text-sm">Select items you wish to return.</p>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="text-sm font-medium text-[#722828] hover:underline uppercase tracking-wide"
          >
            Logout
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#722828]"></div>
          </div>
        )}
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}
        
        {/* ORDERS LIST */}
        <div className="space-y-6">
          {orders.map((order) => {
            const status = order.delivery_status || { is_returnable: false, message: "Status Unknown" };
            const isEligible = status.is_returnable;

            return (
              <div key={order.id} className={`bg-white rounded shadow-sm border ${isEligible ? 'border-gray-100' : 'border-red-50 bg-red-50/10'}`}>
                
                {/* Header */}
                <div className={`px-6 py-4 border-b flex justify-between items-center ${isEligible ? 'bg-gray-50/50' : 'bg-red-50/30'}`}>
                  <div>
                    <h3 className="font-bold text-lg text-gray-800 font-serif tracking-wide">{order.name}</h3>
                    <p className={`text-xs font-bold mt-1 uppercase tracking-wider ${isEligible ? "text-green-700" : "text-red-700"}`}>
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
                      <div key={item.id} className="p-6 flex flex-col md:flex-row justify-between items-center hover:bg-[#faf9f6] transition-colors">
                        <div className="flex-1 mb-2 md:mb-0">
                          <p className="font-medium text-gray-900 text-lg">{item.name}</p>
                          <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                        </div>
                        
                        {/* CHECKBOX LOGIC */}
                        {isEligible ? (
                          <label className="flex items-center space-x-3 cursor-pointer select-none">
                            <span className="text-sm font-medium text-gray-600 uppercase tracking-wide">Return</span>
                            <input 
                              type="checkbox"
                              checked={!!isSelected}
                              onChange={() => handleCheckboxChange(order, item)}
                              className="w-5 h-5 rounded border-gray-300 text-[#722828] focus:ring-[#722828] accent-[#722828]"
                            />
                          </label>
                        ) : (
                          <span className="px-3 py-1 bg-gray-100 text-gray-400 text-xs font-bold rounded uppercase tracking-wider">
                            Not Eligible
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

      {/* FLOATING ACTION BAR */}
      {selectedItems.length > 0 && (
        <div className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 p-4 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] flex justify-between items-center px-6 md:px-12 z-40">
          <div>
            <p className="font-serif font-bold text-xl text-[#722828]">{selectedItems.length} Items Selected</p>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Ready to process</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-[#722828] text-white px-8 py-3 rounded font-bold hover:bg-[#5a1e1e] transition-all shadow-lg uppercase tracking-wider text-sm"
          >
            Proceed
          </button>
        </div>
      )}

      {/* BULK RETURN MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#3a3a3a]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity">
          <div className="bg-white rounded shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col border border-gray-100">
            
            <div className="p-6 border-b border-gray-100 bg-[#FFFCF5]">
              <h2 className="text-xl font-serif font-bold text-[#3a3a3a] uppercase tracking-wide">Confirm Return</h2>
              <p className="text-sm text-gray-500 mt-1">You are returning {selectedItems.length} items</p>
            </div>
            
            <div className="p-6 space-y-5">
              {/* Selected Items List */}
              <div className="bg-gray-50 p-4 rounded border border-gray-200 max-h-32 overflow-y-auto">
                {selectedItems.map(i => (
                  <div key={i.uniqueId} className="text-sm font-medium text-gray-800 py-1 border-b border-gray-100 last:border-0">
                    • {i.title} <span className="text-gray-400 text-xs">({i.orderId})</span>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">Reason</label>
                <div className="relative">
                  <select 
                    className="w-full border border-gray-300 px-4 py-3 rounded text-gray-900 bg-white focus:ring-1 focus:ring-[#722828] focus:border-[#722828] outline-none appearance-none"
                    value={commonReason}
                    onChange={(e) => setCommonReason(e.target.value)}
                    style={{ color: 'black' }}
                  >
                    <option>Size issue</option>
                    <option>Defective product</option>
                    <option>Wrong item received</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">Comments</label>
                <textarea 
                  className="w-full border border-gray-300 px-4 py-3 rounded text-gray-900 placeholder-gray-400 focus:ring-1 focus:ring-[#722828] focus:border-[#722828] outline-none min-h-[80px]"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Details regarding all items..."
                  style={{ color: 'black' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">
                  Unboxing Video <span className="text-red-500 text-xs normal-case ml-1">(Required)</span>
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded p-6 text-center hover:bg-gray-50 transition-colors cursor-pointer group">
                  <input 
                    type="file" 
                    accept="video/*"
                    onChange={(e) => setVideoFile(e.target.files[0])}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-[#722828]/10 file:text-[#722828] hover:file:bg-[#722828]/20 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-[#FFFCF5] rounded-b flex gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded hover:bg-gray-50 uppercase tracking-wide text-sm"
                disabled={uploading}
              >
                Cancel
              </button>
              <button 
                onClick={handleBulkSubmit}
                disabled={uploading}
                className="flex-1 px-4 py-3 bg-[#722828] text-white font-bold rounded hover:bg-[#5a1e1e] disabled:bg-gray-400 flex justify-center items-center uppercase tracking-wide text-sm"
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