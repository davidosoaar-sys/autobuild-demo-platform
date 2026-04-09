"""
geometry.py — 3DCP Adaptive Slicer

Uses trimesh.intersections.mesh_plane to get world-space 3D line segments,
then builds clean wall polygons using graph-based ring tracing.

Gap handling:
  Segments longer than MAX_BEAD_MULTIPLIER × nozzle_width are travel moves
  (they cross a window/door opening). These are split: the slicer emits the
  segment up to the gap, marks a gap, then the segment after the gap restarts.
  The gap marker {"gap": true} tells the 3D viewer to skip drawing a bead.
"""

import numpy as np
import trimesh
from shapely.geometry import Polygon, LinearRing, MultiPolygon
from shapely.ops import unary_union
from typing import List, Tuple, Optional, Dict
from collections import defaultdict
import io

from sika733 import (
    LAYER_HEIGHT_MIN_M,
    LAYER_HEIGHT_MAX_M,
    LAYER_HEIGHT_DEF_M,
)

Segment  = Tuple[Tuple[float, float], Tuple[float, float]]
Layer    = List[Segment]
Geometry = List[Layer]

# Snap tolerance — segments within this distance share a vertex
SNAP_TOL = 1e-4

# Any traced perimeter segment longer than this multiple of the nozzle width
# is a travel move across a void (window/door), NOT a print bead.
# Real print beads are typically 0.8–2× nozzle width long per step.
MAX_BEAD_MULTIPLIER = 8.0   # tune: larger = more permissive


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

    if not isinstance(mesh, trimesh.Trimesh):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            raise ValueError(f"Could not merge mesh: {e}")

    # Fill holes and fix winding for cleaner cross-sections
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

    # ── Build wall-only mesh (filter out roofs/floors) ────────────────────────
    # Faces whose normal is mostly horizontal (|nz| < 0.55) = walls
    try:
        normals    = mesh.face_normals
        wall_mask  = np.abs(normals[:, 2]) < 0.55
        wall_faces = mesh.faces[wall_mask]
        if len(wall_faces) >= 10:
            wall_mesh = trimesh.Trimesh(
                vertices=mesh.vertices.copy(),
                faces=wall_faces,
                process=False,
            )
        else:
            wall_mesh = mesh
    except Exception:
        wall_mesh = mesh

    # ── Compute actual layer count from geometry ──────────────────────────────
    # Always use the real height — never hard-cap unless caller passes max_layers
    num_layers = max(1, int(total_height / layer_height))
    if max_layers:
        num_layers = min(num_layers, max_layers)

    geometry:    Geometry   = []
    layer_metas: List[dict] = []
    max_segs     = 0
    prev_poly    = None

    for i in range(num_layers):
        z = (i + 0.5) * layer_height
        segments, layer_poly = _slice_layer(
            wall_mesh, z, nozzle_width, prev_poly, i == 0
        )

        if layer_poly is not None and not layer_poly.is_empty:
            prev_poly = layer_poly

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


def _snap(v: np.ndarray, tol: float = SNAP_TOL) -> Tuple[float, float]:
    """Snap a 2D point to grid to merge near-identical vertices."""
    return (round(float(v[0]) / tol) * tol, round(float(v[1]) / tol) * tol)


def _build_rings(segments_2d: List[Tuple[np.ndarray, np.ndarray]]) -> List[List[Tuple[float, float]]]:
    """
    Build closed rings from unordered line segments using graph traversal.
    Robust against gaps and T-junctions.
    """
    graph: Dict[Tuple[float,float], List[Tuple[float,float]]] = defaultdict(list)

    for p0, p1 in segments_2d:
        s0 = _snap(p0)
        s1 = _snap(p1)
        if s0 == s1:
            continue
        graph[s0].append(s1)
        graph[s1].append(s0)

    visited_edges = set()
    rings = []

    for start in list(graph.keys()):
        if not graph[start]:
            continue

        for next_v in graph[start]:
            edge = (min(start, next_v), max(start, next_v))
            if edge in visited_edges:
                continue

            ring = [start, next_v]
            visited_edges.add(edge)

            for _ in range(10000):
                current = ring[-1]
                prev    = ring[-2]

                candidates = [v for v in graph[current]
                              if (min(current, v), max(current, v)) not in visited_edges]

                if not candidates:
                    break

                if len(candidates) == 1:
                    nxt = candidates[0]
                else:
                    dx_in  = current[0] - prev[0]
                    dy_in  = current[1] - prev[1]
                    best   = None
                    best_d = float('inf')
                    for c in candidates:
                        dx_out = c[0] - current[0]
                        dy_out = c[1] - current[1]
                        cross  = abs(dx_in * dy_out - dy_in * dx_out)
                        if cross < best_d:
                            best_d = cross
                            best   = c
                    nxt = best

                edge = (min(current, nxt), max(current, nxt))
                visited_edges.add(edge)

                if nxt == ring[0]:
                    break

                ring.append(nxt)

            if len(ring) >= 3 and ring[-1] == ring[0]:
                rings.append(ring[:-1])
            elif len(ring) >= 3:
                rings.append(ring)

    return rings


def _split_on_gaps(segments: Layer, nozzle_width: float) -> Layer:
    """
    Post-process a layer's segments: any segment longer than
    MAX_BEAD_MULTIPLIER × nozzle_width is a travel move across a void
    (window/door). We keep both halves as separate segments — the gap
    between them will be detected by main.py's serialiser and marked
    with {"gap": true}.

    We do NOT actually split the geometry here; instead we remove the
    long diagonal segment entirely. The serialiser in main.py will see
    the coordinate jump between consecutive segments and insert the gap
    marker automatically (gap > GAP_THRESHOLD_M).

    So: just REMOVE segments that are travel moves. The endpoint of the
    previous segment and startpoint of the next real segment will have a
    large gap, which the serialiser catches.
    """
    max_bead_len = nozzle_width * MAX_BEAD_MULTIPLIER
    return [s for s in segments if _seg_len(s[0], s[1]) <= max_bead_len]


def _slice_layer(
    mesh:         trimesh.Trimesh,
    z:            float,
    nozzle_width: float,
    prev_poly,
    is_first:     bool,
) -> Tuple[Layer, object]:
    """
    Slice mesh at height z.
    Returns (segments, wall_polygon).
    Long diagonal segments across voids are removed — the gap between
    consecutive short segments is what signals window/door openings.
    """
    try:
        lines = trimesh.intersections.mesh_plane(
            mesh,
            plane_normal=[0, 0, 1],
            plane_origin=[0, 0, z],
        )
    except Exception:
        return [], None

    if lines is None or len(lines) == 0:
        return [], None

    segs_2d = []
    for seg in lines:
        p0 = np.array([seg[0][0], seg[0][1]])
        p1 = np.array([seg[1][0], seg[1][1]])
        if np.linalg.norm(p1 - p0) > nozzle_width * 0.05:
            segs_2d.append((p0, p1))

    if not segs_2d:
        return [], None

    rings = _build_rings(segs_2d)

    raw_polys = []
    for ring in rings:
        try:
            if len(ring) < 3:
                continue
            poly = Polygon(ring)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_valid and not poly.is_empty and poly.area > (nozzle_width * 2) ** 2:
                raw_polys.append(poly)
        except Exception:
            continue

    if not raw_polys:
        try:
            from shapely.geometry import MultiLineString
            from shapely.ops import polygonize
            ml = MultiLineString([[list(s[0]), list(s[1])] for s in segs_2d])
            raw_polys = [p for p in polygonize(ml)
                         if p.area > (nozzle_width * 2) ** 2]
        except Exception:
            pass

    if not raw_polys:
        try:
            from shapely.geometry import MultiPoint
            pts = [pt for seg in segs_2d for pt in [tuple(seg[0]), tuple(seg[1])]]
            hull = MultiPoint(pts).convex_hull
            if hull.geom_type == 'Polygon' and hull.area > (nozzle_width * 2) ** 2:
                raw_polys = [hull]
        except Exception:
            pass

    if not raw_polys:
        # Raw fallback — filter long segments before returning
        result_segs = [
            ((float(s[0][0]), float(s[0][1])), (float(s[1][0]), float(s[1][1])))
            for s in segs_2d
        ]
        return _split_on_gaps(result_segs, nozzle_width), None

    # ── Island detection ──────────────────────────────────────────────────────
    if not is_first and prev_poly is not None:
        try:
            prev_exp  = prev_poly.buffer(nozzle_width * 3.0)
            connected = [p for p in raw_polys if p.intersects(prev_exp)]
            if connected:
                raw_polys = connected
        except Exception:
            pass

    raw_polys.sort(key=lambda p: p.area, reverse=True)
    max_area   = raw_polys[0].area
    wall_polys = [p for p in raw_polys if p.area >= max_area * 0.10]

    try:
        wall_union = unary_union(wall_polys)
        sorted_polys = (
            sorted(wall_union.geoms, key=lambda p: p.area, reverse=True)
            if hasattr(wall_union, 'geoms') else [wall_union]
        )
    except Exception:
        sorted_polys = wall_polys[:1]

    final_segs: Layer = []

    def trace_ring(coords):
        out = []
        for j in range(len(coords) - 1):
            p0 = (float(coords[j][0]),   float(coords[j][1]))
            p1 = (float(coords[j+1][0]), float(coords[j+1][1]))
            seg_length = _seg_len(p0, p1)
            # Skip micro-segments AND long travel diagonals across voids
            if nozzle_width * 0.05 < seg_length <= nozzle_width * MAX_BEAD_MULTIPLIER:
                out.append((p0, p1))
        return out

    final_union = unary_union(sorted_polys) if sorted_polys else None

    if final_union is None or final_union.is_empty:
        return final_segs, None

    polys_list = list(final_union.geoms) if hasattr(final_union, 'geoms') else [final_union]

    for poly in polys_list:
        if poly.geom_type != 'Polygon':
            continue
        final_segs.extend(trace_ring(list(poly.exterior.coords)))
        for interior in poly.interiors:
            final_segs.extend(trace_ring(list(interior.coords)))

    return final_segs, final_union


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


def _seg_len(p0: Tuple[float, float], p1: Tuple[float, float]) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))