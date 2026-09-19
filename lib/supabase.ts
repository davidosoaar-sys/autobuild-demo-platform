import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);

// Storage bucket must exist in the Supabase project (Storage → New bucket →
// name "training-frames", public read) before this will succeed — the anon
// key used client-side can't create buckets itself.
const TRAINING_BUCKET = 'training-frames';

/** Uploads a bead-analysis photo for model training and returns its public URL, or null on failure. */
export async function uploadTrainingImage(blob: Blob, mimeType: string): Promise<string | null> {
  try {
    const ext = mimeType.split('/')[1] || 'jpg';
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(TRAINING_BUCKET).upload(path, blob, {
      contentType: mimeType,
      cacheControl: '3600',
    });
    if (error) { console.error('[uploadTrainingImage]', error); return null; }
    return supabase.storage.from(TRAINING_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.error('[uploadTrainingImage]', e);
    return null;
  }
}

// ── Types matching the DB schema ──────────────────────────────────────────────

export interface DBProject {
  id:             string;
  created_at:     string;
  name:           string;
  description:    string | null;
  address:        string | null;
  structure_type: string;
  status:         'setup' | 'pre-print' | 'printing' | 'post-processing' | 'complete';
  total_layers:   number;
  print_speed:    number;
  report?:        Record<string, any> | null;
}

export interface DBPrinterConfig {
  id:              string;
  project_id:      string;
  printer_name:    string;
  printer_type:    string | null;
  nozzle:          string | null;
  max_speed:       string | null;
  layer_height?:   number | null;
  bead_compression?: number | null;
  manual_config:   Record<string, any> | null;
}

export interface DBOptimizationResult {
  id:              string;
  project_id:      string;
  result_id:       string;
  elapsed_seconds: number;
  num_layers:      number;
  layer_height:    number;
  total_segments:  number;
  gcode_lines:     number;
  time_saved_pct:  number;
  env_risk_score:  number;
  effective_speed: number;
  est_print_time:  string;
  gcode_preview:   string;
}