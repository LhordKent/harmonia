import { createAccountsHandler } from './handler.mjs';

// Secrets are set with `supabase secrets set`; they never appear in either client.
const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');

Deno.serve(createAccountsHandler({
  firebaseProject: 'harmonia-47c73',
  firebaseApiKey: 'AIzaSyCS6m4JybNezRKUk-Dnsv0NOR9vHCXPlMM',
  serviceAccount: serviceAccountJson ? JSON.parse(serviceAccountJson) : null,
  encryptionKey: Deno.env.get('SCHOOL_PASSWORD_KEY') ?? null,
}));
