import { Navigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';

// Keeps a teacher from landing on Sales pages via a typed URL (and vice
// versa) — bounces back to Login when the session's role doesn't match.
// `role` accepts a single role or an array — an array lets a page (e.g.
// Production's catalog/reference-image screens) be shared with Admin
// without duplicating the route or the component.
export default function RequireRole({ role, children }) {
  const { state } = useAppState();
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(state.role)) return <Navigate to="/login" replace />;
  return children;
}
