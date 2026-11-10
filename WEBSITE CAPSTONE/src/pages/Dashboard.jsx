import { averageScore, hasBothScores } from '../firebase/sessionModel.js';
import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { 
  getStudents, getStudentsByCoach, getSessions, getExercises, getCoaches 
} from "../firebase/firestore";
import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend 
} from "recharts";
import AccuracyBadge from "../components/Shared/AccuracyBadge";

export const Dashboard = () => {
  const { currentUser, canManageAccounts: isAdmin } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Data Loading States
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [coaches, setCoaches] = useState([]);

  // Calculated Personal Metrics (Coach-specific)
  const [coachStudentsCount, setCoachStudentsCount] = useState(0);
  const [avgPitch, setAvgPitch] = useState(0);
  const [avgTone, setAvgTone] = useState(0);
  const [activeSessionsThisWeek, setActiveSessionsThisWeek] = useState(0);
  const [weeklyTrendData, setWeeklyTrendData] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);

  // Calculated Admin Metrics
  const [adminStats, setAdminStats] = useState({
    totalCoaches: 0,
    totalStudents: 0,
    totalSessions: 0
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const allStudents = isAdmin ? await getStudents(currentUser.institutionId, currentUser) : await getStudentsByCoach(currentUser.id, currentUser.institutionId);
      const allSessions = await getSessions(currentUser.institutionId, currentUser);
      const allExercises = await getExercises(currentUser.institutionId);
      const allCoaches = await getCoaches(currentUser.institutionId, currentUser);

      setStudents(allStudents);
      setSessions(allSessions);
      setExercises(allExercises);
      setCoaches(allCoaches);

      if (isAdmin) {
        // Global admin metrics
        setAdminStats({
          totalCoaches: allCoaches.filter(c => c.status === "active").length,
          totalStudents: allStudents.length,
          totalSessions: allSessions.length
        });
      }

      // Filter data for current coach's students
      // Standard coach only sees their own assigned students. Admin sees all or their own.
      // Let's filter students assigned to this coach
      const myStudents = allStudents.filter(s => s.coachId === currentUser.id);
      setCoachStudentsCount(myStudents.length);

      const myStudentIds = new Set(myStudents.map(s => s.id));
      const mySessions = allSessions.filter(s => myStudentIds.has(s.studentId));

      // Calculate Averages
      if (mySessions.length > 0) {
        const sumPitch = mySessions.reduce((acc, s) => acc + s.pitchAccuracy, 0);
        const sumTone = mySessions.reduce((acc, s) => acc + s.toneAccuracy, 0);
        setAvgPitch(averageScore(mySessions, 'pitchAccuracy'));
        setAvgTone(averageScore(mySessions, 'toneAccuracy'));
      } else {
        setAvgPitch(0);
        setAvgTone(0);
      }

      // Calculate Active Sessions This Week (last 7 days)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const weeklySessions = mySessions.filter(s => new Date(s.timestamp) >= oneWeekAgo);
      setActiveSessionsThisWeek(weeklySessions.length);

      // Compile Recent Activity (latest 5 performances)
      // Sort by timestamp desc
      const sortedSessions = [...mySessions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      const activityFeed = sortedSessions.slice(0, 5).map(sess => {
        const student = allStudents.find(s => s.id === sess.studentId);
        const exercise = allExercises.find(e => e.id === sess.exerciseId);
        return {
          id: sess.id,
          studentName: student ? student.name : "Unknown Student",
          studentId: sess.studentId,
          exerciseTitle: exercise ? exercise.title : "Unknown Exercise",
          timestamp: new Date(sess.timestamp).toLocaleString(),
          pitchAccuracy: sess.pitchAccuracy,
          toneAccuracy: sess.toneAccuracy,
          status: sess.verdictStatus
        };
      });
      setRecentActivity(activityFeed);

      // Generate 8-week trend data
      // Group by weeks
      const trend = [];
      const now = new Date();
      for (let i = 7; i >= 0; i--) {
        const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
        const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        
        const weekSessions = mySessions.filter(s => {
          const date = new Date(s.timestamp);
          return date >= weekStart && date < weekEnd;
        });

        const weekLabel = `Wk ${8 - i}`;
        if (weekSessions.length > 0) {
          const wPitch = averageScore(weekSessions, 'pitchAccuracy');
          const wTone = averageScore(weekSessions, 'toneAccuracy');
          trend.push({
            name: weekLabel,
            Pitch: wPitch == null ? null : Math.round(wPitch),
            Tone: wTone == null ? null : Math.round(wTone)
          });
        } else {
          // No recorded measurements means no plotted score for this week.
          trend.push({
            name: weekLabel,
            Pitch: null,
            Tone: null
          });
        }
      }
      setWeeklyTrendData(trend);

    } catch (err) {
      console.error("Dashboard data fetch error:", err);
      showToast("Failed to load dashboard statistics.", "danger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentUser, isAdmin]);


  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading Dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="slide-up">
      
      {/* Welcome Banner */}
      <div className="harmonia-card mb-4 p-4 border-0" style={{
        background: `linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(6, 182, 212, 0.1) 100%)`
      }}>
        <div className="row align-items-center">
          <div className="col-md-8 text-start">
            <h3 className="text-white mb-1">Welcome back, {currentUser?.name}!</h3>
            <p className="text-muted-custom mb-0" style={{ fontSize: "0.95rem" }}>
              Here's the summary of your vocal class performance and recent activities.
            </p>
          </div>
          <div className="col-md-4 text-md-end mt-3 mt-md-0">
            <span className="badge bg-white bg-opacity-10 text-white border border-secondary border-opacity-10 py-2 px-3">
              <i className="bi bi-calendar3 me-2"></i>
              {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      {/* Admin Summary Row */}
      {isAdmin && (
        <div className="mb-4 text-start">
          <h5 className="text-white mb-3 d-flex align-items-center gap-2">
            <i className="bi bi-shield-lock text-primary"></i>
            Institution Admin Console
          </h5>
          <div className="row g-3">
            <div className="col-md-4">
              <div className="harmonia-card p-3 d-flex align-items-center justify-content-between" style={{ borderLeft: "4px solid #8b5cf6" }}>
                <div>
                  <div className="text-muted-custom" style={{ fontSize: "0.8rem", fontWeight: 500 }}>TOTAL COACHES</div>
                  <h3 className="text-white mb-0 fw-bold">{adminStats.totalCoaches}</h3>
                </div>
                <div className="bg-primary bg-opacity-10 p-2.5 rounded-circle text-primary">
                  <i className="bi bi-person-badge fs-4"></i>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="harmonia-card p-3 d-flex align-items-center justify-content-between" style={{ borderLeft: "4px solid #06b6d4" }}>
                <div>
                  <div className="text-muted-custom" style={{ fontSize: "0.8rem", fontWeight: 500 }}>TOTAL STUDENTS</div>
                  <h3 className="text-white mb-0 fw-bold">{adminStats.totalStudents}</h3>
                </div>
                <div className="bg-cyan bg-opacity-10 p-2.5 rounded-circle text-cyan">
                  <i className="bi bi-people-fill fs-4" style={{ color: "#06b6d4" }}></i>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="harmonia-card p-3 d-flex align-items-center justify-content-between" style={{ borderLeft: "4px solid #ec4899" }}>
                <div>
                  <div className="text-muted-custom" style={{ fontSize: "0.8rem", fontWeight: 500 }}>TOTAL PERFORMANCES</div>
                  <h3 className="text-white mb-0 fw-bold">{adminStats.totalSessions}</h3>
                </div>
                <div className="bg-pink bg-opacity-10 p-2.5 rounded-circle text-pink">
                  <i className="bi bi-soundwave fs-4" style={{ color: "#ec4899" }}></i>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Statistics Grid */}
      <div className="row g-3 mb-4">
        {/* Assigned Students */}
        <div className="col-sm-6 col-xl-3 text-start">
          <div className="harmonia-card h-100 p-3.5 d-flex flex-column justify-content-between">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="text-muted-custom" style={{ fontSize: "0.85rem", fontWeight: 500 }}>Assigned Students</span>
              <div className="bg-white bg-opacity-5 p-2 rounded text-muted-custom">
                <i className="bi bi-person-fill"></i>
              </div>
            </div>
            <div>
              <h2 className="text-white mb-1 fw-bold">{coachStudentsCount}</h2>
              <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>Registered roster size</span>
            </div>
          </div>
        </div>

        {/* Avg Pitch Accuracy */}
        <div className="col-sm-6 col-xl-3 text-start">
          <div className="harmonia-card h-100 p-3.5 d-flex flex-column justify-content-between" style={{ borderBottom: "3px solid #06b6d4" }}>
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="text-muted-custom" style={{ fontSize: "0.85rem", fontWeight: 500 }}>Class Avg Pitch</span>
              <div className="bg-cyan bg-opacity-10 p-2 rounded text-cyan">
                <i className="bi bi-music-note"></i>
              </div>
            </div>
            <div>
              <h2 className="text-white mb-1 fw-bold">{avgPitch == null ? '—' : `${Math.round(avgPitch)}%`}</h2>
              <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>Passing standards vary by difficulty</span>
            </div>
          </div>
        </div>

        {/* Avg Tone Accuracy */}
        <div className="col-sm-6 col-xl-3 text-start">
          <div className="harmonia-card h-100 p-3.5 d-flex flex-column justify-content-between" style={{ borderBottom: "3px solid #ec4899" }}>
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="text-muted-custom" style={{ fontSize: "0.85rem", fontWeight: 500 }}>Class Avg Tone</span>
              <div className="bg-pink bg-opacity-10 p-2 rounded text-pink">
                <i className="bi bi-soundwave"></i>
              </div>
            </div>
            <div>
              <h2 className="text-white mb-1 fw-bold">{avgTone == null ? '—' : `${Math.round(avgTone)}%`}</h2>
              <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>Experimental clarity and steadiness</span>
            </div>
          </div>
        </div>

        {/* Active Sessions */}
        <div className="col-sm-6 col-xl-3 text-start">
          <div className="harmonia-card h-100 p-3.5 d-flex flex-column justify-content-between">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="text-muted-custom" style={{ fontSize: "0.85rem", fontWeight: 500 }}>Active This Week</span>
              <div className="bg-white bg-opacity-5 p-2 rounded text-muted-custom">
                <i className="bi bi-activity"></i>
              </div>
            </div>
            <div>
              <h2 className="text-white mb-1 fw-bold">{activeSessionsThisWeek}</h2>
              <span className="text-muted-custom" style={{ fontSize: "0.75rem" }}>Sessions logged in past 7d</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart and Verification Queue */}
      <div className="row g-4 mb-4">
        {/* double-line trend chart */}
        <div className="col-lg-8 text-start">
          <div className="harmonia-card p-4 h-100">
            <h5 className="text-white mb-4">8-Week Class Accuracy Trend</h5>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis domain={[40, 100]} stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ background: "#110e24", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px" }}
                    labelStyle={{ color: "#fff", fontWeight: "bold" }}
                  />
                  <Legend verticalAlign="top" height={36} />
                  <Line type="monotone" dataKey="Pitch" stroke="#06b6d4" strokeWidth={3} activeDot={{ r: 8 }} name="Pitch Accuracy" dot={{ strokeWidth: 2, r: 4 }} />
                  <Line type="monotone" dataKey="Tone" stroke="#ec4899" strokeWidth={3} name="Tone Accuracy" dot={{ strokeWidth: 2, r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Dashboard Info box */}
        <div className="col-lg-4 text-start">
          <div className="harmonia-card p-4 h-100 d-flex flex-column justify-content-between">
            <div>
              <h5 className="text-white mb-3">Quick Actions</h5>
              <p className="text-muted-custom mb-4" style={{ fontSize: "0.85rem", lineHeight: "1.5" }}>
                {isAdmin ? 
                  "Manage your institution's vocal coaches, students, and overall system configuration here." : 
                  "Coaches are recommended to check pending student evaluations. Human-in-the-loop validation updates AI accuracy mappings."}
              </p>
            </div>
            <div className="d-flex flex-column gap-2">
              <Link to="/students" className="btn btn-harmonia w-100 py-2 text-center text-decoration-none">
                <i className="bi bi-people-fill me-2"></i> Roster Review
              </Link>
              {isAdmin ? (
                <Link to="/coaches" className="btn btn-harmonia-outline w-100 py-2 text-center text-decoration-none">
                  <i className="bi bi-person-badge me-2"></i> Manage Coaches
                </Link>
              ) : (
                <Link to="/exercises" className="btn btn-harmonia-outline w-100 py-2 text-center text-decoration-none">
                  <i className="bi bi-plus-lg me-2"></i> Manage Exercises
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="harmonia-card p-4 text-start">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h5 className="text-white mb-0">Recent Activity Feed</h5>
          <Link to="/students" className="text-primary text-decoration-none" style={{ fontSize: "0.85rem" }}>
            View Full Roster <i className="bi bi-arrow-right"></i>
          </Link>
        </div>

        {recentActivity.length === 0 ? (
          <div className="text-center py-5 text-muted-custom">
            <i className="bi bi-inbox fs-2 text-muted mb-2 d-block"></i>
            No student sessions recorded yet
          </div>
        ) : (
          <div className="harmonia-table-container">
            <table className="harmonia-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Exercise</th>
                  <th>Date &amp; Time</th>
                  <th>Verdict Accuracy</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map(activity => (
                  <tr key={activity.id}>
                    <td>
                      <strong className="text-white">{activity.studentName}</strong>
                    </td>
                    <td>{activity.exerciseTitle}</td>
                    <td className="text-muted-custom" style={{ fontSize: "0.85rem" }}>{activity.timestamp}</td>
                    <td>
                      <div className="accuracy-badge-container">
                        <AccuracyBadge type="pitch" value={activity.pitchAccuracy} />
                        <AccuracyBadge type="tone" value={activity.toneAccuracy} />
                      </div>
                    </td>
                    <td>
                      {/* Navigate to students and pass studentId/sessionId state to open detail drawer automatically! */}
                      <button 
                        onClick={() => navigate("/students", { state: { openStudentId: activity.studentId, openSessionId: activity.id } })}
                        className={`btn btn-sm ${activity.status === "pending" ? "btn-harmonia" : "btn-harmonia-outline"}`}
                        style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
                      >
                        {activity.status === "pending" ? (
                          <>
                            <i className="bi bi-clipboard-check me-1"></i> Review
                          </>
                        ) : (
                          "View Detail"
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default Dashboard;
