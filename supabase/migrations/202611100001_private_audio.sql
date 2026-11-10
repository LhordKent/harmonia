-- No anonymous/authenticated Storage policies: only the authorized Edge Function
-- can access these objects. Firebase remains the source of access permissions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('harmonia-audio', 'harmonia-audio', false, 8388608,
  array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
