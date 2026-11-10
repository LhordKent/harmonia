import { averageScore, hasBothScores } from '../firebase/sessionModel.js';
import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { 
  getStudents, getIndependentStudents, getStudentsByCoach, getSessions, getExercises, getCoaches, updateStudent, deleteStudent, updateSession, getBadges
} from "../firebase/firestore";
import { createSchoolAccount } from "../firebase/accountsService";
import CredentialHandover from "../components/Shared/CredentialHandover";
import {
  generateAIFeedback,
  getCoachFeedback,
  saveCoachFeedback,
  getCoachAssessment,
  getCoachAssessmentHistory,
  saveCoachAssessment,
  saveFinalCoachVerdict,
  finalizeCoachAssessment,
  VERDICT_OPTIONS,
} from "../firebase/feedbackService";

import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip 
} from "recharts";
import AccuracyBadge from "../components/Shared/AccuracyBadge";
import ConfirmModal from "../components/Shared/ConfirmModal";
import { resolveAudioUrl } from "../firebase/audioService.js";
import { normalizeSession, scoreVerdict } from '../firebase/sessionModel.js';

export const Students = () => {
  const { currentUser, canManageAccounts: isAdmin } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();

  // Data Loading
  const [loading, setLoading] = useState(true);
  const [showPendingEnrollment, setShowPendingEnrollment] = useState(false);
  const [students, setStudents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [availableBadges, setAvailableBadges] = useState([]);

  // Search, Filters & Sorting
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [accuracyFilter, setAccuracyFilter] = useState("all");
  const [coachFilter, setCoachFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");

  // Selection & Drawer States
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);

  // Audio Playback State
  const [playingAudio, setPlayingAudio] = useState(null); // sessionId
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioObj, setAudioObj] = useState(null);

  // Review Correction Input States
  const [isCorrecting, setIsCorrecting] = useState(false); // sessionId
  const [correctedPitch, setCorrectedPitch] = useState(80);
  const [correctedTone, setCorrectedTone] = useState(80);
  const [sessionFeedback, setSessionFeedback] = useState('');

  // Destructive Actions Modals
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState(null);

  // Student Form Modals (Admin Only)
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [studentModalMode, setStudentModalMode] = useState("create");
  const [editingStudentId, setEditingStudentId] = useState(null);
  
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [handover, setHandover] = useState(null);
  const [formCoachId, setFormCoachId] = useState("");
  const [formStatus, setFormStatus] = useState("active");

  // Coach Notification Modal
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyStudent, setNotifyStudent] = useState(null);
  const [notifyMsg, setNotifyMsg] = useState("");

  // ── Drawer Tab State ──
  const [drawerTab, setDrawerTab] = useState("sessions"); // "sessions" | "feedback"

  // ── Feedback & Verdict State ──
  const [aiFeedbackText, setAiFeedbackText] = useState("");
  const [coachFeedbackText, setCoachFeedbackText] = useState("");
  const [existingAssessmentId, setExistingAssessmentId] = useState(null);
  const [selectedVerdict, setSelectedVerdict] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [verdictSaving, setVerdictSaving] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const allStudents = currentUser.role === "admin" && showPendingEnrollment
        ? await getIndependentStudents()
        : isAdmin ? await getStudents(currentUser.institutionId, currentUser) : await getStudentsByCoach(currentUser.id, currentUser.institutionId);
      const allSessions = await getSessions(currentUser.institutionId, currentUser);
      const allExercises = await getExercises(currentUser.institutionId);
      const allCoaches = await getCoaches(currentUser.institutionId, currentUser);
      const allBadges = await getBadges();

      setStudents(allStudents);
      setSessions(allSessions);
      setExercises(allExercises);
      setCoaches(allCoaches);
      setAvailableBadges(allBadges);

      // Handle Deep Linking from Dashboard review redirects
      if (location.state?.openStudentId) {
        const student = allStudents.find(s => s.id === location.state.openStudentId);
        if (student) {
          setSelectedStudent(student);
          setDrawerOpen(true);
          if (location.state.openSessionId) {
            setActiveSessionId(location.state.openSessionId);
          }
        }
      }

    } catch (err) {
      console.error("Error loading students data:", err);
      showToast("Could not retrieve student list.", "danger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Cleanup audio on unmount
    return () => {
      if (audioObj) {
        audioObj.pause();
      }
    };
  }, [currentUser, location, showPendingEnrollment]);

  // Audio Playback Handlers
  const handlePlayAudio = async (sessionId, audioUrl) => {
    if (playingAudio === sessionId) {
      // Pause
      audioObj.pause();
      setPlayingAudio(null);
    } else {
      // Stop current
      if (audioObj) {
        audioObj.pause();
      }
      let audio;
      try {
        audio = new Audio(await resolveAudioUrl(audioUrl));
        await audio.play();
      } catch (error) {
        showToast(error.message || "Recording could not be played.", "danger");
        return;
      }
      setAudioObj(audio);
      setPlayingAudio(sessionId);
      
      audio.addEventListener("timeupdate", () => {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      });

      audio.addEventListener("ended", () => {
        setPlayingAudio(null);
        setAudioProgress(0);
      });
    }
  };

  // Human-in-the-loop Verdict Handlers
  const handleConfirmVerdict = async (session, advancementDecision = null) => {
    try {
      const updated = {
        coachVerdict: advancementDecision && session.coachVerdict ? session.coachVerdict : ['Excellent accuracy', 'Good stability', 'Requires improvement'].includes(session.aiVerdict) ? session.aiVerdict : 'Requires improvement',
        coachPitchScore: advancementDecision ? session.coachPitchScore ?? null : null,
        coachToneScore: advancementDecision ? session.coachToneScore ?? null : null,
        coachFeedback: session.coachFeedback || '',
        verdictStatus: "reviewed",
        ...(advancementDecision ? { advancementDecision } : {})
      };
      const saved = await updateSession(session.id, updated);
      showToast("Evaluation verdict confirmed by coach.", "success");
      
      // Update local state
      setSessions(prev => prev.map(s => s.id === session.id ? normalizeSession({ ...s, ...saved }) : s));
    } catch (err) {
      showToast("Failed to confirm verdict.", "danger");
    }
  };

  const handleCorrectVerdict = async (session) => {
    try {
      // Auto verdict mapping based on corrected scores
      const coachVerdict = scoreVerdict(correctedPitch, correctedTone, session.gradingEvidence?.policy?.passMark ?? 70);

      const updated = {
        coachPitchScore: correctedPitch,
        coachToneScore: correctedTone,
        coachFeedback: sessionFeedback,
        coachVerdict,
        verdictStatus: "reviewed"
      };

      const saved = await updateSession(session.id, updated);
      showToast("Evaluation results corrected and saved.", "success");
      
      // Update local state
      setSessions(prev => prev.map(s => s.id === session.id ? normalizeSession({ ...s, ...saved }) : s));
      setIsCorrecting(false);
    } catch (err) {
      showToast("Failed to save correction.", "danger");
    }
  };

  // Student Account Modification (Admin)
  const handleToggleStatus = async (student) => {
    try {
      const newStatus = student.status === "active" ? "inactive" : "active";
      await updateStudent(student.id, { status: newStatus });
      showToast(`Student account has been ${newStatus === "active" ? "reactivated" : "deactivated"}.`, "success");
      fetchData();
    } catch (err) {
      showToast("Failed to change account status.", "danger");
    }
  };

  const handleDeleteStudent = async () => {
    if (!studentToDelete) return;
    try {
      await deleteStudent(studentToDelete.id);
      showToast("Student account deleted successfully.", "success");
      setDrawerOpen(false);
      setSelectedStudent(null);
      fetchData();
    } catch (err) {
      showToast("Failed to delete student account.", "danger");
    } finally {
      setShowDeleteModal(false);
      setStudentToDelete(null);
    }
  };

  const handleOpenCreateStudent = () => {
    setFormName("");
    setFormEmail("");
    setFormCoachId("");
    setFormStatus("active");
    setStudentModalMode("create");
    setShowStudentModal(true);
  };

  const handleOpenEditStudent = (student) => {
    setFormName(student.name);
    setFormEmail(student.email);
    setFormCoachId(student.coachId || "");
    setFormStatus(student.status);
    setEditingStudentId(student.id);
    setStudentModalMode("edit");
    setShowStudentModal(true);
  };

  const handleSubmitStudent = async (e) => {
    e.preventDefault();
    if (!formName || !formEmail) {
      showToast("Name and email are required.", "warning");
      return;
    }
    try {
      setLoading(true);
      if (studentModalMode === "create") {
        // The trusted accounts service creates identity + profiles with the school base password.
        const account = await createSchoolAccount({
          role: "student", name: formName, email: formEmail,
          coachId: formCoachId || null, schoolId: currentUser.institutionId,
        });
        if (formStatus === "inactive" && account.uid) await updateStudent(account.uid, { status: "inactive" });
        setHandover(account);
      } else {
        await updateStudent(editingStudentId, {
          institutionId: students.find(s => s.id === editingStudentId)?.institutionId || currentUser.institutionId,
          studentType: "collaborated",
          name: formName,
          email: formEmail,
          coachId: formCoachId || null,
          status: formStatus
        });
        showToast("Student updated successfully.", "success");
      }
      setShowStudentModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to save student.", "danger");
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminder = (e) => {
    e.preventDefault();
    if (!notifyMsg) return;
    // Simulate sending reminder
    showToast(`Practice reminder sent to ${notifyStudent?.name}!`, "success");
    setShowNotifyModal(false);
    setNotifyMsg("");
  };

  // CSV Exporter (Admin only)
  const handleExportCSV = () => {
    try {
      const headers = ["Name", "Email", "Assigned Coach", "Status", "Avg Pitch Accuracy", "Avg Tone Accuracy", "Session Count"];
      const rows = students.map(student => {
        const coach = coaches.find(c => c.id === student.coachId);
        const studSessions = sessions.filter(s => s.studentId === student.id);
        
        let avgP = 0, avgT = 0;
        if (studSessions.length > 0) {
          avgP = Math.round(averageScore(studSessions, 'pitchAccuracy'));
          avgT = Math.round(averageScore(studSessions, 'toneAccuracy'));
        }

        return [
          `"${student.name}"`,
          `"${student.email}"`,
          `"${coach ? coach.name : "Unassigned"}"`,
          `"${student.status}"`,
          `${avgP}%`,
          `${avgT}%`,
          `${studSessions.length}`
        ];
      });

      const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `harmonia_students_roster_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Student roster exported as CSV.", "success");
    } catch (error) {
      showToast("Failed to export CSV.", "danger");
    }
  };

  // Render Logic Helpers
  const getStudentMetrics = (studentId) => {
    const studSessions = sessions.filter(s => s.studentId === studentId);
    let avgP = 0, avgT = 0;
    
    if (studSessions.length > 0) {
      avgP = Math.round(averageScore(studSessions, 'pitchAccuracy'));
      avgT = Math.round(averageScore(studSessions, 'toneAccuracy'));
    }

    // Trend calculation: compare first half vs second half of sessions
    let trend = "flat"; // up, down, flat
    if (studSessions.filter(hasBothScores).length >= 2) {
      const sorted = studSessions.filter(hasBothScores).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const mid = Math.floor(sorted.length / 2);
      const firstHalf = sorted.slice(0, mid);
      const secondHalf = sorted.slice(mid);
      
      const firstAvg = firstHalf.reduce((acc, s) => acc + (s.pitchAccuracy + s.toneAccuracy) / 2, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((acc, s) => acc + (s.pitchAccuracy + s.toneAccuracy) / 2, 0) / secondHalf.length;
      
      if (secondAvg - firstAvg > 1.5) trend = "up";
      else if (firstAvg - secondAvg > 1.5) trend = "down";
    }

    return {
      avgPitch: avgP,
      avgTone: avgT,
      count: studSessions.length,
      trend
    };
  };

  // Filter and Sort Students List
  const filteredStudents = students.filter(student => {
    // Standard Coach sees only their assigned students. Admin sees all unless filtered by coach
    if (!isAdmin && student.coachId !== currentUser.id) return false;
    if (isAdmin && coachFilter !== "all" && student.coachId !== coachFilter) return false;

    // Search query match
    const matchesSearch = student.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          student.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Status match
    const matchesStatus = statusFilter === "all" || student.status === statusFilter;

    // Accuracy criteria
    const metrics = getStudentMetrics(student.id);
    let matchesAccuracy = true;
    if (accuracyFilter === "high") {
      matchesAccuracy = metrics.avgPitch >= 85 && metrics.avgTone >= 85;
    } else if (accuracyFilter === "moderate") {
      matchesAccuracy = (metrics.avgPitch >= 70 && metrics.avgPitch < 85) || 
                        (metrics.avgTone >= 70 && metrics.avgTone < 85);
    } else if (accuracyFilter === "low") {
      matchesAccuracy = metrics.avgPitch < 70 || metrics.avgTone < 70;
    }

    return matchesSearch && matchesStatus && matchesAccuracy;
  }).sort((a, b) => {
    if (sortBy === "name") {
      return a.name.localeCompare(b.name);
    } else if (sortBy === "sessions") {
      return getStudentMetrics(b.id).count - getStudentMetrics(a.id).count;
    } else if (sortBy === "pitch") {
      return getStudentMetrics(b.id).avgPitch - getStudentMetrics(a.id).avgPitch;
    }
    return 0;
  });

  // Calculate drawer trend line data
  const getSelectedStudentHistory = () => {
    if (!selectedStudent) return [];
    const studSessions = sessions.filter(s => s.studentId === selectedStudent.id);
    return [...studSessions]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map((s, idx) => ({
        index: `Session ${idx + 1}`,
        Pitch: s.pitchAccuracy,
        Tone: s.toneAccuracy,
        date: new Date(s.timestamp).toLocaleDateString()
      }));
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading Students...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="slide-up text-start">
      
      {/* Filters Toolbar */}
      <div className="harmonia-card p-3.5 mb-4">
        <div className="row g-3 align-items-center">
          {/* Search */}
          <div className="col-md-3">
            <label className="harmonia-label">Search Student</label>
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

          {/* Status Filter */}
          <div className="col-sm-6 col-md-2">
            <label className="harmonia-label">Status</label>
            <select 
              className="harmonia-input w-100" 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {/* Accuracy Filter */}
          <div className="col-sm-6 col-md-2">
            <label className="harmonia-label">Accuracy Tier</label>
            <select 
              className="harmonia-input w-100" 
              value={accuracyFilter}
              onChange={(e) => setAccuracyFilter(e.target.value)}
            >
              <option value="all">All Levels</option>
              <option value="high">High Accuracy (≥85%)</option>
              <option value="moderate">Moderate (70-84%)</option>
              <option value="low">Needs Improvement (&lt;70%)</option>
            </select>
          </div>

          {/* Coach Filter (Admin only) */}
          {isAdmin && (
            <div className="col-sm-6 col-md-2">
              <label className="harmonia-label">Assigned Coach</label>
              <select 
                className="harmonia-input w-100" 
                value={coachFilter}
                onChange={(e) => setCoachFilter(e.target.value)}
              >
                <option value="all">All Coaches</option>
                {coaches.filter(c => c.status === "active").map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Sort By */}
          <div className="col-sm-6 col-md-2">
            <label className="harmonia-label">Sort By</label>
            <select 
              className="harmonia-input w-100" 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="name">Alphabetical</option>
              <option value="sessions">Session Count</option>
              <option value="pitch">Pitch Accuracy</option>
            </select>
          </div>

          {/* Admin Create & Export */}
          {isAdmin && (
            <div className="col-sm-12 col-md-2 d-flex align-items-end h-100 gap-2">
              <button 
                className="btn btn-harmonia w-100 py-2 px-2" 
                onClick={handleOpenCreateStudent}
                title="Create New Student"
                style={{ height: "42px", fontSize: "0.85rem" }}
              >
                <i className="bi bi-person-plus-fill me-1"></i> New
              </button>
              <button 
                className="btn btn-harmonia-outline py-2 px-2" 
                onClick={handleExportCSV}
                title="Export Roster CSV"
                style={{ height: "42px" }}
              >
                <i className="bi bi-file-earmark-excel-fill"></i>
              </button>
            </div>
          )}
        </div>
      </div>

      {currentUser.role === "admin" && (
        <div className="d-flex gap-2 mb-3">
          <button className={`btn ${!showPendingEnrollment ? "btn-harmonia" : "btn-harmonia-outline"}`} onClick={() => setShowPendingEnrollment(false)}>School roster</button>
          <button className={`btn ${showPendingEnrollment ? "btn-harmonia" : "btn-harmonia-outline"}`} onClick={() => setShowPendingEnrollment(true)}>Unassigned students awaiting enrollment</button>
        </div>
      )}
      {showPendingEnrollment && (
        <p className="text-muted-custom">These earlier self-registered students have no school. Edit one to enroll them into the selected school ({currentUser.institutionId || "none selected"}) and choose a coach. They cannot use the app until enrolled.</p>
      )}
      {/* Roster Table */}
      <div className="harmonia-card p-0">
        {filteredStudents.length === 0 ? (
          <div className="text-center py-5 text-muted-custom">
            <i className="bi bi-person-dash fs-2 mb-2 d-block"></i>
            No students found matching filters
          </div>
        ) : (
          <div className="harmonia-table-container">
            <table className="harmonia-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Status</th>
                  <th>Average Pitch &amp; Tone</th>
                  <th>Sessions</th>
                  <th>Performance Trend</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(student => {
                  const metrics = getStudentMetrics(student.id);
                  const isAssignedToMe = student.coachId === currentUser.id;
                  
                  return (
                    <tr key={student.id}>
                      {/* Name & Email */}
                      <td>
                        <div>
                          <strong className="text-white d-block">{student.name}</strong>
                          <span className="text-muted-custom" style={{ fontSize: "0.8rem" }}>{student.email}</span>
                        </div>
                      </td>
                      
                      {/* Status Badge */}
                      <td>
                        <span className={`badge bg-${student.status === "active" ? "success" : "secondary"} bg-opacity-20 text-${student.status === "active" ? "success" : "secondary"} border border-${student.status === "active" ? "success" : "secondary"} border-opacity-30 px-2.5 py-1`}>
                          {student.status === "active" ? "Active" : "Deactivated"}
                        </span>
                      </td>

                      {/* Accuracy Badges */}
                      <td>
                        {metrics.count > 0 ? (
                          <div className="accuracy-badge-container">
                            <AccuracyBadge type="pitch" value={metrics.avgPitch} />
                            <AccuracyBadge type="tone" value={metrics.avgTone} />
                          </div>
                        ) : (
                          <span className="text-muted-custom" style={{ fontSize: "0.85rem" }}>No session data</span>
                        )}
                      </td>

                      {/* Session Count */}
                      <td>
                        <span className="text-white font-weight-bold">{metrics.count}</span>
                      </td>

                      {/* Trend arrow */}
                      <td>
                        {metrics.count >= 2 ? (
                          <span className={`d-inline-flex align-items-center gap-1 fw-bold ${metrics.trend === "up" ? "text-success" : (metrics.trend === "down" ? "text-danger" : "text-muted-custom")}`}>
                            <i className={`bi ${metrics.trend === "up" ? "bi-arrow-up-right-circle-fill" : (metrics.trend === "down" ? "bi-arrow-down-right-circle-fill" : "bi-arrow-right-circle-fill")}`}></i>
                            <span style={{ fontSize: "0.8rem" }}>
                              {metrics.trend === "up" ? "Improving" : (metrics.trend === "down" ? "Declining" : "Stable")}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-custom" style={{ fontSize: "0.8rem" }}>-</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <button 
                            className="btn btn-sm btn-harmonia"
                            onClick={() => {
                              setSelectedStudent(student);
                              setDrawerOpen(true);
                            }}
                          >
                            <i className="bi bi-folder-fill me-1"></i> Open Drawer
                          </button>
                          
                          {/* Admin Row Actions */}
                          {isAdmin ? (
                            <>
                              <button 
                                className="btn btn-sm btn-dark border border-secondary border-opacity-10 text-white"
                                onClick={() => handleOpenEditStudent(student)}
                                title="Edit/Reassign Student"
                              >
                                <i className="bi bi-pencil-square"></i>
                              </button>
                              <button 
                                className={`btn btn-sm ${student.status === "active" ? "btn-outline-warning" : "btn-outline-success"}`}
                                onClick={() => handleToggleStatus(student)}
                              >
                                {student.status === "active" ? "Deactivate" : "Reactivate"}
                              </button>
                              <button 
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => {
                                  setStudentToDelete(student);
                                  setShowDeleteModal(true);
                                }}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </>
                          ) : (
                            <button 
                              className="btn btn-sm btn-harmonia-outline"
                              onClick={() => {
                                setNotifyStudent(student);
                                setShowNotifyModal(true);
                              }}
                              title="Send Notification"
                            >
                              <i className="bi bi-bell-fill"></i> Notify
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* STUDENT DETAIL DRAWER PANEL */}
      {drawerOpen && selectedStudent && (
        <DrawerWithFeedback
          selectedStudent={selectedStudent}
          sessions={sessions}
          exercises={exercises}
          coaches={coaches}
          availableBadges={availableBadges}
          currentUser={currentUser}
          isAdmin={isAdmin}
          drawerTab={drawerTab}
          setDrawerTab={setDrawerTab}
          aiFeedbackText={aiFeedbackText}
          setAiFeedbackText={setAiFeedbackText}
          coachFeedbackText={coachFeedbackText}
          setCoachFeedbackText={setCoachFeedbackText}
          existingAssessmentId={existingAssessmentId}
          setExistingAssessmentId={setExistingAssessmentId}
          selectedVerdict={selectedVerdict}
          setSelectedVerdict={setSelectedVerdict}
          feedbackLoading={feedbackLoading}
          setFeedbackLoading={setFeedbackLoading}
          verdictSaving={verdictSaving}
          setVerdictSaving={setVerdictSaving}
          playingAudio={playingAudio}
          audioProgress={audioProgress}
          isCorrecting={isCorrecting}
          setIsCorrecting={setIsCorrecting}
          correctedPitch={correctedPitch}
          setCorrectedPitch={setCorrectedPitch}
          correctedTone={correctedTone}
          setCorrectedTone={setCorrectedTone}
          sessionFeedback={sessionFeedback}
          setSessionFeedback={setSessionFeedback}
          handlePlayAudio={handlePlayAudio}
          handleConfirmVerdict={handleConfirmVerdict}
          handleCorrectVerdict={handleCorrectVerdict}
          setDrawerOpen={setDrawerOpen}
          showToast={showToast}
          activeSessionId={activeSessionId}
        />
      )}


      {/* CONFIRMATION MODALS (ADMIN ONLY) */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setStudentToDelete(null);
        }}
        onConfirm={handleDeleteStudent}
        title="Delete Student Account"
        message={`Are you sure you want to permanently delete ${studentToDelete?.name}'s student profile? This action will erase all of their performance logs, session recordings, and accuracy histories and cannot be undone.`}
        confirmText="Permanently Delete"
      />

      {/* STUDENT FORM MODAL (Admin Only) */}
      {showStudentModal && (
        <div className="drawer-backdrop d-flex justify-content-center align-items-center" style={{ zIndex: 1100 }}>
          <div className="harmonia-card fade-in text-start p-4" style={{ maxWidth: "500px", width: "95%", background: "#110e24", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h5 className="text-white mb-0 font-weight-bold">
                {studentModalMode === "edit" ? "Edit Student" : "Create New Student"}
              </h5>
              <button type="button" className="btn-close btn-close-white" onClick={() => setShowStudentModal(false)}></button>
            </div>

            <form onSubmit={handleSubmitStudent}>
              <div className="mb-3">
                <label className="harmonia-label">Name</label>
                <input type="text" className="harmonia-input" value={formName} onChange={(e) => setFormName(e.target.value)} required />
              </div>
              <div className="mb-3">
                <label className="harmonia-label">Email</label>
                <input type="email" className="harmonia-input" value={formEmail} readOnly={studentModalMode === "edit"} onChange={(e) => setFormEmail(e.target.value)} required />
              </div>
              {studentModalMode === "create" && (
                <p className="text-muted-custom mb-3" style={{ fontSize: "0.8rem" }}>
                  The student signs in on the Android app with your school's base password and must choose a new one first. Password recovery is sent to this email.
                </p>
              )}
              <div className="mb-3">
                <label className="harmonia-label">Assigned Coach <span className="text-muted-custom" style={{fontSize:"0.75rem"}}>(optional — can assign later)</span></label>
                <select className="harmonia-input" value={formCoachId} onChange={(e) => setFormCoachId(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {coaches.filter(c => c.status === "active").map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="harmonia-label">Status</label>
                <select className="harmonia-input" value={formStatus} onChange={(e) => setFormStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="d-flex justify-content-end gap-3 pt-3 border-top border-secondary border-opacity-10">
                <button type="button" className="btn btn-harmonia-outline" onClick={() => setShowStudentModal(false)} disabled={loading}>Cancel</button>
                <button type="submit" className="btn btn-harmonia" disabled={loading}>{loading ? "Saving..." : "Save Student"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CredentialHandover account={handover} onClose={() => setHandover(null)} />

      {/* NOTIFICATION MODAL (Coach Only) */}
      {showNotifyModal && (
        <div className="drawer-backdrop d-flex justify-content-center align-items-center" style={{ zIndex: 1100 }}>
          <div className="harmonia-card fade-in text-start p-4" style={{ maxWidth: "450px", width: "95%", background: "#110e24", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="text-white mb-0 font-weight-bold">Notify {notifyStudent?.name}</h5>
              <button type="button" className="btn-close btn-close-white" onClick={() => setShowNotifyModal(false)}></button>
            </div>
            <form onSubmit={handleSendReminder}>
              <div className="mb-4">
                <label className="harmonia-label">Message / Reminder</label>
                <textarea 
                  className="harmonia-input" 
                  rows="4" 
                  placeholder="e.g. Please practice the new arpeggio exercise!" 
                  value={notifyMsg} 
                  onChange={(e) => setNotifyMsg(e.target.value)} 
                  required
                ></textarea>
              </div>
              <div className="d-flex justify-content-end gap-3">
                <button type="button" className="btn btn-harmonia-outline" onClick={() => setShowNotifyModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-harmonia">Send Message</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

// ─────────────────────────────────────────────────────────
// DrawerWithFeedback — Student detail drawer sub-component
// Handles Sessions tab + Comprehensive Feedback & Verdict tab
// ─────────────────────────────────────────────────────────
const DrawerWithFeedback = ({
  selectedStudent, sessions, exercises, coaches, availableBadges,
  currentUser, isAdmin,
  drawerTab, setDrawerTab,
  aiFeedbackText, setAiFeedbackText,
  coachFeedbackText, setCoachFeedbackText,
  existingAssessmentId, setExistingAssessmentId,
  selectedVerdict, setSelectedVerdict,
  feedbackLoading, setFeedbackLoading,
  verdictSaving, setVerdictSaving,
  playingAudio, audioProgress,
  isCorrecting, setIsCorrecting,
  correctedPitch, setCorrectedPitch,
  correctedTone, setCorrectedTone,
  sessionFeedback, setSessionFeedback,
  handlePlayAudio, handleConfirmVerdict, handleCorrectVerdict,
  setDrawerOpen, showToast, activeSessionId,
}) => {
  const studentSessions = sessions.filter(s => s.studentId === selectedStudent.id);

  // Authority & Role Permissions
  const isAssignedCoach = selectedStudent.coachId === currentUser?.id;
  const canEditFeedback = isAssignedCoach && !isAdmin;
  const assignedCoachObj = coaches.find(c => c.id === selectedStudent.coachId);
  const assignedCoachName = assignedCoachObj?.name || "Unassigned";

  // Detailed Feedback States
  const [aiAlignment, setAiAlignment] = useState("neutral"); // "agree" | "override" | "neutral"
  const [additionalObservations, setAdditionalObservations] = useState("");
  const [assessmentStatus, setAssessmentStatus] = useState("draft"); // "draft" | "finalized"
  const [assessmentHistory, setAssessmentHistory] = useState([]);

  // Load feedback and history when tab opens
  const loadFeedbackData = useCallback(async () => {
    if (drawerTab !== "feedback") return;
    setFeedbackLoading(true);
    try {
      // 1. Generate AI advisory feedback from practice data
      const ai = generateAIFeedback(selectedStudent, studentSessions, exercises);
      setAiFeedbackText(ai);

      // 2. Load latest assessment if one exists
      const assessment = await getCoachAssessment(selectedStudent.id);
      if (assessment) {
        setExistingAssessmentId(assessment.id);
        setSelectedVerdict(assessment.finalVerdict || "");
        setCoachFeedbackText(assessment.coachFeedback || "");
        setAdditionalObservations(assessment.additionalObservations || "");
        setAiAlignment(assessment.aiAlignment || "neutral");
        setAssessmentStatus(assessment.status || "draft");
      } else {
        // Fallback to legacy single feedback if present
        const existingFeedback = await getCoachFeedback(selectedStudent.id, currentUser.id);
        if (existingFeedback) {
          setCoachFeedbackText(existingFeedback.feedbackText || "");
        }
      }

      // 3. Load full history of past assessments for this student
      const historyDocs = await getCoachAssessmentHistory(selectedStudent.id);
      setAssessmentHistory(historyDocs);

    } catch (err) {
      console.error("Error loading feedback:", err);
    } finally {
      setFeedbackLoading(false);
    }
  }, [drawerTab, selectedStudent.id, currentUser?.id]);

  useEffect(() => { loadFeedbackData(); }, [loadFeedbackData]);

  // Coach Agrees with AI
  const handleAgreeWithAI = () => {
    if (!canEditFeedback) return;
    setAiAlignment("agree");
    if (!coachFeedbackText.trim()) {
      setCoachFeedbackText("I concur with the AI performance analysis. The pitch stability and tone quality observed in studio practice match the recorded metrics. Great progress on vocal consistency.");
    }
    showToast("Marked as aligned with AI feedback. You may edit your feedback and select the final verdict.", "info");
  };

  // Coach Overrides AI
  const handleOverrideAI = () => {
    if (!canEditFeedback) return;
    setAiAlignment("override");
    if (!coachFeedbackText.trim() || coachFeedbackText.startsWith("I concur")) {
      setCoachFeedbackText("Coach Override: The automated analysis does not account for live breath management and tone support. My professional assessment is that breath control must be stabilized before advancing.");
    }
    showToast("AI evaluation marked as overridden by Vocal Coach. Enter your professional observations.", "warning");
  };

  // Save / Finalize Assessment
  const handleSaveAssessment = async (newStatus = "draft") => {
    if (!canEditFeedback) {
      showToast("Only the assigned Vocal Coach may modify this evaluation.", "danger");
      return;
    }
    if (newStatus === "finalized" && !selectedVerdict) {
      showToast("Please select a final verdict before finalizing this evaluation.", "warning");
      return;
    }

    setVerdictSaving(true);
    try {
      const saved = await saveCoachAssessment({
        studentId: selectedStudent.id,
        coachId: currentUser.id,
        coachName: currentUser.name || `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || "Vocal Coach",
        institutionId: currentUser.institutionId,
        aiFeedback: aiFeedbackText,
        aiAlignment,
        coachFeedback: coachFeedbackText,
        additionalObservations,
        finalVerdict: selectedVerdict,
        status: newStatus,
      });

      setExistingAssessmentId(saved.id);
      setAssessmentStatus(newStatus);
      showToast(
        newStatus === "finalized"
          ? "Evaluation FINALIZED and officially submitted by Vocal Coach."
          : "Evaluation draft saved to Firebase.",
        "success"
      );

      // Refresh history list
      const updatedHistory = await getCoachAssessmentHistory(selectedStudent.id);
      setAssessmentHistory(updatedHistory);
    } catch (err) {
      console.error(err);
      showToast("Failed to save evaluation.", "danger");
    } finally {
      setVerdictSaving(false);
    }
  };

  // Chart history helper
  const history = [...studentSessions]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((s, idx) => ({
      index: `S${idx + 1}`,
      Pitch: s.pitchAccuracy,
      Tone: s.toneAccuracy,
    }));

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
      <div className="harmonia-drawer open">
        {/* Header */}
        <div className="drawer-header">
          <div>
            <div className="d-flex align-items-center gap-2">
              <h4 className="text-white mb-1 font-weight-bold">{selectedStudent.name}</h4>
              <span className={`badge ${selectedStudent.status === "active" ? "bg-success" : "bg-secondary"} bg-opacity-20 text-${selectedStudent.status === "active" ? "success" : "secondary"}`} style={{ fontSize: "0.7rem" }}>
                {selectedStudent.status === "active" ? "Active" : "Inactive"}
              </span>
            </div>
            <span className="text-muted-custom" style={{ fontSize: "0.8rem" }}>
              {selectedStudent.email} &bull; Assigned Coach: <strong className="text-white">{assignedCoachName}</strong>
            </span>
          </div>
          <button type="button" className="btn-close btn-close-white" onClick={() => setDrawerOpen(false)} />
        </div>

        {/* Drawer Tab Bar */}
        <div className="px-4 pt-3 pb-0 d-flex gap-1 border-bottom border-secondary border-opacity-10">
          {["sessions", "feedback"].map(tab => (
            <button
              key={tab}
              onClick={() => setDrawerTab(tab)}
              className={`btn btn-sm px-3 py-1 mb-0 ${
                drawerTab === tab
                  ? "btn-harmonia"
                  : "btn-outline-secondary border-0 text-muted-custom"
              }`}
              style={{ borderRadius: "6px 6px 0 0", fontSize: "0.82rem" }}
            >
              {tab === "sessions" ? (
                <><i className="bi bi-music-note-list me-1"></i>Sessions</>
              ) : (
                <><i className="bi bi-chat-left-text-fill me-1"></i>Feedback &amp; Verdict</>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="drawer-body">
          {/* ══════════════ SESSIONS TAB ══════════════ */}
          {drawerTab === "sessions" && (
            <>
              {/* Badges */}
              <div className="mb-4">
                <h6 className="text-white mb-2 fw-bold">Earned Badges</h6>
                <div className="d-flex flex-wrap gap-2">
                  {(selectedStudent.badges?.length || 0) === 0 ? (
                    <span className="text-muted-custom" style={{ fontSize: "0.85rem" }}>No badges awarded yet</span>
                  ) : (
                    selectedStudent.badges?.map(badgeId => {
                      const badge = availableBadges.find(b => b.id === badgeId);
                      if (!badge) return null;
                      return (
                        <span key={badgeId} className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-2 py-1" style={{ fontSize: "0.8rem" }}>
                          <i className={`bi bi-${badge.iconRef} me-1`}></i>{badge.name}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Accuracy Chart */}
              <div className="mb-4">
                <h6 className="text-white mb-2 fw-bold">Performance Accuracy Curve</h6>
                <div className="bg-white bg-opacity-5 rounded p-2" style={{ height: 180 }}>
                  {history.length === 0 ? (
                    <div className="d-flex h-100 align-items-center justify-content-center text-muted-custom" style={{ fontSize: "0.85rem" }}>No session data to plot</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="index" stroke="#94a3b8" fontSize={9} />
                        <YAxis domain={[30, 100]} stroke="#94a3b8" fontSize={9} />
                        <Tooltip contentStyle={{ background: "#110e24", border: "1px solid rgba(255,255,255,0.12)", fontSize: "0.8rem" }} />
                        <Line type="monotone" dataKey="Pitch" stroke="#06b6d4" strokeWidth={2} dot={{ r: 2 }} />
                        <Line type="monotone" dataKey="Tone" stroke="#ec4899" strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Sessions List */}
              <div>
                <h6 className="text-white mb-2 fw-bold">Singing Performances</h6>
                <div className="d-flex flex-column gap-3">
                  {studentSessions.length === 0 ? (
                    <div className="text-center py-4 text-muted-custom">No recording sessions logged</div>
                  ) : (
                    [...studentSessions]
                      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                      .map(session => {
                        const exercise = exercises.find(e => e.id === session.exerciseId);
                        const isReviewing = activeSessionId === session.id;
                        return (
                          <div key={session.id} className={`p-3 rounded border ${
                            isReviewing ? "border-primary bg-primary bg-opacity-5" : "border-secondary border-opacity-10 bg-white bg-opacity-5"
                          }`}>
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <div>
                                <strong className="text-white d-block" style={{ fontSize: "0.9rem" }}>{exercise ? exercise.title : "Unknown Exercise"}</strong>
                                <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>{new Date(session.timestamp).toLocaleString()}</span>
                              </div>
                              <span className={`badge bg-${session.verdictStatus === "reviewed" ? "success" : "warning"} bg-opacity-25 text-${session.verdictStatus === "reviewed" ? "success" : "warning"} px-2`} style={{ fontSize: "0.7rem" }}>
                                {session.verdictStatus === "reviewed" ? "Reviewed" : "Needs Review"}
                              </span>
                            </div>
                            <div className="d-flex flex-wrap gap-2 mb-3">
                              <AccuracyBadge type="pitch" value={session.pitchAccuracy} passMark={session.gradingEvidence?.policy?.passMark ?? 70} />
                              <AccuracyBadge type="tone" value={session.toneAccuracy} passMark={session.gradingEvidence?.policy?.passMark ?? 70} />
                            </div>
                            <div className="p-2 mb-3 rounded bg-black bg-opacity-20" style={{ fontSize: "0.8rem" }}>
                              <div className="text-muted-custom" style={{ fontSize: "0.7rem" }}>PRACTICE ESTIMATE:</div>
                              <div className="text-white fw-bold">{session.aiVerdict}</div>
                              {session.gradingEvidence && <p className="mt-2 mb-0">{session.gradingEvidence.policy?.difficulty}: ±{session.gradingEvidence.policy?.toleranceCents} cents · {session.gradingEvidence.policy?.passMark}% pass mark. Tone estimates clarity and steadiness; coach review is required.</p>}
                              {session.feedbackNotes && <p className="mt-2 mb-0">{session.feedbackNotes}</p>}
                              <p className="mt-2 mb-0">Advancement: {session.advancementDecision === 'approved' ? 'Approved by coach' : session.advancementDecision === 'repeat' ? 'Repeat requested' : 'Awaiting explicit coach approval'}</p>
                              {session.coachVerdict && (
                                <div className="mt-1 border-top border-secondary border-opacity-10 pt-1">
                                  <span className="text-muted-custom" style={{ fontSize: "0.7rem" }}>COACH VERDICT: </span>
                                  <span className="text-primary fw-semibold">{session.coachVerdict}</span>
                                  {session.coachFeedback && <p className="mt-2 mb-0">{session.coachFeedback}</p>}
                                  {session.coachPitchScore != null && <p className="mt-2 mb-0">Original practice scores: pitch {session.accuracyScore}% · tone {session.toneScore}%</p>}
                                </div>
                              )}
                            </div>
                            <div className="audio-player-card mb-3">
                              <button className="audio-play-btn" onClick={() => handlePlayAudio(session.id, (session.audioStorageRef || session.audioStoragePath))}>
                                <i className={`bi ${playingAudio === session.id ? "bi-pause-fill" : "bi-play-fill"}`}></i>
                              </button>
                              <div className="audio-progress">
                                <div className="audio-progress-bar" style={{ width: `${playingAudio === session.id ? audioProgress : 0}%` }}></div>
                              </div>
                            </div>
                            <div className="d-flex justify-content-end gap-2 pt-2 border-top border-secondary border-opacity-10">
                              {isCorrecting === session.id ? (
                                <div className="w-100 text-start">
                                  <div className="row g-2 mb-2">
                                    <div className="col-6">
                                      <label className="harmonia-label" style={{ fontSize: "0.75rem" }}>Correct Pitch (%)</label>
                                      <input type="number" min="0" max="100" className="harmonia-input w-100 py-1" value={correctedPitch} onChange={e => setCorrectedPitch(Number(e.target.value))} />
                                    </div>
                                    <div className="col-6">
                                      <label className="harmonia-label" style={{ fontSize: "0.75rem" }}>Correct Tone (%)</label>
                                      <input type="number" min="0" max="100" className="harmonia-input w-100 py-1" value={correctedTone} onChange={e => setCorrectedTone(Number(e.target.value))} />
                                    </div>
                                  </div>
                                  <label className="harmonia-label" htmlFor={`review-${session.id}`}>Feedback for the student</label>
                                  <textarea id={`review-${session.id}`} className="harmonia-input w-100 mb-2" maxLength={4000} rows={3} value={sessionFeedback} onChange={e => setSessionFeedback(e.target.value)} />
                                  <div className="d-flex justify-content-end gap-2">
                                    <button className="btn btn-sm btn-harmonia-outline" onClick={() => setIsCorrecting(false)}>Cancel</button>
                                    <button className="btn btn-sm btn-success" onClick={() => handleCorrectVerdict(session)}>Save Correction</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button className="btn btn-sm btn-success" onClick={() => handleConfirmVerdict(session, 'approved')}>Approve advancement</button>
                                  <button className="btn btn-sm btn-harmonia-outline" onClick={() => handleConfirmVerdict(session, 'repeat')}>Request repeat</button>
                                  <button className="btn btn-sm btn-harmonia-outline text-warning border-warning" style={{ fontSize: "0.75rem" }} onClick={() => { setIsCorrecting(session.id); setCorrectedPitch(session.pitchAccuracy); setCorrectedTone(session.toneAccuracy); setSessionFeedback(session.coachFeedback || ''); }}>
                                    <i className="bi bi-pencil-fill me-1"></i> Correct Verdict
                                  </button>
                                  <button className="btn btn-sm btn-harmonia" style={{ fontSize: "0.75rem" }} onClick={() => handleConfirmVerdict(session)} disabled={session.verdictStatus === "reviewed" && session.coachVerdict === session.aiVerdict}>
                                    <i className="bi bi-check-lg me-1"></i> Confirm Practice Estimate
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </>
          )}

          {/* ══════════════ FEEDBACK & VERDICT TAB ══════════════ */}
          {drawerTab === "feedback" && (
            <>
              {/* Authority & Permissions Banner */}
              {!isAssignedCoach && !isAdmin && (
                <div className="p-3 mb-3 rounded" style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                  <div className="d-flex align-items-center gap-2">
                    <i className="bi bi-shield-lock-fill text-danger fs-5"></i>
                    <div>
                      <strong className="text-danger d-block" style={{ fontSize: "0.85rem" }}>Read-Only Mode: Restricted Access</strong>
                      <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>
                        You are not the assigned Vocal Coach for this student (Assigned: <strong>{assignedCoachName}</strong>). Only the assigned coach may submit evaluations or final verdicts.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="p-3 mb-3 rounded" style={{ background: "rgba(6, 182, 212, 0.1)", border: "1px solid rgba(6, 182, 212, 0.3)" }}>
                  <div className="d-flex align-items-center gap-2">
                    <i className="bi bi-info-circle-fill text-info fs-5"></i>
                    <div>
                      <strong className="text-info d-block" style={{ fontSize: "0.85rem" }}>Administrator Oversight</strong>
                      <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>
                        Viewing student performance analytics and coach assessments. The assigned coach (<strong>{assignedCoachName}</strong>) holds exclusive authority over final student evaluations.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {isAssignedCoach && (
                <div className="p-2.5 mb-3 rounded d-flex align-items-center gap-2" style={{ background: "rgba(139, 92, 246, 0.12)", border: "1px solid rgba(139, 92, 246, 0.3)" }}>
                  <i className="bi bi-person-check-fill text-primary fs-5"></i>
                  <div style={{ fontSize: "0.78rem" }}>
                    <span className="text-white fw-bold">Assigned Vocal Coach Authority:</span>{" "}
                    <span className="text-muted-custom">You have final authority over this evaluation. The AI assessment is advisory only.</span>
                  </div>
                </div>
              )}

              {feedbackLoading ? (
                <div className="text-center py-5">
                  <div className="spinner-border spinner-border-sm text-primary" />
                  <p className="text-muted-custom mt-2" style={{ fontSize: "0.85rem" }}>Loading evaluation &amp; practice data…</p>
                </div>
              ) : (
                <div className="d-flex flex-column gap-4">

                  {/* ── 1. Practice Overview Alongside AI ── */}
                  <div>
                    <h6 className="text-white fw-bold mb-2">Practice Data Summary</h6>
                    <div className="row g-2 mb-3">
                      {[
                        { label: "Total Sessions", value: studentSessions.length, icon: "bi-journal-text" },
                        { label: "Avg Pitch", value: studentSessions.length > 0 ? Math.round(studentSessions.reduce((s,x) => s + (x.pitchAccuracy||0), 0) / studentSessions.length) + "%" : "N/A", icon: "bi-music-note" },
                        { label: "Avg Tone", value: studentSessions.length > 0 ? Math.round(studentSessions.reduce((s,x) => s + (x.toneAccuracy||0), 0) / studentSessions.length) + "%" : "N/A", icon: "bi-soundwave" },
                        { label: "Reviewed", value: studentSessions.filter(s => s.verdictStatus === "reviewed").length, icon: "bi-check-circle" },
                      ].map(stat => (
                        <div className="col-6" key={stat.label}>
                          <div className="p-2 rounded bg-white bg-opacity-5 text-center">
                            <i className={`bi ${stat.icon} text-primary d-block mb-1`}></i>
                            <div className="text-white fw-bold" style={{ fontSize: "1.05rem" }}>{stat.value}</div>
                            <div className="text-muted-custom" style={{ fontSize: "0.7rem" }}>{stat.label}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Recent sessions review strip */}
                    <div className="p-2 rounded bg-black bg-opacity-20 border border-secondary border-opacity-10">
                      <div className="text-muted-custom mb-1.5 fw-bold" style={{ fontSize: "0.72rem" }}>
                        <i className="bi bi-clock-history me-1"></i>RECENT SESSIONS RECORDED:
                      </div>
                      {studentSessions.length === 0 ? (
                        <div className="text-muted-custom" style={{ fontSize: "0.75rem" }}>No session recordings logged yet.</div>
                      ) : (
                        <div className="d-flex flex-column gap-1.5">
                          {studentSessions.slice(0, 3).map(s => {
                            const ex = exercises.find(e => e.id === s.exerciseId);
                            return (
                              <div key={s.id} className="d-flex justify-content-between align-items-center p-1.5 rounded bg-white bg-opacity-5" style={{ fontSize: "0.75rem" }}>
                                <span className="text-white text-truncate me-2" style={{ maxWidth: "160px" }}>{ex ? ex.title : "Exercise"}</span>
                                <div className="d-flex align-items-center gap-2">
                                  <span className="text-info">P: {s.pitchAccuracy}%</span>
                                  <span className="text-primary">T: {s.toneAccuracy}%</span>
                                  <button
                                    className="btn btn-sm btn-dark p-0 px-1.5 border border-secondary border-opacity-20 text-white"
                                    onClick={() => handlePlayAudio(s.id, (s.audioStorageRef || s.audioStoragePath))}
                                    title="Listen Recording"
                                  >
                                    <i className={`bi ${playingAudio === s.id ? "bi-pause-fill" : "bi-play-fill"}`}></i>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── 2. AI-Generated Feedback (Advisory) ── */}
                  <div className="p-3 rounded" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.3)" }}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-robot text-primary fs-5"></i>
                        <span className="text-primary fw-bold" style={{ fontSize: "0.85rem" }}>AI-GENERATED ADVISORY FEEDBACK</span>
                      </div>
                      {aiAlignment === "agree" && (
                        <span className="badge bg-success bg-opacity-20 text-success border border-success border-opacity-30" style={{ fontSize: "0.7rem" }}>
                          <i className="bi bi-check-circle me-1"></i>Coach Agrees
                        </span>
                      )}
                      {aiAlignment === "override" && (
                        <span className="badge bg-danger bg-opacity-20 text-danger border border-danger border-opacity-30" style={{ fontSize: "0.7rem" }}>
                          <i className="bi bi-exclamation-triangle me-1"></i>Coach Override
                        </span>
                      )}
                    </div>

                    <p className="text-muted-custom mb-3" style={{ fontSize: "0.82rem", lineHeight: "1.55" }}>
                      {aiFeedbackText || "Generating feedback from student data…"}
                    </p>

                    <div className="p-2 rounded mb-3 bg-black bg-opacity-20 d-flex align-items-center gap-1.5 text-muted-custom" style={{ fontSize: "0.72rem" }}>
                      <i className="bi bi-info-circle text-primary"></i>
                      <span><strong>Notice:</strong> This feedback is generated algorithmically from available practice statistics. The Vocal Coach has the final authority.</span>
                    </div>

                    {/* Coach Interaction: Agree or Override */}
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className={`btn btn-sm flex-fill ${aiAlignment === "agree" ? "btn-success" : "btn-outline-success"}`}
                        style={{ fontSize: "0.75rem" }}
                        onClick={handleAgreeWithAI}
                        disabled={!canEditFeedback}
                      >
                        <i className="bi bi-hand-thumbs-up-fill me-1"></i>
                        Agree with AI Assessment
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm flex-fill ${aiAlignment === "override" ? "btn-warning" : "btn-outline-warning"}`}
                        style={{ fontSize: "0.75rem" }}
                        onClick={handleOverrideAI}
                        disabled={!canEditFeedback}
                      >
                        <i className="bi bi-slash-circle-fill me-1"></i>
                        Disagree / Override AI
                      </button>
                    </div>
                  </div>

                  {/* ── 3. Vocal Coach Professional Feedback ── */}
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-pen-fill" style={{ color: "#06b6d4" }}></i>
                        <span className="text-white fw-bold" style={{ fontSize: "0.85rem" }}>VOCAL COACH FEEDBACK</span>
                      </div>
                      <span className="badge bg-info bg-opacity-10 text-info border border-info border-opacity-20" style={{ fontSize: "0.68rem" }}>
                        Official Coach Input
                      </span>
                    </div>

                    <textarea
                      className="harmonia-input w-100 mb-3"
                      rows={4}
                      placeholder="Write your professional observations about this student's vocal placement, pitch, and performance…"
                      value={coachFeedbackText}
                      onChange={e => setCoachFeedbackText(e.target.value)}
                      disabled={!canEditFeedback || feedbackLoading}
                      style={{ resize: "vertical" }}
                    />

                    {/* Additional Observations / Technique Context */}
                    <label className="harmonia-label mb-1" style={{ fontSize: "0.75rem" }}>
                      <i className="bi bi-journal-check me-1 text-primary"></i>
                      Additional Context &amp; Technique Observations (Breath, Posture, Resonance)
                    </label>
                    <textarea
                      className="harmonia-input w-100 mb-3"
                      rows={2}
                      placeholder="e.g. Focus on diaphragmatic support during ascending scales; tension noted around G4 transition."
                      value={additionalObservations}
                      onChange={e => setAdditionalObservations(e.target.value)}
                      disabled={!canEditFeedback || feedbackLoading}
                      style={{ resize: "vertical", fontSize: "0.8rem" }}
                    />
                  </div>

                  {/* ── Divider ── */}
                  <hr style={{ borderColor: "rgba(255,255,255,0.08)" }} />

                  {/* ── 4. Final Coach Verdict ── */}
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-award-fill" style={{ color: "#f59e0b" }}></i>
                        <span className="text-white fw-bold" style={{ fontSize: "0.85rem" }}>FINAL COACH VERDICT</span>
                      </div>
                      <span className="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-20" style={{ fontSize: "0.68rem" }}>
                        Final Decision
                      </span>
                    </div>
                    <p className="text-muted-custom mb-3" style={{ fontSize: "0.78rem" }}>
                      Select the authoritative outcome. The AI cannot determine or replace this verdict.
                    </p>

                    <div className="d-flex flex-column gap-2 mb-3">
                      {VERDICT_OPTIONS.map(opt => (
                        <label
                          key={opt.value}
                          className={`d-flex align-items-start gap-2 p-2 rounded ${!canEditFeedback ? "opacity-75" : "cursor-pointer"} ${
                            selectedVerdict === opt.value
                              ? "bg-primary bg-opacity-10 border border-primary border-opacity-30"
                              : "bg-white bg-opacity-5 border border-secondary border-opacity-10"
                          }`}
                          style={{ cursor: canEditFeedback ? "pointer" : "default" }}
                        >
                          <input
                            type="radio"
                            name="verdict"
                            value={opt.value}
                            checked={selectedVerdict === opt.value}
                            onChange={() => canEditFeedback && setSelectedVerdict(opt.value)}
                            disabled={!canEditFeedback}
                            className="mt-1"
                          />
                          <div>
                            <div className="text-white" style={{ fontSize: "0.83rem", fontWeight: 600 }}>{opt.label}</div>
                            <div className="text-muted-custom" style={{ fontSize: "0.75rem" }}>{opt.description}</div>
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* Verdict Actions */}
                    {canEditFeedback && (
                      <div className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-harmonia-outline flex-fill d-flex align-items-center justify-content-center gap-1.5"
                          onClick={() => handleSaveAssessment("draft")}
                          disabled={verdictSaving}
                          style={{ fontSize: "0.8rem" }}
                        >
                          {verdictSaving ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-floppy-fill"></i>}
                          Save Draft
                        </button>
                        <button
                          type="button"
                          className="btn btn-harmonia flex-fill d-flex align-items-center justify-content-center gap-1.5"
                          onClick={() => handleSaveAssessment("finalized")}
                          disabled={verdictSaving || !selectedVerdict}
                          style={{ fontSize: "0.8rem" }}
                        >
                          {verdictSaving ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-lock-fill"></i>}
                          Finalize Evaluation
                        </button>
                      </div>
                    )}

                    {assessmentStatus === "finalized" && (
                      <div className="mt-2.5 p-2 rounded bg-success bg-opacity-10 border border-success border-opacity-25 text-center text-success" style={{ fontSize: "0.75rem" }}>
                        <i className="bi bi-check-circle-fill me-1"></i>
                        This evaluation has been <strong>finalized</strong> by Vocal Coach {assignedCoachName}. The verdict is locked as official.
                      </div>
                    )}
                  </div>

                  {/* ── 5. History of Previous Feedback & Assessments ── */}
                  <hr style={{ borderColor: "rgba(255,255,255,0.08)" }} />

                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-clock-history text-muted-custom"></i>
                        <span className="text-white fw-bold" style={{ fontSize: "0.85rem" }}>PREVIOUS EVALUATION HISTORY</span>
                      </div>
                      <span className="text-muted-custom" style={{ fontSize: "0.72rem" }}>
                        {assessmentHistory.length} recorded
                      </span>
                    </div>

                    {assessmentHistory.length === 0 ? (
                      <div className="p-3 rounded bg-white bg-opacity-5 text-center text-muted-custom" style={{ fontSize: "0.78rem" }}>
                        No previously finalized evaluations logged for this student yet.
                      </div>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {assessmentHistory.map((item, idx) => {
                          const itemDate = item.finalizedAt?.toDate?.() || item.updatedAt?.toDate?.() || new Date(item.createdAt || 0);
                          const verdictOpt = VERDICT_OPTIONS.find(v => v.value === item.finalVerdict);
                          return (
                            <div key={item.id || idx} className="p-2.5 rounded bg-white bg-opacity-5 border border-secondary border-opacity-10 text-start">
                              <div className="d-flex justify-content-between align-items-center mb-1">
                                <span className="text-white fw-semibold" style={{ fontSize: "0.8rem" }}>
                                  {verdictOpt ? verdictOpt.label : (item.finalVerdict || "Assessment Logged")}
                                </span>
                                <span className="text-muted-custom" style={{ fontSize: "0.7rem" }}>
                                  {itemDate ? itemDate.toLocaleDateString() : "Recent"}
                                </span>
                              </div>
                              <div className="d-flex gap-2 mb-1.5" style={{ fontSize: "0.7rem" }}>
                                <span className="text-muted-custom">Coach: <strong className="text-white">{item.coachName || "Coach"}</strong></span>
                                {item.aiAlignment === "agree" && <span className="text-success">&bull; Agreed with AI</span>}
                                {item.aiAlignment === "override" && <span className="text-danger">&bull; Overrode AI</span>}
                                <span className={`badge ${item.status === "finalized" ? "bg-success" : "bg-warning"} bg-opacity-20 text-${item.status === "finalized" ? "success" : "warning"}`}>
                                  {item.status === "finalized" ? "Finalized" : "Draft"}
                                </span>
                              </div>
                              {item.coachFeedback && (
                                <p className="text-muted-custom mb-0 text-truncate" style={{ fontSize: "0.74rem" }}>
                                  "{item.coachFeedback}"
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};


export default Students;
