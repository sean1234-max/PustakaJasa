import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppStateProvider } from './state/AppState';
import { useAppState } from './state/useAppState';
import RequireRole from './components/RequireRole';
import Login from './pages/Login';
import NewOrderStep1 from './pages/NewOrderStep1';
import NewOrderStep2 from './pages/NewOrderStep2';
import Cart from './pages/Cart';
import Success from './pages/Success';
import Dashboard from './pages/Dashboard';
import OrderDetails from './pages/OrderDetails';
import Amend from './pages/Amend';
import AmendSummary from './pages/AmendSummary';
import AddOn from './pages/AddOn';
import AddOnSummary from './pages/AddOnSummary';
import SalesDashboard from './pages/SalesDashboard';
import SalesOrderSummary from './pages/SalesOrderSummary';
import ProductionDashboard from './pages/ProductionDashboard';
import ProductionOrderDetail from './pages/ProductionOrderDetail';
import ProductionCatalog from './pages/ProductionCatalog';
import InvoicingDashboard from './pages/InvoicingDashboard';
import InvoicingOrderDetail from './pages/InvoicingOrderDetail';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsers from './pages/AdminUsers';
import AdminSchools from './pages/AdminSchools';
import AdminSchoolDetail from './pages/AdminSchoolDetail';
import AdminSalesmen from './pages/AdminSalesmen';
import AdminSalesmanDetail from './pages/AdminSalesmanDetail';
import AdminOrders from './pages/AdminOrders';
import AdminOrderDetail from './pages/AdminOrderDetail';
import AdminCatalog from './pages/AdminCatalog';
import AdminAuditLog from './pages/AdminAuditLog';

// Supabase's session lives in localStorage and survives a refresh on its
// own, but the app's role/sekolah/etc. state doesn't — AppState restores
// it asynchronously on mount. Routes (and RequireRole's redirect-to-login)
// must wait for that check, or a refresh on e.g. /dashboard would bounce
// straight to Login before the still-valid session had a chance to load.
function AppRoutes() {
  const { state } = useAppState();
  if (!state.sessionChecked) {
    return <div className="screen-center" style={{ textAlign: 'center', opacity: 0.6 }}>Loading…</div>;
  }
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />

      <Route path="/order/step1" element={<RequireRole role="teacher"><NewOrderStep1 /></RequireRole>} />
      <Route path="/order/step2" element={<RequireRole role="teacher"><NewOrderStep2 /></RequireRole>} />
      <Route path="/cart" element={<RequireRole role="teacher"><Cart /></RequireRole>} />
      <Route path="/success" element={<RequireRole role="teacher"><Success /></RequireRole>} />
      <Route path="/dashboard" element={<RequireRole role="teacher"><Dashboard /></RequireRole>} />
      <Route path="/orders/:id" element={<RequireRole role="teacher"><OrderDetails /></RequireRole>} />
      <Route path="/amend/:id" element={<RequireRole role="teacher"><Amend /></RequireRole>} />
      <Route path="/amend/:id/summary" element={<RequireRole role="teacher"><AmendSummary /></RequireRole>} />
      <Route path="/addon/:id" element={<RequireRole role="teacher"><AddOn /></RequireRole>} />
      <Route path="/addon/:id/summary" element={<RequireRole role="teacher"><AddOnSummary /></RequireRole>} />

      <Route path="/sales/dashboard" element={<RequireRole role="salesman"><SalesDashboard /></RequireRole>} />
      <Route path="/sales/orders/:id" element={<RequireRole role="salesman"><SalesOrderSummary /></RequireRole>} />

      <Route path="/production/dashboard" element={<RequireRole role="production"><ProductionDashboard /></RequireRole>} />
      <Route path="/production/orders/:id" element={<RequireRole role="production"><ProductionOrderDetail /></RequireRole>} />
      <Route path="/production/catalog" element={<RequireRole role="production"><ProductionCatalog /></RequireRole>} />

      <Route path="/invoicing/dashboard" element={<RequireRole role="invoicing"><InvoicingDashboard /></RequireRole>} />
      <Route path="/invoicing/orders/:id" element={<RequireRole role="invoicing"><InvoicingOrderDetail /></RequireRole>} />

      <Route path="/admin/dashboard" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
      <Route path="/admin/users" element={<RequireRole role="admin"><AdminUsers /></RequireRole>} />
      <Route path="/admin/schools" element={<RequireRole role="admin"><AdminSchools /></RequireRole>} />
      <Route path="/admin/schools/:id" element={<RequireRole role="admin"><AdminSchoolDetail /></RequireRole>} />
      <Route path="/admin/salesmen" element={<RequireRole role="admin"><AdminSalesmen /></RequireRole>} />
      <Route path="/admin/salesmen/:id" element={<RequireRole role="admin"><AdminSalesmanDetail /></RequireRole>} />
      <Route path="/admin/orders" element={<RequireRole role="admin"><AdminOrders /></RequireRole>} />
      <Route path="/admin/orders/:id" element={<RequireRole role="admin"><AdminOrderDetail /></RequireRole>} />
      <Route path="/admin/catalog" element={<RequireRole role="admin"><AdminCatalog /></RequireRole>} />
      <Route path="/admin/audit-log" element={<RequireRole role="admin"><AdminAuditLog /></RequireRole>} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <HashRouter>
        <div className="app-shell">
          <AppRoutes />
        </div>
      </HashRouter>
    </AppStateProvider>
  );
}
