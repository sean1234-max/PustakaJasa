import { Navigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';

// Keeps a teacher from landing on Sales pages via a typed URL (and vice
// versa) — bounces back to Login when the session's role doesn't match.
export default function RequireRole({ role, children }) {
  const { state } = useAppState();
  if (state.role !== role) return <Navigate to="/login" replace />;
  return children;
}
