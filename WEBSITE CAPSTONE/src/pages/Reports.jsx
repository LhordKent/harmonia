import { averageScore, hasBothScores } from '../firebase/sessionModel.js';
import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { getStudents, getSessions, getCoaches } from "../firebase/firestore";
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend 
} from "recharts";
import AccuracyBadge from "../components/Shared/AccuracyBadge";

export const Reports = () => {
  const { currentUser, canManageAccounts: isAdmin } = useAuth();
  const { showToast } = useToast();

  // Data States
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [coaches, setCoaches] = useState([]);

  // Filter States
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [groupFilter, setGroupFilter] = useState("all"); // 'all', or specific coach if admin
  
  // Analytics Metrics
  const [classAvgPitch, setClassAvgPitch] = useState(0);
  const [classAvgTone, setClassAvgTone] = useState(0);
  const [topPerformer, setTopPerformer] = useState({ name: "N/A", score: 0 });
  const [mostImproved, setMostImproved] = useState({ name: "N/A", growth: 0 });
  const [chartData, setChartData] = useState([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const allStudents = await getStudents(currentUser?.institutionId, currentUser);
      const allSessions = await getSessions(currentUser?.institutionId, currentUser);
      const allCoaches = await getCoaches(currentUser?.institutionId, currentUser);

      setStudents(allStudents);
      setSessions(allSessions);
      setCoaches(allCoaches);

      // Default Date Range: past 30 days
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 30);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));

    } catch (err) {
      showToast("Error retrieving report dataset.", "danger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Compute analytics dynamically when data or filters change
  useEffect(() => {
    if (students.length === 0 || sessions.length === 0) return;

    // 1. Filter students by coach ownership
    // Standard Coach: only their students. Admin: depends on groupFilter
    let filteredStudents = students;
    if (!isAdmin) {
      filteredStudents = students.filter(s => s.coachId === currentUser.id);
    } else if (groupFilter !== "all") {
      filteredStudents = students.filter(s => s.coachId === groupFilter);
    }

    const studentIds = new Set(filteredStudents.map(s => s.id));

    // 2. Filter sessions by date range and student scope
    const startMs = startDate ? new Date(startDate).getTime() : 0;
    const endMs = endDate ? new Date(endDate + "T23:59:59").getTime() : Infinity;

    const filteredSessions = sessions.filter(s => {
      const time = new Date(s.timestamp).getTime();
      return studentIds.has(s.studentId) && time >= startMs && time <= endMs;
    });

    // 3. Calculate Class Averages
    if (filteredSessions.length > 0) {
      const sumP = filteredSessions.reduce((acc, s) => acc + s.pitchAccuracy, 0);
      const sumT = filteredSessions.reduce((acc, s) => acc + s.toneAccuracy, 0);
      setClassAvgPitch(averageScore(filteredSessions, 'pitchAccuracy'));
      setClassAvgTone(averageScore(filteredSessions, 'toneAccuracy'));
    } else {
      setClassAvgPitch(0);
      setClassAvgTone(0);
    }

    // 4. Calculate per-student metrics for comparison chart and top performer
    const comparisonList = [];
    let bestStudent = { name: "None", score: 0 };
    let highestGrowthStudent = { name: "None", growth: 0 };

    filteredStudents.forEach(student => {
      const studSessions = filteredSessions.filter(s => s.studentId === student.id && hasBothScores(s));
      
      if (studSessions.length > 0) {
        const avgP = Math.round(averageScore(studSessions, 'pitchAccuracy'));
        const avgT = Math.round(averageScore(studSessions, 'toneAccuracy'));
        const combined = Math.round((avgP + avgT) / 2);

        comparisonList.push({
          name: student.name,
          Pitch: avgP,
          Tone: avgT,
          Combined: combined
        });

        // Top Performer comparison
        if (combined > bestStudent.score) {
          bestStudent = { name: student.name, score: combined };
        }

        // Most Improved calculation (latest session average vs oldest session average)
        if (studSessions.filter(hasBothScores).length >= 2) {
          const sorted = studSessions.filter(hasBothScores).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          const oldest = (sorted[0].pitchAccuracy + sorted[0].toneAccuracy) / 2;
          const newest = (sorted[sorted.length - 1].pitchAccuracy + sorted[sorted.length - 1].toneAccuracy) / 2;
          const growth = Math.round(newest - oldest);
          
          if (growth > highestGrowthStudent.growth) {
            highestGrowthStudent = { name: student.name, growth };
          }
        }
      }
    });

    setChartData(comparisonList);
    setTopPerformer(bestStudent.score > 0 ? bestStudent : { name: "N/A", score: 0 });
    setMostImproved(highestGrowthStudent.growth > 0 ? highestGrowthStudent : { name: "N/A", growth: 0 });

  }, [students, sessions, startDate, endDate, groupFilter]);

  // Client-Side CSV Export Trigger
  const handleExportCSV = () => {
    try {
      const headers = ["Student Name", "Filtered Pitch Accuracy", "Filtered Tone Accuracy", "Combined Average"];
      const rows = chartData.map(c => [
        `"${c.name}"`,
        `${c.Pitch}%`,
        `${c.Tone}%`,
        `${c.Combined}%`
      ]);

      const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `harmonia_performance_report_${startDate}_to_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Filtered report data exported as CSV.", "success");
    } catch (err) {
      showToast("Failed to compile CSV report.", "danger");
    }
  };

  // PDF Print Trigger (Invokes browser print with custom print-friendly styles)
  const handlePrintPDF = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <div className="spinner-border text-primary" role="status"></div>
      </div>
    );
  }

  return (
    <div className="slide-up text-start">
      
      {/* Reports Header & Action buttons */}
      <div className="d-flex justify-content-between align-items-center mb-4 d-print-none">
        <h4 className="text-white mb-0 font-weight-bold">Analytics &amp; Performance Reports</h4>
        <div className="d-flex gap-2">
          <button 
            className="btn btn-harmonia-outline d-flex align-items-center gap-2 py-2 px-3"
            onClick={handleExportCSV}
            disabled={chartData.length === 0}
          >
            <i className="bi bi-file-earmark-spreadsheet-fill"></i>
            <span>Export CSV</span>
          </button>
          
          <button 
            className="btn btn-harmonia d-flex align-items-center gap-2 py-2 px-3"
            onClick={handlePrintPDF}
            disabled={chartData.length === 0}
          >
            <i className="bi bi-printer-fill"></i>
            <span>Print Report (PDF)</span>
          </button>
        </div>
      </div>

      {/* Print-only Report Header */}
      <div className="d-none d-print-block mb-4">
        <h2 className="text-dark font-weight-bold">Harmonia Vocal conservatory</h2>
        <h4 className="text-secondary">Class Performance Report Summary</h4>
        <p className="text-muted mb-3">
          Date Period: <strong>{startDate}</strong> to <strong>{endDate}</strong>
        </p>
        <hr />
      </div>

      {/* Filter Parameters - Hidden during printing */}
      <div className="harmonia-card p-3.5 mb-4 d-print-none">
        <div className="row g-3 align-items-center">
          {/* Start Date */}
          <div className="col-md-3">
            <label className="harmonia-label">Start Date</label>
            <input
              type="date"
              className="harmonia-input w-100"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {/* End Date */}
          <div className="col-md-3">
            <label className="harmonia-label">End Date</label>
            <input
              type="date"
              className="harmonia-input w-100"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Class Cohort/Group selector */}
          <div className="col-md-4">
            {isAdmin ? (
              <>
                <label className="harmonia-label">Class Instructor Group</label>
                <select 
                  className="harmonia-input w-100" 
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                >
                  <option value="all">All Coaches (Institution-Wide)</option>
                  {coaches.filter(c => c.status === "active").map(c => (
                    <option key={c.id} value={c.id}>{c.name}'s Students</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label className="harmonia-label">Class Roster</label>
                <input 
                  type="text" 
                  className="harmonia-input w-100" 
                  value="My Assigned Roster" 
                  disabled 
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary Scorecards Row */}
      <div className="row g-3 mb-4">
        {/* Class Avg Pitch */}
        <div className="col-md-3 text-start">
          <div className="harmonia-card p-3.5" style={{ borderLeft: "4px solid #06b6d4" }}>
            <div className="text-muted-custom" style={{ fontSize: "0.8rem", fontWeight: 500 }}>CLASS AVG PITCH</div>
            <h2 className="text-white mb-0 fw-bold">{classAvgPitch == null ? '—' : `${Math.round(classAvgPitch)}%`}</h2>
          </div>
        </div>
        {/* Class Avg Tone */}
        <div className="col-md-3 text-start">
          <div className="harmonia-card p-3.5" style={{ borderLeft: "4px solid #ec4899" }}>
            <div className="text-muted-custom" style={{ fontSize: "0.8rem", fontWeight: 500 }}>CLASS AVG TONE</div>
            <h2 className="text-white mb-0 fw-bold">{classAvgTone == null ? '—' : `${Math.round(classAvgTone)}%`}</h2>
          </div>
        </div>
        {/* Top Performer */}
        <div className="col-md-3 text-start">
          <div className="harmonia-card p-3.5" style={{ borderLeft: "4px solid #10b981" }}>
            <div className="text-muted-custom" style={{ fontSize: "0.8rem", fontWeight: 500 }}>TOP PERFORMER</div>
            <h5 className="text-white mb-0 fw-bold text-truncate" style={{ fontSize: "1.15rem", marginTop: "4px" }}>
              {topPerformer.name} 
              {topPerformer.score > 0 && <span className="text-success ms-1">({topPerformer.score}%)</span>}
            </h5>
          </div>
        </div>
        {/* Most Improved */}
        <div className="col-md-3 text-start">
          <div className="harmonia-card p-3.5" style={{ borderLeft: "4px solid #f59e0b" }}>
            <div className="text-muted-custom" style={{ fontSize: "0.8rem", fontWeight: 500 }}>MOST IMPROVED</div>
            <h5 className="text-white mb-0 fw-bold text-truncate" style={{ fontSize: "1.15rem", marginTop: "4px" }}>
              {mostImproved.name} 
              {mostImproved.growth > 0 && <span className="text-warning ms-1">(+{mostImproved.growth}%)</span>}
            </h5>
          </div>
        </div>
      </div>

      {/* Comparison Accuracy Chart */}
      <div className="harmonia-card p-4 mb-4">
        <h5 className="text-white mb-4 d-print-text-dark">Student Accuracy Distribution</h5>
        {chartData.length === 0 ? (
          <div className="text-center py-5 text-muted-custom">
            No recording histories found in selected parameters.
          </div>
        ) : (
          <div style={{ width: "100%", height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" strokeDashoffset={2} />
                <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} fontSize={11} />
                <YAxis domain={[0, 100]} stroke="#94a3b8" tickLine={false} fontSize={11} />
                <Tooltip 
                  contentStyle={{ background: "#110e24", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", color: "#fff" }}
                  labelStyle={{ fontWeight: "bold" }}
                />
                <Legend verticalAlign="top" height={36} />
                <Bar dataKey="Pitch" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Pitch Accuracy (%)" />
                <Bar dataKey="Tone" fill="#ec4899" radius={[4, 4, 0, 0]} name="Tone Accuracy (%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Printable Report Data Details */}
      <div className="harmonia-card p-4">
        <h5 className="text-white mb-4 d-print-text-dark">Detailed Data Log</h5>
        <div className="harmonia-table-container">
          <table className="harmonia-table">
            <thead>
              <tr>
                <th>Student Roster</th>
                <th>Pitch Score</th>
                <th>Tone Score</th>
                <th>Combined Rating</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map(c => (
                <tr key={c.name}>
                  <td><strong className="text-white d-print-text-dark">{c.name}</strong></td>
                  <td>
                    <AccuracyBadge type="pitch" value={c.Pitch} />
                  </td>
                  <td>
                    <AccuracyBadge type="tone" value={c.Tone} />
                  </td>
                  <td>
                    <span className="text-white font-weight-bold d-print-text-dark">{c.Combined}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default Reports;
