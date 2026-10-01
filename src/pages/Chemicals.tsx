import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit3, Trash2, Lock, AlertCircle, CheckCircle2, ShieldAlert, Power } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QuantityBadge } from '../components/QuantityBadge';

export const Chemicals: React.FC = () => {
  const { canPost } = useAuth();
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  
  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingChemical, setEditingChemical] = useState<any | null>(null);

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingChemical, setDeletingChemical] = useState<any | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteCanDeactivate, setDeleteCanDeactivate] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [baseUnit, setBaseUnit] = useState('kg');
  const [minStockLevel, setMinStockLevel] = useState('0');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const fetchChemicals = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any[]>('/chemicals');
      setChemicals(data);
    } catch (err) {
      console.error('Failed to load chemicals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChemicals();
  }, []);

  const handleOpenModal = (chem?: any) => {
    setFormError('');
    setActionSuccessMessage(null);
    if (chem) {
      setEditingChemical(chem);
      setCode(chem.code);
      setName(chem.name);
      setBaseUnit(chem.base_unit);
      setMinStockLevel(chem.min_stock_level.toString());
      setDescription(chem.description || '');
      setIsActive(Boolean(chem.is_active));
    } else {
      setEditingChemical(null);
      setCode('');
      setName('');
      setBaseUnit('kg');
      setMinStockLevel('0');
      setDescription('');
      setIsActive(true);
    }
    setModalOpen(true);
  };

  const handleOpenDeleteModal = (chem: any) => {
    setDeletingChemical(chem);
    setDeleteError(null);
    setDeleteCanDeactivate(false);
    setDeleteModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      const payload = {
        code,
        name,
 base_unit: baseUnit,
        min_stock_level: parseFloat(minStockLevel) || 0,
        description,
        is_active: isActive,
      };

      if (editingChemical) {
        await apiFetch(`/chemicals/${editingChemical.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setActionSuccessMessage(`Chemical "${code}" updated successfully.`);
      } else {
        await apiFetch('/chemicals', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setActionSuccessMessage(`Chemical "${code}" created successfully.`);
      }

      setModalOpen(false);
      fetchChemicals();
    } catch (err: any) {
      setFormError(err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingChemical) return;
    setDeleteError(null);
    setDeleteCanDeactivate(false);
    setSubmitting(true);

    try {
      const res = await apiFetch<{ message: string }>(`/chemicals/${deletingChemical.id}`, {
        method: 'DELETE',
      });

      setActionSuccessMessage(res.message || `Chemical "${deletingChemical.code}" deleted successfully.`);
      setDeleteModalOpen(false);
      setDeletingChemical(null);
      fetchChemicals();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete chemical');
      if (err.message && err.message.includes('Inact')) {
        setDeleteCanDeactivate(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleMakeInactive = async () => {
    if (!deletingChemical) return;
    setSubmitting(true);

    try {
      await apiFetch(`/chemicals/${deletingChemical.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...deletingChemical,
          is_active: false,
        }),
      });

      setActionSuccessMessage(`Chemical "${deletingChemical.code} - ${deletingChemical.name}" set to Inactive.`);
      setDeleteModalOpen(false);
      setDeletingChemical(null);
      fetchChemicals();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to update chemical status');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActiveStatus = async (chem: any) => {
    const newStatus = !chem.is_active;
    try {
      await apiFetch(`/chemicals/${chem.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...chem,
          is_active: newStatus,
        }),
      });
      setActionSuccessMessage(`Chemical "${chem.code}" marked as ${newStatus ? 'Active' : 'Inactive'}.`);
      fetchChemicals();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  const filtered = chemicals.filter(c => {
    const matchesSearch = c.code.toLowerCase().includes(search.toLowerCase()) ||
                          c.name.toLowerCase().includes(search.toLowerCase());
    if (statusFilter === 'active') return matchesSearch && c.is_active;
    if (statusFilter === 'inactive') return matchesSearch && !c.is_active;
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Chemical Master</h2>
          <p className="text-slate-500 text-sm">Configure raw plating chemicals, units, and safety buffer thresholds.</p>
        </div>
        {canPost && (
          <button
            onClick={() => handleOpenModal()}
            className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow transition-colors flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span>Add New Chemical</span>
          </button>
        )}
      </div>

      {actionSuccessMessage && (
        <div className="p-4 bg-teal-50 border border-teal-200 text-teal-900 rounded-xl font-semibold flex items-center gap-3 shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" />
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Search */}
        <div className="flex items-center gap-3 w-full sm:w-80 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search code or name..."
            className="w-full text-sm bg-transparent border-none text-slate-900 focus:outline-none placeholder-slate-400"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Chemicals ({chemicals.length})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              statusFilter === 'active' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-teal-700'
            }`}
          >
            Active ({chemicals.filter(c => c.is_active).length})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('inactive')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              statusFilter === 'inactive' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Inactive ({chemicals.filter(c => !c.is_active).length})
          </button>
        </div>

      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-900 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-4">Chemical Code</th>
                <th className="p-4">Name</th>
                <th className="p-4">Base Unit</th>
                <th className="p-4">Available Stock</th>
                <th className="p-4">Min Stock Level</th>
                <th className="p-4">Status</th>
                {canPost && <th className="p-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">Loading chemicals...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">No chemicals found for status "{statusFilter}".</td>
                </tr>
              ) : (
                filtered.map(chem => (
                  <tr key={chem.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-900">{chem.code}</td>
                    <td className="p-4 font-semibold text-slate-900">
                      <div>{chem.name}</div>
                      {chem.description && <div className="text-xs text-slate-500 font-normal">{chem.description}</div>}
                    </td>
                    <td className="p-4 font-mono uppercase font-bold text-slate-700">
                      <span className="px-2 py-1 bg-slate-100 rounded text-xs border border-slate-200">
                        {chem.base_unit}
                      </span>
                    </td>
                    <td className="p-4">
                      <QuantityBadge
                        value={chem.total_available}
                        unit={chem.base_unit}
                        bold
                        className={chem.is_low_stock ? 'text-amber-600 font-bold' : 'text-slate-900'}
                      />
                      {chem.is_low_stock && (
                        <div className="text-[10px] text-amber-600 font-bold flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3" /> LOW STOCK
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <QuantityBadge value={chem.min_stock_level} unit={chem.base_unit} />
                    </td>
                    <td className="p-4">
                      {chem.is_active ? (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                          Active
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                          Inactive
                        </span>
                      )}
                    </td>
                    {canPost && (
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          
                          <button
                            type="button"
                            onClick={() => handleOpenModal(chem)}
                            className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-teal-700 bg-slate-100 hover:bg-teal-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5"
                            title="Edit chemical attributes"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenDeleteModal(chem)}
                            className="px-3 py-1.5 text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors flex items-center gap-1.5"
                            title="Delete chemical master"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            <span>Delete</span>
                          </button>

                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && deletingChemical && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                Confirm Chemical Deletion
              </h3>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="text-sm text-slate-700 space-y-2">
              <p>
                Are you sure you want to delete chemical:
              </p>
              <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl font-mono font-bold text-slate-900">
                {deletingChemical.code} - {deletingChemical.name}
              </div>
              <p className="text-xs text-slate-500">
                Permanent deletion is allowed only if the chemical has zero stock and no linked lots or transactions.
              </p>
            </div>

            {deleteError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl space-y-2">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <span>Deletion Blocked</span>
                </div>
                <p>{deleteError}</p>
                {deleteCanDeactivate && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleMakeInactive}
                      disabled={submitting}
                      className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>Set "{deletingChemical.code}" to Inactive Instead</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow transition-colors disabled:opacity-50"
              >
                {submitting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Create / Edit Modal Dialog */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-xl font-bold text-slate-900">
                {editingChemical ? `Edit Chemical: ${editingChemical.code}` : 'Add New Chemical'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
            </div>

            {formError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Chemical Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="e.g. CHEM-NIC-001"
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Chemical Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Nickel Sulfate Hexahydrate"
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Base Unit <span className="text-red-500">*</span>
                  </label>
                  {editingChemical && parseFloat(editingChemical.total_available || '0') > 0 ? (
                    <div className="relative">
                      <input
                        type="text"
                        disabled
                        value={baseUnit}
                        className="w-full min-h-[44px] px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg font-mono font-bold text-slate-500 cursor-not-allowed"
                      />
                      <span title="Unit locked due to existing stock history" className="absolute right-3 top-3 text-slate-400">
                        <Lock className="w-4 h-4" />
                      </span>
                    </div>
                  ) : (
                    <select
                      value={baseUnit}
                      onChange={e => setBaseUnit(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                    >
                      <option value="kg">kg (Kilogram)</option>
                      <option value="L">L (Litre)</option>
                      <option value="nos">nos (Pieces/Units)</option>
                      <option value="m">m (Metre)</option>
                      <option value="sets">sets (Sets)</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Min Stock Threshold
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={minStockLevel}
                    onChange={e => setMinStockLevel(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Description / Safety Notes</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Bath concentration specs, hazardous storage requirements..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none text-sm"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                />
                <label htmlFor="isActive" className="text-sm font-semibold text-slate-800">
                  Active (Available for purchase & issues)
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingChemical ? 'Update Chemical' : 'Save Chemical'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
