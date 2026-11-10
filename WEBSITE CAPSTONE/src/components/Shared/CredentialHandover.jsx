import React, { useState } from "react";

/**
 * Shows a newly created account's login email and temporary password for manual handover.
 * Nothing is sent automatically, and the password is not stored by the page.
 */
export const CredentialHandover = ({ account, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!account) return null;
  const roleLabel = { institution: "School administrator", coach: "Coach", student: "Student" }[account.role] || "Account";
  const text = `Harmonia login\nEmail: ${account.email}\nTemporary password: ${account.temporaryPassword}\nYou will be asked to choose your own password when you first sign in.`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="drawer-backdrop d-flex justify-content-center align-items-center" style={{ zIndex: 1200 }} role="dialog" aria-modal="true">
      <div className="harmonia-card fade-in text-start p-4" style={{ maxWidth: 480, width: "95%", background: "#110e24", border: "1px solid rgba(255,255,255,0.12)" }}>
        <h5 className="text-white mb-3"><i className="bi bi-person-check-fill text-success me-2"></i>{roleLabel} account ready</h5>
        {account.alreadyExisted ? (
          <p className="text-muted-custom">
            This account already existed from an earlier attempt, so nothing was changed and its password was not reset.
            Give <strong className="text-white">{account.email}</strong> the temporary password from that attempt, or ask them to use "Forgot password".
          </p>
        ) : (
          <>
            <p className="text-muted-custom" style={{ fontSize: "0.9rem" }}>
              Hand these details to the user privately. They must change the password at first sign-in. This password is shown once.
            </p>
            <dl className="row mb-3" style={{ fontSize: "0.95rem" }}>
              <dt className="col-5 text-muted-custom">Login email</dt>
              <dd className="col-7 text-white text-break" data-testid="handover-email">{account.email}</dd>
              <dt className="col-5 text-muted-custom">Temporary password</dt>
              <dd className="col-7 text-white text-break"><code data-testid="handover-password">{account.temporaryPassword}</code></dd>
            </dl>
            <button type="button" className="btn btn-harmonia-outline btn-sm mb-3" onClick={copy}>
              <i className="bi bi-clipboard me-1"></i>{copied ? "Copied" : "Copy details"}
            </button>
          </>
        )}
        <div className="d-flex justify-content-end">
          <button type="button" className="btn btn-harmonia" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default CredentialHandover;
