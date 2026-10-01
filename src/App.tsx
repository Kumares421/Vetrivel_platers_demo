import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Chemicals } from './pages/Chemicals';
import { ReceiveChemical } from './pages/ReceiveChemical';
import { IssueChemical } from './pages/IssueChemical';
import { Stock } from './pages/Stock';
import { Reports } from './pages/Reports';
import { OpeningStock } from './pages/OpeningStock';
import { Settings } from './pages/Settings';
import { CustomerOrders } from './pages/CustomerOrders';
import { PartsInward } from './pages/PartsInward';
import { JobCards } from './pages/JobCards';
import { ChemicalPOs } from './pages/ChemicalPOs';
import { Production } from './pages/Production';
import { QC } from './pages/QC';
import { Dispatch } from './pages/Dispatch';
import { Invoices } from './pages/Invoices';
import { Payments } from './pages/Payments';
import { Traceability } from './pages/Traceability';
import { ProductionPlanning } from './pages/ProductionPlanning';

const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [traceOrderId, setTraceOrderId] = useState<string | undefined>();
  const [traceJobCardId, setTraceJobCardId] = useState<string | undefined>();

  const handleNavigateWithTrace = (tab: string, orderId?: string, jobCardId?: string) => {
    if (orderId) setTraceOrderId(orderId);
    if (jobCardId) setTraceJobCardId(jobCardId);
    setActiveTab(tab);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center text-teal-400 font-bold text-2xl animate-pulse mb-3">
          VP
        </div>
        <div className="text-sm font-bold text-slate-800">Loading Vetrivel Platers Portal...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'dashboard' && <Dashboard onNavigate={setActiveTab} />}
        {activeTab === 'traceability' && (
          <Traceability 
            initialOrderId={traceOrderId} 
            initialJobCardId={traceJobCardId} 
            onNavigate={setActiveTab} 
          />
        )}
        {activeTab === 'customer-orders' && <CustomerOrders onTrace={(id) => handleNavigateWithTrace('traceability', id)} />}
        {activeTab === 'parts-inward' && <PartsInward />}
        {activeTab === 'job-cards' && <JobCards onTrace={(id) => handleNavigateWithTrace('traceability', undefined, id)} />}
        {activeTab === 'production-planning' && (
          <ProductionPlanning 
            onTrace={(id) => handleNavigateWithTrace('traceability', undefined, id)} 
            onNavigateToProduction={(id) => setActiveTab('production')}
          />
        )}
        {activeTab === 'production' && <Production />}
        {activeTab === 'qc' && <QC />}
        {activeTab === 'dispatch' && <Dispatch />}
        {activeTab === 'invoices' && <Invoices />}
        {activeTab === 'payments' && <Payments />}
        {activeTab === 'chemical-pos' && <ChemicalPOs />}
        {activeTab === 'chemicals' && <Chemicals />}
        {activeTab === 'receive' && <ReceiveChemical />}
        {activeTab === 'issue' && <IssueChemical />}
        {activeTab === 'stock' && <Stock />}
        {activeTab === 'reports' && <Reports />}
        {activeTab === 'opening-stock' && <OpeningStock />}
        {activeTab === 'settings' && <Settings onNavigate={setActiveTab} />}
      </main>

      <footer className="bg-white border-t border-slate-200 py-4 print:hidden">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <b>Vetrivel Platers</b> — Chemical Inventory & FIFO Management System
          </div>
          <div>
            Powered by <b>Qelanto Technologies</b>
          </div>
        </div>
      </footer>
    </div>
  );
};

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
