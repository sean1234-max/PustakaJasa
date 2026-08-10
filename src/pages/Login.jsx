import { useNavigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';

const ROLE_HOME = { teacher: '/dashboard', salesman: '/sales/dashboard', production: '/production/dashboard' };

export default function Login() {
  const { state, patch, login } = useAppState();
  const navigate = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    const role = login(state.userId, state.password);
    if (role) navigate(ROLE_HOME[role]);
  };

  return (
    <div className="screen-center" style={{ maxWidth: 400 }}>
      <form className="card elev-md" style={{ padding: 'var(--space-8) var(--space-6)' }} onSubmit={submit}>
        <div className="login-header">
          <div className="login-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
          </div>
          <div className="login-title">School Portal</div>
          <div className="login-subtitle">Event Ordering System</div>
        </div>

        <div className="field">
          <label htmlFor="userId">User ID</label>
          <input className="input" id="userId" placeholder="Enter your user ID" value={state.userId} onChange={(e) => patch({ userId: e.target.value })} />
        </div>
        <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
          <label htmlFor="password">Password</label>
          <input className="input" id="password" type="password" placeholder="Enter your password" value={state.password} onChange={(e) => patch({ password: e.target.value })} />
        </div>

        {state.loginError && <div className="login-error">{state.loginError}</div>}

        <button type="submit" className="btn btn-primary btn-block">Log In</button>
        <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <a href="#forgot" onClick={(e) => e.preventDefault()}>Forgot password?</a>
        </div>
      </form>
    </div>
  );
}
