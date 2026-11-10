import { createAudioHandler } from './handler.mjs';

Deno.serve(createAudioHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  firebaseProject: 'harmonia-47c73',
  firebaseApiKey: 'AIzaSyCS6m4JybNezRKUk-Dnsv0NOR9vHCXPlMM',
}));
