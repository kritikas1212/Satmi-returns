'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "@/lib/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
} from "firebase/firestore";
import { isAdminEmail } from "@/lib/adminConfig";

const STATUS_FILTERS = ["All", "Pending", "Approved", "Rejected"];

export default function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [returns, setReturns] = useState([]);
  const [processingId, setProcessingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [rejectModal, setRejectModal] = useState({ open: false, request: null, reason: "" });
  const [approveModal, setApproveModal] = useState({ open: false, request: null });
  const [labelLoadingId, setLabelLoadingId] = useState(null);
  const [warehouseModal, setWarehouseModal] = useState({ open: false, request: null, address: null });
  const [selectedReturns, setSelectedReturns] = useState(new Set());
  const [viewMode, setViewMode] = useState("cards"); // cards or table

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser && isAdminEmail(currentUser.email)) {
        setUser(currentUser);
      } else {
        setUser(null);
        if (!currentUser) router.replace("/admin/login");
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "returns"),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setReturns(data);
    });
    return () => unsubscribe();
  }, [user]);

  const filteredReturns = returns
    .filter((r) => {
      // Status filter
      if (statusFilter !== "All" && (r.status || "Pending") !== statusFilter) return false;
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          r.orderId?.toLowerCase().includes(query) ||
          r.customerName?.toLowerCase().includes(query) ||
          r.email?.toLowerCase().includes(query) ||
          r.phone?.includes(query)
        );
      }
      
      // Date filter
      if (dateFilter !== "all" && r.createdAt) {
        const returnDate = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        const now = new Date();
        const daysDiff = Math.floor((now - returnDate) / (1000 * 60 * 60 * 24));
        
        switch (dateFilter) {
          case "7days":
            return daysDiff <= 7;
          case "30days":
            return daysDiff <= 30;
          case "90days":
            return daysDiff <= 90;
          default:
            return true;
        }
      }
      
      return true;
    })
    .sort((a, b) => {
      // Sort by creation date (newest first)
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return dateB - dateA;
    });

  const stats = {
    pending: returns.filter((r) => (r.status || "Pending") === "Pending").length,
    approved: returns.filter((r) => r.status === "Approved").length,
    rejected: returns.filter((r) => r.status === "Rejected").length,
    totalRefunds: returns.reduce((sum, r) => sum + (parseFloat(r.shopifyOrderData?.refundAmount) || 0), 0),
    avgRefundAmount: returns.length > 0 
      ? returns.reduce((sum, r) => sum + (parseFloat(r.shopifyOrderData?.refundAmount) || 0), 0) / returns.length 
      : 0,
    thisMonth: returns.filter(r => {
      const date = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt || 0);
      const now = new Date();
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length
  };

  // Analytics data
  const returnReasons = returns.reduce((acc, r) => {
    const reason = r.reason || 'Other';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  const topReturnReasons = Object.entries(returnReasons)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const monthlyReturns = returns.reduce((acc, r) => {
    const date = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt || 0);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    acc[monthKey] = (acc[monthKey] || 0) + 1;
    return acc;
  }, {});

  const handleApprove = async (request) => {
    if (processingId) return;
    setProcessingId(request.id);
    try {
      const res = await fetch("/api/returns/approve-and-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnId: request.id,
          orderId: request.orderId,
          customerName: request.customerName,
          email: request.email,
          phone: request.phone,
          originalCourier: request.originalCourier,
          approvedBy: user?.email || null,
        }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(res.ok ? "Invalid response" : `Request failed (${res.status}). Check console.`);
      }
      if (!data.success) {
        throw new Error(data.error || "Approve failed");
      }

      setApproveModal({ open: false, request: null });
      if (data.labelUrl) window.open(data.labelUrl, "_blank");
      alert(`Return created. Label ${data.labelUrl ? "opened and " : ""}${data.emailSent ? "approval email sent" : "approval email queued/failed"} for ${request.email}.`);
    } catch (error) {
      console.error("Approve error:", error);
      alert("Error: " + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (request, reason) => {
    if (processingId) return;
    setProcessingId(request.id);
    try {
      const returnRef = doc(db, "returns", request.id);
      await updateDoc(returnRef, {
        status: "Rejected",
        workflowStatus: "RETURN_REJECTED",
        rejectedAt: new Date(),
        rejectedBy: user.email,
        rejectionReason: reason?.trim() || null,
      });
      setRejectModal({ open: false, request: null, reason: "" });
    } catch (error) {
      console.error("Reject error:", error);
      alert("Error: " + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleGenerateLabel = async (request) => {
    const sid = request.shiprocketShipmentId;
    if (!sid) {
      alert("No shipment ID. Approve the return first.");
      return;
    }
    setLabelLoadingId(request.id);
    try {
      const res = await fetch("/api/shiprocket/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: sid }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Label generation failed");
      const labelUrl = data.labelUrl;
      if (labelUrl) {
        const returnRef = doc(db, "returns", request.id);
        await updateDoc(returnRef, { labelUrl });
        window.open(labelUrl, "_blank");
      } else {
        console.warn("Shiprocket label response without URL:", data.raw || data);
        alert("Label generated but URL was not clearly provided. Please check Shiprocket panel for the label.");
      }
    } catch (error) {
      console.error("Label error:", error);
      alert("Error: " + error.message);
    } finally {
      setLabelLoadingId(null);
    }
  };

  const handleUpdateWarehouseAddress = async (request, newAddress) => {
    if (processingId) return;
    setProcessingId(request.id);
    try {
      const returnRef = doc(db, "returns", request.id);
      await updateDoc(returnRef, {
        warehouseAddress: newAddress,
        updatedAt: new Date(),
        updatedBy: user.email
      });
      setWarehouseModal({ open: false, request: null, address: null });
      alert("Warehouse address updated successfully!");
    } catch (error) {
      console.error("Warehouse update error:", error);
      alert("Error: " + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedReturns.size === 0) {
      alert("Please select returns to approve");
      return;
    }
    
    if (!confirm(`Approve ${selectedReturns.size} return requests?`)) return;
    
    setProcessingId('bulk');
    try {
      const promises = Array.from(selectedReturns).map(async (returnId) => {
        const returnData = returns.find(r => r.id === returnId);
        if (!returnData) return;
        
        const res = await fetch("/api/returns/approve-and-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            returnId: returnData.id,
            orderId: returnData.orderId,
            customerName: returnData.customerName,
            email: returnData.email,
            phone: returnData.phone,
            originalCourier: returnData.originalCourier,
            approvedBy: user?.email || null,
          }),
        });
        
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Approval failed for return ${returnId}`);
        }
      });
      
      await Promise.all(promises);
      setSelectedReturns(new Set());
      alert(`Successfully approved ${selectedReturns.size} returns!`);
    } catch (error) {
      console.error("Bulk approve error:", error);
      alert("Error: " + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleBulkReject = async () => {
    if (selectedReturns.size === 0) {
      alert("Please select returns to reject");
      return;
    }
    
    const reason = prompt("Rejection reason for all selected returns:");
    if (!reason) return;
    
    setProcessingId('bulk');
    try {
      const promises = Array.from(selectedReturns).map(async (returnId) => {
        const returnRef = doc(db, "returns", returnId);
        await updateDoc(returnRef, {
          status: "Rejected",
          workflowStatus: "RETURN_REJECTED",
          rejectionReason: reason,
          rejectedAt: new Date(),
          rejectedBy: user.email,
        });
      });
      
      await Promise.all(promises);
      setSelectedReturns(new Set());
      alert(`Successfully rejected ${selectedReturns.size} returns!`);
    } catch (error) {
      console.error("Bulk reject error:", error);
      alert("Error: " + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleExport = async () => {
    try {
      const csvContent = [
        ["Order ID", "Customer Name", "Email", "Phone", "Status", "Reason", "Refund Amount", "Created Date"],
        ...filteredReturns.map(r => [
          r.orderId || "",
          r.customerName || "",
          r.email || "",
          r.phone || "",
          r.status || "Pending",
          r.reason || "",
          r.shopifyOrderData?.refundAmount || "0",
          r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString() : ""
        ])
      ].map(row => row.join(",")).join("\n");
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `returns-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
      alert("Error exporting data");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.replace("/admin/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <div className="text-center">
          <img src="/logo.png" alt="Satmi" className="h-10 w-auto object-contain mx-auto mb-4" />
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#96572A] border-t-transparent mx-auto" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Satmi" className="h-8 w-auto object-contain" />
                <h1 className="text-sm font-semibold text-gray-800 tracking-wide">Returns Dashboard</h1>
              </div>
              <div className="flex items-center bg-gray-50 rounded-full p-0.5 border border-gray-100">
                <button
                  onClick={() => setViewMode("cards")}
                  className={`p-2 rounded-full transition-all ${
                    viewMode === "cards"
                      ? "bg-white text-[#96572A] shadow-sm"
                      : "text-black hover:text-gray-600"
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
                      : "text-black hover:text-gray-600"
                  }`}
                  title="Table View"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" d="M3 6h18M3 12h18M3 18h18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-black">{user.email}</span>
              <button
                onClick={handleLogout}
                className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
          
          {/* Filters and Search Bar */}
          <div className="pb-3 space-y-3">
            {/* Status Filters */}
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    statusFilter === s
                      ? "bg-[#96572A] text-white shadow-sm"
                      : "bg-gray-50 text-black hover:bg-gray-100 border border-gray-100"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            
            {/* Search and Date Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="flex-1 min-w-64">
                <input
                  type="text"
                  placeholder="Search by Order ID, Name, Email, Phone…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] focus:outline-none transition-colors"
                />
              </div>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] focus:outline-none transition-colors text-gray-700"
              >
                <option value="all">All Time</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
                <option value="90days">Last 90 Days</option>
              </select>
              <button
                onClick={handleExport}
                className="px-4 py-2.5 bg-gray-50 text-gray-600 rounded-xl hover:bg-gray-100 font-medium text-xs border border-gray-100 transition-colors"
              >
                Export CSV
              </button>
            </div>
            
            {/* Bulk Actions */}
            {selectedReturns.size > 0 && (
              <div className="flex items-center gap-2 p-3 bg-[#F9F6F2] rounded-xl border border-[#C8956C]/20">
                <span className="text-xs font-semibold text-[#96572A]">
                  {selectedReturns.size} selected
                </span>
                <button
                  onClick={handleBulkApprove}
                  disabled={processingId === 'bulk'}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 disabled:opacity-60 text-xs font-medium transition-colors"
                >
                  {processingId === 'bulk' ? 'Processing…' : 'Bulk Approve'}
                </button>
                <button
                  onClick={handleBulkReject}
                  disabled={processingId === 'bulk'}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-60 text-xs font-medium transition-colors"
                >
                  Bulk Reject
                </button>
                <button
                  onClick={() => setSelectedReturns(new Set())}
                  className="px-3 py-1.5 bg-white text-gray-600 rounded-full hover:bg-gray-50 text-xs font-medium border border-gray-200 transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[11px] text-black uppercase tracking-wider font-medium">Pending</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{stats.pending}</p>
            <p className="text-[10px] text-black mt-0.5">Awaiting review</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[11px] text-black uppercase tracking-wider font-medium">Approved</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.approved}</p>
            <p className="text-[10px] text-black mt-0.5">Processed</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[11px] text-black uppercase tracking-wider font-medium">Rejected</p>
            <p className="text-2xl font-bold text-red-500 mt-1">{stats.rejected}</p>
            <p className="text-[10px] text-black mt-0.5">Declined</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[11px] text-black uppercase tracking-wider font-medium">This Month</p>
            <p className="text-2xl font-bold text-[#96572A] mt-1">{stats.thisMonth}</p>
            <p className="text-[10px] text-black mt-0.5">New returns</p>
          </div>
        </div>
        
        {/* Financial Analytics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[11px] text-black uppercase tracking-wider font-medium">Total Refunds</p>
            <p className="text-2xl font-bold text-purple-600 mt-1">₹{stats.totalRefunds.toFixed(2)}</p>
            <p className="text-[10px] text-black mt-0.5">All time</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[11px] text-black uppercase tracking-wider font-medium">Average Refund</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">₹{stats.avgRefundAmount.toFixed(2)}</p>
            <p className="text-[10px] text-black mt-0.5">Per return</p>
          </div>
        </div>
        
        {/* Analytics Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          {/* Top Return Reasons */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Top Return Reasons</h3>
            <div className="space-y-2.5">
              {topReturnReasons.length > 0 ? (
                topReturnReasons.map(([reason, count], index) => (
                  <div key={reason} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] font-medium text-black w-5">#{index + 1}</span>
                      <span className="text-xs text-gray-700">{reason}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-gray-100 rounded-full h-1.5">
                        <div 
                          className="bg-[#96572A] h-1.5 rounded-full"
                          style={{ width: `${(count / returns.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-black w-6 text-right">{count}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-black">No data available</p>
              )}
            </div>
          </div>
          
          {/* Monthly Trends */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Monthly Trend</h3>
            <div className="space-y-2.5">
              {Object.entries(monthlyReturns).length > 0 ? (
                Object.entries(monthlyReturns)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .slice(0, 6)
                  .map(([month, count]) => {
                    const [year, monthNum] = month.split('-');
                    const monthName = new Date(year, monthNum - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    const maxCount = Math.max(...Object.values(monthlyReturns));
                    
                    return (
                      <div key={month} className="flex items-center justify-between">
                        <span className="text-xs text-gray-700 w-24">{monthName}</span>
                        <div className="flex items-center gap-2 flex-1 ml-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                            <div 
                              className="bg-[#C8956C] h-1.5 rounded-full"
                              style={{ width: `${(count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-black w-6 text-right">{count}</span>
                        </div>
                      </div>
                    );
                  })
              ) : (
                <p className="text-xs text-black">No data available</p>
              )}
            </div>
          </div>
        </div>

        {filteredReturns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
            </svg>
            <p className="text-black text-sm">No return requests {statusFilter !== "All" ? `with status "${statusFilter}"` : ""}</p>
          </div>
        ) : (
          <>
            {/* Card View */}
            {viewMode === "cards" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredReturns.map((req) => {
                  const status = req.status || "Pending";
                  const isSelected = selectedReturns.has(req.id);
                  
                  return (
                    <div 
                      key={req.id} 
                      className={`bg-white rounded-xl border overflow-hidden hover:shadow-md transition-all ${
                        isSelected ? "ring-2 ring-[#96572A] border-[#C8956C]/30" : "border-gray-100"
                      }`}
                    >
                      {/* Card Header */}
                      <div className="px-4 py-3.5 border-b border-gray-50">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const newSelected = new Set(selectedReturns);
                                if (e.target.checked) {
                                  newSelected.add(req.id);
                                } else {
                                  newSelected.delete(req.id);
                                }
                                setSelectedReturns(newSelected);
                              }}
                              className="rounded border-gray-200 text-[#96572A] focus:ring-[#96572A] h-4 w-4"
                            />
                            <div>
                              <div className="font-semibold text-gray-800 text-sm">{req.orderId}</div>
                              <div className="text-xs text-black">{req.customerName}</div>
                            </div>
                          </div>
                          <span
                            className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full tracking-wide border ${
                              status === "Approved"
                                ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                                : status === "Rejected"
                                ? "bg-red-50 text-red-500 border-red-200"
                                : "bg-amber-50 text-amber-600 border-amber-200"
                            }`}
                          >
                            {status}
                          </span>
                        </div>
                        
                        {/* Customer Info */}
                        <div className="space-y-0.5 text-xs">
                          <div className="text-black truncate">{req.email}</div>
                          <div className="text-black">{req.phone}</div>
                        </div>
                      </div>
                      
                      {/* Card Body */}
                      <div className="px-4 py-3.5 space-y-3">
                        {/* Return Details */}
                        <div>
                          <h4 className="text-[10px] text-black uppercase tracking-wider font-medium mb-1.5">Return Details</h4>
                          <div className="space-y-1 text-xs">
                            <div className="text-gray-600">{req.reason}</div>
                            {req.comments && (
                              <div className="text-black italic">{req.comments}</div>
                            )}
                            {req.shopifyOrderData?.refundAmount && (
                              <div className="text-emerald-600 font-medium">
                                Refund: {req.shopifyOrderData.currency || "INR"} {parseFloat(req.shopifyOrderData.refundAmount).toFixed(2)}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Warehouse Address */}
                        <div>
                          <h4 className="text-[10px] text-black uppercase tracking-wider font-medium mb-1.5">Warehouse</h4>
                          <div className="text-xs text-black">
                            <div>{req.warehouseAddress?.shipping_address || "Plot No 519, Roja Yaqubpur, Sec 16B"}</div>
                            <div>
                              {req.warehouseAddress?.shipping_city || "Greater Noida"}, {req.warehouseAddress?.shipping_state || "UP"} {req.warehouseAddress?.shipping_pincode || "201306"}
                            </div>
                          </div>
                          <button
                            onClick={() => setWarehouseModal({ open: true, request: req, address: req.warehouseAddress || {
                              shipping_customer_name: "Satmi Warehouse",
                              shipping_address: "Plot No 519, Roja Yaqubpur, Sec 16B",
                              shipping_address_2: "Greater Noida",
                              shipping_city: "Greater Noida",
                              shipping_state: "Uttar Pradesh",
                              shipping_country: "India",
                              shipping_pincode: "201306",
                              shipping_phone: "9999999999"
                            }})}
                            className="text-[10px] text-[#96572A] hover:text-[#7A4422] underline mt-1"
                          >
                            Edit Address
                          </button>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-50">
                          {status === "Pending" && (
                            <>
                              <button
                                onClick={() => setApproveModal({ open: true, request: req })}
                                disabled={processingId === req.id}
                                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-full hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                              >
                                {processingId === req.id ? "Processing…" : "Approve"}
                              </button>
                              <button
                                onClick={() => setRejectModal({ open: true, request: req, reason: "" })}
                                disabled={processingId === req.id}
                                className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-full hover:bg-red-700 disabled:opacity-60 transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {(status === "Approved") && req.shiprocketShipmentId && (
                            <button
                              onClick={() => handleGenerateLabel(req)}
                              disabled={labelLoadingId === req.id}
                              className="px-3 py-1.5 bg-[#96572A] text-white text-xs font-medium rounded-full hover:bg-[#7A4422] disabled:opacity-60 transition-colors"
                            >
                              {labelLoadingId === req.id
                                ? "Generating…"
                                : req.labelUrl
                                ? "Open label"
                                : "Get label"}
                            </button>
                          )}
                          {status === "Approved" && req.labelUrl && (
                            <a
                              href={req.labelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 bg-gray-50 text-gray-600 text-xs font-medium rounded-full hover:bg-gray-100 border border-gray-100 transition-colors"
                            >
                              Download
                            </a>
                          )}
                          {req.videoUrl && (
                            <a
                              href={req.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 text-[#96572A] hover:underline text-xs font-medium"
                            >
                              Video
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            {/* Table View */}
            {viewMode === "table" && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-4 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={selectedReturns.size === filteredReturns.length && filteredReturns.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedReturns(new Set(filteredReturns.map(r => r.id)));
                              } else {
                                setSelectedReturns(new Set());
                              }
                            }}
                            className="rounded border-gray-200 text-[#96572A] focus:ring-[#96572A] h-4 w-4"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold text-black uppercase tracking-wider">Order / Customer</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold text-black uppercase tracking-wider">Items & Reason</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold text-black uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold text-black uppercase tracking-wider">Warehouse</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold text-black uppercase tracking-wider">Video</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold text-black uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReturns.map((req) => {
                        const status = req.status || "Pending";
                        return (
                          <tr key={req.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30 transition-colors">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedReturns.has(req.id)}
                                onChange={(e) => {
                                  const newSelected = new Set(selectedReturns);
                                  if (e.target.checked) {
                                    newSelected.add(req.id);
                                  } else {
                                    newSelected.delete(req.id);
                                  }
                                  setSelectedReturns(newSelected);
                                }}
                                className="rounded border-gray-200 text-[#96572A] focus:ring-[#96572A] h-4 w-4"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-800 text-sm">{req.orderId}</div>
                              <div className="text-xs text-black">{req.customerName}</div>
                              <div className="text-[10px] text-black">{req.email}</div>
                              <div className="text-[10px] text-black">{req.phone}</div>
                              {req.pincode && (
                                <div className="text-[10px] text-black">PIN: {req.pincode}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-xs text-gray-600">
                                {req.items?.map((item, i) => (
                                  <div key={i}>• {item.title}</div>
                                ))}
                              </div>
                              <div className="text-[10px] text-black mt-1">{req.reason}</div>
                              {req.comments && (
                                <div className="text-[10px] text-black mt-0.5 italic">{req.comments}</div>
                              )}
                              {req.shopifyOrderData?.refundAmount && (
                                <div className="text-[10px] text-emerald-600 mt-1 font-medium">
                                  Refund: {req.shopifyOrderData.currency || "INR"} {parseFloat(req.shopifyOrderData.refundAmount).toFixed(2)}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full tracking-wide border ${
                                  status === "Approved"
                                    ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                                    : status === "Rejected"
                                    ? "bg-red-50 text-red-500 border-red-200"
                                    : "bg-amber-50 text-amber-600 border-amber-200"
                                }`}
                              >
                                {status}
                              </span>
                              {req.shiprocketAwb && (
                                <div className="text-[10px] text-black mt-1">AWB: {req.shiprocketAwb}</div>
                              )}
                              {req.rejectionReason && (
                                <div className="text-[10px] text-red-500 mt-1">{req.rejectionReason}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-xs text-gray-600">
                                {req.warehouseAddress?.shipping_address || "Plot No 519, Roja Yaqubpur, Sec 16B"}
                              </div>
                              <div className="text-[10px] text-black">
                                {req.warehouseAddress?.shipping_city || "Greater Noida"}, {req.warehouseAddress?.shipping_state || "UP"} {req.warehouseAddress?.shipping_pincode || "201306"}
                              </div>
                              <button
                                onClick={() => setWarehouseModal({ open: true, request: req, address: req.warehouseAddress || {
                                  shipping_customer_name: "Satmi Warehouse",
                                  shipping_address: "Plot No 519, Roja Yaqubpur, Sec 16B",
                                  shipping_address_2: "Greater Noida",
                                  shipping_city: "Greater Noida",
                                  shipping_state: "Uttar Pradesh",
                                  shipping_country: "India",
                                  shipping_pincode: "201306",
                                  shipping_phone: "9999999999"
                                }})}
                                className="text-[10px] text-[#96572A] hover:text-[#7A4422] underline mt-1"
                              >
                                Edit Address
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              {req.videoUrl ? (
                                <a
                                  href={req.videoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-[#96572A] hover:underline"
                                >
                                  View
                                </a>
                              ) : (
                                <span className="text-black text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1.5">
                                {status === "Pending" && (
                                  <>
                                    <button
                                      onClick={() => setApproveModal({ open: true, request: req })}
                                      disabled={processingId === req.id}
                                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-full hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                                    >
                                      {processingId === req.id ? "Processing…" : "Approve"}
                                    </button>
                                    <button
                                      onClick={() => setRejectModal({ open: true, request: req, reason: "" })}
                                      disabled={processingId === req.id}
                                      className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-full hover:bg-red-700 disabled:opacity-60 transition-colors"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                                {(status === "Approved") && req.shiprocketShipmentId && (
                                  <button
                                    onClick={() => handleGenerateLabel(req)}
                                    disabled={labelLoadingId === req.id}
                                    className="px-3 py-1.5 bg-[#96572A] text-white text-xs font-medium rounded-full hover:bg-[#7A4422] disabled:opacity-60 transition-colors"
                                  >
                                    {labelLoadingId === req.id
                                      ? "Generating…"
                                      : req.labelUrl
                                      ? "Open label"
                                      : "Get label"}
                                  </button>
                                )}
                                {status === "Approved" && req.labelUrl && (
                                  <a
                                    href={req.labelUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 bg-gray-50 text-gray-600 text-xs font-medium rounded-full hover:bg-gray-100 border border-gray-100 transition-colors"
                                  >
                                    Download
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Approve modal */}
      {approveModal.open && approveModal.request && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-gray-900">Approve Return</h2>
            </div>
            <p className="text-xs text-black mb-5">
              This will create a return, generate a label, and email the customer for order <strong className="text-gray-700">{approveModal.request.orderId}</strong>.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setApproveModal({ open: false, request: null })}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-full hover:bg-gray-50 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleApprove(approveModal.request)}
                disabled={processingId === approveModal.request.id}
                className="px-5 py-2 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 disabled:opacity-60 text-sm font-medium transition-colors"
              >
                {processingId === approveModal.request.id ? "Processing…" : "Approve & Create Return"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal.open && rejectModal.request && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-gray-900">Reject Return</h2>
            </div>
            <p className="text-xs text-black mb-4">
              Reject return for order <strong className="text-gray-700">{rejectModal.request.orderId}</strong>.
            </p>
            <div className="mb-5">
              <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">Reason (optional)</label>
              <textarea
                value={rejectModal.reason}
                onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-sm min-h-20 focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                placeholder="e.g. Outside return window"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRejectModal({ open: false, request: null, reason: "" })}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-full hover:bg-gray-50 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReject(rejectModal.request, rejectModal.reason)}
                disabled={processingId === rejectModal.request.id}
                className="px-5 py-2 bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-60 text-sm font-medium transition-colors"
              >
                {processingId === rejectModal.request.id ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warehouse Address Edit Modal */}
      {warehouseModal.open && warehouseModal.request && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-[#96572A]/10 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-[#96572A]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-gray-900">Edit Warehouse Address</h2>
            </div>
            <p className="text-xs text-black mb-5">
              Update warehouse address for order <strong className="text-gray-700">{warehouseModal.request.orderId}</strong>. Used when creating the return shipment.
            </p>
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">Warehouse Name</label>
                <input
                  type="text"
                  value={warehouseModal.address.shipping_customer_name || ""}
                  onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_customer_name: e.target.value } }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                  placeholder="Satmi Warehouse"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">Address Line 1</label>
                <input
                  type="text"
                  value={warehouseModal.address.shipping_address || ""}
                  onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_address: e.target.value } }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                  placeholder="Plot No 519, Roja Yaqubpur, Sec 16B"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">Address Line 2</label>
                <input
                  type="text"
                  value={warehouseModal.address.shipping_address_2 || ""}
                  onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_address_2: e.target.value } }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                  placeholder="Greater Noida"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">City</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_city || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_city: e.target.value } }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                    placeholder="Greater Noida"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">State</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_state || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_state: e.target.value } }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                    placeholder="Uttar Pradesh"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">Pincode</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_pincode || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_pincode: e.target.value } }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                    placeholder="201318"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black uppercase tracking-wider mb-1.5">Phone</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_phone || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_phone: e.target.value } }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96572A]/20 focus:border-[#96572A] transition-colors"
                    placeholder="9999999999"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setWarehouseModal({ open: false, request: null, address: null })}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-full hover:bg-gray-50 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpdateWarehouseAddress(warehouseModal.request, warehouseModal.address)}
                disabled={processingId === warehouseModal.request.id}
                className="px-5 py-2 bg-[#96572A] text-white rounded-full hover:bg-[#7A4623] disabled:opacity-60 text-sm font-medium transition-colors"
              >
                {processingId === warehouseModal.request.id ? "Updating…" : "Update Address"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
