import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

// ─────────────────────────────────────────────────────────
// Human-readable Firebase error messages
// ─────────────────────────────────────────────────────────
const friendlyAuthError = (error) => {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password. Please check your credentials.";
    case "auth/invalid-email":
      return "The email address entered is not valid.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact your administrator.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a moment before trying again.";
    case "auth/network-request-failed":
      return "Unable to connect to Firebase. Please check your internet connection.";
    default:
      return error?.message || "Authentication failed. Please verify your credentials.";
  }
};

export const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);

  // Forgot Password
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const { login, resetPassword } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const redirectPath = location.state?.from?.pathname || "/dashboard";

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      showToast("Please fill in all credentials.", "danger");
      return;
    }

    setLoading(true);
    try {
      await login(email, password, rememberMe);
      showToast("Signed in successfully. Welcome to Harmonia!", "success");
      navigate(redirectPath, { replace: true });
    } catch (error) {
      console.error("Login error:", error);
      showToast(friendlyAuthError(error), "danger");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotEmail) {
      showToast("Please enter your registered email address.", "danger");
      return;
    }
    setForgotLoading(true);
    try {
      await resetPassword(forgotEmail);
      showToast("Password reset link sent to your email.", "success");
      setShowForgotModal(false);
      setForgotEmail("");
    } catch (error) {
      showToast(friendlyAuthError(error), "danger");
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div
      className="d-flex justify-content-center align-items-center min-vh-100 p-3"
      style={{
        background: "var(--bg-dark)",
        backgroundImage: `radial-gradient(circle at 50% 30%, rgba(139, 92, 246, 0.15) 0%, transparent 60%)`,
      }}
    >
      <div className="w-100" style={{ maxWidth: "460px" }}>
        {/* Logo */}
        <div className="text-center mb-4">
          <div
            className="d-inline-flex align-items-center justify-content-center bg-primary bg-opacity-10 border border-primary border-opacity-20 rounded-circle mb-3"
            style={{ width: 68, height: 68 }}
          >
            <i className="bi bi-soundwave text-primary fs-1"></i>
          </div>
          <h1 className="h3 text-white mb-1" style={{ fontWeight: 800 }}>
            Harmonia Portal
          </h1>
          <p className="text-muted-custom" style={{ fontSize: "0.9rem" }}>
            Vocal Coach &amp; Institution Administration
          </p>
        </div>

        {/* ── Main Login Form ── */}
        <div className="harmonia-card p-4 mb-4">
          <h4 className="text-white mb-4" style={{ fontWeight: 600 }}>
            Sign In
          </h4>

          <form onSubmit={handleLogin}>
            <div className="mb-3 d-flex flex-column text-start">
              <label className="harmonia-label" htmlFor="email-input">
                Institutional Email
              </label>
              <input
                id="email-input"
                type="email"
                className="harmonia-input"
                placeholder="coach@harmonia.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="mb-4 d-flex flex-column text-start">
              <div className="d-flex justify-content-between align-items-center">
                <label className="harmonia-label" htmlFor="password-input">
                  Password
                </label>
                <button
                  type="button"
                  className="btn btn-link p-0 text-primary border-0 text-decoration-none"
                  style={{ fontSize: "0.8rem", marginTop: "-3px" }}
                  onClick={() => setShowForgotModal(true)}
                  disabled={loading}
                >
                  Forgot Password?
                </button>
              </div>
              <input
                id="password-input"
                type="password"
                className="harmonia-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="d-flex align-items-center mb-4">
              <div className="form-check text-start">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="rememberCheck"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                  style={{
                    backgroundColor: rememberMe ? "#8b5cf6" : "transparent",
                    borderColor: "#8b5cf6",
                  }}
                />
                <label
                  className="form-check-label text-muted-custom"
                  htmlFor="rememberCheck"
                  style={{ fontSize: "0.85rem", cursor: "pointer" }}
                >
                  Remember me
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-harmonia w-100 py-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-hidden="true"
                  />
                  Authenticating…
                </>
              ) : (
                "Sign In"
              )}
            </button>

          </form>
        </div>


        {/* Footer */}
        <p
          className="text-center text-muted-custom"
          style={{ fontSize: "0.75rem" }}
        >
          Harmonia Vocal Training Platform &middot; Admin &amp; Coach Portal
        </p>
      </div>

      {/* ── Forgot Password Modal ── */}
      {showForgotModal && (
        <div
          className="drawer-backdrop d-flex justify-content-center align-items-center"
          style={{ zIndex: 1100 }}
        >
          <div
            className="harmonia-card text-start p-4 m-3"
            style={{ maxWidth: "400px", width: "100%", background: "#120e24" }}
          >
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="text-white mb-0 font-weight-bold">
                Reset Password
              </h5>
              <button
                className="btn-close btn-close-white"
                onClick={() => setShowForgotModal(false)}
              />
            </div>
            <p
              className="text-muted-custom mb-3"
              style={{ fontSize: "0.85rem", lineHeight: "1.4" }}
            >
              Enter your institutional email and we'll send a password reset
              link.
            </p>
            <form onSubmit={handleForgotPassword}>
              <div className="mb-4 d-flex flex-column">
                <label className="harmonia-label" htmlFor="forgot-email">
                  Email Address
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  className="harmonia-input"
                  placeholder="coach@harmonia.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  disabled={forgotLoading}
                  required
                />
              </div>
              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn btn-harmonia-outline"
                  onClick={() => setShowForgotModal(false)}
                  disabled={forgotLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-harmonia"
                  disabled={forgotLoading}
                >
                  {forgotLoading ? "Sending…" : "Send Reset Link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
