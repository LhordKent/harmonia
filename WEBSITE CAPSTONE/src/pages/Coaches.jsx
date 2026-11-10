import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { getCoaches, createCoach, updateCoach, deleteCoach } from "../firebase/firestore";
import { createAccountAuth } from "../firebase/auth";
import ConfirmModal from "../components/Shared/ConfirmModal";
import { Navigate } from "react-router-dom";

export const Coaches = () => {
  const { currentUser, canManageAccounts: isAdmin } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  const [showFormModal, setShowFormModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingId, setEditingId] = useState(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("active");

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [coachToDelete, setCoachToDelete] = useState(null);

  useEffect(() => {
    if (isAdmin) {
      fetchCoaches();
    }
  }, [isAdmin]);

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const fetchCoaches = async () => {
    try {
      setLoading(true);
      const data = await getCoaches(currentUser.institutionId);
      // Only show coaches, not the admin themselves if they have a different role
      setCoaches(data.filter(c => c.role !== "admin"));
    } catch (err) {
      showToast("Failed to load coaches.", "danger");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setStatus("active");
    setEditingId(null);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setModalMode("create");
    setShowFormModal(true);
  };

  const handleOpenEditModal = (c) => {
    resetForm();
    setModalMode("edit");
    setEditingId(c.id);
    setName(c.name);
    setEmail(c.email);
    setStatus(c.status);
    setShowFormModal(true);
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (!name || !email) {
      showToast("Name and email are required.", "warning");
      return;
    }
    if (modalMode === "create" && !password) {
      showToast("Password is required for new coaches.", "warning");
      return;
    }

    try {
      setLoading(true);
      if (modalMode === "create") {
        await createAccountAuth(email, password, async (newAuthUser) => createCoach({
          userId: newAuthUser.uid,
          name,
          email,
          status,
          institutionId: currentUser.institutionId
        }));
        showToast("Coach created successfully.", "success");
      } else {
        const updateData = { name, email, status };
        // We cannot update auth password here easily, so we only update firestore data
        await updateCoach(editingId, updateData);
        showToast("Coach updated successfully.", "success");
      }
      setShowFormModal(false);
      resetForm();
      fetchCoaches();
    } catch (err) {
      console.error(err);
      if (err.code === "auth/email-already-in-use") {
        showToast("An account with this email already exists.", "danger");
      } else {
        showToast(err.message || "Failed to save coach.", "danger");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (coach) => {
    try {
      setLoading(true);
      const newStatus = coach.status === "active" ? "inactive" : "active";
      await updateCoach(coach.id, { status: newStatus });
      showToast(`Coach has been ${newStatus === "active" ? "reactivated" : "deactivated"}.`, "success");
      fetchCoaches();
    } catch (err) {
      showToast("Failed to change account status.", "danger");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTrigger = (c) => {
    setCoachToDelete(c);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!coachToDelete) return;
    try {
      setLoading(true);
      await deleteCoach(coachToDelete.id);
      showToast("Coach deleted successfully.", "success");
      fetchCoaches();
    } catch (err) {
      showToast("Failed to delete coach.", "danger");
    } finally {
      setLoading(false);
      setShowDeleteModal(false);
      setCoachToDelete(null);
    }
  };

  const filteredCoaches = coaches.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="slide-up text-start">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h4 className="text-white mb-0 font-weight-bold">Vocal Coaches</h4>
        <button 
          className="btn btn-harmonia d-flex align-items-center gap-2 py-2 px-3"
          onClick={handleOpenCreateModal}
        >
          <i className="bi bi-person-plus-fill"></i>
          <span>Create Coach</span>
        </button>
      </div>

      <div className="harmonia-card p-3.5 mb-4">
        <div className="row g-3 align-items-center">
          <div className="col-md-4">
            <label className="harmonia-label">Search Coach</label>
            <div className="position-relative">
              <input
                type="text"
                className="harmonia-input w-100 ps-5"
                placeholder="Name or Email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <i className="bi bi-search position-absolute start-0 top-50 translate-middle-y ms-3 text-muted"></i>
            </div>
          </div>
        </div>
      </div>

      <div className="harmonia-card p-0">
        {loading && coaches.length === 0 ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status"></div>
          </div>
        ) : filteredCoaches.length === 0 ? (
          <div className="text-center py-5 text-muted-custom">
            <i className="bi bi-person-badge fs-2 mb-2 d-block"></i>
            No coaches found.
          </div>
        ) : (
          <div className="harmonia-table-container">
            <table className="harmonia-table">
              <thead>
                <tr>
                  <th>Coach</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoaches.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div>
                        <strong className="text-white d-block">{c.name}</strong>
                        <span className="text-muted-custom" style={{ fontSize: "0.8rem" }}>{c.email}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge bg-${c.status === "active" ? "success" : "secondary"} bg-opacity-20 text-${c.status === "active" ? "success" : "secondary"} border border-${c.status === "active" ? "success" : "secondary"} border-opacity-30 px-2.5 py-1`}>
                        {c.status === "active" ? "Active" : "Deactivated"}
                      </span>
                    </td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <button 
                          className={`btn btn-sm ${c.status === "active" ? "btn-outline-warning" : "btn-outline-success"}`}
                          onClick={() => handleToggleStatus(c)}
                        >
                          {c.status === "active" ? "Deactivate" : "Reactivate"}
                        </button>
                        <button 
                          className="btn btn-sm btn-dark border border-secondary border-opacity-10 text-white"
                          onClick={() => handleOpenEditModal(c)}
                          title="Edit Coach"
                        >
                          <i className="bi bi-pencil-square"></i>
                        </button>
                        <button 
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => handleDeleteTrigger(c)}
                          title="Delete Coach"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showFormModal && (
        <div className="drawer-backdrop d-flex justify-content-center align-items-center" style={{ zIndex: 1100 }}>
          <div className="harmonia-card fade-in text-start p-4" style={{ maxWidth: "500px", width: "95%", background: "#110e24", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h5 className="text-white mb-0 font-weight-bold">
                {modalMode === "edit" ? "Edit Coach" : "Create New Coach"}
              </h5>
              <button type="button" className="btn-close btn-close-white" onClick={() => setShowFormModal(false)}></button>
            </div>

            <form onSubmit={handleSubmitForm}>
              <div className="mb-3">
                <label className="harmonia-label">Name</label>
                <input
                  type="text"
                  className="harmonia-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="mb-3">
                <label className="harmonia-label">Email</label>
                <input
                  type="email"
                  className="harmonia-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={modalMode === "edit"}
                  required
                />
              </div>
              <div className="mb-4">
                <label className="harmonia-label">
                  {modalMode === "edit" ? "New Password (Optional)" : "Password"}
                </label>
                <input
                  type="password"
                  className="harmonia-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={modalMode === "create"}
                />
              </div>

              <div className="d-flex justify-content-end gap-3 pt-3 border-top border-secondary border-opacity-10">
                <button type="button" className="btn btn-harmonia-outline" onClick={() => setShowFormModal(false)} disabled={loading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-harmonia" disabled={loading}>
                  {loading ? <span className="spinner-border spinner-border-sm"></span> : "Save Coach"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Vocal Coach"
        message={`Are you sure you want to delete ${coachToDelete?.name}? This action cannot be undone.`}
        confirmText="Confirm Delete"
      />
    </div>
  );
};

export default Coaches;
