import React, { useEffect, useState, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { getSchools } from "../firebase/firestore";
import { createSchool, setSchoolBasePassword, createSchoolAccount, newRequestId } from "../firebase/accountsService";
import CredentialHandover from "../components/Shared/CredentialHandover";

const emptySchool = { name: "", contactEmail: "", basePassword: "", confirmBase: "", adminName: "", adminEmail: "" };

/** Platform-administrator school management: create schools, set base passwords, provision school administrators. */
export const Schools = () => {
  const { isPlatformAdmin, selectedSchoolId, setSelectedSchoolId } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'create' | 'base' | 'admin', school? }
  const [form, setForm] = useState(emptySchool);
  const [error, setError] = useState("");
  const [handover, setHandover] = useState(null);
  const requestId = useRef(null);

  const load = async () => {
    setLoading(true);
    try { setSchools(await getSchools()); } catch { showToast("Could not load schools.", "danger"); } finally { setLoading(false); }
  };
  useEffect(() => { if (isPlatformAdmin) load(); }, [isPlatformAdmin]);
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  const open = (type, school = null) => {
    setForm(emptySchool); setError(""); setModal({ type, school });
    // One identifier per create dialog: resubmitting after an error or lost response is retry-safe.
    requestId.current = type === "create" ? newRequestId() : null;
  };
  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const needsBase = modal.type === "create" || modal.type === "base";
    if (needsBase && form.basePassword.length < 8) return setError("The base password needs at least 8 characters.");
    if (needsBase && form.basePassword !== form.confirmBase) return setError("The base password and confirmation do not match.");
    if (modal.type === "create" && !form.name.trim()) return setError("Enter the school name.");
    if (modal.type !== "base" && (!form.adminName.trim() || !form.adminEmail.trim())) return setError("Enter the school administrator's name and email.");
    setBusy(true);
    try {
      if (modal.type === "create") {
        const result = await createSchool({ requestId: requestId.current, name: form.name, contactEmail: form.contactEmail,
          basePassword: form.basePassword, adminName: form.adminName, adminEmail: form.adminEmail });
        setHandover(result.account);
        showToast("School created.", "success");
      } else if (modal.type === "base") {
        await setSchoolBasePassword(modal.school.id, form.basePassword);
        showToast("Base password saved. It applies to accounts created from now on; existing passwords are unchanged.", "success");
      } else {
        const account = await createSchoolAccount({ role: "institution", schoolId: modal.school.id, name: form.adminName, email: form.adminEmail });
        setHandover(account);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.message || "The request failed. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
        <p className="text-muted-custom mb-0">Create schools and their first administrators. School administrators then create their own coaches and students.</p>
        <button className="btn btn-harmonia" onClick={() => open("create")}><i className="bi bi-plus-lg me-1"></i>New school</button>
      </div>
      <div className="harmonia-card p-0">
        {loading ? (
          <div className="text-center py-5"><div className="spinner-border spinner-border-sm text-primary" /></div>
        ) : schools.length === 0 ? (
          <div className="text-center py-5 text-muted-custom">No schools yet.</div>
        ) : (
          <div className="harmonia-table-container">
            <table className="harmonia-table">
              <thead><tr><th>School</th><th>Base password</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {schools.map(s => (
                  <tr key={s.id}>
                    <td><div className="text-white fw-semibold">{s.name || s.id}</div><small className="text-muted-custom">{s.id}{s.contactEmail ? ` · ${s.contactEmail}` : ""}</small></td>
                    <td>{s.basePasswordSet ? <span className="badge bg-success bg-opacity-25 text-success">Set</span> : <span className="badge bg-warning bg-opacity-25 text-warning">Not set</span>}</td>
                    <td className="text-capitalize">{s.status || "active"}</td>
                    <td>
                      <div className="d-flex gap-2 flex-wrap">
                        <button className="btn btn-harmonia-outline btn-sm" onClick={() => { setSelectedSchoolId(s.id); navigate("/students"); }}>
                          {selectedSchoolId === s.id ? "Open roster (selected)" : "Open roster"}
                        </button>
                        <button className="btn btn-harmonia-outline btn-sm" onClick={() => open("base", s)}>Set base password</button>
                        <button className="btn btn-harmonia-outline btn-sm" onClick={() => open("admin", s)} disabled={!s.basePasswordSet}>Add school administrator</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className="drawer-backdrop d-flex justify-content-center align-items-center" style={{ zIndex: 1100 }}>
          <div className="harmonia-card fade-in text-start p-4" style={{ maxWidth: 520, width: "95%", background: "#110e24", border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="text-white mb-0">
                {modal.type === "create" ? "New school" : modal.type === "base" ? `Base password · ${modal.school.name}` : `New administrator · ${modal.school.name}`}
              </h5>
              <button type="button" className="btn-close btn-close-white" onClick={() => setModal(null)} disabled={busy}></button>
            </div>
            <form onSubmit={submit} noValidate>
              {modal.type === "create" && (
                <>
                  <div className="mb-3"><label className="harmonia-label" htmlFor="school-name">School name</label>
                    <input id="school-name" className="harmonia-input" value={form.name} onChange={set("name")} /></div>
                  <div className="mb-3"><label className="harmonia-label" htmlFor="school-contact">Contact email (optional)</label>
                    <input id="school-contact" type="email" className="harmonia-input" value={form.contactEmail} onChange={set("contactEmail")} /></div>
                </>
              )}
              {(modal.type === "create" || modal.type === "base") && (
                <>
                  <p className="text-muted-custom" style={{ fontSize: "0.85rem" }}>
                    New accounts in this school start with the base password and must change it at first sign-in.
                    {modal.type === "base" && " Changing it affects future accounts only; existing passwords are not reset."}
                  </p>
                  <div className="mb-3"><label className="harmonia-label" htmlFor="school-base">Base password (min. 8 characters)</label>
                    <input id="school-base" type="password" autoComplete="new-password" className="harmonia-input" value={form.basePassword} onChange={set("basePassword")} /></div>
                  <div className="mb-3"><label className="harmonia-label" htmlFor="school-base-confirm">Confirm base password</label>
                    <input id="school-base-confirm" type="password" autoComplete="new-password" className="harmonia-input" value={form.confirmBase} onChange={set("confirmBase")} /></div>
                </>
              )}
              {modal.type !== "base" && (
                <>
                  <h6 className="text-white mt-2">School administrator</h6>
                  <div className="mb-3"><label className="harmonia-label" htmlFor="school-admin-name">Full name</label>
                    <input id="school-admin-name" className="harmonia-input" value={form.adminName} onChange={set("adminName")} /></div>
                  <div className="mb-3"><label className="harmonia-label" htmlFor="school-admin-email">Email (login and password recovery)</label>
                    <input id="school-admin-email" type="email" className="harmonia-input" value={form.adminEmail} onChange={set("adminEmail")} /></div>
                </>
              )}
              {error && <div className="alert alert-danger py-2" role="alert" style={{ fontSize: "0.85rem" }}>{error}</div>}
              <div className="d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-harmonia-outline" onClick={() => setModal(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-harmonia" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <CredentialHandover account={handover} onClose={() => setHandover(null)} />
    </div>
  );
};

export default Schools;
