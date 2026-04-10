"""
optimizer.py
Adaptive slicer optimizer.

For each layer:
1. Fetch current weather conditions
2. Compute per-layer print parameters from Sika 733 physics:
   - print speed (respecting pot life, temperature, nozzle, flow rate)
   - layer height (from nozzle diameter)
   - extrusion multiplier (from spread flow target)
   - interlayer wait time
3. Run RL agent to order segments (minimise travel)
4. Return full per-layer parameter set + ordered toolpath
"""

import numpy as np
from stable_baselines3 import PPO
from typing import List, Tuple, Optional, Dict
from collections import defaultdict
import time

from environment import AdaptiveSlicerEnv, MAX_SEGMENTS, DEFAULT_PRINTER
from geometry import Geometry, Segment, Layer
from weather import WeatherSchedule, conditions_at_elapsed, average_conditions
from sika733 import (
    pot_life_at_temp,
    composite_risk_score,
    adapt_speed_for_conditions,
    min_interlayer_time,
    max_print_speed,
    layer_height_for_speed,
    estimated_print_time_seconds,
    LAYER_HEIGHT_DEF_M,
)

# ── Per-layer output ──────────────────────────────────────────────────────────

class LayerParams:
    """Physical print parameters for one layer, decided by the adaptive slicer."""
    def __init__(
        self,
        layer_idx:           int,
        z_height_m:          float,
        print_speed_mm_s:    float,
        extrusion_multiplier: float,
        layer_height_m:      float,
        interlayer_wait_s:   float,
        pot_life_remaining_min: float,
        risk_score:          float,
        weather_snapshot:    dict,
        segments_ordered:    List[Segment],
        travel_mm:           float,
        naive_travel_mm:     float,
    ):
        self.layer_idx             = layer_idx
        self.z_height_m            = z_height_m
        self.print_speed_mm_s      = print_speed_mm_s
        self.extrusion_multiplier  = extrusion_multiplier
        self.layer_height_m        = layer_height_m
        self.interlayer_wait_s     = interlayer_wait_s
        self.pot_life_remaining_min = pot_life_remaining_min
        self.risk_score            = risk_score
        self.weather_snapshot      = weather_snapshot
        self.segments_ordered      = segments_ordered
        self.travel_mm             = travel_mm
        self.naive_travel_mm       = naive_travel_mm

    def to_dict(self) -> dict:
        return {
            "layer_idx":              self.layer_idx,
            "z_height_m":             self.z_height_m,
            "print_speed_mm_s":       self.print_speed_mm_s,
            "extrusion_multiplier":   self.extrusion_multiplier,
            "layer_height_m":         self.layer_height_m,
            "interlayer_wait_s":      self.interlayer_wait_s,
            "pot_life_remaining_min": self.pot_life_remaining_min,
            "risk_score":             self.risk_score,
            "temperature_c":          self.weather_snapshot.get("temperature", 20.0),
            "humidity_pct":           self.weather_snapshot.get("humidity", 65.0),
            "wind_speed_kmh":         self.weather_snapshot.get("wind_speed", 8.0),
            "travel_mm":              self.travel_mm,
            "naive_travel_mm":        self.naive_travel_mm,
        }


# ── Cached model loader ───────────────────────────────────────────────────────

_cached_model = None
_cached_model_path = None

def _load_model(model_path: str):
    """Load PPO model once and cache it. Returns None if loading fails."""
    global _cached_model, _cached_model_path
    if _cached_model is None or _cached_model_path != model_path:
        try:
            _cached_model      = PPO.load(model_path)
            _cached_model_path = model_path
        except Exception as e:
            print(f"Warning: Could not load RL model: {e}. Using nearest-neighbour fallback.")
            _cached_model      = None
            _cached_model_path = model_path
    return _cached_model


# ── Main optimize function ────────────────────────────────────────────────────

def optimize(
    geometry:        Geometry,
    layer_metas:     List[dict],
    weather_sched:   WeatherSchedule,
    model_path:      str   = "model.zip",
    printer:         dict  = None,
    base_speed_mm_s: float = 60.0,
    max_layers:      Optional[int] = None,
) -> Tuple[List[Layer], List[LayerParams], dict]:
    """
    Run the full adaptive slicer.

    Speed optimisation:
    - Model loaded once and cached in memory
    - RL ordering only run on sampled layers (every Nth)
    - Remaining layers use fast nearest-neighbour ordering
    - Segments capped at MAX_SEGS_PER_LAYER per layer
    - Per-layer physics parameters computed for ALL layers
    """
    printer = printer or {}
    printer = {**DEFAULT_PRINTER, **printer}

    model = _load_model(model_path)
    env   = AdaptiveSlicerEnv() if model else None

    layers_to_process = geometry[:max_layers] if max_layers else geometry
    layer_metas_use   = layer_metas[:len(layers_to_process)]
    num_layers        = len(layers_to_process)

    # Run RL on every Nth layer — fast NN for the rest
    RL_SAMPLE_RATE = max(1, num_layers // 20)

    toolpath:     List[Layer]       = []
    layer_params: List[LayerParams] = []

    elapsed_min   = 0.0
    total_travel  = 0.0
    naive_travel  = 0.0

    nozzle_diam_mm    = float(printer.get("nozzle_diameter_mm",   25.0))
    max_speed_printer = float(printer.get("max_speed_mm_s",       100.0))
    min_speed_printer = float(printer.get("min_speed_mm_s",        15.0))
    flow_rate_l_min   = float(printer.get("max_mass_flow_l_min",    8.0))
    layer_height_m    = layer_height_for_speed(base_speed_mm_s, nozzle_diam_mm)

    start_t = time.time()

    for layer_idx, (layer_segs, lmeta) in enumerate(zip(layers_to_process, layer_metas_use)):

        # ── 1. Weather at this moment ─────────────────────────────────────────
        elapsed_h = elapsed_min / 60.0
        weather   = conditions_at_elapsed(weather_sched, elapsed_h)
        temp_c    = float(weather.get("temperature", 20.0))
        humidity  = float(weather.get("humidity",    65.0))
        wind_kmh  = float(weather.get("wind_speed",   8.0))

        # ── 2. Pot life ───────────────────────────────────────────────────────
        pot_life_total = pot_life_at_temp(temp_c)
        pot_remaining  = max(0.0, pot_life_total - elapsed_min)

        # ── 3. Risk score ─────────────────────────────────────────────────────
        risk = composite_risk_score(
            temp_c, humidity, wind_kmh,
            float(weather.get("ground_slope", 0.0)),
        )

        # ── 4. Adaptive print speed ───────────────────────────────────────────
        physics_speed = max_print_speed(nozzle_diam_mm, layer_height_m, flow_rate_l_min)
        adapted_speed = adapt_speed_for_conditions(
            base_speed_mm_s, temp_c, humidity, wind_kmh,
            pot_remaining, elapsed_min / max(pot_life_total, 1.0),
        )
        final_speed = min(physics_speed, max_speed_printer, adapted_speed)
        final_speed = max(min_speed_printer, final_speed)

        # ── 5. Extrusion multiplier ───────────────────────────────────────────
        extrusion_mult = 1.0
        if temp_c > 25.0:
            extrusion_mult -= (temp_c - 25.0) * 0.01
        if humidity < 55.0:
            extrusion_mult -= (55.0 - humidity) * 0.002
        extrusion_mult = round(max(0.85, min(1.15, extrusion_mult)), 3)

        # ── 6. Interlayer wait ────────────────────────────────────────────────
        interlayer_s = min_interlayer_time(layer_height_m)

        # ── 7. Segment ordering ───────────────────────────────────────────────
        if not layer_segs:
            toolpath.append([])
            ordered_segs = []
            layer_travel = 0.0
            naive_l      = 0.0
        else:
            # Use all segments — accuracy over speed
            segs    = layer_segs
            naive_l = _naive_travel_mm(segs)

            use_rl = (layer_idx % RL_SAMPLE_RATE == 0) and model is not None

            if use_rl:
                env.set_layer(
                    segments    = segs,
                    layer_meta  = lmeta,
                    weather     = weather,
                    layer_idx   = layer_idx,
                    elapsed_min = elapsed_min,
                    pot_life_min = pot_life_total,
                    printer     = printer,
                )
                obs, _ = env.reset()
                while env.remaining:
                    action, _ = model.predict(obs, deterministic=True)
                    obs, _, done, truncated, _ = env.step(int(action))
                    if done or truncated:
                        break
                ordered_segs = env.ordered_segments()
                layer_travel = env.travel_mm()
            else:
                ordered_segs = _nearest_neighbour(segs)
                layer_travel = _travel_mm(ordered_segs)

            toolpath.append(ordered_segs)
            total_travel += layer_travel
            naive_travel += naive_l

        # ── 8. Elapsed time update ────────────────────────────────────────────
        segs_total_mm = sum(_seg_len(s[0], s[1]) * 1000 for s in ordered_segs) if ordered_segs else 0
        layer_time_s  = (segs_total_mm / max(final_speed, 1.0)) + interlayer_s
        elapsed_min  += layer_time_s / 60.0

        # ── 9. Record ─────────────────────────────────────────────────────────
        lp = LayerParams(
            layer_idx              = layer_idx,
            z_height_m             = float(lmeta.get("z_height_m", layer_idx * layer_height_m)),
            print_speed_mm_s       = round(final_speed, 1),
            extrusion_multiplier   = extrusion_mult,
            layer_height_m         = layer_height_m,
            interlayer_wait_s      = round(interlayer_s, 1),
            pot_life_remaining_min = round(pot_remaining, 1),
            risk_score             = risk,
            weather_snapshot       = weather,
            segments_ordered       = ordered_segs,
            travel_mm              = round(layer_travel, 1),
            naive_travel_mm        = round(naive_l, 1),
        )
        layer_params.append(lp)

    # ── Stats ─────────────────────────────────────────────────────────────────
    elapsed_wall = time.time() - start_t
    total_segs   = sum(len(t) for t in toolpath)
    avg_speed    = np.mean([lp.print_speed_mm_s for lp in layer_params]) if layer_params else base_speed_mm_s
    avg_risk     = np.mean([lp.risk_score        for lp in layer_params]) if layer_params else 0.0

    est_seconds = estimated_print_time_seconds(
        total_travel_mm = total_travel,
        avg_speed_mm_s  = avg_speed,
        num_layers      = len(layer_params),
        layer_height_m  = layer_height_m,
    )

    travel_saved_pct = 0.0
    if naive_travel > 0:
        travel_saved_pct = round((naive_travel - total_travel) / naive_travel * 100, 1)

    stats = {
        "layers_processed":       len(layer_params),
        "total_segments":         total_segs,
        "total_travel_mm":        round(total_travel, 1),
        "naive_travel_mm":        round(naive_travel, 1),
        "time_saved_pct":         max(0.0, travel_saved_pct),
        "env_risk_score":         round(avg_risk, 1),
        "avg_print_speed_mm_s":   round(float(avg_speed), 1),
        "estimated_print_time_s": round(est_seconds, 0),
        "elapsed_compute_s":      round(elapsed_wall, 2),
    }

    return toolpath, layer_params, stats


# ── Helpers ───────────────────────────────────────────────────────────────────

def _nearest_neighbour(segs: List[Segment]) -> List[Segment]:
    """
    Fast segment ordering using endpoint lookup dict.
    Near O(n) for well-connected paths, much faster than O(n²) brute force.
    """
    if not segs:
        return []
    if len(segs) == 1:
        return segs

    def rkey(p): return (round(p[0], 5), round(p[1], 5))

    remaining = list(segs)
    ordered   = [remaining.pop(0)]
    cur       = ordered[0][1]

    # Build start-point index
    index: dict = defaultdict(list)
    for i, s in enumerate(remaining):
        index[rkey(s[0])].append(i)

    used = [False] * len(remaining)

    for _ in range(len(remaining)):
        # Try exact endpoint match first — O(1)
        hits = [i for i in index.get(rkey(cur), []) if not used[i]]
        if hits:
            best_i = hits[0]
        else:
            # Nearest neighbour scan — only runs when path breaks
            best_i, best_d = -1, float('inf')
            for i, s in enumerate(remaining):
                if used[i]: continue
                dx = s[0][0] - cur[0]
                dy = s[0][1] - cur[1]
                d  = dx*dx + dy*dy
                if d < best_d:
                    best_d, best_i = d, i
            if best_i < 0:
                break

        used[best_i] = True
        seg = remaining[best_i]
        ordered.append(seg)
        # Remove from index
        k = rkey(seg[0])
        if best_i in index.get(k, []):
            index[k].remove(best_i)
        cur = seg[1]

    # Append any stragglers
    for i, s in enumerate(remaining):
        if not used[i]:
            ordered.append(s)

    return ordered


def _naive_travel_mm(segs: List[Segment]) -> float:
    if not segs:
        return 0.0
    total = 0.0
    pos   = np.array(segs[0][0])
    for seg in segs:
        total += float(np.linalg.norm(np.array(seg[0]) - pos)) * 1000
        pos    = np.array(seg[1])
    return total


def _travel_mm(segs: List[Segment]) -> float:
    return _naive_travel_mm(segs)


def _seg_len(p0, p1) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))