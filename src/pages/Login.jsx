import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';

const ROLE_HOME = { teacher: '/dashboard', salesman: '/sales/dashboard', production: '/production/dashboard', admin: '/admin/dashboard' };

export default function Login() {
  const { state, patch, login } = useAppState();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const role = await login(state.userId, state.password);
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
          <div className="password-field-wrap">
            <input
              className="input"
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={state.password}
              onChange={(e) => patch({ password: e.target.value })}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.4 18.4 0 0 1 4.22-5.19M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s3-8 11-8 11 8 11 8-3 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
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
