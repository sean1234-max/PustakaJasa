import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';

export default function Nav() {
  const { state, logout } = useAppState();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const cartCount = state.cart.length;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (state.role === 'salesman') {
    return (
      <nav className="nav">
        <span className="nav-brand">Sales Portal</span>
        <Link to="/sales/dashboard" aria-current={pathname === '/sales/dashboard' ? 'page' : undefined}>Orders</Link>
        <button type="button" className="nav-logout" onClick={handleLogout}>Log Out</button>
      </nav>
    );
  }

  return (
    <nav className="nav">
      <span className="nav-brand">School Portal</span>
      <Link to="/order/step1" aria-current={pathname.startsWith('/order') ? 'page' : undefined}>New Order</Link>
      <Link to="/dashboard" aria-current={pathname === '/dashboard' ? 'page' : undefined}>My Orders</Link>
      <Link to="/cart" className="nav-cart" aria-label="Cart">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" />
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
        </svg>
        {cartCount > 0 && <span className="nav-cart-badge">{cartCount}</span>}
      </Link>
      <button type="button" className="nav-logout" onClick={handleLogout}>Log Out</button>
    </nav>
  );
}
