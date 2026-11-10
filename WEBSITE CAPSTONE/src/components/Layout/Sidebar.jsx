import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export const Sidebar = ({ isOpen, toggleSidebar }) => {
  const { currentUser, logout, canManageAccounts: isAdmin, isPlatformAdmin } = useAuth();

  const handleNavClick = () => {
    if (window.innerWidth < 992) {
      toggleSidebar(false);
    }
  };

  return (
    <div className={`sidebar-wrapper ${isOpen ? "show" : ""}`}>
      {/* Sidebar Header / Logo */}
      <div className="p-4 d-flex align-items-center justify-content-between border-bottom border-secondary border-opacity-10">
        <div className="sidebar-logo">
          <i className="bi bi-soundwave fs-3"></i>
          <span>Harmonia</span>
        </div>
        <button 
          className="btn d-lg-none text-muted-custom p-0" 
          onClick={() => toggleSidebar(false)}
        >
          <i className="bi bi-x-lg fs-4"></i>
        </button>
      </div>

      {/* Nav Menu */}
      <div className="sidebar-nav mt-3">
        <NavLink 
          to="/dashboard" 
          className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
          onClick={handleNavClick}
        >
          <i className="bi bi-grid-1x2-fill"></i>
          <span>Dashboard</span>
        </NavLink>

        <NavLink 
          to="/students" 
          className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
          onClick={handleNavClick}
        >
          <i className="bi bi-people-fill"></i>
          <span>Students</span>
        </NavLink>

        <NavLink 
          to="/exercises" 
          className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
          onClick={handleNavClick}
        >
          <i className="bi bi-journal-music"></i>
          <span>Exercises</span>
        </NavLink>

        {isPlatformAdmin && (
          <NavLink
            to="/schools"
            className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
            onClick={handleNavClick}
          >
            <i className="bi bi-building"></i>
            <span>Schools</span>
          </NavLink>
        )}

        {isAdmin && (
          <NavLink 
            to="/coaches" 
            className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
            onClick={handleNavClick}
          >
            <i className="bi bi-person-badge-fill"></i>
            <span>Coaches</span>
          </NavLink>
        )}

        <NavLink 
          to="/reports" 
          className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
          onClick={handleNavClick}
        >
          <i className="bi bi-bar-chart-line-fill"></i>
          <span>Reports</span>
        </NavLink>

        <NavLink 
          to="/settings" 
          className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
          onClick={handleNavClick}
        >
          <i className="bi bi-gear-fill"></i>
          <span>Settings</span>
        </NavLink>
      </div>

      {/* Coach Info & Logout (Bottom) */}
      <div className="position-absolute bottom-0 w-100 p-4 border-top border-secondary border-opacity-10 bg-dark bg-opacity-25">
        <div className="d-flex align-items-center gap-3 mb-3">
          <div className="avatar-circle bg-primary bg-opacity-20 text-primary border border-primary border-opacity-20 d-flex align-items-center justify-content-center" style={{ width: 42, height: 42, borderRadius: "50%", fontWeight: "bold" }}>
            {currentUser?.name?.charAt(0).toUpperCase() || "C"}
          </div>
          <div style={{ minWidth: 0 }}>
            <h6 className="text-white mb-0 text-truncate" style={{ fontSize: "0.9rem" }}>{currentUser?.name}</h6>
            <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>
              {currentUser?.role === "institution" ? "School Administrator" : isPlatformAdmin ? "Platform Administrator" : "Vocal Coach"}
            </span>
          </div>
        </div>
        <button 
          onClick={logout}
          className="btn btn-outline-danger w-100 d-flex align-items-center justify-content-center gap-2 py-2"
          style={{ fontSize: "0.85rem", borderRadius: "8px" }}
        >
          <i className="bi bi-box-arrow-right"></i>
          Sign Out
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
