"""
geometry.py — 3DCP Adaptive Slicer

Strategy:
  1. Load mesh. For OBJ files apply Y-up → Z-up rotation.
  2. Build a wall-only submesh (|nz| < 0.55).
  3. At each layer Z, call trimesh.intersections.mesh_plane → raw 3D segments.
  4. Project to 2D XY. These ARE the wall cross-section edges — no ring tracing
     needed. We sort them into a continuous print path using nearest-neighbour
     chaining. Gaps > GAP_THRESHOLD (window/door openings) are left as-is;
     main.py's serialiser detects them and inserts {"gap": true} markers.

OBJ Y-up fix:
  OBJ format uses Y-up. We rotate the mesh -90° around X before slicing
  so Z becomes the height axis.
"""

import numpy as np
import trimesh
from typing import List, Tuple, Optional
import io

from sika733 import (
    LAYER_HEIGHT_MIN_M,
    LAYER_HEIGHT_MAX_M,
    LAYER_HEIGHT_DEF_M,
)

Segment  = Tuple[Tuple[float, float], Tuple[float, float]]
Layer    = List[Segment]
Geometry = List[Layer]

# Gaps larger than this between chained segments = window/door opening.
# Main.py serialiser inserts {"gap": true} markers at these points.
# In metres — 50mm is generous enough to catch real openings but not
# treat close-but-disconnected wall segments as gaps.
GAP_CHAIN_THRESHOLD_M = 0.05   # 50 mm


def parse_and_slice(
    file_bytes:   bytes,
    filename:     str,
    layer_height: float = LAYER_HEIGHT_DEF_M,
    nozzle_width: float = 0.025,
    max_layers:   Optional[int] = None,
) -> Tuple[Geometry, List[dict], dict]:

    ext = filename.lower().split(".")[-1]

    try:
        if ext == "stl":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="stl", force="mesh")
        elif ext == "obj":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="obj", force="mesh")
        else:
            raise ValueError(f"Unsupported file type: {ext}")
    except Exception as e:
        raise ValueError(f"Could not load mesh: {e}")

    # Merge scene into single mesh if needed
    if not isinstance(mesh, trimesh.Trimesh):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            raise ValueError(f"Could not merge mesh: {e}")

    # ── OBJ Y-up → Z-up rotation ──────────────────────────────────────────────
    # OBJ files store Y as vertical. Rotate -90° around X so Y becomes Z.
    if ext == "obj":
        rot = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
        mesh.apply_transform(rot)

    # Fix mesh normals/winding
    try:
        trimesh.repair.fix_normals(mesh)
        trimesh.repair.fix_winding(mesh)
    except Exception:
        pass

    # Centre: sit on Z=0, centre X/Y
    b = mesh.bounds
    mesh.apply_translation([
        -(b[0][0] + b[1][0]) / 2.0,
        -(b[0][1] + b[1][1]) / 2.0,
        -b[0][2],
    ])

    bounds       = mesh.bounds
    total_height = float(bounds[1][2])
    layer_height = float(np.clip(layer_height, LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M))

    if total_height < layer_height:
        raise ValueError(
            f"Model height {total_height:.4f}m is less than layer height {layer_height:.4f}m"
        )

    # ── Wall-only submesh ─────────────────────────────────────────────────────
    # Keep faces whose normal is mostly horizontal (|nz| < 0.55).
    # This removes roofs and floors which would add garbage cross-section segs.
    try:
        normals    = mesh.face_normals
        wall_mask  = np.abs(normals[:, 2]) < 0.55
        wall_faces = mesh.faces[wall_mask]
        wall_mesh  = (
            trimesh.Trimesh(vertices=mesh.vertices.copy(), faces=wall_faces, process=False)
            if len(wall_faces) >= 10
            else mesh
        )
    except Exception:
        wall_mesh = mesh

    # ── Layer count ───────────────────────────────────────────────────────────
    num_layers = max(1, int(total_height / layer_height))
    if max_layers:
        num_layers = min(num_layers, max_layers)

    geometry:    Geometry   = []
    layer_metas: List[dict] = []
    max_segs = 0

    for i in range(num_layers):
        z        = (i + 0.5) * layer_height
        segments = _slice_layer(wall_mesh, z, nozzle_width)
        geometry.append(segments)

        if segments:
            perim, area, wall_t = _layer_geometry(segments, nozzle_width)
            max_segs = max(max_segs, len(segments))
        else:
            perim, area, wall_t = 0.0, 0.0, nozzle_width

        layer_metas.append({
            "index":            i,
            "z_height_m":       round(z, 4),
            "segment_count":    len(segments),
            "perimeter_m":      round(perim, 4),
            "area_m2":          round(area, 6),
            "wall_thickness_m": round(wall_t, 4),
            "complexity":       0.0,
        })

    for lm in layer_metas:
        lm["complexity"] = round(lm["segment_count"] / max(max_segs, 1), 4)

    bounds = mesh.bounds
    meta = {
        "num_layers":        num_layers,
        "layer_height":      layer_height,
        "nozzle_width":      nozzle_width,
        "bounds_x":          (round(float(bounds[0][0]), 3), round(float(bounds[1][0]), 3)),
        "bounds_y":          (round(float(bounds[0][1]), 3), round(float(bounds[1][1]), 3)),
        "bounds_z":          (round(float(bounds[0][2]), 3), round(float(bounds[1][2]), 3)),
        "total_height_m":    round(total_height, 3),
        "total_segments":    sum(len(l) for l in geometry),
        "total_perimeter_m": round(sum(lm["perimeter_m"] for lm in layer_metas), 2),
        "file_name":         filename,
    }

    return geometry, layer_metas, meta


def _slice_layer(
    mesh:         trimesh.Trimesh,
    z:            float,
    nozzle_width: float,
) -> Layer:
    """
    Slice the wall mesh at height z.

    Returns segments sorted into a continuous print path using
    nearest-neighbour chaining. Large gaps between chained segments
    are door/window openings — left in place for main.py to mark.
    """
    try:
        lines = trimesh.intersections.mesh_plane(
            mesh,
            plane_normal=[0, 0, 1],
            plane_origin=[0, 0, z],
        )
    except Exception:
        return []

    if lines is None or len(lines) == 0:
        return []

    # Project to 2D, filter micro-segments
    min_len = nozzle_width * 0.02   # ~0.5mm for 25mm nozzle
    raw: List[Segment] = []
    for seg in lines:
        p0 = (float(seg[0][0]), float(seg[0][1]))
        p1 = (float(seg[1][0]), float(seg[1][1]))
        if _seg_len(p0, p1) > min_len:
            raw.append((p0, p1))

    if not raw:
        return []

    # Sort segments into a continuous print path (nearest-neighbour chain).
    # This is O(n²) but n is typically < 500 segments per layer — fast enough.
    ordered  = [raw[0]]
    used     = {0}
    cur_end  = raw[0][1]

    for _ in range(len(raw) - 1):
        best_i    = -1
        best_dist = float('inf')
        best_flip = False

        for j, seg in enumerate(raw):
            if j in used:
                continue
            d_fwd = _dist(cur_end, seg[0])
            d_rev = _dist(cur_end, seg[1])
            if d_fwd < best_dist:
                best_dist = d_fwd
                best_i    = j
                best_flip = False
            if d_rev < best_dist:
                best_dist = d_rev
                best_i    = j
                best_flip = True

        if best_i == -1:
            break

        seg = raw[best_i]
        if best_flip:
            seg = (seg[1], seg[0])

        ordered.append(seg)
        used.add(best_i)
        cur_end = seg[1]

    return ordered


def _dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return float(np.hypot(b[0] - a[0], b[1] - a[1]))


def _seg_len(p0: Tuple[float, float], p1: Tuple[float, float]) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))


def _layer_geometry(segments: Layer, nozzle_width: float) -> Tuple[float, float, float]:
    if not segments:
        return 0.0, 0.0, nozzle_width
    total_len = sum(_seg_len(s[0], s[1]) for s in segments)
    all_pts   = [p for seg in segments for p in seg]
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    area   = (max(xs) - min(xs)) * (max(ys) - min(ys))
    wall_t = max(nozzle_width, min(nozzle_width * 4, total_len / max(len(segments), 1) * 0.3))
    return total_len, area, wall_t