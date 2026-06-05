//this replaces the db.js and user.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables from root .env
try {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch (err) {
  console.warn('[Supabase Config] Failed to load .env file:', err.message);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (err) {
    console.error('[Supabase Config] Failed to initialize Supabase client:', err.message);
  }
} else {
  console.warn(
    '[Supabase Config] SUPABASE_URL or SUPABASE_KEY not found in env. Running in offline/mock database log mode.'
  );
}

export default supabase;