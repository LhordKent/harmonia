import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { 
  getInstitution, updateInstitution, addAnnouncement, getBadges, saveBadge 
} from "../firebase/firestore";
import { setSchoolBasePassword, validateNewPassword } from "../firebase/accountsService";

export const Settings = () => {
  const { currentUser, isAdmin, canManageAccounts, updateProfileData, changePassword } = useAuth();
  const { showToast } = useToast();

  // Active Tab
  const [activeTab, setActiveTab] = useState("profile");

  // LOADING STATES
  const [loading, setLoading] = useState(false);

  // PROFILE STATE
  const [profileName, setProfileName] = useState(currentUser?.name || "");
  const [profileEmail, setProfileEmail] = useState(currentUser?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [basePassword, setBasePassword] = useState("");
  const [confirmBasePassword, setConfirmBasePassword] = useState("");

  // INSTITUTION STATE (Admin Only)
  const [instName, setInstName] = useState("");
  const [instEmail, setInstEmail] = useState("");
  const [instTimeZone, setInstTimeZone] = useState("Asia/Manila");
  const [instYear, setInstYear] = useState("2026-2027");

  // NOTIFICATION STATE (Admin Only)
  const [rules, setRules] = useState({
    weeklySummary: true,
    lowAccuracyAlert: true,
    inactivityAlert: false,
    newEnrollment: true
  });

  // DATA PRIVACY STATE (Admin Only)
  const [retentionPeriod, setRetentionPeriod] = useState("12");
  const [defaultExport, setDefaultExport] = useState("CSV");
  const [anonymousStats, setAnonymousStats] = useState(true);

  // ANNOUNCEMENT COMPOSER STATE (Admin Only)
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [targetAudience, setTargetAudience] = useState("all");

  // BADGE CONFIG STATE (Admin Only)
  const [badgesList, setBadgesList] = useState([]);
  const [editingBadgeId, setEditingBadgeId] = useState(null);
  const [badgeThreshold, setBadgeThreshold] = useState("");
  const [badgeCriteria, setBadgeCriteria] = useState("");

  const loadSettingsData = async () => {
    if (!canManageAccounts) return;
    try {
      setLoading(true);
      const inst = await getInstitution(currentUser?.institutionId);
      if (inst) {
        setInstName(inst.name || "");
        setInstEmail(inst.contactEmail || "");
        setInstTimeZone(inst.timeZone || "Asia/Manila");
        setInstYear(inst.academicYear || "2026-2027");
        if (inst.notificationRules) setRules(inst.notificationRules);
        if (inst.dataPrivacySettings) {
          setRetentionPeriod(inst.dataPrivacySettings.retentionPeriod || "12");
          setDefaultExport(inst.dataPrivacySettings.defaultExport || "CSV");
          setAnonymousStats(inst.dataPrivacySettings.anonymousStats !== false);
        }
      }

      if (isAdmin) setBadgesList(await getBadges());

    } catch(err) {
      showToast("Error loading system settings.", "danger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettingsData();
  }, [canManageAccounts]);

  // Profile Form Handler
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!profileName) {
      showToast("Name cannot be empty.", "warning");
      return;
    }

    try {
      setLoading(true);
      await updateProfileData({ name: profileName });
      showToast("Personal profile details updated.", "success");
    } catch(err) {
      showToast(err.message || "Failed to update profile.", "danger");
    } finally {
      setLoading(false);
    }
  };

  // Real Firebase password change through the trusted accounts service.
  const handleChangePassword = async (e) => {
    e.preventDefault();
    const problem = validateNewPassword({ currentPassword, newPassword, confirmPassword });
    if (problem) { showToast(problem, "danger"); return; }
    try {
      setLoading(true);
      await changePassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      showToast("Password changed. Use your new password next time you sign in.", "success");
    } catch (err) {
      showToast(err.message || "Your password could not be changed.", "danger");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBasePassword = async (e) => {
    e.preventDefault();
    if (basePassword.length < 8) { showToast("The base password needs at least 8 characters.", "danger"); return; }
    if (basePassword !== confirmBasePassword) { showToast("The base password and confirmation do not match.", "danger"); return; }
    try {
      setLoading(true);
      await setSchoolBasePassword(currentUser.institutionId, basePassword);
      setBasePassword(""); setConfirmBasePassword("");
      showToast("Base password saved. It applies to new accounts only; existing passwords are unchanged.", "success");
    } catch (err) {
      showToast(err.message || "The base password could not be saved.", "danger");
    } finally {
      setLoading(false);
    }
  };

  // Institution Settings Save Handler
  const handleSaveInstitution = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const updated = {
        name: instName,
        contactEmail: instEmail,
        timeZone: instTimeZone,
        academicYear: instYear,
        notificationRules: rules,
        dataPrivacySettings: {
          retentionPeriod,
          defaultExport,
          anonymousStats
        }
      };

      await updateInstitution(currentUser?.institutionId, updated);
      showToast("Institution profiles and configs saved.", "success");
    } catch (err) {
      showToast("Failed to save institutional settings.", "danger");
    } finally {
      setLoading(false);
    }
  };

  // Broadcast Announcement Submit Handler
  const handleSendAnnouncement = async (e) => {
    e.preventDefault();
    if (!broadcastMsg) {
      showToast("Announcement message cannot be empty.", "warning");
      return;
    }

    try {
      setLoading(true);
      const newAnn = {
        institutionId: currentUser?.institutionId,
        message: broadcastMsg,
        audience: targetAudience,
        sentBy: currentUser.name,
        sentAt: new Date().toISOString()
      };

      await addAnnouncement(newAnn);
      showToast(`Announcement broadcast to ${targetAudience === "all" ? "all users" : targetAudience}.`, "success");
      setBroadcastMsg("");
    } catch (err) {
      showToast("Failed to distribute announcement.", "danger");
    } finally {
      setLoading(false);
    }
  };

  // Badge Config Form Handler
  const handleEditBadgeTrigger = (badge) => {
    setEditingBadgeId(badge.id);
    setBadgeThreshold(badge.threshold);
    setBadgeCriteria(badge.criteria);
  };

  const handleSaveBadge = async (badge) => {
    try {
      setLoading(true);
      const updatedBadge = {
        ...badge,
        threshold: Number(badgeThreshold),
        criteria: badgeCriteria
      };

      await saveBadge(updatedBadge);
      showToast(`Criteria for badge "${badge.name}" modified.`, "success");
      setEditingBadgeId(null);
      // Reload badges
      const badges = await getBadges();
      setBadgesList(badges);
    } catch (err) {
      showToast("Failed to update badge criteria.", "danger");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="slide-up text-start">
      
      {/* Settings layout row */}
      <div className="row g-4">
        
        {/* Left Side Tab Navigation */}
        <div className="col-lg-3">
          <div className="harmonia-card p-3 d-flex flex-column gap-2">
            <h6 className="text-muted-custom px-3 py-1 mb-2 fw-semibold" style={{ fontSize: "0.75rem", textTransform: "uppercase" }}>Personal Settings</h6>
            
            <button 
              onClick={() => setActiveTab("profile")}
              className={`btn text-start border-0 py-2.5 px-3 rounded-3 d-flex align-items-center gap-2.5 ${activeTab === "profile" ? "btn-harmonia" : "text-muted-custom bg-transparent hover-bg-opacity-5"}`}
            >
              <i className="bi bi-person-fill"></i>
              <span>Personal Profile</span>
            </button>

            {canManageAccounts && (
              <>
                <h6 className="text-muted-custom px-3 py-1 mt-4 mb-2 fw-semibold" style={{ fontSize: "0.75rem", textTransform: "uppercase" }}>School Admin Controls</h6>
                
                <button 
                  onClick={() => setActiveTab("institution")}
                  className={`btn text-start border-0 py-2.5 px-3 rounded-3 d-flex align-items-center gap-2.5 ${activeTab === "institution" ? "btn-harmonia" : "text-muted-custom bg-transparent"}`}
                >
                  <i className="bi bi-bank2"></i>
                  <span>Academy Details</span>
                </button>

                {isAdmin && (<>
                <button
                  onClick={() => setActiveTab("announcements")}
                  className={`btn text-start border-0 py-2.5 px-3 rounded-3 d-flex align-items-center gap-2.5 ${activeTab === "announcements" ? "btn-harmonia" : "text-muted-custom bg-transparent"}`}
                >
                  <i className="bi bi-megaphone-fill"></i>
                  <span>Broadcast Messages</span>
                </button>

                <button 
                  onClick={() => setActiveTab("badges")}
                  className={`btn text-start border-0 py-2.5 px-3 rounded-3 d-flex align-items-center gap-2.5 ${activeTab === "badges" ? "btn-harmonia" : "text-muted-custom bg-transparent"}`}
                >
                  <i className="bi bi-trophy-fill"></i>
                  <span>Badge Configuration</span>
                </button>
                </>)}

                <button 
                  onClick={() => setActiveTab("privacy")}
                  className={`btn text-start border-0 py-2.5 px-3 rounded-3 d-flex align-items-center gap-2.5 ${activeTab === "privacy" ? "btn-harmonia" : "text-muted-custom bg-transparent"}`}
                >
                  <i className="bi bi-shield-fill-check"></i>
                  <span>Data &amp; Privacy</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right Side Settings Panel Details */}
        <div className="col-lg-9">
          
          {/* PERSONAL PROFILE TAB */}
          {activeTab === "profile" && (
            <div className="harmonia-card p-4">
              <h5 className="text-white mb-4">Personal Profile Settings</h5>
              
              <form onSubmit={handleUpdateProfile}>
                <div className="row g-3 mb-3">
                  <div className="col-md-6 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="profile-name">Vocal Coach Name</label>
                    <input 
                      id="profile-name"
                      type="text" 
                      className="harmonia-input"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-md-6 d-flex flex-column">
                    <label className="harmonia-label">Institutional Email</label>
                    <input 
                      type="email" 
                      className="harmonia-input" 
                      value={profileEmail}
                      disabled
                      title="Institutional emails cannot be modified client-side."
                    />
                  </div>
                </div>

                <div className="text-end">
                  <button type="submit" className="btn btn-harmonia px-4 py-2" disabled={loading}>Save Profile</button>
                </div>
              </form>

              <hr className="my-4 border-secondary border-opacity-20" />
              <h6 className="text-white mb-3">Change Account Password</h6>
              <form onSubmit={handleChangePassword} noValidate>
                <div className="row g-3 mb-4">
                  <div className="col-md-4 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="current-pw">Current Password</label>
                    <input
                      id="current-pw"
                      type="password"
                      autoComplete="current-password"
                      className="harmonia-input"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div className="col-md-4 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="new-pw">New Password</label>
                    <input 
                      id="new-pw"
                      type="password" 
                      className="harmonia-input"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div className="col-md-4 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="confirm-pw">Confirm New Password</label>
                    <input 
                      id="confirm-pw"
                      type="password" 
                      className="harmonia-input"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>

                <div className="text-end">
                  <button 
                    type="submit" 
                    className="btn btn-harmonia px-4 py-2"
                    disabled={loading}
                  >
                    Change Password
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ACADEMY DETAILS TAB */}
          {activeTab === "institution" && canManageAccounts && (
            <div className="harmonia-card p-4">
              <h5 className="text-white mb-2">School base password</h5>
              <p className="text-muted-custom" style={{ fontSize: "0.85rem" }}>
                New coach and student accounts start with this password and must change it at first sign-in.
                Changing it affects accounts created from now on; existing passwords are not reset.
              </p>
              <form onSubmit={handleSaveBasePassword} noValidate className="row g-3 mb-4">
                <div className="col-md-5 d-flex flex-column">
                  <label className="harmonia-label" htmlFor="base-pw">New base password</label>
                  <input id="base-pw" type="password" autoComplete="new-password" className="harmonia-input" value={basePassword} onChange={(e) => setBasePassword(e.target.value)} />
                </div>
                <div className="col-md-5 d-flex flex-column">
                  <label className="harmonia-label" htmlFor="base-pw-confirm">Confirm base password</label>
                  <input id="base-pw-confirm" type="password" autoComplete="new-password" className="harmonia-input" value={confirmBasePassword} onChange={(e) => setConfirmBasePassword(e.target.value)} />
                </div>
                <div className="col-md-2 d-flex align-items-end">
                  <button type="submit" className="btn btn-harmonia w-100" disabled={loading}>Save</button>
                </div>
              </form>
              <hr className="my-4 border-secondary border-opacity-20" />
              <h5 className="text-white mb-4">Academy &amp; System Configuration</h5>

              <form onSubmit={handleSaveInstitution}>
                <div className="row g-3 mb-4">
                  <div className="col-md-6 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="inst-name">Institution Name</label>
                    <input 
                      id="inst-name"
                      type="text" 
                      className="harmonia-input"
                      value={instName}
                      onChange={(e) => setInstName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-md-6 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="inst-email">Administrative Email</label>
                    <input 
                      id="inst-email"
                      type="email" 
                      className="harmonia-input"
                      value={instEmail}
                      onChange={(e) => setInstEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-md-6 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="inst-tz">System Timezone</label>
                    <select 
                      id="inst-tz"
                      className="harmonia-input"
                      value={instTimeZone}
                      onChange={(e) => setInstTimeZone(e.target.value)}
                    >
                      <option value="America/New_York">Eastern Time (EST/EDT)</option>
                      <option value="America/Chicago">Central Time (CST/CDT)</option>
                      <option value="America/Denver">Mountain Time (MST/MDT)</option>
                      <option value="America/Los_Angeles">Pacific Time (PST/PDT)</option>
                    </select>
                  </div>
                  <div className="col-md-6 d-flex flex-column">
                    <label className="harmonia-label" htmlFor="inst-year">Current Academic Year</label>
                    <input 
                      id="inst-year"
                      type="text" 
                      className="harmonia-input"
                      placeholder="e.g. 2026-2027"
                      value={instYear}
                      onChange={(e) => setInstYear(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <hr className="my-4 border-secondary border-opacity-20" />
                <h6 className="text-white mb-3">Notification Rules &amp; Triggers</h6>
                
                <div className="d-flex flex-column gap-2 mb-4">
                  <div className="form-check text-start">
                    <input 
                      type="checkbox" 
                      className="form-check-input" 
                      id="weeklySummaryCheck"
                      checked={rules.weeklySummary}
                      onChange={(e) => setRules(prev => ({ ...prev, weeklySummary: e.target.checked }))}
                    />
                    <label className="form-check-label text-muted-custom" htmlFor="weeklySummaryCheck">
                      Send weekly class performance summaries to coaches
                    </label>
                  </div>
                  
                  <div className="form-check text-start">
                    <input 
                      type="checkbox" 
                      className="form-check-input" 
                      id="lowAccuracyCheck"
                      checked={rules.lowAccuracyAlert}
                      onChange={(e) => setRules(prev => ({ ...prev, lowAccuracyAlert: e.target.checked }))}
                    />
                    <label className="form-check-label text-muted-custom" htmlFor="lowAccuracyCheck">
                      Alert coaches immediately on repeated low-accuracy submissions (&lt;70% over 3 tasks)
                    </label>
                  </div>

                  <div className="form-check text-start">
                    <input 
                      type="checkbox" 
                      className="form-check-input" 
                      id="inactivityCheck"
                      checked={rules.inactivityAlert}
                      onChange={(e) => setRules(prev => ({ ...prev, inactivityAlert: e.target.checked }))}
                    />
                    <label className="form-check-label text-muted-custom" htmlFor="inactivityCheck">
                      Send inactivity notifications to students inactive for more than 7 days
                    </label>
                  </div>

                  <div className="form-check text-start">
                    <input 
                      type="checkbox" 
                      className="form-check-input" 
                      id="newEnrollmentCheck"
                      checked={rules.newEnrollment}
                      onChange={(e) => setRules(prev => ({ ...prev, newEnrollment: e.target.checked }))}
                    />
                    <label className="form-check-label text-muted-custom" htmlFor="newEnrollmentCheck">
                      Alert administrative coaches on new student or coach registrations
                    </label>
                  </div>
                </div>

                <div className="text-end">
                  <button type="submit" className="btn btn-harmonia px-4" disabled={loading}>
                    Save Config
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* BROADCAST ANNOUNCEMENTS TAB */}
          {activeTab === "announcements" && isAdmin && (
            <div className="harmonia-card p-4">
              <h5 className="text-white mb-1">Broadcast Announcements</h5>
              <p className="text-muted-custom mb-4" style={{ fontSize: "0.85rem" }}>
                Send messages directly to the Harmonia mobile app consumed by students or to other vocal coaches.
              </p>
              
              <form onSubmit={handleSendAnnouncement}>
                <div className="mb-3 d-flex flex-column">
                  <label className="harmonia-label" htmlFor="audience-select">Target Audience</label>
                  <select 
                    id="audience-select"
                    className="harmonia-input"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                  >
                    <option value="all">All Students and Coaches (Public)</option>
                    <option value="student">Students Only</option>
                    <option value="coach">Vocal Coaches Only</option>
                  </select>
                </div>

                <div className="mb-4 d-flex flex-column">
                  <label className="harmonia-label" htmlFor="broadcast-msg">Message Content</label>
                  <textarea 
                    id="broadcast-msg"
                    rows="5"
                    className="harmonia-input"
                    placeholder="Type announcement message here..."
                    value={broadcastMsg}
                    onChange={(e) => setBroadcastMsg(e.target.value)}
                    required
                  ></textarea>
                </div>

                <div className="text-end">
                  <button type="submit" className="btn btn-harmonia px-4 d-flex align-items-center gap-2 ms-auto" disabled={loading}>
                    <i className="bi bi-send-fill"></i>
                    <span>Broadcast Message</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* BADGES CONFIGURATION TAB */}
          {activeTab === "badges" && isAdmin && (
            <div className="harmonia-card p-4">
              <h5 className="text-white mb-1">Badge Configuration &amp; Auto-Award Rules</h5>
              <p className="text-muted-custom mb-4" style={{ fontSize: "0.85rem" }}>
                Define accuracy thresholds and completion targets required to unlock achievements in the student portal.
              </p>
              
              <div className="d-flex flex-column gap-3">
                {badgesList.map(badge => {
                  const isEditing = editingBadgeId === badge.id;
                  
                  return (
                    <div key={badge.id} className="p-3 rounded border border-secondary border-opacity-10 bg-white bg-opacity-5 d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3">
                      <div className="d-flex align-items-center gap-3 text-start">
                        <div className="bg-primary bg-opacity-15 text-primary border border-primary border-opacity-25 rounded-circle d-flex align-items-center justify-content-center" style={{ width: 44, height: 44 }}>
                          <i className={`bi bi-${badge.iconRef} fs-5`}></i>
                        </div>
                        <div>
                          <strong className="text-white d-block">{badge.name}</strong>
                          
                          {isEditing ? (
                            <input 
                              type="text" 
                              className="harmonia-input py-0.5 px-2 mt-1" 
                              value={badgeCriteria}
                              onChange={(e) => setBadgeCriteria(e.target.value)}
                              style={{ fontSize: "0.85rem", width: "260px" }}
                            />
                          ) : (
                            <span className="text-muted-custom" style={{ fontSize: "0.85rem" }}>{badge.criteria}</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="d-flex align-items-center gap-2.5">
                        {isEditing ? (
                          <>
                            <div className="d-flex align-items-center gap-1.5">
                              <span className="text-muted-custom" style={{ fontSize: "0.85rem" }}>Threshold (%):</span>
                              <input 
                                type="number" 
                                min="1" max="100" 
                                className="harmonia-input py-1 text-center" 
                                style={{ width: "70px" }}
                                value={badgeThreshold}
                                onChange={(e) => setBadgeThreshold(e.target.value)}
                              />
                            </div>
                            <button 
                              className="btn btn-sm btn-success px-3"
                              onClick={() => handleSaveBadge(badge)}
                            >
                              Save
                            </button>
                            <button 
                              className="btn btn-sm btn-harmonia-outline"
                              onClick={() => setEditingBadgeId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="badge bg-white bg-opacity-5 text-white border border-secondary border-opacity-10 py-1.5 px-2.5" style={{ fontSize: "0.8rem" }}>
                              Ruleset: {badge.threshold}%
                            </span>
                            <button 
                              className="btn btn-sm btn-harmonia-outline py-1 px-2.5"
                              onClick={() => handleEditBadgeTrigger(badge)}
                            >
                              <i className="bi bi-pencil-fill me-1"></i> Edit Rule
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* DATA & PRIVACY CONTROL TAB */}
          {activeTab === "privacy" && canManageAccounts && (
            <div className="harmonia-card p-4">
              <h5 className="text-white mb-4">Data Governance &amp; Privacy Policies</h5>
              
              <form onSubmit={handleSaveInstitution}>
                <div className="row g-3 mb-4">
                  {/* Data Retention */}
                  <div className="col-md-6 d-flex flex-column text-start">
                    <label className="harmonia-label" htmlFor="retention-select">Vocal Performance Retention Period</label>
                    <select 
                      id="retention-select"
                      className="harmonia-input"
                      value={retentionPeriod}
                      onChange={(e) => setRetentionPeriod(e.target.value)}
                    >
                      <option value="3">3 Months</option>
                      <option value="6">6 Months</option>
                      <option value="12">12 Months (Recommended)</option>
                      <option value="24">24 Months</option>
                      <option value="infinite">Indefinite Retention</option>
                    </select>
                    <span className="text-muted-custom mt-1" style={{ fontSize: "0.75rem" }}>
                      Audio recordings and feature matrices older than this will be scrubbed automatically.
                    </span>
                  </div>

                  {/* Default Format */}
                  <div className="col-md-6 d-flex flex-column text-start">
                    <label className="harmonia-label" htmlFor="export-select">Preferred Export Format</label>
                    <select 
                      id="export-select"
                      className="harmonia-input"
                      value={defaultExport}
                      onChange={(e) => setDefaultExport(e.target.value)}
                    >
                      <option value="CSV">Comma Separated Values (CSV)</option>
                      <option value="PDF">Portable Document Format (PDF)</option>
                    </select>
                  </div>
                </div>

                <hr className="my-4 border-secondary border-opacity-20" />
                
                <div className="form-check text-start mb-4">
                  <input 
                    type="checkbox" 
                    className="form-check-input" 
                    id="statsCheck"
                    checked={anonymousStats}
                    onChange={(e) => setAnonymousStats(e.target.checked)}
                  />
                  <label className="form-check-label text-muted-custom" htmlFor="statsCheck" style={{ fontSize: "0.9rem" }}>
                    Enable anonymous analytics gathering (shares aggregated pitch/tone variance metrics to improve SVM model classification libraries)
                  </label>
                </div>

                <div className="text-end">
                  <button type="submit" className="btn btn-harmonia px-4" disabled={loading}>
                    Save Policies
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      </div>

    </div>
  );
};

export default Settings;
