import React, { createContext, useContext, useState, useCallback } from "react";

const ToastContext = createContext();

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast Render Area */}
      <div className="harmonia-toast-container">
        {toasts.map((toast) => (
          <div 
            key={toast.id} 
            className={`harmonia-toast ${toast.type}`}
            onClick={() => removeToast(toast.id)}
            style={{ cursor: "pointer" }}
          >
            <i className={`bi ${toast.type === "success" ? "bi-check-circle-fill text-success" : "bi-exclamation-triangle-fill text-danger"} fs-5`}></i>
            <div className="flex-grow-1" style={{ fontSize: "0.85rem" }}>{toast.message}</div>
            <button 
              type="button" 
              className="btn-close btn-close-white" 
              style={{ fontSize: "0.65rem" }}
              aria-label="Close"
            ></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
