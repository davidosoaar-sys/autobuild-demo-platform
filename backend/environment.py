"""
environment.py
RL environment for adaptive 3DCP slicing.

The agent operates on one layer at a time and makes TWO types of decisions:

1. PER-LAYER PARAMETERS (continuous action):
   - print_speed_factor:    0.5–2.0 × base speed
   - extrusion_multiplier:  0.8–1.3 (flow rate adjustment)
   - layer_height_factor:   0.8–1.1 × nominal layer height

2. SEGMENT ORDERING (discrete action):
   - Which segment to print next within the layer

This is a two-phase environment:
  Phase A: agent picks parameters (single step)
  Phase B: agent orders segments (N steps)

Observation includes:
  - Layer geometry complexity
  - Current weather conditions
  - Elapsed fraction of pot life
  - Printer physical limits (from ManualConfig)
  - Cumulative stress on material from previous layers
"""

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from typing import List, Optional, Tuple
import math

from sika733 import (
    pot_life_at_temp,
    composite_risk_score,
    adapt_speed_for_conditions,
    min_interlayer_time,
    LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M,
    AMBIENT_TEMP_MIN, AMBIENT_TEMP_MAX,
)

# ── Types ─────────────────────────────────────────────────────────────────────

Segment = Tuple[Tuple[float, float], Tuple[float, float]]

MAX_SEGMENTS = 256   # max segments per layer observation


# ── Printer profile defaults ──────────────────────────────────────────────────

DEFAULT_PRINTER = {
    "nozzle_diameter_mm":      25.0,
    "max_speed_mm_s":          100.0,
    "min_speed_mm_s":          15.0,
    "layer_adhesion_pressure": 12.0,
    "max_layer_height_mm":     20.0,
    "min_layer_height_mm":     6.0,
    "max_mass_flow_l_min":     8.0,
    "hose_length_m":           15.0,
    "pump_lag_s":              3.0,    # estimated from hose length
}


# ── Observation space dimensions ──────────────────────────────────────────────

# Weather: temp, humidity, wind, slope (4)
# Sika state: pot_life_remaining_frac, risk_score (2)
# Layer meta: complexity, perimeter, area, wall_t_norm (4)
# Printer: speed_limit, flow_limit, nozzle_norm (3)
# Print state: layer_idx_norm, elapsed_frac, layers_remaining_norm (3)
# Segments: MAX_SEGMENTS × 4 coords + MAX_SEGMENTS mask

FIXED_OBS_DIM = 4 + 2 + 4 + 3 + 3   # = 16
SEG_FEATURES  = 4
OBS_DIM       = FIXED_OBS_DIM + MAX_SEGMENTS * SEG_FEATURES + MAX_SEGMENTS


class AdaptiveSlicerEnv(gym.Env):
    """
    Gymnasium environment for adaptive 3DCP parameter optimisation.

    Action space:
      Discrete(MAX_SEGMENTS) — which segment to print next
      (Parameter decisions are made separately by a continuous head in optimizer.py)

    Observation:
      Flat vector combining weather, material state, layer geometry, printer limits.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        segments:      Optional[List[Segment]] = None,
        layer_meta:    Optional[dict]          = None,
        weather:       Optional[dict]          = None,
        printer:       Optional[dict]          = None,
        layer_idx:     int                     = 0,
        num_layers:    int                     = 100,
        elapsed_min:   float                   = 0.0,
        pot_life_min:  float                   = 60.0,
    ):
        super().__init__()

        self.all_segments  = segments   or []
        self.layer_meta    = layer_meta or {}
        self.weather       = weather    or {"temperature":20,"humidity":65,"wind_speed":8,"ground_slope":0}
        self.printer       = {**DEFAULT_PRINTER, **(printer or {})}
        self.layer_idx     = layer_idx
        self.num_layers    = num_layers
        self.elapsed_min   = elapsed_min   # minutes into the print so far
        self.pot_life_min  = pot_life_min  # pot life at current temperature

        self.action_space      = spaces.Discrete(MAX_SEGMENTS)
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf,
            shape=(OBS_DIM,), dtype=np.float32,
        )

        self.remaining:   List[int] = []
        self.printed:     List[int] = []
        self.nozzle_pos:  np.ndarray = np.zeros(2, dtype=np.float32)
        self._step_count: int = 0
        self._travel_mm:  float = 0.0

    # ── Gym API ───────────────────────────────────────────────────────────────

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.remaining   = list(range(min(len(self.all_segments), MAX_SEGMENTS)))
        self.printed     = []
        self.nozzle_pos  = self._start_pos()
        self._step_count = 0
        self._travel_mm  = 0.0
        return self._obs(), {}

    def step(self, action: int):
        if action not in self.remaining:
            action = self._nearest()

        seg = self.all_segments[action]
        seg_start  = np.array(seg[0], dtype=np.float32)
        seg_end    = np.array(seg[1], dtype=np.float32)

        travel_m   = float(np.linalg.norm(seg_start - self.nozzle_pos))
        seg_len_m  = float(np.linalg.norm(seg_end - seg_start))

        self._travel_mm  += (travel_m + seg_len_m) * 1000
        self.nozzle_pos   = seg_end
        self.remaining.remove(action)
        self.printed.append(action)
        self._step_count += 1

        reward   = self._reward(travel_m, seg_len_m)
        done     = len(self.remaining) == 0
        truncated = self._step_count >= MAX_SEGMENTS * 2

        return self._obs(), reward, done, truncated, {}

    # ── Observation ───────────────────────────────────────────────────────────

    def _obs(self) -> np.ndarray:
        obs = np.zeros(OBS_DIM, dtype=np.float32)
        w   = self.weather
        p   = self.printer

        temp     = float(w.get("temperature",  20.0))
        humidity = float(w.get("humidity",     65.0))
        wind     = float(w.get("wind_speed",    8.0))
        slope    = float(w.get("ground_slope",  0.0))

        # Weather block (0:4)
        obs[0] = self._n(temp,     AMBIENT_TEMP_MIN, AMBIENT_TEMP_MAX)
        obs[1] = self._n(humidity, 30.0, 100.0)
        obs[2] = self._n(wind,      0.0,  60.0)
        obs[3] = self._n(slope,     0.0,  15.0)

        # Sika material state (4:6)
        pot_remaining    = max(0.0, self.pot_life_min - self.elapsed_min)
        pot_frac_remaining = pot_remaining / max(self.pot_life_min, 1.0)
        risk             = composite_risk_score(temp, humidity, wind, slope) / 100.0
        obs[4] = float(pot_frac_remaining)
        obs[5] = float(risk)

        # Layer metadata (6:10)
        complexity = float(self.layer_meta.get("complexity", 0.5))
        perimeter  = self._n(float(self.layer_meta.get("perimeter_m", 1.0)), 0.0, 100.0)
        area       = self._n(float(self.layer_meta.get("area_m2",    0.1)), 0.0,  50.0)
        wall_t     = self._n(float(self.layer_meta.get("wall_thickness_m", 0.025)), 0.005, 0.1)
        obs[6] = complexity
        obs[7] = perimeter
        obs[8] = area
        obs[9] = wall_t

        # Printer limits (10:13)
        obs[10] = self._n(float(p.get("max_speed_mm_s",  100.0)),   0.0, 300.0)
        obs[11] = self._n(float(p.get("max_mass_flow_l_min", 8.0)), 0.0,  40.0)
        obs[12] = self._n(float(p.get("nozzle_diameter_mm", 25.0)), 10.0, 50.0)

        # Print progress (13:16)
        obs[13] = self._n(float(self.layer_idx),      0.0, float(self.num_layers))
        obs[14] = self._n(self.elapsed_min, 0.0, max(self.pot_life_min, 1.0))
        obs[15] = self._n(float(self.num_layers - self.layer_idx), 0.0, float(self.num_layers))

        # Segments (16 : 16 + MAX_SEGMENTS*4)
        base = FIXED_OBS_DIM
        for i, seg in enumerate(self.all_segments[:MAX_SEGMENTS]):
            o = base + i * SEG_FEATURES
            obs[o]     = float(seg[0][0])
            obs[o + 1] = float(seg[0][1])
            obs[o + 2] = float(seg[1][0])
            obs[o + 3] = float(seg[1][1])

        # Availability mask (base + MAX_SEGMENTS*4 : end)
        mask_base = base + MAX_SEGMENTS * SEG_FEATURES
        for i in self.remaining:
            if i < MAX_SEGMENTS:
                obs[mask_base + i] = 1.0

        return obs

    # ── Reward ────────────────────────────────────────────────────────────────

    def _reward(self, travel_m: float, seg_len_m: float) -> float:
        w    = self.weather
        temp = float(w.get("temperature", 20.0))

        # Core rewards
        print_reward   =  seg_len_m * 3.0       # reward printing useful path
        travel_penalty = -travel_m  * 2.5       # penalise wasted travel

        # Pot life penalty: penalise heavily if elapsed > 80% of pot life
        pot_remaining  = max(0.0, self.pot_life_min - self.elapsed_min)
        pot_frac_used  = 1.0 - pot_remaining / max(self.pot_life_min, 1.0)
        time_penalty   = -max(0.0, pot_frac_used - 0.8) * 10.0

        # Environmental risk penalty
        risk = composite_risk_score(
            temp,
            float(w.get("humidity", 65.0)),
            float(w.get("wind_speed", 8.0)),
            float(w.get("ground_slope", 0.0)),
        )
        env_penalty = -(risk / 100.0) * 2.0

        # Structural continuity bonus: reward printing adjacent segments
        struct_bonus = 0.0
        if len(self.printed) >= 2:
            prev = self.all_segments[self.printed[-2]]
            dist = float(np.linalg.norm(
                np.array(prev[1]) - np.array(self.all_segments[self.printed[-1]][0])
            ))
            if dist < 0.01:   # within 10mm — continuous extrusion
                struct_bonus = 0.5

        # Interlayer time bonus: reward completing layer faster than min interlayer
        # (so the next layer can be placed before material stiffens too much)
        speed_bonus = 0.0
        if len(self.remaining) == 0 and self.elapsed_min < self.pot_life_min * 0.5:
            speed_bonus = 1.0

        return float(
            print_reward + travel_penalty + time_penalty +
            env_penalty + struct_bonus + speed_bonus
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _start_pos(self) -> np.ndarray:
        if not self.all_segments:
            return np.zeros(2, dtype=np.float32)
        # Start from the segment closest to origin (bottom-left corner)
        origin = np.zeros(2)
        nearest = min(
            range(len(self.all_segments)),
            key=lambda i: np.linalg.norm(np.array(self.all_segments[i][0]) - origin),
        )
        return np.array(self.all_segments[nearest][0], dtype=np.float32)

    def _nearest(self) -> int:
        if not self.remaining:
            return 0
        dists = [
            float(np.linalg.norm(
                np.array(self.all_segments[i][0]) - self.nozzle_pos
            ))
            for i in self.remaining
        ]
        return self.remaining[int(np.argmin(dists))]

    def ordered_segments(self) -> List[Segment]:
        return [self.all_segments[i] for i in self.printed]

    def travel_mm(self) -> float:
        return self._travel_mm

    def set_layer(
        self,
        segments:    List[Segment],
        layer_meta:  dict,
        weather:     dict,
        layer_idx:   int,
        elapsed_min: float,
        pot_life_min: float,
        printer:     Optional[dict] = None,
    ):
        self.all_segments = segments
        self.layer_meta   = layer_meta
        self.weather      = weather
        self.layer_idx    = layer_idx
        self.elapsed_min  = elapsed_min
        self.pot_life_min = pot_life_min
        if printer:
            self.printer  = {**DEFAULT_PRINTER, **printer}

    @staticmethod
    def _n(val: float, lo: float, hi: float) -> float:
        return float(np.clip((val - lo) / (hi - lo + 1e-8), 0.0, 1.0))