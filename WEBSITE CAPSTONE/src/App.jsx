import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";

// Pages
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Students from "./pages/Students";
import Exercises from "./pages/Exercises";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Coaches from "./pages/Coaches";
import Schools from "./pages/Schools";
import AccountSetup from "./pages/AccountSetup";

// Components
import Sidebar from "./components/Layout/Sidebar";
import Header from "./components/Layout/Header";

// CSS file delete warning - clean app-level CSS overrides
import "./App.css";

// PROTECTED ROUTE GUARD
const ProtectedRoute = ({ children }) => {
  const { currentUser, loading, authState } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100 bg-dark text-white">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Pending accounts see only the setup screen, whatever URL was opened, refreshed or restored.
  if (authState !== "ready") {
    return <AccountSetup />;
  }

  return children;
};

// LAYOUT WRAPPER FOR PROTECTED ROUTES
const DashboardLayout = ({ title }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { selectedSchoolId } = useAuth();

  // Map route path to human-readable screen titles
  const getScreenTitle = () => {
    switch (location.pathname) {
      case "/dashboard": return "Dashboard Overview";
      case "/students": return "Student Management";
      case "/exercises": return "Exercise Directory";
      case "/reports": return "Reports & Performance Analytics";
      case "/settings": return "System Settings";
      case "/schools": return "School Management";
      case "/coaches": return "Coach Management";
      default: return "Harmonia Admin";
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar isOpen={sidebarOpen} toggleSidebar={setSidebarOpen} />

      {/* Sidebar overlay backdrop for mobile */}
      {sidebarOpen && (
        <div
          className="drawer-backdrop d-lg-none"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <div className="main-content-wrapper">
        <Header title={getScreenTitle()} toggleSidebar={setSidebarOpen} />

        {/* Actual Page Component */}
        {/* Remount pages when a platform administrator switches schools so data reloads. */}
        <main className="fade-in" key={selectedSchoolId || "no-school"}>
          <Routes>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="students" element={<Students />} />
            <Route path="exercises" element={<Exercises />} />
            <Route path="reports" element={<Reports />} />
            <Route path="coaches" element={<Coaches />} />
            <Route path="settings" element={<Settings />} />
            <Route path="schools" element={<Schools />} />
            <Route path="" element={<Navigate to="dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public Login Route */}
            <Route path="/login" element={<Login />} />

            {/* Protected Application Routes */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            />
            </Routes>
        </AuthProvider>
      </ToastProvider>
    </Router>
  );
}
