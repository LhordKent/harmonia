import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { getAnnouncements } from "../../firebase/firestore";

export const Header = ({ title, toggleSidebar }) => {
  const { currentUser, isAdmin } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const data = await getAnnouncements();
        // Filters: Standard coach sees 'all' and 'coach' target announcements. Admin sees all.
        const filtered = data.filter(ann => {
          if (isAdmin) return true;
          return ann.audience === "all" || ann.audience === "coach";
        });
        setAnnouncements(filtered.slice(0, 5)); // show latest 5
      } catch (err) {
        console.error("Error loading notifications:", err);
      }
    };
    fetchAnnouncements();
  }, [isAdmin]);

  return (
    <header className="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom border-secondary border-opacity-10 position-relative">
      <div className="d-flex align-items-center gap-3">
        {/* Toggle Button for mobile screens */}
        <button 
          className="btn d-lg-none text-white p-0" 
          onClick={() => toggleSidebar(prev => !prev)}
        >
          <i className="bi bi-list fs-3"></i>
        </button>
        <h2 className="mb-0 text-white font-weight-bold">{title}</h2>
      </div>

      {/* User Info / Notifications */}
      <div className="d-flex align-items-center gap-3">
        {/* Notifications Dropdown */}
        <div className="position-relative">
          <button 
            className="btn btn-dark border border-secondary border-opacity-10 rounded-circle d-flex align-items-center justify-content-center position-relative"
            style={{ width: 42, height: 42 }}
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <i className="bi bi-bell text-white"></i>
            {announcements.length > 0 && (
              <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-dark" style={{ fontSize: "0.6rem", padding: "0.25em 0.5em" }}>
                {announcements.length}
              </span>
            )}
          </button>

          {/* Notifications Dropdown Content */}
          {showNotifications && (
            <>
              <div 
                className="position-fixed top-0 start-0 w-100 h-100" 
                style={{ zIndex: 999 }} 
                onClick={() => setShowNotifications(false)}
              />
              <div 
                className="harmonia-card position-absolute end-0 mt-2 p-3 text-start shadow-lg"
                style={{ width: 320, zIndex: 1000, background: "#110e24", border: "1px solid rgba(255, 255, 255, 0.12)" }}
              >
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="mb-0 text-white font-weight-bold">Recent Announcements</h6>
                  <span className="badge bg-primary bg-opacity-20 text-primary px-2 py-1" style={{ fontSize: "0.7rem" }}>
                    {announcements.length} New
                  </span>
                </div>
                
                <div className="d-flex flex-column gap-2" style={{ maxHeight: "280px", overflowY: "auto" }}>
                  {announcements.length === 0 ? (
                    <div className="text-center py-3 text-muted-custom">
                      <i className="bi bi-bell-slash fs-4 d-block mb-1"></i>
                      No recent announcements
                    </div>
                  ) : (
                    announcements.map(ann => (
                      <div key={ann.id} className="p-2 rounded bg-white bg-opacity-5 hover-bg-opacity-10 transition">
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <strong className="text-white" style={{ fontSize: "0.8rem" }}>
                            {ann.sentBy}
                          </strong>
                          <span className="text-muted-custom" style={{ fontSize: "0.65rem" }}>
                            {new Date(ann.sentAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mb-0 text-muted-custom" style={{ fontSize: "0.75rem", lineHeight: "1.4" }}>
                          {ann.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Coach Meta Detail */}
        <div className="d-none d-sm-block text-end">
          <div className="text-white fw-semibold" style={{ fontSize: "0.85rem" }}>{currentUser?.name}</div>
          <div className="text-muted-custom" style={{ fontSize: "0.7rem" }}>
            {isAdmin ? "Institutional Admin" : "Vocal Coach"}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
