import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);

// ── Types matching the DB schema ──────────────────────────────────────────────

export interface DBProject {
  id:             string;
  created_at:     string;
  name:           string;
  description:    string | null;
  address:        string | null;
  structure_type: string;
  status:         'setup' | 'pre-print' | 'printing' | 'complete';
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