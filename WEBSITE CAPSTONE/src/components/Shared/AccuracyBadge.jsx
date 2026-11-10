import React from "react";

export const AccuracyBadge = ({ type, value, passMark = 70 }) => {
  const available = typeof value === 'number' && Number.isFinite(value);
  const score = available ? Math.round(value) : null;
  
  let gradeClass = "low";
  let iconClass = "bi-exclamation-triangle-fill";
  
  if (score >= 85) {
    gradeClass = "high";
    iconClass = "bi-check-circle-fill";
  } else if (score >= passMark) {
    gradeClass = "moderate";
    iconClass = "bi-dash-circle-fill";
  }

  const label = type === "pitch" ? "Pitch" : "Tone";
  const badgeIcon = type === "pitch" ? "bi-music-note" : "bi-soundwave";

  return (
    <div className={`badge-metric ${gradeClass}`} title={available ? `${label}: ${score}%` : `${label}: unavailable`}>
      <i className={`bi ${badgeIcon} me-1`}></i>
      <span>{label}: <strong>{available ? `${score}%` : '—'}</strong></span>
      <i className={`bi ${iconClass} ms-1`} style={{ fontSize: '0.75rem' }}></i>
    </div>
  );
};

export default AccuracyBadge;
