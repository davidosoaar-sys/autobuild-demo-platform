"""
train.py
Train the PPO agent for adaptive 3DCP segment ordering.

The agent learns to order segments within a layer to minimise:
  - Wasted travel (non-printing moves)
  - Time pressure against Sika 733 pot life
  - Environmental risk from temperature/humidity/wind

Training uses randomised synthetic layers so the agent generalises
to any geometry, not a specific model.
"""

import numpy as np
import argparse
import random
import math
from typing import List, Tuple
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv
from stable_baselines3.common.callbacks import CheckpointCallback, EvalCallback

from environment import AdaptiveSlicerEnv, MAX_SEGMENTS, DEFAULT_PRINTER
from sika733 import pot_life_at_temp, LAYER_HEIGHT_DEF_M

Segment = Tuple[Tuple[float, float], Tuple[float, float]]


# ── Synthetic layer generators ─────────────────────────────────────────────────

def make_wall_layer(
    width_m: float = 8.0,
    depth_m: float = 6.0,
    nozzle_w: float = 0.025,
    n_contours: int = 2,
) -> List[Segment]:
    """Generate a rectangular wall footprint — common house layout."""
    segs: List[Segment] = []
    for k in range(n_contours):
        offset = k * nozzle_w
        x0, y0 = offset, offset
        x1, y1 = width_m - offset, depth_m - offset
        pts = [(x0,y0),(x1,y0),(x1,y1),(x0,y1),(x0,y0)]
        for i in range(len(pts)-1):
            segs.append((pts[i], pts[i+1]))
    return segs


def make_infill_layer(
    width_m: float,
    depth_m: float,
    nozzle_w: float = 0.025,
    angle_deg: float = 0.0,
) -> List[Segment]:
    """Generate raster infill lines at a given angle."""
    segs: List[Segment] = []
    spacing = nozzle_w
    n = max(1, int(depth_m / spacing))
    for i in range(n):
        y = i * spacing
        if i % 2 == 0:
            segs.append(((0.0, y), (width_m, y)))
        else:
            segs.append(((width_m, y), (0.0, y)))
    return segs


def make_random_layer(complexity: str = "medium") -> List[Segment]:
    """
    Generate a random layer with varying complexity.
    complexity: 'simple' | 'medium' | 'complex'
    """
    if complexity == "simple":
        n_segs = random.randint(4, 20)
    elif complexity == "medium":
        n_segs = random.randint(20, 80)
    else:
        n_segs = random.randint(80, MAX_SEGMENTS)

    width = random.uniform(2.0, 12.0)
    depth = random.uniform(2.0, 10.0)

    choice = random.randint(0, 3)
    if choice == 0:
        return make_wall_layer(width, depth)[:n_segs]
    elif choice == 1:
        return make_infill_layer(width, depth)[:n_segs]
    elif choice == 2:
        # Mix of wall + infill
        wall   = make_wall_layer(width, depth)
        infill = make_infill_layer(width, depth)
        return (wall + infill)[:n_segs]
    else:
        # Pure random segments
        segs = []
        for _ in range(n_segs):
            x0, y0 = random.uniform(0, width), random.uniform(0, depth)
            angle   = random.uniform(0, 2 * math.pi)
            length  = random.uniform(0.02, 0.5)
            x1      = x0 + length * math.cos(angle)
            y1      = y0 + length * math.sin(angle)
            segs.append(((x0, y0), (x1, y1)))
        return segs


def make_random_weather() -> dict:
    """Sample weather conditions spanning Sika 733 operating range and beyond."""
    temp     = random.uniform(5.0, 35.0)   # includes edge cases
    humidity = random.uniform(30.0, 95.0)
    wind     = random.uniform(0.0, 50.0)
    slope    = random.uniform(0.0, 10.0)
    return {
        "temperature":  temp,
        "humidity":     humidity,
        "wind_speed":   wind,
        "ground_slope": slope,
    }


def make_random_printer() -> dict:
    """Sample printer configs across the range supported."""
    return {
        "nozzle_diameter_mm":      random.uniform(15.0, 40.0),
        "max_speed_mm_s":          random.uniform(50.0, 200.0),
        "min_speed_mm_s":          random.uniform(10.0, 25.0),
        "max_mass_flow_l_min":     random.uniform(3.0, 20.0),
        "hose_length_m":           random.uniform(5.0, 50.0),
        "layer_adhesion_pressure": random.uniform(8.0, 18.0),
    }


# ── Environment factory ────────────────────────────────────────────────────────

def make_env(complexity: str = "medium"):
    def _init():
        weather  = make_random_weather()
        printer  = make_random_printer()
        segs     = make_random_layer(complexity)
        temp     = weather["temperature"]
        pot_life = pot_life_at_temp(temp)
        elapsed  = random.uniform(0, pot_life * 0.6)  # start anywhere in pot life

        env = AdaptiveSlicerEnv(
            segments     = segs,
            layer_meta   = {
                "complexity":        len(segs) / MAX_SEGMENTS,
                "perimeter_m":       random.uniform(1.0, 40.0),
                "area_m2":           random.uniform(0.1, 20.0),
                "wall_thickness_m":  printer["nozzle_diameter_mm"] / 1000 * 1.5,
            },
            weather      = weather,
            printer      = printer,
            layer_idx    = random.randint(0, 100),
            num_layers   = random.randint(50, 500),
            elapsed_min  = elapsed,
            pot_life_min = pot_life,
        )
        return env
    return _init


# ── Training ───────────────────────────────────────────────────────────────────

def train(
    total_timesteps: int  = 500_000,
    n_envs:          int  = 4,
    save_path:       str  = "model",
    complexity:      str  = "medium",
):
    print("=" * 50)
    print("AutoBuild AI — Adaptive Slicer RL Training")
    print(f"Total timesteps : {total_timesteps:,}")
    print(f"Parallel envs   : {n_envs}")
    print(f"Complexity      : {complexity}")
    print(f"Material        : Sikacrete-733 W 3D")
    print("=" * 50)

    # Training envs: mix of complexities
    env_fns = (
        [make_env("simple")]   * max(1, n_envs // 4) +
        [make_env("medium")]   * max(1, n_envs // 2) +
        [make_env("complex")]  * max(1, n_envs // 4)
    )[:n_envs]

    vec_env = DummyVecEnv(env_fns)

    model = PPO(
        "MlpPolicy",
        vec_env,
        verbose          = 1,
        learning_rate    = 3e-4,
        n_steps          = 1024,
        batch_size       = 256,
        n_epochs         = 8,
        gamma            = 0.99,
        gae_lambda       = 0.95,
        clip_range       = 0.2,
        ent_coef         = 0.02,   # encourage exploration of segment orderings
        tensorboard_log  = "./tb_logs",
        policy_kwargs    = dict(net_arch=[256, 256, 128]),
    )

    callbacks = [
        CheckpointCallback(
            save_freq      = max(1, total_timesteps // 10),
            save_path      = "./checkpoints",
            name_prefix    = "autobuild_slicer",
        ),
    ]

    model.learn(
        total_timesteps = total_timesteps,
        callback        = callbacks,
        progress_bar    = True,
    )

    out = f"{save_path}.zip"
    model.save(save_path)
    print(f"\nModel saved → {out}")
    print("Run: python -m uvicorn main:app --reload --port 8000")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--timesteps",  type=int, default=500_000)
    parser.add_argument("--envs",       type=int, default=4)
    parser.add_argument("--out",        type=str, default="model")
    parser.add_argument("--complexity", type=str, default="medium",
                        choices=["simple", "medium", "complex", "mixed"])
    args = parser.parse_args()
    train(args.timesteps, args.envs, args.out, args.complexity)