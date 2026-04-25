"""
optimizer.py  —  Adaptive slicer optimizer.
Speed optimisations:
- RL sample rate adaptive to layer size
- Fast NN uses dict index + set for O(1) ops  
- numpy vectorised travel computation
- No redundant numpy array creation in hot loop
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
    LAYER_HEIGHT_MIN_M,
    LAYER_HEIGHT_MAX_M,
)


class LayerParams:
    def __init__(
        self,
        layer_idx:              int,
        z_height_m:             float,
        print_speed_mm_s:       float,
        extrusion_multiplier:   float,
        layer_height_m:         float,
        interlayer_wait_s:      float,
        pot_life_remaining_min: float,
        risk_score:             float,
        weather_snapshot:       dict,
        segments_ordered:       List[Segment],
        travel_mm:              float,
        naive_travel_mm:        float,
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
            "humidity_pct":           self.weather_snapshot.get("humidity",    65.0),
            "wind_speed_kmh":         self.weather_snapshot.get("wind_speed",   8.0),
            "travel_mm":              self.travel_mm,
            "naive_travel_mm":        self.naive_travel_mm,
        }


_cached_model      = None
_cached_model_path = None

def _load_model(model_path: str):
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


def optimize(
    geometry:        Geometry,
    layer_metas:     List[dict],
    weather_sched:   WeatherSchedule,
    model_path:      str   = "model.zip",
    printer:         dict  = None,
    base_speed_mm_s: float = 60.0,
    max_layers:      Optional[int] = None,
) -> Tuple[List[Layer], List[LayerParams], dict]:

    printer = {**DEFAULT_PRINTER, **(printer or {})}
    model   = _load_model(model_path)
    env     = AdaptiveSlicerEnv() if model else None

    layers_to_process = geometry[:max_layers] if max_layers else geometry
    layer_metas_use   = layer_metas[:len(layers_to_process)]
    num_layers        = len(layers_to_process)

    # Adaptive RL sample rate:
    # - Small models (< 50 layers): RL every layer
    # - Medium (50-200): every 10th
    # - Large (200+): every 20th
    if num_layers < 50:
        RL_SAMPLE_RATE = 1
    elif num_layers < 200:
        RL_SAMPLE_RATE = max(1, num_layers // 10)
    else:
        RL_SAMPLE_RATE = max(1, num_layers // 20)

    toolpath:     List[Layer]       = []
    layer_params: List[LayerParams] = []

    elapsed_min  = 0.0
    total_travel = 0.0
    naive_travel = 0.0

    nozzle_diam_mm    = float(printer.get("nozzle_diameter_mm",   25.0))
    max_speed_printer = float(printer.get("max_speed_mm_s",       100.0))
    min_speed_printer = float(printer.get("min_speed_mm_s",        15.0))
    flow_rate_l_min   = float(printer.get("max_mass_flow_l_min",    8.0))
    pump_lag_s        = float(printer.get("pump_lag_s",              3.0))
    bead_compression  = float(printer.get("bead_compression",        0.6))
    # Use the printer's actual bead compression rather than the old fixed 0.6
    layer_height_m    = layer_height_for_speed(nozzle_diam_mm, bead_compression)

    # Rough total-print estimate (used to normalise elapsed_fraction and RL obs)
    total_perim_mm  = sum(float(lm.get("perimeter_m", 0.0)) for lm in layer_metas_use) * 1000.0
    rough_print_s   = total_perim_mm / max(base_speed_mm_s, 1.0)
    interlayer_tot  = num_layers * min_interlayer_time(layer_height_m)
    # Add 30 % margin and floor at 60 min so obs[14] never clips on the first layer
    total_print_min = max(60.0, (rough_print_s + interlayer_tot) / 60.0 * 1.3)

    start_t = time.time()

    for layer_idx, (layer_segs, lmeta) in enumerate(zip(layers_to_process, layer_metas_use)):

        elapsed_h = elapsed_min / 60.0
        weather   = conditions_at_elapsed(weather_sched, elapsed_h)
        temp_c    = float(weather.get("temperature", 20.0))
        humidity  = float(weather.get("humidity",    65.0))
        wind_kmh  = float(weather.get("wind_speed",   8.0))

        pot_life_total = pot_life_at_temp(temp_c)
        pot_remaining  = max(0.0, pot_life_total - elapsed_min)

        risk = composite_risk_score(
            temp_c, humidity, wind_kmh,
            float(weather.get("ground_slope", 0.0)),
        )

        physics_speed    = max_print_speed(nozzle_diam_mm, layer_height_m, flow_rate_l_min)
        elapsed_fraction = elapsed_min / max(total_print_min, 1.0)
        adapted_speed    = adapt_speed_for_conditions(
            base_speed_mm_s, temp_c, humidity, wind_kmh,
            pot_remaining, elapsed_fraction,
        )
        final_speed = max(min_speed_printer, min(physics_speed, max_speed_printer, adapted_speed))

        extrusion_mult = 1.0
        if temp_c > 25.0:   extrusion_mult -= (temp_c - 25.0) * 0.01
        if humidity < 55.0: extrusion_mult -= (55.0 - humidity) * 0.002
        extrusion_mult = round(max(0.85, min(1.15, extrusion_mult)), 3)

        interlayer_s = min_interlayer_time(layer_height_m)

        if not layer_segs:
            toolpath.append([])
            ordered_segs = []
            layer_travel = 0.0
            naive_l      = 0.0
        else:
            segs    = layer_segs
            naive_l = _naive_travel_mm(segs)

            # RL on sampled layers, NN on the rest
            # For very large layers (> MAX_SEGMENTS), always use fast NN
            use_rl = (
                (layer_idx % RL_SAMPLE_RATE == 0)
                and model is not None
                and len(segs) <= MAX_SEGMENTS
            )

            if use_rl:
                env.set_layer(
                    segments        = segs,
                    layer_meta      = lmeta,
                    weather         = weather,
                    layer_idx       = layer_idx,
                    elapsed_min     = elapsed_min,
                    pot_life_min    = pot_life_total,
                    printer         = printer,
                    total_print_min = total_print_min,
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

        segs_total_mm = _total_print_mm(ordered_segs) if ordered_segs else 0.0
        layer_time_s  = (segs_total_mm / max(final_speed, 1.0)) + interlayer_s
        elapsed_min  += layer_time_s / 60.0

        layer_params.append(LayerParams(
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
        ))

    elapsed_wall = time.time() - start_t
    total_segs   = sum(len(t) for t in toolpath)
    avg_speed    = float(np.mean([lp.print_speed_mm_s for lp in layer_params])) if layer_params else base_speed_mm_s
    avg_risk     = float(np.mean([lp.risk_score        for lp in layer_params])) if layer_params else 0.0

    est_seconds = estimated_print_time_seconds(
        total_travel_mm      = total_travel,
        avg_speed_mm_s       = avg_speed,
        num_layers           = len(layer_params),
        layer_height_m       = layer_height_m,
        pump_lag_s_per_layer = pump_lag_s,
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
        "avg_print_speed_mm_s":   round(avg_speed, 1),
        "estimated_print_time_s": round(est_seconds, 0),
        "elapsed_compute_s":      round(elapsed_wall, 2),
    }

    return toolpath, layer_params, stats


# ── Helpers ───────────────────────────────────────────────────────────────────

def _nearest_neighbour(segs: List[Segment]) -> List[Segment]:
    """
    Fast O(n) segment ordering.
    Uses endpoint dict for exact match (O(1)), falls back to scan only on path breaks.
    Uses set for O(1) membership/removal.
    """
    if not segs:  return []
    if len(segs) == 1: return segs

    def rkey(p): return (round(p[0], 5), round(p[1], 5))

    # Build start-point index: key → list of indices
    index: Dict[tuple, List[int]] = defaultdict(list)
    for i, s in enumerate(segs):
        index[rkey(s[0])].append(i)

    # Use set for O(1) membership test and removal
    remaining_set = set(range(len(segs)))
    ordered = []
    cur     = segs[0][0]
    
    # Start from segment nearest to origin
    best_start = min(range(len(segs)), key=lambda i: segs[i][0][0]**2 + segs[i][0][1]**2)
    remaining_set.discard(best_start)
    ordered.append(segs[best_start])
    cur = segs[best_start][1]

    while remaining_set:
        # Try exact endpoint match first — O(1)
        hits = [i for i in index.get(rkey(cur), []) if i in remaining_set]
        if hits:
            best_i = hits[0]
        else:
            # Nearest scan — only on path breaks, unavoidable
            cx, cy = cur
            best_i = min(
                remaining_set,
                key=lambda i: (segs[i][0][0]-cx)**2 + (segs[i][0][1]-cy)**2
            )

        remaining_set.discard(best_i)
        # Remove from index
        k = rkey(segs[best_i][0])
        if best_i in index.get(k, []):
            index[k].remove(best_i)
        ordered.append(segs[best_i])
        cur = segs[best_i][1]

    return ordered


def _naive_travel_mm(segs: List[Segment]) -> float:
    """Vectorised naive travel — no per-segment Python loop."""
    if not segs: return 0.0
    # Stack all start/end points
    starts = np.array([s[0] for s in segs], dtype=np.float32)
    ends   = np.array([s[1] for s in segs], dtype=np.float32)
    # Travel gaps: end[i] → start[i+1]
    gaps   = starts[1:] - ends[:-1]
    total  = float(np.sum(np.hypot(gaps[:, 0], gaps[:, 1])))
    return total * 1000.0


def _travel_mm(segs: List[Segment]) -> float:
    return _naive_travel_mm(segs)


def _total_print_mm(segs: List[Segment]) -> float:
    """Total extrusion length in mm — vectorised."""
    if not segs: return 0.0
    starts = np.array([s[0] for s in segs], dtype=np.float32)
    ends   = np.array([s[1] for s in segs], dtype=np.float32)
    diffs  = ends - starts
    return float(np.sum(np.hypot(diffs[:, 0], diffs[:, 1]))) * 1000.0


def _seg_len(p0, p1) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))


def _enforce_continuous_loop(ordered_segments: list) -> list:
    """
    Convert ordered Segment tuples to enriched dicts with type='travel'|'extrude'.
    Inserts explicit travel moves between non-adjacent segments (gap > 2 mm).
    """
    if not ordered_segments:
        return []

    import math as _math
    GAP_M  = 0.002
    result = []

    for i, seg in enumerate(ordered_segments):
        if i == 0:
            result.append({"type": "travel", "x0": 0.0, "y0": 0.0,
                           "x1": seg[0][0], "y1": seg[0][1], "extrude": False})
        else:
            prev = ordered_segments[i - 1]
            gap  = _math.hypot(seg[0][0] - prev[1][0], seg[0][1] - prev[1][1])
            if gap > GAP_M:
                result.append({"type": "travel",
                               "x0": prev[1][0], "y0": prev[1][1],
                               "x1": seg[0][0],  "y1": seg[0][1], "extrude": False})

        result.append({"type": "extrude",
                       "x0": seg[0][0], "y0": seg[0][1],
                       "x1": seg[1][0], "y1": seg[1][1], "extrude": True})

    return result