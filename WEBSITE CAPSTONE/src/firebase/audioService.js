import { auth, db } from './config.js';
import { doc, getDocFromServer } from 'firebase/firestore';

export function validateAudioEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') ||
      url.pathname !== '/functions/v1/audio' || url.search || url.hash || url.username || url.password || url.port) {
    throw new Error('Audio storage configuration is invalid.');
  }
  return url;
}

async function audioRequest(params, body, contentType) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before accessing audio.');
  const config = await getDocFromServer(doc(db, 'appConfig', 'audio'));
  if (!config.exists()) throw new Error('Audio storage setup is pending. Please try again later.');
  const url = validateAudioEndpoint(config.data().endpoint);
  url.search = new URLSearchParams(params).toString();
  const token = await user.getIdToken();
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) }, body,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Audio request failed.');
  return result;
}

export async function uploadReferenceAudio(file, id) {
  if (!file?.size || file.size > 8 * 1024 * 1024) throw new Error('Choose an audio file smaller than 8 MB.');
  const extension = file.name?.split('.').at(-1)?.toLowerCase();
  const type = ({ m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' })[extension] || file.type || 'audio/wav';
  return (await audioRequest({ action: 'upload', kind: 'references', id }, file, type)).audioRef;
}

export async function resolveAudioUrl(ref) {
  if (!ref) throw new Error('No recording is available for this session.');
  if (ref.startsWith('supabase://')) return (await audioRequest({ action: 'playback', ref })).url;
  // Previously stored HTTPS recordings remain playable.
  if (new URL(ref).protocol !== 'https:') throw new Error('This recording link is invalid.');
  return ref;
}
