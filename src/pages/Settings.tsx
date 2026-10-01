import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, Truck, Container, Users, ShieldAlert, Download, 
  Database, Plus, CheckCircle2, Edit3, History, BadgeIndianRupee, Building2, 
  Layers, Check, X, AlertTriangle 
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export const Settings: React.FC<{ onNavigate?: (tab: string) => void }> = ({ onNavigate }) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'suppliers' | 'tanks' | 'rates' | 'users' | 'audit' | 'backup'>('suppliers');

  // Masters State
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Supplier Form Modal
  const [suppModal, setSuppModal] = useState(false);
  const [editingSupp, setEditingSupp] = useState<any | null>(null);
  const [suppName, setSuppName] = useState('');
  const [suppContact, setSuppContact] = useState('');
  const [suppAddr, setSuppAddr] = useState('');

  // Tank Form Modal
  const [tankModal, setTankModal] = useState(false);
  const [editingTank, setEditingTank] = useState<any | null>(null);
  const [tankCode, setTankCode] = useState('');
  const [tankName, setTankName] = useState('');
  const [tankCapacity, setTankCapacity] = useState<number | string>(0);
  const [tankLocation, setTankLocation] = useState('');
  const [tankStatus, setTankStatus] = useState('ACTIVE');
  const [tankIsActive, setTankIsActive] = useState(true);

  // Tank Issue History Modal
  const [historyTank, setHistoryTank] = useState<any | null>(null);
  const [tankHistoryRecords, setTankHistoryRecords] = useState<any[]>([]);
  const [loadingTankHistory, setLoadingTankHistory] = useState(false);

  // Customer Form Modal
  const [custModal, setCustModal] = useState(false);
  const [editingCust, setEditingCust] = useState<any | null>(null);
  const [custCode, setCustCode] = useState('');
  const [custName, setCustName] = useState('');
  const [custContact, setCustContact] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custAddr, setCustAddr] = useState('');
  const [custGst, setCustGst] = useState('');

  // Part / Rate Form Modal
  const [partModal, setPartModal] = useState(false);
  const [editingPart, setEditingPart] = useState<any | null>(null);
  const [partCustomerId, setPartCustomerId] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [partName, setPartName] = useState('');
  const [partProcess, setPartProcess] = useState('Zinc Plating');
  const [partSurfaceArea, setPartSurfaceArea] = useState<number | string>(0);
  const [partRate, setPartRate] = useState<number | string>('');
  const [partUnit, setPartUnit] = useState('nos');

  // User Form Modal (Super Admin / Admin)
  const [userModal, setUserModal] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState<'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>('STAFF');

  // Reset Controls State
  const [resetSummary, setResetSummary] = useState<any>(null);
  const [resetModalScope, setResetModalScope] = useState<'TRANSACTIONS_ONLY' | 'FULL_TEST_RESET' | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [resetResult, setResetResult] = useState<any>(null);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any[]>('/suppliers');
      setSuppliers(res);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTanks = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any[]>('/tanks');
      setTanks(res);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRatesData = async () => {
    setLoading(true);
    try {
      const [cRes, pRes] = await Promise.all([
        apiFetch<any[]>('/customers?include_inactive=true'),
        apiFetch<any[]>('/parts?include_inactive=true')
      ]);
      setCustomers(cRes);
      setParts(pRes);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any[]>('/auth/users');
      setUsersList(res);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/reports/audit-logs');
      setAuditLogs(res.rows || res || []);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchResetSummary = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/backup/reset-summary');
      setResetSummary(res);
    } catch (e: any) {
      console.error('Failed to fetch reset summary:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setErrorMsg('');
    setStatusMsg('');
    if (activeTab === 'suppliers') fetchSuppliers();
    else if (activeTab === 'tanks') fetchTanks();
    else if (activeTab === 'rates') fetchRatesData();
    else if (activeTab === 'users') fetchUsers();
    else if (activeTab === 'audit') fetchAuditLogs();
    else if (activeTab === 'backup') fetchResetSummary();
  }, [activeTab]);

  // Handle Tank History
  const handleViewTankHistory = async (tank: any) => {
    setHistoryTank(tank);
    setLoadingTankHistory(true);
    try {
      const records = await apiFetch<any[]>(`/tanks/${tank.id}/issue-history`);
      setTankHistoryRecords(records);
    } catch (e: any) {
      alert(`Failed to load tank issue history: ${e.message}`);
    } finally {
      setLoadingTankHistory(false);
    }
  };

  // Supplier Save
  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { name: suppName, contact_details: suppContact, address: suppAddr, is_active: true };
      if (editingSupp) {
        await apiFetch(`/suppliers/${editingSupp.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/suppliers', { method: 'POST', body: JSON.stringify(payload) });
      }
      setSuppModal(false);
      setStatusMsg('Supplier saved successfully');
      fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Tank Save
  const handleSaveTank = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { 
        code: tankCode, 
        display_name: tankName, 
        capacity_liters: parseFloat(String(tankCapacity)) || 0,
        location: tankLocation,
        status: tankStatus,
        is_active: tankIsActive 
      };
      if (editingTank) {
        await apiFetch(`/tanks/${editingTank.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/tanks', { method: 'POST', body: JSON.stringify(payload) });
      }
      setTankModal(false);
      setStatusMsg('Production tank saved successfully');
      fetchTanks();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Customer Save
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { 
        code: custCode, 
        name: custName, 
        contact_person: custContact, 
        phone: custPhone, 
        email: custEmail, 
        address: custAddr, 
        gst_number: custGst 
      };
      if (editingCust) {
        await apiFetch(`/customers/${editingCust.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/customers', { method: 'POST', body: JSON.stringify(payload) });
      }
      setCustModal(false);
      setStatusMsg('Customer saved successfully');
      fetchRatesData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggleCustomerStatus = async (cust: any) => {
    try {
      const newStatus = !cust.is_active;
      await apiFetch(`/customers/${cust.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: newStatus })
      });
      fetchRatesData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Part / Rate Save
  const handleSavePart = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { 
        customer_id: partCustomerId,
        part_number: partNumber,
        part_name: partName,
        process_type: partProcess,
        surface_area_sqdm: parseFloat(String(partSurfaceArea)) || 0,
        rate_per_piece: parseFloat(String(partRate)),
        base_unit: partUnit
      };
      if (editingPart) {
        await apiFetch(`/parts/${editingPart.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/parts', { method: 'POST', body: JSON.stringify(payload) });
      }
      setPartModal(false);
      setStatusMsg('Part rate saved successfully');
      fetchRatesData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleTogglePartStatus = async (part: any) => {
    try {
      const newStatus = !part.is_active;
      await apiFetch(`/parts/${part.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: newStatus })
      });
      fetchRatesData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // User Save
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: userEmail, password: userPassword, name: userName, role: userRole }),
      });
      setUserModal(false);
      setStatusMsg('User registered successfully');
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggleUserStatus = async (u: any) => {
    if (u.id === user?.id) {
      alert('You cannot deactivate your own currently active session.');
      return;
    }
    try {
      const newStatus = !u.is_active;
      await apiFetch(`/auth/users/${u.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: newStatus })
      });
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSeedDemoData = async () => {
    if (!confirm('Seed sample demo data ("Demo — Sample Data") into database?')) return;
    try {
      const res = await apiFetch<any>('/seed/demo-data', { method: 'POST' });
      setStatusMsg(res.message);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalScope) return;
    setIsResetting(true);
    setResetError('');
    setResetResult(null);

    try {
      const res = await apiFetch<any>('/backup/reset-test-data', {
        method: 'POST',
        body: JSON.stringify({
          scope: resetModalScope,
          confirmation_text: confirmInput
        })
      });
      setResetResult(res);
      setResetModalScope(null);
      setConfirmInput('');
      fetchResetSummary();
      setStatusMsg(res.message);
    } catch (err: any) {
      setResetError(err.message || 'Reset execution failed.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <SettingsIcon className="w-7 h-7 text-slate-700" />
            System Administration & Masters
          </h2>
          <p className="text-slate-500 text-sm">
            Unified central master registry for Customers, Customer Rates, Tanks, Suppliers, RBAC, and Audit Trails.
          </p>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 bg-teal-50 border border-teal-200 text-teal-900 rounded-xl text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${
              activeTab === 'suppliers' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Truck className="w-4 h-4" /> Suppliers
          </button>
          <button
            onClick={() => setActiveTab('tanks')}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${
              activeTab === 'tanks' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Container className="w-4 h-4" /> Production Tanks
          </button>
          <button
            onClick={() => setActiveTab('rates')}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${
              activeTab === 'rates' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <BadgeIndianRupee className="w-4 h-4" /> Customer Rates & Parts
          </button>
          {(isAdmin || isSuperAdmin) && (
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${
                activeTab === 'users' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Users className="w-4 h-4" /> User RBAC
            </button>
          )}
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${
              activeTab === 'audit' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <ShieldAlert className="w-4 h-4" /> Audit Logs
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${
              activeTab === 'backup' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Database className="w-4 h-4" /> System Backups & Seed
          </button>
        </div>

        {/* Tab 1: Suppliers */}
        {activeTab === 'suppliers' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Chemical Suppliers</h3>
                <p className="text-xs text-slate-500">Approved chemical vendors for purchase orders & direct inwards.</p>
              </div>
              {(isAdmin || isSuperAdmin) && (
                <button
                  onClick={() => {
                    setEditingSupp(null);
                    setSuppName('');
                    setSuppContact('');
                    setSuppAddr('');
                    setSuppModal(true);
                  }}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-4 h-4" /> Add Supplier
                </button>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800">
                  <tr>
                    <th className="p-3">Supplier Name</th>
                    <th className="p-3">Contact Details</th>
                    <th className="p-3">Address</th>
                    <th className="p-3">Status</th>
                    {(isAdmin || isSuperAdmin) && <th className="p-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {suppliers.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{s.name}</td>
                      <td className="p-3 text-slate-700">{s.contact_details || 'N/A'}</td>
                      <td className="p-3 text-slate-600">{s.address || 'N/A'}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-teal-50 text-teal-800 rounded font-semibold text-[10px]">Active</span>
                      </td>
                      {(isAdmin || isSuperAdmin) && (
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setEditingSupp(s);
                              setSuppName(s.name);
                              setSuppContact(s.contact_details || '');
                              setSuppAddr(s.address || '');
                              setSuppModal(true);
                            }}
                            className="p-1 hover:bg-slate-200 rounded text-slate-600"
                            title="Edit Supplier"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {suppliers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-400">No suppliers registered.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Tanks */}
        {activeTab === 'tanks' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                  <span>Production Tanks & Plating Lines</span>
                  <span className="text-xs font-normal text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                    * Tank capacity is bath volume, NOT chemical stock in store
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Production lines receiving FIFO issues. Chemical stock remains in the store ledger until issued.
                </p>
              </div>
              {(isAdmin || isSuperAdmin) && (
                <button
                  onClick={() => {
                    setEditingTank(null);
                    setTankCode('');
                    setTankName('');
                    setTankCapacity(0);
                    setTankLocation('');
                    setTankStatus('ACTIVE');
                    setTankIsActive(true);
                    setTankModal(true);
                  }}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm shrink-0"
                >
                  <Plus className="w-4 h-4" /> Add Production Tank
                </button>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800">
                  <tr>
                    <th className="p-3">Tank Code</th>
                    <th className="p-3">Display Name</th>
                    <th className="p-3">Bath Capacity (L)</th>
                    <th className="p-3">Location / Bay</th>
                    <th className="p-3">Bath Status</th>
                    <th className="p-3">Master State</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {tanks.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-slate-900">{t.code}</td>
                      <td className="p-3 font-semibold text-slate-800">{t.display_name}</td>
                      <td className="p-3 font-mono font-bold text-slate-900">
                        {t.capacity_liters ? `${t.capacity_liters} L` : 'N/A'}
                      </td>
                      <td className="p-3 text-slate-600">{t.location || 'Main Floor'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.status === 'ACTIVE' ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-800'
                        }`}>
                          {t.status || 'ACTIVE'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          onClick={() => handleViewTankHistory(t)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold inline-flex items-center gap-1"
                          title="View Issue Consumption History"
                        >
                          <History className="w-3.5 h-3.5" /> History
                        </button>
                        {(isAdmin || isSuperAdmin) && (
                          <button
                            onClick={() => {
                              setEditingTank(t);
                              setTankCode(t.code);
                              setTankName(t.display_name);
                              setTankCapacity(t.capacity_liters || 0);
                              setTankLocation(t.location || '');
                              setTankStatus(t.status || 'ACTIVE');
                              setTankIsActive(Boolean(t.is_active));
                              setTankModal(true);
                            }}
                            className="p-1 hover:bg-slate-200 rounded text-slate-600"
                            title="Edit Tank Details"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {tanks.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-slate-400">No production tanks configured.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Customer Rates & Parts */}
        {activeTab === 'rates' && (
          <div className="space-y-6">
            
            {/* Customers Master Sub-section */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-teal-700" />
                    Customer Accounts Directory
                  </h3>
                  <p className="text-xs text-slate-500">Commercial plating customers placing job orders.</p>
                </div>
                {(isAdmin || isSuperAdmin) && (
                  <button
                    onClick={() => {
                      setEditingCust(null);
                      setCustCode('');
                      setCustName('');
                      setCustContact('');
                      setCustPhone('');
                      setCustEmail('');
                      setCustAddr('');
                      setCustGst('');
                      setCustModal(true);
                    }}
                    className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm"
                  >
                    <Plus className="w-4 h-4" /> New Customer
                  </button>
                )}
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800 text-xs">
                    <tr>
                      <th className="p-2.5">Code</th>
                      <th className="p-2.5">Customer Name</th>
                      <th className="p-2.5">Contact Person</th>
                      <th className="p-2.5">Phone / Email</th>
                      <th className="p-2.5">GST No</th>
                      <th className="p-2.5">Status</th>
                      {(isAdmin || isSuperAdmin) && <th className="p-2.5 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {customers.map(c => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono font-bold text-slate-900">{c.code}</td>
                        <td className="p-2.5 font-bold text-slate-800">{c.name}</td>
                        <td className="p-2.5 text-slate-600">{c.contact_person || '—'}</td>
                        <td className="p-2.5 text-slate-600">{c.phone || c.email || '—'}</td>
                        <td className="p-2.5 font-mono text-slate-600">{c.gst_number || '—'}</td>
                        <td className="p-2.5">
                          <button
                            onClick={() => (isAdmin || isSuperAdmin) && handleToggleCustomerStatus(c)}
                            disabled={!isAdmin && !isSuperAdmin}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              c.is_active ? 'bg-teal-50 text-teal-800 hover:bg-teal-100' : 'bg-red-50 text-red-800 hover:bg-red-100'
                            }`}
                          >
                            {c.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        {(isAdmin || isSuperAdmin) && (
                          <td className="p-2.5 text-right">
                            <button
                              onClick={() => {
                                setEditingCust(c);
                                setCustCode(c.code);
                                setCustName(c.name);
                                setCustContact(c.contact_person || '');
                                setCustPhone(c.phone || '');
                                setCustEmail(c.email || '');
                                setCustAddr(c.address || '');
                                setCustGst(c.gst_number || '');
                                setCustModal(true);
                              }}
                              className="p-1 hover:bg-slate-200 rounded text-slate-600"
                              title="Edit Customer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {customers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-slate-400">No customers registered.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Customer Rates / Parts Master Sub-section */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <BadgeIndianRupee className="w-5 h-5 text-emerald-700" />
                    Customer Rates & Plating Process Master
                  </h3>
                  <p className="text-xs text-slate-500">Agreed commercial plating rates per piece, surface area, and process varieties.</p>
                </div>
                {(isAdmin || isSuperAdmin) && (
                  <button
                    onClick={() => {
                      if (customers.length === 0) {
                        alert('Please add a Customer first before adding parts/rates.');
                        return;
                      }
                      setEditingPart(null);
                      setPartCustomerId(customers[0]?.id || '');
                      setPartNumber('');
                      setPartName('');
                      setPartProcess('Zinc Plating');
                      setPartSurfaceArea(0);
                      setPartRate('');
                      setPartUnit('nos');
                      setPartModal(true);
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm"
                  >
                    <Plus className="w-4 h-4" /> Add Part / Rate
                  </button>
                )}
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800 text-xs">
                    <tr>
                      <th className="p-2.5">Customer</th>
                      <th className="p-2.5">Part Number</th>
                      <th className="p-2.5">Part Name</th>
                      <th className="p-2.5">Process Variety</th>
                      <th className="p-2.5">Surface Area (dm²)</th>
                      <th className="p-2.5">Agreed Rate (₹)</th>
                      <th className="p-2.5">Unit</th>
                      <th className="p-2.5">Status</th>
                      {(isAdmin || isSuperAdmin) && <th className="p-2.5 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {parts.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-slate-800">{p.customer_name}</td>
                        <td className="p-2.5 font-mono font-bold text-teal-800">{p.part_number}</td>
                        <td className="p-2.5 font-medium text-slate-700">{p.part_name}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded font-semibold text-[10px]">
                            {p.process_type}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-700">{p.surface_area_sqdm || '0'}</td>
                        <td className="p-2.5 font-mono font-bold text-slate-900">₹{p.rate_per_piece.toFixed(2)}</td>
                        <td className="p-2.5 text-slate-600 uppercase text-[11px]">{p.base_unit || 'nos'}</td>
                        <td className="p-2.5">
                          <button
                            onClick={() => (isAdmin || isSuperAdmin) && handleTogglePartStatus(p)}
                            disabled={!isAdmin && !isSuperAdmin}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              p.is_active ? 'bg-teal-50 text-teal-800 hover:bg-teal-100' : 'bg-red-50 text-red-800 hover:bg-red-100'
                            }`}
                          >
                            {p.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        {(isAdmin || isSuperAdmin) && (
                          <td className="p-2.5 text-right">
                            <button
                              onClick={() => {
                                setEditingPart(p);
                                setPartCustomerId(p.customer_id);
                                setPartNumber(p.part_number);
                                setPartName(p.part_name);
                                setPartProcess(p.process_type);
                                setPartSurfaceArea(p.surface_area_sqdm || 0);
                                setPartRate(p.rate_per_piece);
                                setPartUnit(p.base_unit || 'nos');
                                setPartModal(true);
                              }}
                              className="p-1 hover:bg-slate-200 rounded text-slate-600"
                              title="Edit Part / Rate"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {parts.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-4 text-center text-slate-400">No parts or rates registered.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* Tab 4: Users RBAC */}
        {activeTab === 'users' && (isAdmin || isSuperAdmin) && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Three-Account Model & User RBAC</h3>
                <p className="text-xs text-slate-500">
                  Role-based access enforcement: SUPER_ADMIN (Full control), ADMIN (Masters & Approvals), STAFF (Operational Entry).
                </p>
              </div>
              <button
                onClick={() => {
                  setUserEmail('');
                  setUserName('');
                  setUserPassword('');
                  setUserRole('STAFF');
                  setUserModal(true);
                }}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Add User Account
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800">
                  <tr>
                    <th className="p-3">Full Name</th>
                    <th className="p-3">Email Address</th>
                    <th className="p-3">Assigned Role</th>
                    <th className="p-3">Account State</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {usersList.map(u => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{u.name}</td>
                      <td className="p-3 font-mono text-slate-700">{u.email}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-900 border border-purple-200' :
                          u.role === 'ADMIN' ? 'bg-blue-100 text-blue-900 border border-blue-200' :
                          'bg-teal-100 text-teal-900 border border-teal-200'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.is_active ? 'bg-teal-50 text-teal-800' : 'bg-red-50 text-red-800'
                        }`}>
                          {u.is_active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {isSuperAdmin && u.id !== user?.id && (
                          <button
                            onClick={() => handleToggleUserStatus(u)}
                            className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                              u.is_active ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                            }`}
                          >
                            {u.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 5: Audit Trail */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-900 text-lg">System Audit Log</h3>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">User</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Record Ref</th>
                    <th className="p-3">Reason / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-mono">
                  {auditLogs.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="p-3 text-slate-500">{new Date(a.created_at).toLocaleString('en-IN')}</td>
                      <td className="p-3 font-sans font-semibold text-slate-800">{a.user_email || 'System'}</td>
                      <td className="p-3 font-bold text-purple-800">{a.action}</td>
                      <td className="p-3 text-slate-700">{a.record_ref || 'N/A'}</td>
                      <td className="p-3 font-sans text-slate-600 italic">{a.reason || 'N/A'}</td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-400">No audit records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 6: Backup & Seed & Test Reset Controls */}
        {activeTab === 'backup' && (
          <div className="space-y-6">
            
            {/* Database Environment Identity Banner */}
            {resetSummary && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-slate-700" />
                    <span className="font-bold text-slate-900 text-sm">Connected Database & Environment Identity</span>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    resetSummary.eligible ? 'bg-teal-100 text-teal-800 border border-teal-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                  }`}>
                    {resetSummary.eligible ? 'TEST / DEMO RESET ELIGIBLE' : 'RESET DISABLED IN THIS ENV'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <div className="text-slate-400 text-[10px] font-sans">Database Engine</div>
                    <div className="font-bold text-slate-900 mt-0.5">{resetSummary.database_identity?.database_engine}</div>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <div className="text-slate-400 text-[10px] font-sans">Environment Mode</div>
                    <div className="font-bold text-slate-900 mt-0.5">NODE: {resetSummary.database_identity?.node_env}</div>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <div className="text-slate-400 text-[10px] font-sans">Reset Flags</div>
                    <div className="font-bold text-slate-900 mt-0.5">ALLOW_DEMO_RESET={String(resetSummary.database_identity?.allow_demo_reset)}</div>
                  </div>
                </div>

                {!resetSummary.eligible && (
                  <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                    <strong>Notice:</strong> {resetSummary.eligibility_reason}
                  </p>
                )}
              </div>
            )}

            {/* 1. Full Database Export Section */}
            <div className="bg-white p-5 border border-slate-200 rounded-2xl space-y-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Download className="w-5 h-5 text-teal-600" />
                Database Backup & JSON Export
              </h3>
              <p className="text-xs text-slate-500">Download an instant full JSON dump of all factory master tables, transactions, attachments, and audit logs.</p>
              <div className="pt-2">
                <a
                  href="/api/export"
                  download
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow transition-colors"
                >
                  <Download className="w-4 h-4 text-teal-400" /> Export Full JSON Database Backup
                </a>
              </div>
            </div>

            {/* 2. Reusable Test-Data Reset Controls */}
            {isAdmin && (
              <div className="bg-white p-5 border border-slate-200 rounded-2xl space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-purple-700" />
                    Isolated Test Reset Controls
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Clear transactional test data or full test setup cleanly between test runs. Automated verified JSON backups are saved prior to any deletion.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-teal-50/60 border border-teal-200 rounded-xl space-y-3 flex flex-col justify-between">
                    <div>
                      <div className="font-bold text-teal-950 text-sm flex items-center gap-2">
                        <span>Reset Test Transactions</span>
                        <span className="px-2 py-0.5 bg-teal-200 text-teal-900 font-extrabold text-[10px] rounded-full uppercase">Isolated</span>
                      </div>
                      <p className="text-xs text-teal-900 mt-1">
                        Clears all customer orders, inwards, job cards, POs, receipts, lots, issues, and movements.
                      </p>
                      <ul className="text-[11px] text-teal-800 mt-2 space-y-1 list-disc list-inside">
                        <li><strong>Preserves:</strong> Master items, suppliers, tanks, users, rates, audit logs.</li>
                      </ul>
                    </div>

                    <button
                      type="button"
                      disabled={!resetSummary?.eligible}
                      onClick={() => {
                        setConfirmInput('');
                        setResetError('');
                        setResetModalScope('TRANSACTIONS_ONLY');
                      }}
                      className={`w-full py-2.5 px-4 font-bold text-xs rounded-xl transition-colors ${
                        resetSummary?.eligible 
                          ? 'bg-teal-700 hover:bg-teal-800 text-white shadow' 
                          : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      Reset Test Transactions
                    </button>
                  </div>

                  <div className="p-4 bg-red-50/60 border border-red-200 rounded-xl space-y-3 flex flex-col justify-between">
                    <div>
                      <div className="font-bold text-red-950 text-sm flex items-center gap-2">
                        <span>Full Test Reset</span>
                        <span className="px-2 py-0.5 bg-red-200 text-red-900 font-extrabold text-[10px] rounded-full uppercase">Destructive</span>
                      </div>
                      <p className="text-xs text-red-900 mt-1">
                        Clears all transactions PLUS chemical, supplier, and production tank masters.
                      </p>
                      <ul className="text-[11px] text-red-800 mt-2 space-y-1 list-disc list-inside">
                        <li><strong>Preserves:</strong> User login accounts, roles, company settings & audit logs.</li>
                      </ul>
                    </div>

                    <button
                      type="button"
                      disabled={!resetSummary?.eligible}
                      onClick={() => {
                        setConfirmInput('');
                        setResetError('');
                        setResetModalScope('FULL_TEST_RESET');
                      }}
                      className={`w-full py-2.5 px-4 font-bold text-xs rounded-xl transition-colors ${
                        resetSummary?.eligible 
                          ? 'bg-red-700 hover:bg-red-800 text-white shadow' 
                          : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      Full Test Reset
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Demo Sample Data Generator */}
            {isAdmin && (
              <div className="bg-white p-5 border border-slate-200 rounded-2xl space-y-2">
                <h3 className="font-bold text-amber-900 text-base">Demo Sample Data Generator</h3>
                <p className="text-xs text-slate-500">
                  Populate test database with sample chemicals, suppliers, tanks, and lots for demo walkthroughs.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSeedDemoData}
                    className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow transition-colors"
                  >
                    Seed Demo — Sample Data
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* Tank Issue History Modal */}
      {historyTank && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                  <Container className="w-5 h-5 text-teal-600" />
                  Issue History: {historyTank.code} ({historyTank.display_name})
                </h3>
                <p className="text-xs text-slate-500">
                  Bath capacity: {historyTank.capacity_liters || 0} L — Historical FIFO chemical consumption in this tank
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryTank(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingTankHistory ? (
              <div className="py-8 text-center text-xs text-slate-500 font-semibold animate-pulse">
                Loading tank consumption ledger...
              </div>
            ) : tankHistoryRecords.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No chemical issue transactions recorded for this tank yet.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800">
                    <tr>
                      <th className="p-2.5">Date</th>
                      <th className="p-2.5">Issue No</th>
                      <th className="p-2.5">Chemical</th>
                      <th className="p-2.5">Issued Qty</th>
                      <th className="p-2.5">Job Ref</th>
                      <th className="p-2.5">Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tankHistoryRecords.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono text-slate-500">{new Date(r.issue_date).toLocaleDateString()}</td>
                        <td className="p-2.5 font-mono font-bold text-teal-700">{r.issue_number}</td>
                        <td className="p-2.5 font-medium text-slate-800">{r.chemical_name}</td>
                        <td className="p-2.5 font-mono font-bold text-slate-900">{r.required_qty} {r.base_unit}</td>
                        <td className="p-2.5 font-mono text-slate-600">{r.job_reference || '—'}</td>
                        <td className="p-2.5 text-slate-700">{r.issued_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setHistoryTank(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      {suppModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-lg mb-4">{editingSupp ? 'Edit Supplier' : 'Add Chemical Supplier'}</h3>
            <form onSubmit={handleSaveSupplier} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Supplier Name *</label>
                <input type="text" required value={suppName} onChange={e => setSuppName(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Contact Details</label>
                <input type="text" value={suppContact} onChange={e => setSuppContact(e.target.value)} placeholder="+91 98400..." className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Address</label>
                <textarea rows={2} value={suppAddr} onChange={e => setSuppAddr(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setSuppModal(false)} className="px-3 py-2 border rounded-lg text-xs font-bold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white font-bold text-xs rounded-lg">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tank Modal */}
      {tankModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-lg mb-4">{editingTank ? 'Edit Production Tank' : 'Add Production Tank'}</h3>
            <form onSubmit={handleSaveTank} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tank Code *</label>
                <input 
                  type="text" 
                  required 
                  value={tankCode} 
                  onChange={e => setTankCode(e.target.value)} 
                  placeholder="e.g. TANK-NKL-01" 
                  className="w-full p-2 border rounded-lg text-sm font-mono uppercase" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Display Name *</label>
                <input 
                  type="text" 
                  required 
                  value={tankName} 
                  onChange={e => setTankName(e.target.value)} 
                  placeholder="e.g. Tank 1 - Bright Nickel Plating Line" 
                  className="w-full p-2 border rounded-lg text-sm" 
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Bath Capacity (Liters)</label>
                  <input 
                    type="number" 
                    min="0"
                    step="1"
                    value={tankCapacity} 
                    onChange={e => setTankCapacity(e.target.value)} 
                    className="w-full p-2 border rounded-lg text-sm font-mono" 
                  />
                  <span className="text-[10px] text-slate-400">* Bath volume capacity</span>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Location / Bay</label>
                  <input 
                    type="text" 
                    value={tankLocation} 
                    onChange={e => setTankLocation(e.target.value)} 
                    placeholder="Bay 1 / Main Line" 
                    className="w-full p-2 border rounded-lg text-sm" 
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Bath Status</label>
                  <select 
                    value={tankStatus} 
                    onChange={e => setTankStatus(e.target.value)} 
                    className="w-full p-2 border rounded-lg text-sm font-semibold"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="STANDBY">STANDBY</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Master State</label>
                  <select 
                    value={tankIsActive ? '1' : '0'} 
                    onChange={e => setTankIsActive(e.target.value === '1')} 
                    className="w-full p-2 border rounded-lg text-sm font-semibold"
                  >
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setTankModal(false)} className="px-3 py-2 border rounded-lg text-xs font-bold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white font-bold text-xs rounded-lg">Save Tank</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Modal */}
      {custModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-lg mb-4">{editingCust ? 'Edit Customer' : 'Add New Customer'}</h3>
            <form onSubmit={handleSaveCustomer} className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Code *</label>
                  <input 
                    type="text" 
                    required 
                    disabled={!!editingCust}
                    value={custCode} 
                    onChange={e => setCustCode(e.target.value)} 
                    placeholder="CUST-001" 
                    className="w-full p-2 border rounded-lg text-sm font-mono uppercase disabled:bg-slate-100" 
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Customer Name *</label>
                  <input type="text" required value={custName} onChange={e => setCustName(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Contact Person</label>
                  <input type="text" value={custContact} onChange={e => setCustContact(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone</label>
                  <input type="text" value={custPhone} onChange={e => setCustPhone(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
                <input type="email" value={custEmail} onChange={e => setCustEmail(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">GST Number</label>
                <input type="text" value={custGst} onChange={e => setCustGst(e.target.value)} placeholder="33AAAAA0000A1Z5" className="w-full p-2 border rounded-lg text-sm font-mono uppercase" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Billing & Delivery Address</label>
                <textarea rows={2} value={custAddr} onChange={e => setCustAddr(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setCustModal(false)} className="px-3 py-2 border rounded-lg text-xs font-bold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white font-bold text-xs rounded-lg">Save Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Part / Rate Modal */}
      {partModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-lg mb-4">{editingPart ? 'Edit Part / Rate' : 'Add Part & Agreed Rate'}</h3>
            <form onSubmit={handleSavePart} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer *</label>
                <select 
                  required 
                  disabled={!!editingPart}
                  value={partCustomerId} 
                  onChange={e => setPartCustomerId(e.target.value)} 
                  className="w-full p-2 border rounded-lg text-sm font-semibold disabled:bg-slate-100"
                >
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Part Number *</label>
                  <input 
                    type="text" 
                    required 
                    disabled={!!editingPart}
                    value={partNumber} 
                    onChange={e => setPartNumber(e.target.value)} 
                    placeholder="e.g. BRK-PIN-01" 
                    className="w-full p-2 border rounded-lg text-sm font-mono uppercase disabled:bg-slate-100" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Part Name *</label>
                  <input type="text" required value={partName} onChange={e => setPartName(e.target.value)} placeholder="Brake Caliper Pin" className="w-full p-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Process Variety *</label>
                  <input type="text" required value={partProcess} onChange={e => setPartProcess(e.target.value)} placeholder="Bright Zinc Plating" className="w-full p-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Surface Area (dm²)</label>
                  <input type="number" step="0.01" min="0" value={partSurfaceArea} onChange={e => setPartSurfaceArea(e.target.value)} className="w-full p-2 border rounded-lg text-sm font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Agreed Rate (₹/pc) *</label>
                  <input type="number" step="0.01" min="0" required value={partRate} onChange={e => setPartRate(e.target.value)} placeholder="14.50" className="w-full p-2 border rounded-lg text-sm font-mono font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Unit of Measure</label>
                  <input type="text" required value={partUnit} onChange={e => setPartUnit(e.target.value)} placeholder="nos" className="w-full p-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setPartModal(false)} className="px-3 py-2 border rounded-lg text-xs font-bold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-lg">Save Rate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User RBAC Modal */}
      {userModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-lg mb-4">Create Factory User Account</h3>
            <form onSubmit={handleSaveUser} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name *</label>
                <input type="text" required value={userName} onChange={e => setUserName(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address *</label>
                <input type="email" required value={userEmail} onChange={e => setUserEmail(e.target.value)} className="w-full p-2 border rounded-lg text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Login Password *</label>
                <input type="password" required value={userPassword} onChange={e => setUserPassword(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">System Role (Three-Account Model) *</label>
                <select value={userRole} onChange={e => setUserRole(e.target.value as any)} className="w-full p-2 border rounded-lg text-sm font-semibold">
                  <option value="STAFF">STAFF (Storekeeper / Production Floor Operator)</option>
                  <option value="ADMIN">ADMIN (Manager / Master Setup & Approvals)</option>
                  {isSuperAdmin && (
                    <option value="SUPER_ADMIN">SUPER_ADMIN (Managing Director / Full Control)</option>
                  )}
                </select>
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setUserModal(false)} className="px-3 py-2 border rounded-lg text-xs font-bold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white font-bold text-xs rounded-lg">Create Account</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {resetModalScope && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                <ShieldAlert className={`w-6 h-6 ${resetModalScope === 'FULL_TEST_RESET' ? 'text-red-600' : 'text-teal-600'}`} />
                Confirm {resetModalScope === 'FULL_TEST_RESET' ? 'Full Test Reset' : 'Test Transactions Reset'}
              </h3>
              <button
                type="button"
                onClick={() => setResetModalScope(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs font-mono space-y-1">
              <div className="text-slate-500 font-sans font-bold">Target Database & Scope</div>
              <div>Database: <span className="font-bold text-slate-900">{resetSummary?.database_identity?.database_engine}</span></div>
              <div>Environment: <span className="font-bold text-slate-900">TEST / DEMO (ALLOW_DEMO_RESET=true)</span></div>
            </div>

            <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-teal-600" /> Preserved System Items:
              </div>
              <p>
                {resetModalScope === 'TRANSACTIONS_ONLY' 
                  ? 'Customer Masters, Parts, Chemical Masters, Suppliers, Production Tanks, User Accounts, Password Hashes, Roles, and Audit Logs.' 
                  : 'User Accounts, Roles, Login Password Hashes, Company Settings, and Administrative Audit Logs.'}
              </p>
            </div>

            <form onSubmit={handleExecuteReset} className="space-y-3 pt-2 border-t">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Type <span className="font-mono text-red-700 select-all">{resetModalScope === 'FULL_TEST_RESET' ? 'RESET ALL TEST DATA' : 'RESET TEST TRANSACTIONS'}</span> to confirm:
                </label>
                <input
                  type="text"
                  required
                  value={confirmInput}
                  onChange={e => setConfirmInput(e.target.value)}
                  placeholder={resetModalScope === 'FULL_TEST_RESET' ? 'RESET ALL TEST DATA' : 'RESET TEST TRANSACTIONS'}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalScope(null)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isResetting ||
                    (resetModalScope === 'FULL_TEST_RESET' && confirmInput !== 'RESET ALL TEST DATA') ||
                    (resetModalScope === 'TRANSACTIONS_ONLY' && confirmInput !== 'RESET TEST TRANSACTIONS')
                  }
                  className={`px-5 py-2 text-white font-bold text-xs rounded-xl shadow transition-colors ${
                    isResetting || 
                    (resetModalScope === 'FULL_TEST_RESET' && confirmInput !== 'RESET ALL TEST DATA') ||
                    (resetModalScope === 'TRANSACTIONS_ONLY' && confirmInput !== 'RESET TEST TRANSACTIONS')
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : resetModalScope === 'FULL_TEST_RESET' ? 'bg-red-700 hover:bg-red-800' : 'bg-teal-700 hover:bg-teal-800'
                  }`}
                >
                  {isResetting ? 'Verifying Backup & Executing Reset...' : 'Confirm & Execute Reset'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
