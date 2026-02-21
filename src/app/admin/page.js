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
  const [rejectModal, setRejectModal] = useState({ open: false, request: null, reason: "" });
  const [approveModal, setApproveModal] = useState({ open: false, request: null, pickupPincode: "" });
  const [labelLoadingId, setLabelLoadingId] = useState(null);

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

  const filteredReturns =
    statusFilter === "All"
      ? returns
      : returns.filter((r) => (r.status || "Pending") === statusFilter);

  const stats = {
    pending: returns.filter((r) => (r.status || "Pending") === "Pending").length,
    approved: returns.filter((r) => r.status === "Approved").length,
    rejected: returns.filter((r) => r.status === "Rejected").length,
  };

  const handleApprove = async (request, pickupPincode) => {
    if (processingId) return;
    setProcessingId(request.id);
    try {
      const pincode = pickupPincode?.trim() || request.pincode || "201318";
      const shiprocketRes = await fetch("/api/shiprocket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: request.orderId,
          customerName: request.customerName,
          email: request.email,
          phone: request.phone,
          pincode,
          originalCourier: request.originalCourier,
          testMode: false,
        }),
      });
      const shiprocketData = await shiprocketRes.json();
      if (!shiprocketData.success) {
        throw new Error(shiprocketData.error || "Shiprocket API failed");
      }

      const returnRef = doc(db, "returns", request.id);
      await updateDoc(returnRef, {
        status: "Approved",
        shiprocketAwb: shiprocketData.awb || "PENDING",
        shiprocketCourier: shiprocketData.courier || "Unknown",
        shiprocketShipmentId: shiprocketData.shipmentId ?? null,
        approvedAt: new Date(),
        approvedBy: user.email,
      });

      setApproveModal({ open: false, request: null, pickupPincode: "" });
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
      } else if (data.raw?.label_url) {
        const returnRef = doc(db, "returns", request.id);
        await updateDoc(returnRef, { labelUrl: data.raw.label_url });
        window.open(data.raw.label_url, "_blank");
      } else {
        alert("Label generated but URL not returned. Check Shiprocket panel.");
      }
    } catch (error) {
      console.error("Label error:", error);
      alert("Error: " + error.message);
    } finally {
      setLabelLoadingId(null);
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
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">Satmi Returns Dashboard</h1>
              <nav className="flex gap-2">
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
              </nav>
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
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Pending</p>
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Approved</p>
            <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Rejected</p>
            <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
          </div>
        </div>

        {filteredReturns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            No return requests {statusFilter !== "All" ? `with status "${statusFilter}"` : ""}.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order / Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items & Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
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
                                  onClick={() =>
                                    setApproveModal({
                                      open: true,
                                      request: req,
                                      pickupPincode: req.pincode || "201318",
                                    })
                                  }
                                  disabled={processingId === req.id}
                                  className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60"
                                >
                                  {processingId === req.id ? "Processing…" : "Approve"}
                                </button>
                                <button
                                  onClick={() =>
                                    setRejectModal({ open: true, request: req, reason: "" })
                                  }
                                  disabled={processingId === req.id}
                                  className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {status === "Approved" && req.shiprocketShipmentId && (
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
      </main>

      {/* Approve modal: confirm and optional pickup pincode */}
      {approveModal.open && approveModal.request && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Approve return</h2>
            <p className="text-sm text-gray-600 mb-4">
              Create Shiprocket return order and generate AWB for{" "}
              <strong>{approveModal.request.orderId}</strong>.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pickup pincode (customer)
              </label>
              <input
                type="text"
                value={approveModal.pickupPincode}
                onChange={(e) =>
                  setApproveModal((m) => ({ ...m, pickupPincode: e.target.value }))
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                placeholder="e.g. 201318"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setApproveModal({ open: false, request: null, pickupPincode: "" })}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleApprove(approveModal.request, approveModal.pickupPincode)}
                disabled={processingId === approveModal.request.id}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
              >
                {processingId === approveModal.request.id ? "Processing…" : "Approve & create label"}
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
    </div>
  );
}
