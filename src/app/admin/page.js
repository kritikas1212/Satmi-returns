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

      const returnRef = doc(db, "returns", request.id);
      await updateDoc(returnRef, {
        status: "Approved",
        shiprocketAwb: data.awb || "PENDING",
        shiprocketCourier: data.courier || "Unknown",
        shiprocketShipmentId: data.shipmentId ?? null,
        labelUrl: data.labelUrl ?? null,
        approvedAt: new Date(),
        approvedBy: user.email,
      });

      setApproveModal({ open: false, request: null });
      if (data.labelUrl) window.open(data.labelUrl, "_blank");
      alert(`RTO created. Label ${data.labelUrl ? "opened and " : ""}emailed to ${request.email}.`);
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
          }),
        });
        
        const data = await res.json();
        if (data.success) {
          const returnRef = doc(db, "returns", returnId);
          await updateDoc(returnRef, {
            status: "Approved",
            shiprocketAwb: data.awb || "PENDING",
            shiprocketShipmentId: data.shipmentId,
            shiprocketCourier: data.courier,
            labelUrl: data.labelUrl,
            approvedAt: new Date(),
            approvedBy: user.email,
          });
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
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#7A1E1E]" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">Satmi Returns Dashboard</h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewMode("cards")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    viewMode === "cards"
                      ? "bg-[#7A1E1E] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    viewMode === "table"
                      ? "bg-[#7A1E1E] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Table
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{user.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm font-medium text-[#7A1E1E] hover:underline"
              >
                Logout
              </button>
            </div>
          </div>
          
          {/* Filters and Search Bar */}
          <div className="pb-4 space-y-4">
            {/* Status Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Status:</span>
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-[#7A1E1E] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            
            {/* Search and Date Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-64">
                <input
                  type="text"
                  placeholder="Search by Order ID, Customer Name, Email, Phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7A1E1E] focus:border-transparent"
                />
              </div>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7A1E1E] focus:border-transparent"
              >
                <option value="all">All Time</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
                <option value="90days">Last 90 Days</option>
              </select>
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm"
              >
                Export CSV
              </button>
            </div>
            
            {/* Bulk Actions */}
            {selectedReturns.size > 0 && (
              <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                <span className="text-sm font-medium text-blue-900">
                  {selectedReturns.size} selected
                </span>
                <button
                  onClick={handleBulkApprove}
                  disabled={processingId === 'bulk'}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 text-sm font-medium"
                >
                  {processingId === 'bulk' ? 'Processing...' : 'Bulk Approve'}
                </button>
                <button
                  onClick={handleBulkReject}
                  disabled={processingId === 'bulk'}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 text-sm font-medium"
                >
                  Bulk Reject
                </button>
                <button
                  onClick={() => setSelectedReturns(new Set())}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                >
                  Clear Selection
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Enhanced Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Pending</p>
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
            <p className="text-xs text-gray-400 mt-1">Awaiting review</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Approved</p>
            <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
            <p className="text-xs text-gray-400 mt-1">Processed returns</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Rejected</p>
            <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
            <p className="text-xs text-gray-400 mt-1">Declined requests</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">This Month</p>
            <p className="text-2xl font-bold text-blue-600">{stats.thisMonth}</p>
            <p className="text-xs text-gray-400 mt-1">New returns</p>
          </div>
        </div>
        
        {/* Financial Analytics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total Refunds</p>
            <p className="text-2xl font-bold text-purple-600">₹{stats.totalRefunds.toFixed(2)}</p>
            <p className="text-xs text-gray-400 mt-1">Total refund amount</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Average Refund</p>
            <p className="text-2xl font-bold text-indigo-600">₹{stats.avgRefundAmount.toFixed(2)}</p>
            <p className="text-xs text-gray-400 mt-1">Per return average</p>
          </div>
        </div>
        
        {/* Analytics Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Top Return Reasons */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Return Reasons</h3>
            <div className="space-y-3">
              {topReturnReasons.length > 0 ? (
                topReturnReasons.map(([reason, count], index) => (
                  <div key={reason} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-500 w-6">#{index + 1}</span>
                      <span className="text-sm text-gray-900">{reason}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-[#7A1E1E] h-2 rounded-full"
                          style={{ width: `${(count / returns.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No data available</p>
              )}
            </div>
          </div>
          
          {/* Monthly Trends */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Returns Trend</h3>
            <div className="space-y-3">
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
                        <span className="text-sm text-gray-900">{monthName}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${(count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-gray-700 w-8 text-right">{count}</span>
                        </div>
                      </div>
                    );
                  })
              ) : (
                <p className="text-sm text-gray-500">No data available</p>
              )}
            </div>
          </div>
        </div>

        {filteredReturns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            No return requests {statusFilter !== "All" ? `with status "${statusFilter}"` : ""}.
          </div>
        ) : (
          <>
            {/* Card View */}
            {viewMode === "cards" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredReturns.map((req) => {
                  const status = req.status || "Pending";
                  const isSelected = selectedReturns.has(req.id);
                  
                  return (
                    <div 
                      key={req.id} 
                      className={`bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow ${
                        isSelected ? "ring-2 ring-blue-500" : ""
                      }`}
                    >
                      {/* Card Header */}
                      <div className="p-4 border-b border-gray-100">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
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
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div>
                              <div className="font-semibold text-gray-900">{req.orderId}</div>
                              <div className="text-sm text-gray-500">{req.customerName}</div>
                            </div>
                          </div>
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              status === "Approved"
                                ? "bg-green-100 text-green-800"
                                : status === "Rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {status}
                          </span>
                        </div>
                        
                        {/* Customer Info */}
                        <div className="space-y-1 text-sm">
                          <div className="text-gray-600">
                            <span className="font-medium">Email:</span> {req.email}
                          </div>
                          <div className="text-gray-600">
                            <span className="font-medium">Phone:</span> {req.phone}
                          </div>
                        </div>
                      </div>
                      
                      {/* Card Body */}
                      <div className="p-4 space-y-4">
                        {/* Return Details */}
                        <div>
                          <h4 className="text-sm font-medium text-gray-900 mb-2">Return Details</h4>
                          <div className="space-y-1 text-sm">
                            <div className="text-gray-600">
                              <span className="font-medium">Reason:</span> {req.reason}
                            </div>
                            {req.comments && (
                              <div className="text-gray-600">
                                <span className="font-medium">Comments:</span> {req.comments}
                              </div>
                            )}
                            {req.shopifyOrderData?.refundAmount && (
                              <div className="text-green-600 font-medium">
                                Refund: {req.shopifyOrderData.currency || "INR"} {parseFloat(req.shopifyOrderData.refundAmount).toFixed(2)}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Warehouse Address */}
                        <div>
                          <h4 className="text-sm font-medium text-gray-900 mb-2">Warehouse Address</h4>
                          <div className="text-sm text-gray-600">
                            <div>{req.warehouseAddress?.shipping_address || "Plot No 519, Roja Yaqubpur, Sec 16B"}</div>
                            <div>
                              {req.warehouseAddress?.shipping_city || "Greater Noida"}, {req.warehouseAddress?.shipping_state || "Uttar Pradesh"} {req.warehouseAddress?.shipping_pincode || "201306"}
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
                            className="text-xs text-blue-600 hover:text-blue-800 underline mt-1"
                          >
                            Edit Address
                          </button>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                          {status === "Pending" && (
                            <>
                              <button
                                onClick={() => setApproveModal({ open: true, request: req })}
                                disabled={processingId === req.id}
                                className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60"
                              >
                                {processingId === req.id ? "Processing…" : "Approve"}
                              </button>
                              <button
                                onClick={() => setRejectModal({ open: true, request: req, reason: "" })}
                                disabled={processingId === req.id}
                                className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {(status === "Approved") && req.shiprocketShipmentId && (
                            <button
                              onClick={() => handleGenerateLabel(req)}
                              disabled={labelLoadingId === req.id}
                              className="px-3 py-1.5 bg-[#7A1E1E] text-white text-sm font-medium rounded-lg hover:bg-[#5e1717] disabled:opacity-60"
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
                              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
                            >
                              Download
                            </a>
                          )}
                          {req.videoUrl && (
                            <a
                              href={req.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 text-[#7A1E1E] hover:underline text-sm font-medium"
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
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
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
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order / Customer</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items & Reason</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Warehouse Address</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Video</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredReturns.map((req) => {
                        const status = req.status || "Pending";
                        return (
                          <tr key={req.id} className="hover:bg-gray-50/50">
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
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">{req.orderId}</div>
                              <div className="text-sm text-gray-500">{req.customerName}</div>
                              <div className="text-xs text-gray-400">{req.email}</div>
                              <div className="text-xs text-gray-400">{req.phone}</div>
                              {req.pincode && (
                                <div className="text-xs text-gray-400">Pincode: {req.pincode}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm text-gray-700">
                                {req.items?.map((item, i) => (
                                  <div key={i}>• {item.title}</div>
                                ))}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">{req.reason}</div>
                              {req.comments && (
                                <div className="text-xs text-gray-400 mt-0.5">{req.comments}</div>
                              )}
                              {req.shopifyOrderData?.refundAmount && (
                                <div className="text-xs text-green-600 mt-1 font-medium">
                                  Refund: {req.shopifyOrderData.currency || "INR"} {parseFloat(req.shopifyOrderData.refundAmount).toFixed(2)}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  status === "Approved"
                                    ? "bg-green-100 text-green-800"
                                    : status === "Rejected"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {status}
                              </span>
                              {req.shiprocketAwb && (
                                <div className="text-xs text-gray-500 mt-1">AWB: {req.shiprocketAwb}</div>
                              )}
                              {req.rejectionReason && (
                                <div className="text-xs text-red-600 mt-1">{req.rejectionReason}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm text-gray-900">
                                {req.warehouseAddress?.shipping_address || "Plot No 519, Roja Yaqubpur, Sec 16B"}
                              </div>
                              <div className="text-xs text-gray-500">
                                {req.warehouseAddress?.shipping_city || "Greater Noida"}, {req.warehouseAddress?.shipping_state || "Uttar Pradesh"} {req.warehouseAddress?.shipping_pincode || "201306"}
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
                                className="text-xs text-blue-600 hover:text-blue-800 underline mt-1"
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
                                  className="text-sm text-[#7A1E1E] hover:underline"
                                >
                                  View video
                                </a>
                              ) : (
                                <span className="text-gray-400 text-sm">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                {status === "Pending" && (
                                  <>
                                    <button
                                      onClick={() => setApproveModal({ open: true, request: req })}
                                      disabled={processingId === req.id}
                                      className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60"
                                    >
                                      {processingId === req.id ? "Processing…" : "Approve"}
                                    </button>
                                    <button
                                      onClick={() => setRejectModal({ open: true, request: req, reason: "" })}
                                      disabled={processingId === req.id}
                                      className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                                {(status === "Approved") && req.shiprocketShipmentId && (
                                  <button
                                    onClick={() => handleGenerateLabel(req)}
                                    disabled={labelLoadingId === req.id}
                                    className="px-3 py-1.5 bg-[#7A1E1E] text-white text-sm font-medium rounded-lg hover:bg-[#5e1717] disabled:opacity-60"
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
                                    className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
                                  >
                                    Download label
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

      {/* Approve modal: confirm and optional pickup pincode */}
      {approveModal.open && approveModal.request && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Approve return</h2>
            <p className="text-sm text-gray-600 mb-4">
              Create RTO, generate label, and email the customer for order <strong>{approveModal.request.orderId}</strong>.
              Pickup address is taken from Shopify; label is sent to {approveModal.request.email}.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setApproveModal({ open: false, request: null })}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleApprove(approveModal.request)}
                disabled={processingId === approveModal.request.id}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
              >
                {processingId === approveModal.request.id ? "Processing…" : "Approve & create RTO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal.open && rejectModal.request && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Reject return</h2>
            <p className="text-sm text-gray-600 mb-4">
              Reject return request for order <strong>{rejectModal.request.orderId}</strong>.
              Optionally add a reason (e.g. for internal use or future communication).
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason (optional)
              </label>
              <textarea
                value={rejectModal.reason}
                onChange={(e) =>
                  setRejectModal((m) => ({ ...m, reason: e.target.value }))
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 min-h-[80px]"
                placeholder="e.g. Outside return window"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRejectModal({ open: false, request: null, reason: "" })}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReject(rejectModal.request, rejectModal.reason)}
                disabled={processingId === rejectModal.request.id}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
              >
                {processingId === rejectModal.request.id ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warehouse Address Edit Modal */}
      {warehouseModal.open && warehouseModal.request && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit Warehouse Address</h2>
            <p className="text-sm text-gray-600 mb-4">
              Update warehouse address for order <strong>{warehouseModal.request.orderId}</strong>.
              This will be used when creating the return shipment.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse Name</label>
                <input
                  type="text"
                  value={warehouseModal.address.shipping_customer_name || ""}
                  onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_customer_name: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  placeholder="Satmi Warehouse"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
                <input
                  type="text"
                  value={warehouseModal.address.shipping_address || ""}
                  onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_address: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  placeholder="Plot No 519, Roja Yaqubpur, Sec 16B"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
                <input
                  type="text"
                  value={warehouseModal.address.shipping_address_2 || ""}
                  onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_address_2: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  placeholder="Greater Noida"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_city || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_city: e.target.value } }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="Greater Noida"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_state || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_state: e.target.value } }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="Uttar Pradesh"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_pincode || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_pincode: e.target.value } }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="201318"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={warehouseModal.address.shipping_phone || ""}
                    onChange={(e) => setWarehouseModal(m => ({ ...m, address: { ...m.address, shipping_phone: e.target.value } }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="9999999999"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setWarehouseModal({ open: false, request: null, address: null })}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpdateWarehouseAddress(warehouseModal.request, warehouseModal.address)}
                disabled={processingId === warehouseModal.request.id}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
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
