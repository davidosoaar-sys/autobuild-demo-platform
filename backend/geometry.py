"""
geometry.py — 3DCP Adaptive Slicer

How it works:
  1. Load mesh. OBJ files get Y-up → Z-up rotation applied.
  2. At each layer Z, slice the FULL mesh (not wall-filtered) using
     trimesh.intersections.mesh_plane → raw 3D line segments.
  3. Polygonize those segments using Shapely → clean closed polygons
     representing the actual cross-section of the building.
  4. Inward-offset each polygon by nozzle_width/2 → print centreline.
  5. Walk polygon.exterior.coords → ordered print segments.
     Interior rings (holes = rooms) are also walked → inner wall passes.
  6. Gaps between consecutive exterior coord pairs that are larger than
     the nozzle width signal window/door openings — these are left as
     coordinate jumps. main.py's serialiser detects them and inserts
     {"gap": true} so the 3D viewer and G-code both handle them correctly.
"""

import io
import numpy as np
import trimesh
from shapely.geometry import MultiLineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union
from typing import List, Optional, Tuple

from sika733 import (
    LAYER_HEIGHT_DEF_M,
    LAYER_HEIGHT_MAX_M,
    LAYER_HEIGHT_MIN_M,
)

Segment  = Tuple[Tuple[float, float], Tuple[float, float]]
Layer    = List[Segment]
Geometry = List[Layer]


def parse_and_slice(
    file_bytes:   bytes,
    filename:     str,
    layer_height: float = LAYER_HEIGHT_DEF_M,
    nozzle_width: float = 0.025,
    max_layers:   Optional[int] = None,
    print_scale:  float = 1.0,
) -> Tuple[Geometry, List[dict], dict]:

    ext = filename.lower().split(".")[-1]

    # ── Load ──────────────────────────────────────────────────────────────────
    try:
        if ext == "stl":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="stl", force="mesh")
        elif ext == "obj":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="obj", force="mesh")
        else:
            raise ValueError(f"Unsupported file type: {ext}")
    except Exception as e:
        raise ValueError(f"Could not load mesh: {e}")

    if not isinstance(mesh, trimesh.Trimesh):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            raise ValueError(f"Could not merge mesh: {e}")

    # ── OBJ: Y-up → Z-up ─────────────────────────────────────────────────────
    if ext == "obj":
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
        )

    # ── Repair ────────────────────────────────────────────────────────────────
    try:
        trimesh.repair.fix_normals(mesh)
        trimesh.repair.fix_winding(mesh)
    except Exception:
        pass

    # ── Centre on origin, sit on Z=0 ─────────────────────────────────────────
    b = mesh.bounds
    mesh.apply_translation([
        -(b[0][0] + b[1][0]) / 2.0,
        -(b[0][1] + b[1][1]) / 2.0,
        -b[0][2],
    ])

    # Apply uniform print scale — all geometry, segments, perimeter, and
    # estimated time scale correctly because the mesh itself is transformed.
    if abs(print_scale - 1.0) > 1e-6:
        mesh.apply_scale(float(print_scale))

    bounds       = mesh.bounds
    total_height = float(bounds[1][2])
    layer_height = float(np.clip(layer_height, LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M))

    if total_height < layer_height:
        raise ValueError(
            f"Model height {total_height*1000:.1f}mm < layer height {layer_height*1000:.1f}mm"
        )

    num_layers = max(1, int(total_height / layer_height))
    if max_layers:
        num_layers = min(num_layers, max_layers)

    geometry:    Geometry   = []
    layer_metas: List[dict] = []
    max_segs = 0

    for i in range(num_layers):
        z        = (i + 0.5) * layer_height
        segments = _slice_layer(mesh, z, nozzle_width)
        geometry.append(segments)

        n = len(segments)
        max_segs = max(max_segs, n)

        perim = sum(_seg_len(s[0], s[1]) for s in segments) if segments else 0.0
        all_pts = [p for s in segments for p in s]
        if all_pts:
            xs = [p[0] for p in all_pts]
            ys = [p[1] for p in all_pts]
            area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        else:
            area = 0.0

        layer_metas.append({
            "index":            i,
            "z_height_m":       round(z, 4),
            "segment_count":    n,
            "perimeter_m":      round(perim, 4),
            "area_m2":          round(area, 6),
            "wall_thickness_m": round(nozzle_width, 4),
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


def _slice_layer(mesh: trimesh.Trimesh, z: float, nozzle_width: float) -> Layer:
    """
    Slice the mesh at height z and return ordered print segments.

    Pipeline:
      mesh_plane() → 2D line segments → polygonize → inward offset →
      walk exterior + interiors → ordered segments with implicit gap markers
    """
    # Step 1: get raw 3D cross-section segments from trimesh
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

    # Step 2: build 2D MultiLineString from the segments
    line_list = []
    for seg in lines:
        x0, y0 = float(seg[0][0]), float(seg[0][1])
        x1, y1 = float(seg[1][0]), float(seg[1][1])
        if abs(x1 - x0) > 1e-9 or abs(y1 - y0) > 1e-9:
            line_list.append(((x0, y0), (x1, y1)))

    if not line_list:
        return []

    mls = MultiLineString(line_list)

    # Step 3: polygonize — Shapely finds all closed rings in the line soup
    polys = list(polygonize(mls))

    # If polygonize finds nothing, try buffering the lines slightly to close gaps
    if not polys:
        try:
            buffered = mls.buffer(nozzle_width * 0.1)
            if buffered.geom_type == "Polygon":
                polys = [buffered]
            elif hasattr(buffered, "geoms"):
                polys = [g for g in buffered.geoms if g.geom_type == "Polygon"]
        except Exception:
            pass

    if not polys:
        return []

    # Step 4: merge overlapping polygons, keep only significant ones
    try:
        merged = unary_union(polys)
    except Exception:
        merged = polys[0] if polys else None

    if merged is None or merged.is_empty:
        return []

    poly_list: List[Polygon] = (
        [g for g in merged.geoms if g.geom_type == "Polygon"]
        if hasattr(merged, "geoms")
        else [merged] if merged.geom_type == "Polygon"
        else []
    )

    # Filter tiny noise polygons (< 4× nozzle area)
    min_area = (nozzle_width * 2) ** 2
    poly_list = [p for p in poly_list if p.area > min_area]

    if not poly_list:
        return []

    # Step 5: inward offset by nozzle_width/2 → print centreline
    # Use join_style=2 (flat) to avoid artefacts at corners
    offset_polys: List[Polygon] = []
    for poly in poly_list:
        try:
            shrunk = poly.buffer(-nozzle_width / 2, join_style=2)
            if shrunk.is_empty:
                # Wall is thinner than nozzle — use original perimeter
                shrunk = poly
            if shrunk.geom_type == "Polygon":
                offset_polys.append(shrunk)
            elif hasattr(shrunk, "geoms"):
                offset_polys.extend(g for g in shrunk.geoms if g.geom_type == "Polygon")
        except Exception:
            offset_polys.append(poly)

    if not offset_polys:
        return []

    # Step 6: walk each polygon's exterior (and interiors for thick walls)
    # producing ordered (p0, p1) segments.
    # Coordinate jumps > nozzle_width between consecutive coords = gap
    # (window/door opening). We leave those jumps in place — main.py
    # serialiser detects gap > GAP_THRESHOLD_M and inserts {"gap": true}.
    segments: Layer = []

    def walk_ring(coords) -> List[Segment]:
        pts = list(coords)
        out = []
        for j in range(len(pts) - 1):
            p0 = (float(pts[j][0]),   float(pts[j][1]))
            p1 = (float(pts[j+1][0]), float(pts[j+1][1]))
            # Only skip true zero-length duplicates
            if _seg_len(p0, p1) > 1e-9:
                out.append((p0, p1))
        return out

    # Sort polygons largest-first so outer wall prints before inner passes
    offset_polys.sort(key=lambda p: p.area, reverse=True)

    for poly in offset_polys:
        segments.extend(walk_ring(poly.exterior.coords))
        for interior in poly.interiors:
            segments.extend(walk_ring(interior.coords))

    return segments


def _seg_len(p0: Tuple[float, float], p1: Tuple[float, float]) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))