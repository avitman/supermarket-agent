import { Routes, Route, NavLink } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import PricesPage from './pages/PricesPage';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
          <span className="font-bold text-orange-500 text-base flex items-center gap-2">
            🛒 <span>בול מרקט</span>
          </span>
          <div className="flex gap-1">
            {[
              { to: '/',        label: 'לוח בקרה' },
              { to: '/orders',  label: 'הזמנות' },
              { to: '/prices',  label: 'השוואת מחירים' },
            ].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-orange-50 text-orange-600'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        <Routes>
          <Route path="/"            element={<DashboardPage />} />
          <Route path="/orders"      element={<OrdersPage />} />
          <Route path="/orders/:id"  element={<OrderDetailPage />} />
          <Route path="/prices"      element={<PricesPage />} />
        </Routes>
      </main>
    </div>
  );
}
