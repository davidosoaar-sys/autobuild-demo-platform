"""
geometry.py
Adaptive slicer for 3DCP.

Takes an STL or OBJ file and slices it into horizontal layers,
exactly as a 3DCP printer needs:

  1. Load mesh
  2. Sit it on Z=0
  3. Cut horizontal slices every `layer_height` metres
  4. Each slice → cross-section polygon (the wall shape at that height)
  5. Perimeter segments  → the nozzle traces the outline
  6. Infill lines        → boustrophedon (back-and-forth) fill inside walls
  7. Per-layer metadata  → complexity, perimeter, area, wall thickness
                          (fed to the RL agent for parameter decisions)

Layer height is clamped to Sika 733 PDS limits: 6–20 mm.
"""

import numpy as np
import trimesh
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union
from typing import List, Tuple, Optional
import io

from sika733 import (
    LAYER_HEIGHT_MIN_M,
    LAYER_HEIGHT_MAX_M,
    LAYER_HEIGHT_DEF_M,
    layer_height_for_speed,
)

# ── Types ─────────────────────────────────────────────────────────────────────

Segment  = Tuple[Tuple[float, float], Tuple[float, float]]
Layer    = List[Segment]
Geometry = List[Layer]


# ── Main entry point ──────────────────────────────────────────────────────────

def parse_and_slice(
    file_bytes:   bytes,
    filename:     str,
    layer_height: float = LAYER_HEIGHT_DEF_M,
    nozzle_width: float = 0.025,
    max_layers:   Optional[int] = None,
) -> Tuple[Geometry, List[dict], dict]:
    """
    Slice an STL or OBJ file into printable layers.

    Returns
    -------
    geometry     : list[list[Segment]]   — ordered segments per layer
    layer_metas  : list[dict]            — per-layer metadata for RL
    meta         : dict                  — overall geometry info
    """
    ext = filename.lower().split(".")[-1]

    # ── Load mesh ─────────────────────────────────────────────────────────────
    try:
        if ext == "stl":
            mesh = trimesh.load(
                io.BytesIO(file_bytes), file_type="stl", force="mesh"
            )
        elif ext == "obj":
            mesh = trimesh.load(
                io.BytesIO(file_bytes), file_type="obj", force="mesh"
            )
        else:
            raise ValueError(f"Unsupported file type: {ext}")
    except Exception as e:
        raise ValueError(f"Could not load mesh: {e}")

    # If OBJ loaded as Scene, merge all sub-meshes
    if not isinstance(mesh, trimesh.Trimesh):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            raise ValueError(f"Could not merge mesh geometry: {e}")

    # ── Normalise: sit on Z=0, centered on X/Y ───────────────────────────────
    # Move to Z=0 first
    mesh.apply_translation(-mesh.bounds[0])
    # Now center X and Y so toolpath aligns with model in 3D viewer
    bounds       = mesh.bounds
    cx           = (bounds[0][0] + bounds[1][0]) / 2.0
    cy           = (bounds[0][1] + bounds[1][1]) / 2.0
    mesh.apply_translation([-cx, -cy, 0])

    bounds       = mesh.bounds                      # [[xmin,ymin,zmin],[xmax,ymax,zmax]]
    total_height = float(bounds[1][2])

    # Clamp layer height to Sika 733 PDS limits (6–20 mm)
    layer_height = float(np.clip(layer_height, LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M))

    num_layers = max(1, int(total_height / layer_height))
    if max_layers:
        num_layers = min(num_layers, max_layers)

    geometry:    Geometry   = []
    layer_metas: List[dict] = []
    max_segs     = 0

    for i in range(num_layers):
        z        = (i + 0.5) * layer_height     # slice at mid-layer Z
        segments = _slice_at_z(mesh, z, nozzle_width)
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
            "complexity":       0.0,    # filled in below
        })

    # Normalise complexity across all layers
    for lm in layer_metas:
        lm["complexity"] = round(lm["segment_count"] / max(max_segs, 1), 4)

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


# ── Slice at a given Z height ─────────────────────────────────────────────────

def _slice_at_z(
    mesh:        trimesh.Trimesh,
    z:           float,
    nozzle_width: float,
) -> Layer:
    """
    Cut the mesh at height z and return printable segments.

    Segments come from two sources:
      1. Perimeter  — the outline of the cross-section
      2. Infill     — boustrophedon raster lines inside the walls
    """
    try:
        section = mesh.section(
            plane_origin=[0, 0, z],
            plane_normal=[0, 0, 1],
        )
    except Exception:
        return []

    if section is None:
        return []

    try:
        path2d, _ = section.to_planar()
    except Exception:
        return []

    segments: Layer = []

    # Filter: keep only the largest polygon (outer wall shell)
    # This removes interior features, floors, ceilings that a 3DCP printer doesn't print
        try:
            polys = []
            for entity in path2d.entities:
                pts = path2d.vertices[entity.points]
                if len(pts) >= 3:
                    try:
                        p = Polygon(pts)
                        if p.is_valid and not p.is_empty and p.area > 0.001:
                            polys.append(p)
                    except Exception:
                        pass

            if polys:
                # Keep only the largest polygon — the outer building shell
                outer = max(polys, key=lambda p: p.area)
                # Also keep polygons that are at least 20% of the largest area
                # (handles L-shaped or complex footprints)
                min_area = outer.area * 0.20
                significant = [p for p in polys if p.area >= min_area]
                filtered = unary_union(significant)

                # Regenerate perimeter segments from filtered polygon only
                segments = []
                if hasattr(filtered, 'geoms'):
                    polys_to_trace = list(filtered.geoms)
                else:
                    polys_to_trace = [filtered]

                for poly in polys_to_trace:
                    coords = list(poly.exterior.coords)
                    for j in range(len(coords) - 1):
                        p0 = (float(coords[j][0]),   float(coords[j][1]))
                        p1 = (float(coords[j+1][0]), float(coords[j+1][1]))
                        if _seg_len(p0, p1) > 0.001:
                            segments.append((p0, p1))
        except Exception:
            pass  # fall back to raw segments if filtering fails

    # 2. Infill lines inside the filtered cross-section
    infill = _boustrophedon_infill(path2d, nozzle_width, outer_only=True)
    segments.extend(infill)

    return segments


# ── Boustrophedon infill ──────────────────────────────────────────────────────

def _boustrophedon_infill(path2d, spacing: float, outer_only: bool = True) -> Layer:
    """
    Generate back-and-forth horizontal fill lines strictly inside the wall cross-section.
    Uses only the exterior boundary to prevent infill bleeding outside the model.
    """
    segments: Layer = []
    try:
        polys = []
        for entity in path2d.entities:
            pts = path2d.vertices[entity.points]
            if len(pts) >= 3:
                try:
                    p = Polygon(pts)
                    if p.is_valid and not p.is_empty and p.area > 0.001:
                        # Use only exterior ring — ignore holes to prevent bleed
                        exterior = Polygon(p.exterior.coords)
                        if exterior.is_valid:
                            polys.append(exterior)
                except Exception:
                    pass

        if not polys:
            return []

        if outer_only and len(polys) > 1:
            largest_area = max(p.area for p in polys)
            polys = [p for p in polys if p.area >= largest_area * 0.20]

        # Use union but then take only exterior to avoid interior artifacts
        union = unary_union(polys)
        if union.is_empty:
            return []

        # Shrink slightly inward (erosion) to keep infill inside walls
        clipped = union.buffer(-spacing * 0.3)
        if clipped.is_empty:
            clipped = union

        minx, miny, maxx, maxy = clipped.bounds
        row  = 0
        y    = miny + spacing * 0.5

        while y <= maxy:
            scan  = LineString([(minx - 0.001, y), (maxx + 0.001, y)])
            inter = clipped.intersection(scan)

            if not inter.is_empty:
                lines = list(inter.geoms) if hasattr(inter, "geoms") else [inter]
                for line in lines:
                    coords = list(line.coords)
                    if len(coords) < 2:
                        continue
                    if row % 2 == 1:
                        coords = list(reversed(coords))
                    for k in range(len(coords) - 1):
                        p0 = (float(coords[k][0]),   float(coords[k][1]))
                        p1 = (float(coords[k+1][0]), float(coords[k+1][1]))
                        if _seg_len(p0, p1) > 0.001:
                            segments.append((p0, p1))

            y   += spacing
            row += 1

    except Exception:
        pass

    return segments


# ── Per-layer geometry stats ──────────────────────────────────────────────────

def _layer_geometry(
    segments:    Layer,
    nozzle_width: float,
) -> Tuple[float, float, float]:
    """
    Compute:
      perimeter_m      — total length of all segments
      area_m2          — approximate enclosed area (bounding box heuristic)
      wall_thickness_m — estimated wall thickness
    """
    if not segments:
        return 0.0, 0.0, nozzle_width

    total_len = sum(_seg_len(s[0], s[1]) for s in segments)

    # Bounding box of all segment endpoints
    all_pts = [p for seg in segments for p in seg]
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    bbox_w = max(xs) - min(xs)
    bbox_h = max(ys) - min(ys)
    area   = bbox_w * bbox_h

    # Wall thickness estimate: average segment length / number of lines
    avg_seg = total_len / max(len(segments), 1)
    wall_t  = max(nozzle_width, min(nozzle_width * 4, avg_seg * 0.3))

    return total_len, area, wall_t


# ── Utility ───────────────────────────────────────────────────────────────────

def _seg_len(
    p0: Tuple[float, float],
    p1: Tuple[float, float],
) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))