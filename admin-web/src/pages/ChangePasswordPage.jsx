import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Mandatory first-login password change for any account whose password was
// system-generated rather than chosen by the user (currently: every bulk-imported
// surveyor — see surveyorImportService.js). RequireAuth redirects here and blocks every
// other route until this succeeds; reuses the existing POST /api/auth/change-password.
export default function ChangePasswordPage({ mandatory = true }) {
  const { user, clearForcePasswordChange, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      clearForcePasswordChange();
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    // Full reload so the rest of the app picks up the updated user/flag cleanly.
    window.location.href = '/';
    return null;
  }

  return (
    <div className="login-shell">
      <form className="login-box" onSubmit={handleSubmit} style={{ width: 380 }}>
        <h1><KeyRound size={18} style={{ verticalAlign: -3, marginRight: 8 }} />Set Your Password</h1>
        {mandatory && (
          <p className="help-text" style={{ marginBottom: 14 }}>
            Your account was created with a temporary password{user?.name ? ` for ${user.name}` : ''}. Set your own password to continue.
          </p>
        )}
        <div className="form-row">
          <label>Current (temporary) password</label>
          <input value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} type="password" required />
        </div>
        <div className="form-row">
          <label>New password</label>
          <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" required minLength={8} />
        </div>
        <div className="form-row">
          <label>Confirm new password</label>
          <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" required minLength={8} />
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Saving...' : 'Set Password'}
        </button>
        {!mandatory && (
          <button type="button" className="secondary sm" style={{ width: '100%', marginTop: 8 }} onClick={() => window.history.back()}>
            Cancel
          </button>
        )}
        {mandatory && (
          <button type="button" className="secondary sm" style={{ width: '100%', marginTop: 8 }} onClick={logout}>
            Log out instead
          </button>
        )}
      </form>
    </div>
  );
}
