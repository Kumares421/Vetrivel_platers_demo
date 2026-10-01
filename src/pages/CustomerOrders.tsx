import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, Plus, CheckCircle2, XCircle, AlertTriangle, Eye, 
  Trash2, FileText, Search, RefreshCw, ArrowRight, Network 
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QuantityBadge } from '../components/QuantityBadge';

interface CustomerOrdersProps {
  onTrace?: (orderId: string) => void;
}

export const CustomerOrders: React.FC<CustomerOrdersProps> = ({ onTrace }) => {
  const { isAdmin, isStaff } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Create Modal State
  const [createModal, setCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formPoNumber, setFormPoNumber] = useState('');
  const [formOrderDate, setFormOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formAutoConfirm, setFormAutoConfirm] = useState(true);
  const [orderItems, setOrderItems] = useState<Array<{ part_id: string; quantity: number; rate: number; process_type: string }>>([
    { part_id: '', quantity: 100, rate: 0, process_type: 'Zinc Plating' }
  ]);

  // View Details Modal
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [detailsModal, setDetailsModal] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [orderToCancel, setOrderToCancel] = useState<any | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    setError('');
    try {
      let url = '/customer-orders';
      if (statusFilter) url += `?status=${statusFilter}`;
      const res = await apiFetch<any[]>(url);
      setOrders(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load customer orders');
    } finally {
      setLoading(false);
    }
  };

  const loadMasters = async () => {
    try {
      const [custList, partList] = await Promise.all([
        apiFetch<any[]>('/customers'),
        apiFetch<any[]>('/parts')
      ]);
      setCustomers(custList);
      setParts(partList);
    } catch (e) {
      console.error('Failed to load masters:', e);
    }
  };

  useEffect(() => {
    fetchOrders();
    loadMasters();
  }, [statusFilter]);

  const handleAddItem = () => {
    setOrderItems([...orderItems, { part_id: '', quantity: 100, rate: 0, process_type: 'Zinc Plating' }]);
  };

  const handleRemoveItem = (index: number) => {
    if (orderItems.length === 1) return;
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const handlePartSelect = (index: number, partId: string) => {
    const part = parts.find(p => p.id === partId);
    const updated = [...orderItems];
    updated[index].part_id = partId;
    if (part) {
      updated[index].rate = part.rate_per_piece || 0;
      updated[index].process_type = part.process_type || 'Zinc Plating';
    }
    setOrderItems(updated);
  };

  const handleItemChange = (index: number, field: string, val: any) => {
    const updated = [...orderItems];
    (updated[index] as any)[field] = val;
    setOrderItems(updated);
  };

  // Math totals
  const totalQuantity = orderItems.reduce((acc, it) => acc + (parseFloat(it.quantity as any) || 0), 0);
  const totalAmount = orderItems.reduce((acc, it) => {
    const qty = parseFloat(it.quantity as any) || 0;
    const rate = parseFloat(it.rate as any) || 0;
    return acc + (qty * rate);
  }, 0);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCustomerId) {
      alert('Please select a customer');
      return;
    }
    for (let i = 0; i < orderItems.length; i++) {
      if (!orderItems[i].part_id) {
        alert(`Please select a part for Item #${i + 1}`);
        return;
      }
      if (orderItems[i].quantity <= 0) {
        alert(`Item #${i + 1}: Quantity must be greater than zero`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `co-submit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await apiFetch('/customer-orders', {
        method: 'POST',
        headers: { 'x-idempotency-key': idempotencyKey },
        body: JSON.stringify({
          customer_id: formCustomerId,
          customer_po_number: formPoNumber,
          order_date: formOrderDate,
          expected_delivery_date: formDeliveryDate || null,
          notes: formNotes,
          auto_confirm: formAutoConfirm,
          items: orderItems
        })
      });

      setCreateModal(false);
      // Reset form
      setFormCustomerId('');
      setFormPoNumber('');
      setFormNotes('');
      setOrderItems([{ part_id: '', quantity: 100, rate: 0, process_type: 'Zinc Plating' }]);
      fetchOrders();
    } catch (err: any) {
      alert('Failed to create order: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmOrder = async (orderId: string) => {
    if (!confirm('Confirm this customer order for production?')) return;
    try {
      await apiFetch(`/customer-orders/${orderId}/confirm`, { method: 'POST' });
      fetchOrders();
    } catch (err: any) {
      alert('Failed to confirm order: ' + err.message);
    }
  };

  const handleCancelOrder = async () => {
    if (!orderToCancel || !cancelReason.trim()) {
      alert('Please provide a cancellation reason');
      return;
    }
    try {
      await apiFetch(`/customer-orders/${orderToCancel.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancelReason })
      });
      setCancelModal(false);
      setOrderToCancel(null);
      setCancelReason('');
      fetchOrders();
    } catch (err: any) {
      alert('Failed to cancel order: ' + err.message);
    }
  };

  const openOrderDetails = async (orderId: string) => {
    try {
      const details = await apiFetch<any>(`/customer-orders/${orderId}`);
      setSelectedOrder(details);
      setDetailsModal(true);
    } catch (e: any) {
      alert('Failed to load order details: ' + e.message);
    }
  };

  const filteredOrders = orders.filter(o => {
    const matchSearch = 
      o.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customer_po_number?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSearch;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-teal-700" />
            Customer Orders & Plating Schedule
          </h2>
          <p className="text-slate-500 text-sm">
            Book incoming customer purchase orders, configure process types, and track parts inward fulfillment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchOrders}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
            title="Refresh Orders"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button
              onClick={() => setCreateModal(true)}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center gap-2 shadow"
            >
              <Plus className="w-4 h-4" /> New Customer Order
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search Order No, Customer, PO..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <label className="text-xs font-semibold text-slate-600">Status:</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-teal-500"
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="IN_PRODUCTION">In Production</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Error Banner with Retry */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-2xl text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <div>{error}</div>
          </div>
          <button
            onClick={fetchOrders}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200">
              <tr>
                <th className="p-4">Order Number</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Customer PO</th>
                <th className="p-4">Order Date</th>
                <th className="p-4">Target Delivery</th>
                <th className="p-4 text-right">Total Qty</th>
                <th className="p-4">Inward Progress</th>
                <th className="p-4 text-right">Total Amount</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">Loading orders...</td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    No customer orders found matching current filter.
                  </td>
                </tr>
              ) : (
                filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-teal-800">{order.order_number}</td>
                    <td className="p-4 font-semibold text-slate-900">{order.customer_name}</td>
                    <td className="p-4 font-mono text-xs">{order.customer_po_number || '—'}</td>
                    <td className="p-4 text-xs">{order.order_date}</td>
                    <td className="p-4 text-xs font-medium text-slate-600">{order.expected_delivery_date || '—'}</td>
                    <td className="p-4 text-right font-mono font-bold">{order.total_quantity.toLocaleString()}</td>
                    <td className="p-4 text-xs">
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between font-mono text-[11px]">
                          <span className="text-teal-700 font-bold">Recv: {order.total_inward_accepted_qty}</span>
                          <span className="text-amber-700 font-bold">Pend: {order.total_pending_qty}</span>
                        </div>
                        <div className="w-28 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-teal-600 h-full rounded-full"
                            style={{ width: `${Math.min(100, (order.total_inward_accepted_qty / (order.total_quantity || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-900">
                      ₹{order.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        order.status === 'CONFIRMED' ? 'bg-teal-100 text-teal-800' :
                        order.status === 'IN_PRODUCTION' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                        order.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {onTrace && (
                          <button
                            onClick={() => onTrace(order.id)}
                            className="p-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold"
                            title="Trace End-to-End Lineage"
                          >
                            <Network className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openOrderDetails(order.id)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs"
                          title="View Order Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {isAdmin && order.status === 'DRAFT' && (
                          <button
                            onClick={() => handleConfirmOrder(order.id)}
                            className="p-1.5 bg-teal-100 hover:bg-teal-200 text-teal-800 rounded-lg text-xs font-bold"
                            title="Confirm Order"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {isAdmin && order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && (
                          <button
                            onClick={() => {
                              setOrderToCancel(order);
                              setCancelModal(true);
                            }}
                            className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs"
                            title="Cancel Order"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Order Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-4 mb-4">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <ShoppingCart className="w-6 h-6 text-teal-700" />
                Book New Customer Order
              </h3>
              <button 
                onClick={() => setCreateModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Customer *</label>
                  <select
                    value={formCustomerId}
                    onChange={e => setFormCustomerId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select Customer...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Customer PO Number</label>
                  <input
                    type="text"
                    placeholder="e.g. PO-HYD-9942"
                    value={formPoNumber}
                    onChange={e => setFormPoNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Order Date *</label>
                  <input
                    type="date"
                    value={formOrderDate}
                    onChange={e => setFormOrderDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Delivery Date</label>
                  <input
                    type="date"
                    value={formDeliveryDate}
                    onChange={e => setFormDeliveryDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Instructions</label>
                  <input
                    type="text"
                    placeholder="Specific plating requirements or packaging notes"
                    value={formNotes}
                    onChange={e => setFormNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Order Items Table */}
              <div className="pt-2">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-sm font-bold text-slate-900">Order Parts & Plating Variety</h4>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Part Item
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Part Selection *</th>
                        <th className="p-3">Process / Variety</th>
                        <th className="p-3 w-32">Quantity *</th>
                        <th className="p-3 w-32">Rate (₹) *</th>
                        <th className="p-3 w-32 text-right">Line Amount</th>
                        <th className="p-3 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {orderItems.map((item, idx) => {
                        const lineAmt = (parseFloat(item.quantity as any) || 0) * (parseFloat(item.rate as any) || 0);
                        return (
                          <tr key={idx}>
                            <td className="p-2">
                              <select
                                value={item.part_id}
                                onChange={e => handlePartSelect(idx, e.target.value)}
                                required
                                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-teal-500"
                              >
                                <option value="">Select Part...</option>
                                {parts
                                  .filter(p => !formCustomerId || p.customer_id === formCustomerId)
                                  .map(p => (
                                    <option key={p.id} value={p.id}>{p.part_number} - {p.part_name}</option>
                                  ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={item.process_type}
                                onChange={e => handleItemChange(idx, 'process_type', e.target.value)}
                                placeholder="Process"
                                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={item.quantity}
                                onChange={e => handleItemChange(idx, 'quantity', parseFloat(e.target.value))}
                                required
                                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.rate}
                                onChange={e => handleItemChange(idx, 'rate', parseFloat(e.target.value))}
                                required
                                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                              />
                            </td>
                            <td className="p-2 text-right font-mono font-bold text-slate-900">
                              ₹{lineAmt.toFixed(2)}
                            </td>
                            <td className="p-2 text-center">
                              {orderItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(idx)}
                                  className="text-slate-400 hover:text-red-600 p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mathematical Totals Verification */}
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center text-sm font-semibold">
                  <div>
                    Total Order Quantity: <span className="font-mono font-bold text-teal-700">{totalQuantity.toLocaleString()}</span>
                  </div>
                  <div>
                    Total Order Value: <span className="font-mono font-black text-slate-900 text-base">₹{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="autoConfirm"
                  checked={formAutoConfirm}
                  onChange={e => setFormAutoConfirm(e.target.checked)}
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                <label htmlFor="autoConfirm" className="text-xs font-semibold text-slate-700">
                  Immediately confirm order for production and parts inward
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm shadow transition-colors"
                >
                  {submitting ? 'Booking Order...' : 'Confirm & Save Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {detailsModal && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-xl font-bold text-slate-900 font-mono">{selectedOrder.order_number}</h3>
                <p className="text-xs text-slate-500">Customer: <b className="text-slate-800">{selectedOrder.customer_name}</b></p>
              </div>
              <button onClick={() => setDetailsModal(false)} className="text-slate-400 hover:text-slate-700 font-bold text-lg">✕</button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl text-xs">
              <div><span className="text-slate-500">PO Ref:</span> <b className="font-mono">{selectedOrder.customer_po_number || 'N/A'}</b></div>
              <div><span className="text-slate-500">Order Date:</span> <b>{selectedOrder.order_date}</b></div>
              <div><span className="text-slate-500">Status:</span> <b>{selectedOrder.status}</b></div>
              <div><span className="text-slate-500">Created By:</span> <b>{selectedOrder.created_by_name}</b></div>
            </div>

            <h4 className="text-sm font-bold text-slate-900">Line Items & Parts Inward Status</h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Part</th>
                    <th className="p-3">Process</th>
                    <th className="p-3 text-right">Ordered</th>
                    <th className="p-3 text-right">Accepted</th>
                    <th className="p-3 text-right">Rejected</th>
                    <th className="p-3 text-right text-amber-700">Pending</th>
                    <th className="p-3 text-right">Rate</th>
                    <th className="p-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {selectedOrder.items?.map((it: any) => (
                    <tr key={it.id}>
                      <td className="p-3 font-sans font-bold">{it.part_number} - {it.part_name}</td>
                      <td className="p-3 font-sans">{it.process_type}</td>
                      <td className="p-3 text-right font-bold">{it.quantity}</td>
                      <td className="p-3 text-right text-teal-700 font-bold">{it.accepted_qty}</td>
                      <td className="p-3 text-right text-red-700 font-bold">{it.rejected_qty}</td>
                      <td className="p-3 text-right text-amber-700 font-black">{it.pending_qty}</td>
                      <td className="p-3 text-right">₹{it.rate.toFixed(2)}</td>
                      <td className="p-3 text-right font-bold text-slate-900">₹{it.line_amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-3">
              <button
                onClick={() => setDetailsModal(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Modal */}
      {cancelModal && orderToCancel && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Cancel Customer Order
            </h3>
            <p className="text-sm text-slate-600">
              Are you sure you want to cancel order <b>{orderToCancel.order_number}</b>? This action preserves full audit history.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Cancellation *</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason is required for audit log"
                required
                className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-red-500"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCancelModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={handleCancelOrder}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
