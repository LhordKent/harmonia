import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { validateNewPassword } from "../firebase/accountsService";

/**
 * The only screen a pending account can use: change password, recover by email, or sign out.
 * It is rendered in place of every protected route, so refreshes and direct links cannot skip it.
 */
export const AccountSetup = () => {
  const { currentUser, authState, changePassword, resetPassword, refreshProfile, logout } = useAuth();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const enrollment = authState === "enrollmentRequired";

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validateNewPassword({ currentPassword, newPassword, confirmPassword });
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const session = await changePassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      if (session?.state === "ready") showToast("Password changed. Your account is ready.", "success");
    } catch (err) {
      setError(err.message || "Your password could not be changed. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true); setError("");
    try {
      await resetPassword(currentUser.email);
      setResetSent(true);
    } catch (err) {
      setError(err.message || "The reset email could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckAgain = async () => {
    setBusy(true); setError("");
    try {
      const session = await refreshProfile();
      if (session?.state === "passwordChangeRequired") {
        setError("We could not confirm a new password yet. If you used the email link, sign out and sign in with your new password.");
      }
    } catch (err) {
      setError(err.message || "Your account could not be checked.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrapper d-flex justify-content-center align-items-center min-vh-100 px-3">
      <div className="harmonia-card p-4 fade-in" style={{ maxWidth: 460, width: "100%" }}>
        <div className="d-flex align-items-center gap-2 mb-2">
          <i className={`bi ${enrollment ? "bi-building-exclamation" : "bi-shield-lock-fill"} fs-3 text-primary`}></i>
          <h4 className="text-white mb-0">{enrollment ? "School enrollment required" : "Finish account setup"}</h4>
        </div>
        <p className="text-muted-custom" style={{ fontSize: "0.9rem" }}>
          Signed in as <strong className="text-white">{currentUser?.email}</strong>.
        </p>

        {enrollment ? (
          <p className="text-muted-custom">
            Your account is not assigned to a school yet. Contact your school administrator; you can use Harmonia once they enroll you.
          </p>
        ) : (
          <>
            <p className="text-muted-custom" style={{ fontSize: "0.9rem" }}>
              Choose your own password before using Harmonia. It must have at least 8 characters and differ from your
              current password and your school's base password.
            </p>
            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-3">
                <label className="harmonia-label" htmlFor="setup-current">Current password</label>
                <input id="setup-current" type="password" autoComplete="current-password" className="harmonia-input"
                  value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={busy} />
              </div>
              <div className="mb-3">
                <label className="harmonia-label" htmlFor="setup-new">New password</label>
                <input id="setup-new" type="password" autoComplete="new-password" className="harmonia-input"
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={busy} />
              </div>
              <div className="mb-3">
                <label className="harmonia-label" htmlFor="setup-confirm">Confirm new password</label>
                <input id="setup-confirm" type="password" autoComplete="new-password" className="harmonia-input"
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={busy} />
              </div>
              {error && <div className="alert alert-danger py-2" role="alert" style={{ fontSize: "0.85rem" }}>{error}</div>}
              <button type="submit" className="btn btn-harmonia w-100 py-2" disabled={busy}>
                {busy ? "Working…" : "Change password"}
              </button>
            </form>
            <hr className="border-secondary border-opacity-25" />
            <p className="text-muted-custom mb-2" style={{ fontSize: "0.85rem" }}>
              Forgot your current password? We can email a reset link to {currentUser?.email}. After resetting, sign in with the new password.
            </p>
            {resetSent && <div className="alert alert-info py-2" style={{ fontSize: "0.85rem" }}>Reset link sent. Check your inbox, then sign out and sign in with your new password.</div>}
            <div className="d-flex gap-2 flex-wrap">
              <button type="button" className="btn btn-harmonia-outline btn-sm" onClick={handleReset} disabled={busy}>Email me a reset link</button>
              <button type="button" className="btn btn-harmonia-outline btn-sm" onClick={handleCheckAgain} disabled={busy}>I already reset it</button>
            </div>
          </>
        )}
        {enrollment && error && <div className="alert alert-danger py-2 mt-2">{error}</div>}
        <button type="button" className="btn btn-outline-danger w-100 mt-4" onClick={logout} disabled={busy}>
          <i className="bi bi-box-arrow-right me-2"></i>Sign out
        </button>
      </div>
    </div>
  );
};

export default AccountSetup;
