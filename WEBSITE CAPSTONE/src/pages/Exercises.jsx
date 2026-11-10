import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { uploadReferenceAudio, resolveAudioUrl } from "../firebase/audioService.js";
import { exerciseFields, validatePrerequisite, DIFFICULTY } from '../firebase/exerciseModel.js';
import { extractReferenceMelody } from '../firebase/referenceMelody.js';
import { getExercises, getExercisesByCoach, createExercise, updateExercise, deleteExercise } from "../firebase/firestore";
import ConfirmModal from "../components/Shared/ConfirmModal";

export const Exercises = () => {
  const { currentUser, isAdmin } = useAuth();
  const { showToast } = useToast();

  // Data Loading
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTier, setActiveTier] = useState("All");

  // Form Modal States
  const [showFormModal, setShowFormModal] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // create, edit
  const [editingId, setEditingId] = useState(null);

  // Form Fields
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState("Beginner");
  const [duration, setDuration] = useState(""); // seconds
  const [referenceAudioRef, setReferenceAudioRef] = useState("");
  const [targetPitchData, setTargetPitchData] = useState(""); // Hz target
  const [targetToneData, setTargetToneData] = useState(""); // Spectral Centroid target
  const [unlockCriteria, setUnlockCriteria] = useState("None");
  const [exerciseType, setExerciseType] = useState('single');
  const [targetNotes, setTargetNotes] = useState([]);
  const [targetApproved, setTargetApproved] = useState(false);
  const [targetPage, setTargetPage] = useState(0);
  const [analyzingReference, setAnalyzingReference] = useState(false);

  // File Upload State
  const [audioFile, setAudioFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  // Delete Action Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [exerciseToDelete, setExerciseToDelete] = useState(null);

  // Audio Playback Preview State
  const [previewingAudio, setPreviewingAudio] = useState(null); // exerciseId
  const [audioObj, setAudioObj] = useState(null);

  const fetchExercisesList = async () => {
    try {
      setLoading(true);
      const data = isAdmin ? await getExercises(currentUser.institutionId) : await getExercisesByCoach(currentUser.id);
      setExercises(data);
    } catch (err) {
      showToast("Failed to load exercises.", "danger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExercisesList();
    return () => {
      if (audioObj) audioObj.pause();
    };
  }, []);

  // Form Reset Helper
  const resetForm = () => {
    setExerciseType('single'); setTargetNotes([]); setTargetApproved(false); setTargetPage(0);
    setTitle("");
    setTier("Beginner");
    setDuration("");
    setReferenceAudioRef("");
    setTargetPitchData("");
    setTargetToneData("");
    setUnlockCriteria("None");
    setAudioFile(null);
    setUploadProgress(0);
    setUploading(false);
    setEditingId(null);
  };

  // Trigger Create Form
  const handleOpenCreateModal = () => {
    resetForm();
    setModalMode("create");
    setShowFormModal(true);
  };

  // Trigger Edit Form
  const handleOpenEditModal = (ex) => {
    resetForm();
    setModalMode("edit");
    setEditingId(ex.id);
    setTitle(ex.title);
    setTier(ex.tier);
    setDuration(ex.duration);
    setReferenceAudioRef(ex.referenceAudioRef);
    setTargetPitchData(ex.targetPitchData);
    setTargetToneData(ex.targetToneData);
    setUnlockCriteria(ex.prerequisiteId || "None");
    setExerciseType(ex.exerciseType || 'single'); setTargetNotes(ex.targetNotes || []); setTargetApproved(ex.targetApproved === true);
    setShowFormModal(true);
  };

  // Private reference audio upload
  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setAudioFile(e.target.files[0]);
      setTargetApproved(false);
    }
  };

  const handleUploadAudio = async () => {
    if (!audioFile) {
      showToast("Please choose an audio file first.", "warning");
      return null;
    }

    setUploading(true);
    setUploadProgress(10);
    try {
      const audioRef = await uploadReferenceAudio(audioFile, crypto.randomUUID());
      setUploadProgress(100);
      return audioRef;
    } finally {
      setUploading(false);
    }
  };

  // Submit Exercise Form (Create / Edit)
  const handleSubmitForm = async (e) => {
    e.preventDefault();

    // Validations
    if (!title || !duration || (exerciseType === 'single' && !targetPitchData)) {
      showToast("Please fill in all target parameters.", "warning");
      return;
    }

    try {
      setLoading(true);
      const prerequisiteId = unlockCriteria === 'None' ? null : unlockCriteria;
      validatePrerequisite(editingId, prerequisiteId, exercises);
      exerciseFields({ title, tier, duration: Number(duration), targetPitchData: Number(targetPitchData || 440), exerciseType, targetNotes, targetApproved });
      let audioUrl = referenceAudioRef;

      // Perform file upload if a new file is chosen
      if (audioFile) {
        const uploadedUrl = await handleUploadAudio();
        if (uploadedUrl) {
          audioUrl = uploadedUrl;
        } else {
          return; // failed
        }
      }

      const exerciseData = {
        title,
        tier,
        exerciseType, targetNotes, targetApproved, prerequisiteId,
        targetVersion: crypto.randomUUID(),
        duration: Number(duration),
        referenceAudioRef: audioUrl,
        targetPitchData: Number(targetPitchData || 440),
        targetToneData: targetToneData === '' ? null : Number(targetToneData),
        unlockCriteria
      };

      if (modalMode === "edit") {
        await updateExercise(editingId, exerciseData);
      } else {
        exerciseData.coachId = currentUser.id;
        exerciseData.institutionId = currentUser.institutionId;
        await createExercise(exerciseData);
      }
      showToast(`Exercise successfully ${modalMode === "edit" ? "updated" : "created"}.`, "success");
      setShowFormModal(false);
      resetForm();
      fetchExercisesList();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to save exercise.", "danger");
    } finally {
      setLoading(false);
    }
  };

  // Delete Action Handler
  const handleDeleteTrigger = (ex) => {
    setExerciseToDelete(ex);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!exerciseToDelete) return;
    try {
      setLoading(true);
      await deleteExercise(exerciseToDelete.id);
      showToast("Exercise deleted successfully.", "success");
      fetchExercisesList();
    } catch (err) {
      showToast("Failed to delete exercise.", "danger");
    } finally {
      setLoading(false);
    }
  };

  // Preview Reference Audio Playback
  const toggleAudioPreview = async (exId, url) => {
    if (previewingAudio === exId) {
      audioObj.pause();
      setPreviewingAudio(null);
    } else {
      if (audioObj) audioObj.pause();
      let audio;
      try {
        audio = new Audio(await resolveAudioUrl(url));
        await audio.play();
      } catch (error) {
        showToast(error.message || "Reference audio could not be played.", "danger");
        return;
      }
      setAudioObj(audio);
      setPreviewingAudio(exId);
      
      audio.addEventListener("ended", () => {
        setPreviewingAudio(null);
      });
    }
  };

  // Format Duration Helper (seconds to mm:ss)
  const formatDuration = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Group exercises by tier
  const tiers = ["All", "Beginner", "Intermediate", "Advanced"];
  const filteredExercises = activeTier === "All" 
    ? exercises 
    : exercises.filter(e => e.tier === activeTier);

  return (
    <div className="slide-up text-start">
      
      {/* Page Title & Add Button */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h4 className="text-white mb-0 font-weight-bold">Vocal Exercises</h4>
        
        {/* Only Vocal Coaches can modify exercises */}
        {!isAdmin && (
          <button 
            aria-label="Create Exercise"
            className="btn btn-harmonia d-flex align-items-center gap-2 py-2 px-3"
            onClick={handleOpenCreateModal}
          >
            <i className="bi bi-plus-circle"></i>
            <span>Create Exercise</span>
          </button>
        )}
      </div>

      {/* Tiers Navigation */}
      <div className="harmonia-card p-2 mb-4 d-flex flex-wrap gap-2">
        {tiers.map(t => (
          <button
            key={t}
            onClick={() => setActiveTier(t)}
            className={`btn px-4 py-2 border-0 rounded-3 ${activeTier === t ? "btn-harmonia" : "text-muted-custom bg-transparent"}`}
            style={{ fontWeight: 600, fontSize: "0.9rem" }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Exercises Roster Grid */}
      {loading && exercises.length === 0 ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status"></div>
        </div>
      ) : filteredExercises.length === 0 ? (
        <div className="harmonia-card text-center py-5 text-muted-custom">
          <i className="bi bi-music-note-list fs-2 mb-2 d-block"></i>
          No exercises found in the {activeTier} tier.
        </div>
      ) : (
        <div className="row g-4">
          {filteredExercises.map(ex => (
            <div key={ex.id} className="col-md-6 col-lg-4">
              <div className="harmonia-card h-100 p-4 d-flex flex-column justify-content-between">
                
                {/* Header Information */}
                <div>
                  <div className="d-flex justify-content-between align-items-start mb-3">
                    <span className={`badge px-2.5 py-1 rounded-pill ${
                      ex.tier === "Beginner" ? "bg-success bg-opacity-20 text-success border border-success border-opacity-25" : 
                      (ex.tier === "Intermediate" ? "bg-warning bg-opacity-20 text-warning border border-warning border-opacity-25" : 
                      "bg-danger bg-opacity-20 text-danger border border-danger border-opacity-25")
                    }`} style={{ fontSize: "0.75rem", fontWeight: "600" }}>
                      {ex.tier}
                    </span>
                    <span className="text-muted-custom" style={{ fontSize: "0.8rem" }}>
                      <i className="bi bi-clock me-1"></i>
                      {formatDuration(ex.duration)}
                    </span>
                  </div>

                  <h5 className="text-white mb-3" style={{ fontWeight: 600 }}>{ex.title}</h5>

                  {/* Parameters Grid */}
                  <div className="row g-2 mb-4 p-2.5 rounded bg-white bg-opacity-5">
                    <div className="col-6">
                      <div className="text-muted-custom" style={{ fontSize: "0.65rem", textTransform: "uppercase" }}>Target Pitch</div>
                      <div className="text-cyan fw-bold" style={{ fontSize: "0.85rem", color: "#06b6d4" }}>
                        {ex.targetPitchData} Hz
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="text-muted-custom" style={{ fontSize: "0.65rem", textTransform: "uppercase" }}>Target Tone</div>
                      <div className="text-pink fw-bold" style={{ fontSize: "0.85rem", color: "#ec4899" }}>
                        {ex.targetToneData} SC
                      </div>
                    </div>
                    <div className="col-12 border-top border-secondary border-opacity-10 pt-1.5 mt-1.5">
                      <div className="text-muted-custom" style={{ fontSize: "0.65rem", textTransform: "uppercase" }}>Unlock Criteria</div>
                      <div className="text-white" style={{ fontSize: "0.8rem" }}>
                        {ex.unlockCriteria === "None" ? "Instantly Available" : `Complete: ${ex.unlockCriteria}`}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Operations Toolbar */}
                <div className="d-flex align-items-center gap-2 pt-3 border-top border-secondary border-opacity-10">
                  <button 
                    className="btn btn-sm btn-harmonia-outline d-flex align-items-center gap-1 py-2 flex-grow-1 justify-content-center"
                    onClick={() => toggleAudioPreview(ex.id, ex.referenceAudioRef)}
                    style={{ fontSize: "0.8rem" }}
                  >
                    <i className={`bi ${previewingAudio === ex.id ? "bi-stop-fill text-danger" : "bi-play-fill text-success"}`}></i>
                    {previewingAudio === ex.id ? "Stop Preview" : "Play Audio"}
                  </button>
                  
                  {!isAdmin && (
                    <>
                      <button 
                        className="btn btn-sm btn-dark border border-secondary border-opacity-10 text-white py-2"
                        onClick={() => handleOpenEditModal(ex)}
                        title="Edit Exercise"
                      >
                        <i className="bi bi-pencil-square"></i>
                      </button>
                      
                      <button 
                        className="btn btn-sm btn-outline-danger py-2"
                        onClick={() => handleDeleteTrigger(ex)}
                        title="Delete Exercise"
                      >
                        <i className="bi bi-trash"></i>
                      </button>
                    </>
                  )}
                </div>

              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT EXERCISE MODAL */}
      {showFormModal && (
        <div className="drawer-backdrop d-flex justify-content-center align-items-center" style={{ zIndex: 1100 }}>
          <div 
            className="harmonia-card fade-in text-start p-4" 
            style={{ maxWidth: "550px", width: "95%", maxHeight: "90vh", overflowY: "auto", background: "#110e24", border: "1px solid rgba(255, 255, 255, 0.12)" }}
          >
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h5 className="text-white mb-0 font-weight-bold">
                {modalMode === "edit" ? "Edit Exercise Settings" : "Create New Exercise"}
              </h5>
              <button 
                type="button" 
                className="btn-close btn-close-white" 
                onClick={() => setShowFormModal(false)}
              ></button>
            </div>

            <form onSubmit={handleSubmitForm}>
              {/* Title */}
              <div className="mb-3 d-flex flex-column">
                <label className="harmonia-label" htmlFor="title-input">Exercise Title</label>
                <input
                  id="title-input"
                  type="text"
                  className="harmonia-input"
                  placeholder="e.g. Arpeggio Pitch Jumps"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="row g-3 mb-3">
                {/* Tier */}
                <div className="col-md-6 d-flex flex-column">
                  <label className="harmonia-label" htmlFor="tier-select">Difficulty Tier</label>
                  <select 
                    id="tier-select"
                    className="harmonia-input" 
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                </div>
                {/* Duration */}
                <div className="col-md-6 d-flex flex-column">
                  <label className="harmonia-label" htmlFor="duration-input">Duration (Seconds)</label>
                  <input
                    id="duration-input"
                    type="number"
                    min="3" max="600" step="1"
                    className="harmonia-input"
                    placeholder="e.g. 90"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="mb-3 d-flex flex-column">
                <label className="harmonia-label" htmlFor="practice-type">Practice type</label>
                <select id="practice-type" className="harmonia-input" value={exerciseType} onChange={e => { setExerciseType(e.target.value); setTargetApproved(false); }}>
                  <option value="single">Single note</option><option value="scale">Scale</option><option value="song">Full song</option><option value="free">Free vocalising (no pitch grade)</option>
                </select>
                <p className="text-muted-custom mt-2">{DIFFICULTY[tier].toleranceCents} cents tolerance · {DIFFICULTY[tier].passMark}% passing mark · coach approval required</p>
              </div>
              {['scale', 'song'].includes(exerciseType) && <section className="mb-3" aria-label="Target melody">
                <h5 className="text-white">Target melody</h5>
                <p className="text-muted-custom">Choose a solo vocal reference below, then extract its notes. Listen and correct them before approving. Gaps between notes are rests.</p>
                <button type="button" className="btn btn-harmonia-outline mb-2" disabled={!audioFile || analyzingReference} onClick={async () => {
                  setAnalyzingReference(true); setTargetApproved(false);
                  try { const result = await extractReferenceMelody(audioFile); setTargetNotes(result.notes); setDuration(String(result.duration)); setTargetPage(0); }
                  catch (error) { showToast(error.message, 'danger'); } finally { setAnalyzingReference(false); }
                }}>{analyzingReference ? 'Finding reference notes…' : 'Extract notes from selected audio'}</button>
                {targetNotes.slice(targetPage * 40, targetPage * 40 + 40).map((note, offset) => { const index = targetPage * 40 + offset; return <div className="row g-2 mb-2" key={index}>
                  {['startSeconds', 'endSeconds', 'frequencyHz'].map((field, column) => <div className="col-6 col-sm-3" key={field}><label className="harmonia-label" htmlFor={`note-${index}-${field}`}>{['Start (s)', 'End (s)', 'Pitch (Hz)'][column]}</label><input id={`note-${index}-${field}`} type="number" step="any" className="harmonia-input w-100" value={note[field]} onChange={e => { setTargetApproved(false); setTargetNotes(prev => prev.map((n, i) => i === index ? { ...n, [field]: Number(e.target.value) } : n)); }} /></div>)}
                  <div className="col-6 col-sm-3 d-flex align-items-end"><button type="button" className="btn btn-harmonia-outline" onClick={() => { setTargetApproved(false); setTargetNotes(prev => prev.filter((_, i) => i !== index)); }}>Remove</button></div>
                </div>; })}
                <div className="d-flex flex-wrap gap-2 my-2">
                  <button type="button" className="btn btn-harmonia-outline" onClick={() => { setTargetApproved(false); setTargetNotes(prev => [...prev, { startSeconds: prev.at(-1)?.endSeconds || 0, endSeconds: (prev.at(-1)?.endSeconds || 0) + 1, frequencyHz: 440 }]); setTargetPage(Math.floor(targetNotes.length / 40)); }}>Add note</button>
                  <button type="button" className="btn btn-harmonia-outline" disabled={targetPage === 0} onClick={() => setTargetPage(p => p - 1)}>Previous notes</button>
                  <button type="button" className="btn btn-harmonia-outline" disabled={(targetPage + 1) * 40 >= targetNotes.length} onClick={() => setTargetPage(p => p + 1)}>Next notes</button>
                  {audioFile && <button type="button" className="btn btn-harmonia-outline" onClick={async () => { if (audioObj) audioObj.pause(); const url = URL.createObjectURL(audioFile); const audio = new Audio(url); audio.onended = () => URL.revokeObjectURL(url); setAudioObj(audio); try { await audio.play(); } catch { URL.revokeObjectURL(url); showToast('Reference playback failed.', 'danger'); } }}>Listen to selected reference</button>}
                </div>
                <label className="text-white"><input type="checkbox" className="me-2" checked={targetApproved} disabled={!targetNotes.length} onChange={e => setTargetApproved(e.target.checked)} />I have checked and approve these target notes ({targetNotes.length} notes).</label>
              </section>}
              {exerciseType === 'single' && <div className="mb-3 d-flex flex-column">
                <label className="harmonia-label" htmlFor="pitch-input">Target pitch (Hz)</label>
                <input id="pitch-input" type="number" min="65" max="1050" step="any" className="harmonia-input" placeholder="e.g. 261.63 for C4" value={targetPitchData} onChange={e => setTargetPitchData(e.target.value)} required />
              </div>}
              <p className="text-muted-custom">Tone feedback estimates clarity and steadiness. It does not assess vocal health or artistic style.</p>

              {/* Unlock Criteria */}
              <div className="mb-3 d-flex flex-column">
                <label className="harmonia-label" htmlFor="unlock-select">Unlock Requirement</label>
                <select 
                  id="unlock-select"
                  className="harmonia-input" 
                  value={unlockCriteria}
                  onChange={(e) => setUnlockCriteria(e.target.value)}
                >
                  <option value="None">None (Instantly Available)</option>
                  {exercises.filter(ex => ex.id !== editingId).map(ex => (
                    <option key={ex.id} value={ex.id}>{ex.title} ({ex.tier})</option>
                  ))}
                </select>
              </div>

              {/* Reference Audio File upload */}
              <div className="mb-4 d-flex flex-column">
                <label className="harmonia-label">Reference Audio File</label>
                
                {referenceAudioRef && modalMode === "edit" && !audioFile && (
                  <div className="mb-2 p-2 bg-white bg-opacity-5 rounded d-flex align-items-center justify-content-between" style={{ fontSize: "0.8rem" }}>
                    <span className="text-truncate text-muted-custom">Current reference file linked</span>
                    <button 
                      type="button" 
                      className="btn btn-sm btn-harmonia-outline py-0.5 px-2"
                      onClick={() => toggleAudioPreview("modal-preview", referenceAudioRef)}
                    >
                      <i className={`bi ${previewingAudio === "modal-preview" ? "bi-stop-fill" : "bi-play-fill"}`}></i> Test
                    </button>
                  </div>
                )}

                <input 
                  type="file" 
                  accept="audio/mp3, audio/wav, audio/m4a"
                  className="harmonia-input"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
                
                {uploading && (
                  <div className="mt-2">
                    <div className="d-flex justify-content-between mb-1" style={{ fontSize: "0.75rem" }}>
                      <span className="text-muted-custom">Uploading reference audio...</span>
                      <span className="text-primary">{uploadProgress}%</span>
                    </div>
                    <div className="progress" style={{ height: "4px", backgroundColor: "rgba(255,255,255,0.1)" }}>
                      <div className="progress-bar bg-primary" role="progressbar" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Form Buttons */}
              <div className="d-flex justify-content-end gap-3 pt-3 border-top border-secondary border-opacity-10">
                <button
                  type="button"
                  className="btn btn-harmonia-outline"
                  onClick={() => setShowFormModal(false)}
                  disabled={uploading || loading || analyzingReference}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-harmonia"
                  disabled={uploading || loading || analyzingReference}
                >
                  {loading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : modalMode === "edit" ? (
                    "Save Changes"
                  ) : (
                    "Create Exercise"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setExerciseToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Delete Vocal Exercise"
        message={`Are you sure you want to permanently delete the vocal exercise "${exerciseToDelete?.title}"? Any student unlock criteria requiring this exercise will be reset, and this action cannot be undone.`}
        confirmText="Confirm Delete"
      />

    </div>
  );
};

export default Exercises;
