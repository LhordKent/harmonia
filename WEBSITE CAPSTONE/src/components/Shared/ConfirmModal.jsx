import React from "react";

export const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Delete", confirmBtnVariant = "danger" }) => {
  if (!isOpen) return null;

  return (
    <div className="drawer-backdrop d-flex justify-content-center align-items-center" style={{ zIndex: 1100 }}>
      <div 
        className="harmonia-card fade-in text-start p-4" 
        style={{ maxWidth: "450px", width: "90%", background: "#120e24", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        <h4 className="mb-3 text-white d-flex align-items-center gap-2">
          <i className="bi bi-exclamation-triangle-fill text-warning"></i>
          {title}
        </h4>
        <p className="text-muted-custom mb-4" style={{ fontSize: "0.95rem", lineHeight: "1.5" }}>
          {message}
        </p>
        <div className="d-flex justify-content-end gap-3">
          <button 
            type="button" 
            className="btn btn-harmonia-outline py-2 px-3"
            onClick={onClose}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className={`btn btn-${confirmBtnVariant} py-2 px-3`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
