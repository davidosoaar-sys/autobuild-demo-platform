"""
geometry.py
3DCP Adaptive Slicer

Slices STL/OBJ into horizontal layers for concrete printing.

Key differences from plastic FDM slicers:
  - Layer heights 6-20mm (Sika 733 PDS)
  - Perimeter-only mode (walls, not solid infill)
  - Infill strictly clipped to wall polygon — no bleed
  - Mesh centered at X=0, Y=0 so toolpath aligns with 3D viewer
"""

import numpy as np
import trimesh
from shapely.geometry import Polygon, LineString, MultiPolygon
from shapely.ops import unary_union
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


def parse_and_slice(
    file_bytes:   bytes,
    filename:     str,
    layer_height: float = LAYER_HEIGHT_DEF_M,
    nozzle_width: float = 0.025,
    max_layers:   Optional[int] = None,
) -> Tuple[Geometry, List[dict], dict]:
    """
    Slice an STL/OBJ into 3DCP-printable layers.
    Returns (geometry, layer_metas, meta).
    """
    ext = filename.lower().split(".")[-1]

    # ── Load mesh ─────────────────────────────────────────────────────────────
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

    # ── Centre mesh at origin: Z sits on 0, X/Y centred ──────────────────────
    b = mesh.bounds
    mesh.apply_translation([
        -(b[0][0] + b[1][0]) / 2.0,   # centre X
        -(b[0][1] + b[1][1]) / 2.0,   # centre Y
        -b[0][2],                       # sit on Z=0
    ])

    bounds       = mesh.bounds
    total_height = float(bounds[1][2])

    # Clamp layer height to Sika 733 PDS limits
    layer_height = float(np.clip(layer_height, LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M))

    num_layers = max(1, int(total_height / layer_height))
    if max_layers:
        num_layers = min(num_layers, max_layers)

    geometry:    Geometry   = []
    layer_metas: List[dict] = []
    max_segs     = 0

    for i in range(num_layers):
        z        = (i + 0.5) * layer_height
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
            "complexity":       0.0,
        })

    for lm in layer_metas:
        lm["complexity"] = round(lm["segment_count"] / max(max_segs, 1), 4)

    bounds = mesh.bounds  # recompute after translation
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


def _slice_at_z(
    mesh:         trimesh.Trimesh,
    z:            float,
    nozzle_width: float,
) -> Layer:
    """
    Slice at height z. Returns wall perimeter + infill segments,
    strictly clipped to the wall polygon.
    """
    try:
        section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    except Exception:
        return []

    if section is None:
        return []

    try:
        path2d, _ = section.to_planar()
    except Exception:
        return []

    # ── Build polygons from cross-section ─────────────────────────────────────
    raw_polys = []
    for entity in path2d.entities:
        pts = path2d.vertices[entity.points]
        if len(pts) < 3:
            continue
        try:
            poly = Polygon(pts)
            if poly.is_valid and not poly.is_empty and poly.area > (nozzle_width ** 2):
                raw_polys.append(poly)
        except Exception:
            pass

    if not raw_polys:
        return []

    # ── Keep only outer shell ─────────────────────────────────────────────────
    # Sort by area descending, keep polys >= 15% of largest
    raw_polys.sort(key=lambda p: p.area, reverse=True)
    max_area = raw_polys[0].area
    wall_polys = [p for p in raw_polys if p.area >= max_area * 0.15]

    # Merge overlapping wall polygons
    wall_union = unary_union(wall_polys)
    if wall_union.is_empty:
        return []

    segments: Layer = []

    # ── 1. Perimeter (concrete wall outline) ─────────────────────────────────
    # For each polygon, trace the EXTERIOR ring only
    def _trace_ring(ring):
        coords = list(ring.coords)
        segs = []
        for j in range(len(coords) - 1):
            p0 = (float(coords[j][0]),   float(coords[j][1]))
            p1 = (float(coords[j+1][0]), float(coords[j+1][1]))
            if _seg_len(p0, p1) > nozzle_width * 0.1:
                segs.append((p0, p1))
        return segs

    if hasattr(wall_union, "geoms"):
        polys_list = list(wall_union.geoms)
    else:
        polys_list = [wall_union]

    for poly in polys_list:
        segments.extend(_trace_ring(poly.exterior))

    # ── 2. Infill strictly clipped to wall polygon ────────────────────────────
    # Inset the polygon by half nozzle width so infill stays inside wall
    inset = wall_union.buffer(-nozzle_width * 0.5)
    if inset.is_empty or inset.area < nozzle_width ** 2:
        return segments

    infill = _raster_infill(inset, nozzle_width)
    segments.extend(infill)

    return segments


def _raster_infill(polygon, spacing: float) -> Layer:
    """
    Generate boustrophedon (back-and-forth) raster lines
    STRICTLY inside the given polygon using intersection clipping.
    """
    segments: Layer = []
    try:
        minx, miny, maxx, maxy = polygon.bounds
        row = 0
        y   = miny + spacing * 0.5

        while y <= maxy:
            # Scan line clipped exactly to polygon — no bleed
            scan  = LineString([(minx - 0.001, y), (maxx + 0.001, y)])
            inter = polygon.intersection(scan)

            if not inter.is_empty:
                # May return Point, LineString, or MultiLineString
                if inter.geom_type == "LineString":
                    lines = [inter]
                elif inter.geom_type == "MultiLineString":
                    lines = list(inter.geoms)
                else:
                    lines = []

                for line in lines:
                    if line.length < spacing * 0.1:
                        continue
                    coords = list(line.coords)
                    if row % 2 == 1:
                        coords = list(reversed(coords))
                    for k in range(len(coords) - 1):
                        p0 = (float(coords[k][0]),   float(coords[k][1]))
                        p1 = (float(coords[k+1][0]), float(coords[k+1][1]))
                        if _seg_len(p0, p1) > spacing * 0.05:
                            segments.append((p0, p1))

            y   += spacing
            row += 1

    except Exception:
        pass

    return segments


def _layer_geometry(
    segments:     Layer,
    nozzle_width: float,
) -> Tuple[float, float, float]:
    """Perimeter length, area, wall thickness for a layer."""
    if not segments:
        return 0.0, 0.0, nozzle_width

    total_len = sum(_seg_len(s[0], s[1]) for s in segments)
    all_pts   = [p for seg in segments for p in seg]
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    area   = (max(xs) - min(xs)) * (max(ys) - min(ys))
    wall_t = max(nozzle_width, min(nozzle_width * 4,
                                   total_len / max(len(segments), 1) * 0.3))
    return total_len, area, wall_t


def _seg_len(p0: Tuple[float, float], p1: Tuple[float, float]) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))