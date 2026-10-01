import React, { useState } from 'react';
import { 
  LayoutDashboard, ShoppingCart, PackageCheck, Layers, Factory, ShieldCheck, Truck, Receipt, CreditCard,
  FileText, FlaskConical, ArrowDownToLine, ArrowUpFromLine, 
  Boxes, FileSpreadsheet, Settings, LogOut, Menu, X, Network, CalendarClock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const { user, isAdmin, isSuperAdmin, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Connected ERP Business Flow Navigation Items
  const allNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, minRole: 'STAFF' },
    { id: 'customer-orders', label: 'Customer Orders', icon: ShoppingCart, minRole: 'STAFF' },
    { id: 'parts-inward', label: 'Parts Inward', icon: PackageCheck, minRole: 'STAFF' },
    { id: 'job-cards', label: 'Job Cards', icon: Layers, minRole: 'STAFF' },
    { id: 'production-planning', label: 'Production Planning', icon: CalendarClock, minRole: 'STAFF' },
    { id: 'traceability', label: 'Traceability', icon: Network, minRole: 'STAFF' },
    { id: 'production', label: 'Production', icon: Factory, minRole: 'STAFF' },
    { id: 'qc', label: 'QC Inspection', icon: ShieldCheck, minRole: 'STAFF' },
    { id: 'dispatch', label: 'Dispatch', icon: Truck, minRole: 'STAFF' },
    { id: 'invoices', label: 'Invoices', icon: Receipt, minRole: 'STAFF' },
    { id: 'payments', label: 'Payments', icon: CreditCard, minRole: 'STAFF' },
    { id: 'chemical-pos', label: 'Chemical PO', icon: FileText, minRole: 'STAFF' },
    { id: 'receive', label: 'Receive Chem', icon: ArrowDownToLine, minRole: 'STAFF' },
    { id: 'issue', label: 'Issue (FIFO)', icon: ArrowUpFromLine, minRole: 'STAFF' },
    { id: 'stock', label: 'Stock & Lots', icon: Boxes, minRole: 'STAFF' },
    { id: 'reports', label: 'Reports', icon: FileSpreadsheet, minRole: 'STAFF' },
    { id: 'settings', label: 'Settings', icon: Settings, minRole: 'ADMIN' },
  ];

  // Role-specific filtering
  const visibleNavItems = allNavItems.filter(item => {
    if (item.minRole === 'ADMIN') {
      return isAdmin || isSuperAdmin;
    }
    return true;
  });

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm print:hidden">
      {/* Top Header Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Company & Brand */}
          <div className="flex items-center gap-3 cursor-pointer shrink-0" onClick={() => setActiveTab('dashboard')}>
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-teal-400 font-bold text-xl shadow">
              VP
            </div>
            <div className="hidden sm:block">
              <h1 className="text-base font-bold text-slate-900 leading-tight">Vetrivel Platers</h1>
              <p className="text-[11px] text-slate-500 font-medium">ERP & FIFO Chemical Stores</p>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden xl:flex items-center space-x-1 overflow-x-auto py-1">
            {visibleNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Tablet Compact Nav dropdown or scrollable */}
          <nav className="hidden lg:flex xl:hidden items-center space-x-1">
            {visibleNavItems.slice(0, 6).map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors whitespace-nowrap ${
                    isActive ? 'bg-teal-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="px-2 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              More...
            </button>
          </nav>

          {/* User Profile & Logout */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="text-xs font-bold text-slate-900 leading-tight">{user?.name}</div>
              <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black tracking-wider uppercase ${
                user?.role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-900 border border-purple-200' :
                user?.role === 'ADMIN' ? 'bg-blue-100 text-blue-900 border border-blue-200' :
                'bg-teal-100 text-teal-900 border border-teal-200'
              }`}>
                {user?.role}
              </span>
            </div>
            <button
              onClick={logout}
              title="Logout session"
              className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-700 hover:bg-slate-100"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white px-4 pt-2 pb-4 space-y-1 shadow-lg">
          <div className="p-2 mb-2 bg-slate-50 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-slate-900">{user?.name}</div>
              <div className="text-[10px] font-bold text-teal-700 uppercase">{user?.role}</div>
            </div>
            <button
              onClick={logout}
              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-bold flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>

          {visibleNavItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition-colors ${
                  isActive
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
