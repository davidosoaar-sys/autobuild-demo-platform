"""
environment.py  —  RL environment for adaptive 3DCP slicing.
Speed-optimised: remaining is a set, obs mask uses direct indexing,
start_pos uses squared distances, _nearest uses set iteration.
"""

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from typing import List, Optional, Tuple, Set
import math

from sika733 import (
    pot_life_at_temp,
    composite_risk_score,
    adapt_speed_for_conditions,
    min_interlayer_time,
    LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M,
    AMBIENT_TEMP_MIN, AMBIENT_TEMP_MAX,
)

Segment = Tuple[Tuple[float, float], Tuple[float, float]]

MAX_SEGMENTS = 256

DEFAULT_PRINTER = {
    "nozzle_diameter_mm":      25.0,
    "max_speed_mm_s":          100.0,
    "min_speed_mm_s":          15.0,
    "layer_adhesion_pressure": 12.0,
    "max_layer_height_mm":     20.0,
    "min_layer_height_mm":     6.0,
    "max_mass_flow_l_min":     8.0,
    "hose_length_m":           15.0,
    "pump_lag_s":              3.0,
}

FIXED_OBS_DIM = 4 + 2 + 4 + 3 + 3   # 16
SEG_FEATURES  = 4
OBS_DIM       = FIXED_OBS_DIM + MAX_SEGMENTS * SEG_FEATURES + MAX_SEGMENTS


class AdaptiveSlicerEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        segments:        Optional[List[Segment]] = None,
        layer_meta:      Optional[dict]          = None,
        weather:         Optional[dict]          = None,
        printer:         Optional[dict]          = None,
        layer_idx:       int                     = 0,
        num_layers:      int                     = 100,
        elapsed_min:     float                   = 0.0,
        pot_life_min:    float                   = 60.0,
        total_print_min: float                   = 0.0,   # actual estimated total duration
    ):
        super().__init__()

        self.all_segments  = segments   or []
        self.layer_meta    = layer_meta or {}
        self.weather       = weather    or {"temperature":20,"humidity":65,"wind_speed":8,"ground_slope":0}
        self.printer       = {**DEFAULT_PRINTER, **(printer or {})}
        self.layer_idx     = layer_idx
        self.num_layers    = num_layers
        self.elapsed_min   = elapsed_min
        self.pot_life_min  = pot_life_min
        self.total_print_min = total_print_min

        self.action_space      = spaces.Discrete(MAX_SEGMENTS)
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf,
            shape=(OBS_DIM,), dtype=np.float32,
        )

        # FIX 1: set instead of list — O(1) lookup and removal
        self.remaining:   Set[int]   = set()
        self.printed:     List[int]  = []
        self.nozzle_pos:  np.ndarray = np.zeros(2, dtype=np.float32)
        self._step_count: int        = 0
        self._travel_mm:  float      = 0.0

        # FIX 2: pre-allocate obs array — reuse across steps
        self._obs_buf = np.zeros(OBS_DIM, dtype=np.float32)
        # FIX 3: pre-compute segment coords array for fast indexing
        self._seg_coords: np.ndarray = np.zeros((MAX_SEGMENTS, 4), dtype=np.float32)

    def _build_seg_coords(self):
        """Cache segment coords as numpy array once per layer."""
        n = min(len(self.all_segments), MAX_SEGMENTS)
        for i in range(n):
            seg = self.all_segments[i]
            self._seg_coords[i, 0] = seg[0][0]
            self._seg_coords[i, 1] = seg[0][1]
            self._seg_coords[i, 2] = seg[1][0]
            self._seg_coords[i, 3] = seg[1][1]

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        n = min(len(self.all_segments), MAX_SEGMENTS)
        # FIX 1: set for O(1) ops
        self.remaining   = set(range(n))
        self.printed     = []
        self.nozzle_pos  = self._start_pos()
        self._step_count = 0
        self._travel_mm  = 0.0
        self._build_seg_coords()
        return self._obs(), {}

    def step(self, action: int):
        # FIX 1: O(1) membership test
        if action not in self.remaining:
            action = self._nearest()

        seg       = self.all_segments[action]
        seg_start = np.array(seg[0], dtype=np.float32)
        seg_end   = np.array(seg[1], dtype=np.float32)

        travel_m  = float(np.linalg.norm(seg_start - self.nozzle_pos))
        seg_len_m = float(np.linalg.norm(seg_end - seg_start))

        self._travel_mm  += (travel_m + seg_len_m) * 1000
        self.nozzle_pos   = seg_end
        # FIX 1: O(1) removal
        self.remaining.discard(action)
        self.printed.append(action)
        self._step_count += 1

        reward    = self._reward(travel_m, seg_len_m)
        done      = len(self.remaining) == 0
        truncated = self._step_count >= MAX_SEGMENTS * 2

        return self._obs(), reward, done, truncated, {}

    def _obs(self) -> np.ndarray:
        # FIX 2: reuse pre-allocated buffer
        obs = self._obs_buf
        obs[:] = 0.0

        w = self.weather
        p = self.printer

        temp     = float(w.get("temperature",  20.0))
        humidity = float(w.get("humidity",     65.0))
        wind     = float(w.get("wind_speed",    8.0))
        slope    = float(w.get("ground_slope",  0.0))

        obs[0] = self._n(temp,     AMBIENT_TEMP_MIN, AMBIENT_TEMP_MAX)
        obs[1] = self._n(humidity, 30.0, 100.0)
        obs[2] = self._n(wind,      0.0,  60.0)
        obs[3] = self._n(slope,     0.0,  15.0)

        pot_remaining = max(0.0, self.pot_life_min - self.elapsed_min)
        obs[4] = float(pot_remaining / max(self.pot_life_min, 1.0))
        obs[5] = float(composite_risk_score(temp, humidity, wind, slope) / 100.0)

        obs[6]  = float(self.layer_meta.get("complexity", 0.5))
        obs[7]  = self._n(float(self.layer_meta.get("perimeter_m", 1.0)), 0.0, 100.0)
        obs[8]  = self._n(float(self.layer_meta.get("area_m2",    0.1)), 0.0,  50.0)
        obs[9]  = self._n(float(self.layer_meta.get("wall_thickness_m", 0.025)), 0.005, 0.1)
        obs[10] = self._n(float(p.get("max_speed_mm_s",      100.0)),  0.0, 300.0)
        obs[11] = self._n(float(p.get("max_mass_flow_l_min",   8.0)),  0.0,  40.0)
        obs[12] = self._n(float(p.get("nozzle_diameter_mm",   25.0)), 10.0,  50.0)
        obs[13] = self._n(float(self.layer_idx),                       0.0, float(self.num_layers))
        # Normalise elapsed against total estimated print duration so long prints
        # (e.g. 52h = 3120 min) don't clip to 1.0 after the first pot-life window
        total_min_norm = max(self.total_print_min, self.pot_life_min, 1.0)
        obs[14] = self._n(self.elapsed_min, 0.0, total_min_norm)
        obs[15] = self._n(float(self.num_layers - self.layer_idx),     0.0, float(self.num_layers))

        # FIX 3: use pre-cached seg coords — one slice copy instead of loop
        base = FIXED_OBS_DIM
        n    = min(len(self.all_segments), MAX_SEGMENTS)
        obs[base : base + n * SEG_FEATURES] = self._seg_coords[:n].ravel()

        # Mask: set bits for remaining segments
        mask_base = base + MAX_SEGMENTS * SEG_FEATURES
        # FIX 4: clear only previously set bits, set new ones
        for i in self.remaining:
            if i < MAX_SEGMENTS:
                obs[mask_base + i] = 1.0

        return obs

    def _reward(self, travel_m: float, seg_len_m: float) -> float:
        w    = self.weather
        temp = float(w.get("temperature", 20.0))

        print_reward   =  seg_len_m * 3.0
        travel_penalty = -travel_m  * 2.5

        pot_remaining = max(0.0, self.pot_life_min - self.elapsed_min)
        pot_frac_used = 1.0 - pot_remaining / max(self.pot_life_min, 1.0)
        time_penalty  = -max(0.0, pot_frac_used - 0.8) * 10.0

        risk = composite_risk_score(
            temp,
            float(w.get("humidity",     65.0)),
            float(w.get("wind_speed",    8.0)),
            float(w.get("ground_slope",  0.0)),
        )
        env_penalty  = -(risk / 100.0) * 2.0
        struct_bonus = 0.0
        if len(self.printed) >= 2:
            prev = self.all_segments[self.printed[-2]]
            dist = float(np.linalg.norm(
                np.array(prev[1]) - np.array(self.all_segments[self.printed[-1]][0])
            ))
            if dist < 0.01:
                struct_bonus = 0.5

        speed_bonus = 0.0
        if len(self.remaining) == 0 and self.elapsed_min < self.pot_life_min * 0.5:
            speed_bonus = 1.0

        return float(print_reward + travel_penalty + time_penalty + env_penalty + struct_bonus + speed_bonus)

    def _start_pos(self) -> np.ndarray:
        if not self.all_segments:
            return np.zeros(2, dtype=np.float32)
        # FIX 5: squared distance — avoid sqrt
        nearest = min(
            range(len(self.all_segments)),
            key=lambda i: (self.all_segments[i][0][0]**2 + self.all_segments[i][0][1]**2),
        )
        return np.array(self.all_segments[nearest][0], dtype=np.float32)

    def _nearest(self) -> int:
        if not self.remaining:
            return 0
        cx, cy = float(self.nozzle_pos[0]), float(self.nozzle_pos[1])
        best_i, best_d = -1, float('inf')
        # FIX 1: iterate over set — no O(n) list scan
        for i in self.remaining:
            s  = self.all_segments[i]
            dx = s[0][0] - cx
            dy = s[0][1] - cy
            d  = dx*dx + dy*dy
            if d < best_d:
                best_d, best_i = d, i
        return best_i if best_i >= 0 else next(iter(self.remaining))

    def ordered_segments(self) -> List[Segment]:
        return [self.all_segments[i] for i in self.printed]

    def travel_mm(self) -> float:
        return self._travel_mm

    def set_layer(
        self,
        segments:        List[Segment],
        layer_meta:      dict,
        weather:         dict,
        layer_idx:       int,
        elapsed_min:     float,
        pot_life_min:    float,
        printer:         Optional[dict] = None,
        total_print_min: float          = 0.0,
    ):
        self.all_segments    = segments
        self.layer_meta      = layer_meta
        self.weather         = weather
        self.layer_idx       = layer_idx
        self.elapsed_min     = elapsed_min
        self.pot_life_min    = pot_life_min
        self.total_print_min = total_print_min
        if printer:
            self.printer = {**DEFAULT_PRINTER, **printer}

    @staticmethod
    def _n(val: float, lo: float, hi: float) -> float:
        return float(np.clip((val - lo) / (hi - lo + 1e-8), 0.0, 1.0))