"""
geometry.py — 3DCP Adaptive Slicer

Pipeline per layer:
  1. Slice wall mesh at height Z → raw 3D line segments (trimesh)
  2. Project to 2D XY
  3. Buffer each segment by nozzle_width/2 → concrete bead footprint
  4. Merge overlapping bead footprints → printable wall regions
  5. Walk exterior of each region → ordered print segments
  6. Large gaps between consecutive segments = door/window openings
     → left as coordinate jumps; main.py serialiser marks them {"gap":true}

FAST_PATH_THRESHOLD is computed dynamically from nozzle_width:
  - nozzle_width comes from printer setup (nozzle_diameter_mm / 1000)
  - baseline 2000 segs covers Wellness Beckum (~767 segs/layer at 25mm nozzle)
  - scales proportionally: smaller nozzle → lower threshold (faster)
  - always at least 1500 to avoid skipping buffer on medium complexity models
"""

import io
import numpy as np
import trimesh
from typing import List, Optional, Tuple

from sika733 import (
    LAYER_HEIGHT_DEF_M,
    LAYER_HEIGHT_MAX_M,
    LAYER_HEIGHT_MIN_M,
)

Segment  = Tuple[Tuple[float, float], Tuple[float, float]]
Layer    = List[Segment]
Geometry = List[Layer]


def _load_dxf(file_bytes: bytes) -> trimesh.Trimesh:
    """Convert DXF entities to a trimesh mesh."""
    import ezdxf
    import tempfile, os

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as f:
        f.write(file_bytes)
        tmp_path = f.name

    try:
        doc   = ezdxf.readfile(tmp_path)
        msp   = doc.modelspace()
        verts = []
        faces = []

        for entity in msp:
            if entity.dxftype() == '3DFACE':
                pts  = [entity.dxf.vtx0, entity.dxf.vtx1, entity.dxf.vtx2, entity.dxf.vtx3]
                base = len(verts)
                verts.extend([[p.x, p.y, p.z] for p in pts])
                faces.append([base, base+1, base+2])
                if pts[2] != pts[3]:
                    faces.append([base, base+2, base+3])
            elif entity.dxftype() == 'MESH':
                try:
                    v    = [(p[0], p[1], p[2]) for p in entity.vertices]
                    f    = list(entity.faces)
                    base = len(verts)
                    verts.extend(v)
                    faces.extend([[base+i for i in face] for face in f])
                except Exception:
                    pass

        if not verts:
            raise ValueError("No 3D geometry found in DXF file.")
        return trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=True)
    finally:
        os.unlink(tmp_path)


def _load_ifc(file_bytes: bytes) -> trimesh.Trimesh:
    """Extract wall geometry from IFC file using ifcopenshell."""
    import ifcopenshell
    import ifcopenshell.geom
    import tempfile, os

    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as f:
        f.write(file_bytes)
        tmp_path = f.name

    try:
        ifc      = ifcopenshell.open(tmp_path)
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
        meshes   = []

        for product in ifc.by_type('IfcWall') + ifc.by_type('IfcSlab') + \
                       ifc.by_type('IfcColumn') + ifc.by_type('IfcBeam'):
            try:
                shape = ifcopenshell.geom.create_shape(settings, product)
                verts = np.array(shape.geometry.verts).reshape(-1, 3)
                faces = np.array(shape.geometry.faces).reshape(-1, 3)
                if len(verts) > 0 and len(faces) > 0:
                    meshes.append(trimesh.Trimesh(vertices=verts, faces=faces, process=False))
            except Exception:
                continue

        if not meshes:
            raise ValueError("No structural geometry found in IFC file.")
        return trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
    finally:
        os.unlink(tmp_path)


def parse_and_slice(
    file_bytes:   bytes,
    filename:     str,
    layer_height: float = LAYER_HEIGHT_DEF_M,
    nozzle_width: float = 0.025,
    max_layers:   Optional[int] = None,
    print_scale:  float = 1.0,
    slicing_mode: str   = 'geometry',
) -> Tuple[Geometry, List[dict], dict]:

    ext = filename.lower().split(".")[-1]

    # ── Load ──────────────────────────────────────────────────────────────────
    try:
        if ext == "stl":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="stl", force="mesh")
        elif ext == "obj":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="obj", force="mesh")
        elif ext in ("stp", "step"):
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="step", force="mesh")
        elif ext == "dxf":
            mesh = _load_dxf(file_bytes)
        elif ext == "ifc":
            mesh = _load_ifc(file_bytes)
        else:
            raise ValueError(f"Unsupported file type: .{ext}. Supported: STL, OBJ, STP/STEP, DXF, IFC")
    except Exception as e:
        raise ValueError(f"Could not load mesh: {e}")

    if not isinstance(mesh, trimesh.Trimesh):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            raise ValueError(f"Could not merge mesh: {e}")

    if ext == "obj":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))

    try:
        trimesh.repair.fix_normals(mesh)
        trimesh.repair.fix_winding(mesh)
    except Exception:
        pass

    # ── Centre: sit on Z=0, centre X/Y ───────────────────────────────────────
    b = mesh.bounds
    mesh.apply_translation([
        -(b[0][0] + b[1][0]) / 2.0,
        -(b[0][1] + b[1][1]) / 2.0,
        -b[0][2],
    ])

    # ── Auto unit detection ───────────────────────────────────────────────────
    # STL/OBJ files are commonly authored in mm. Detect and convert to meters.
    # Heuristic: if any dimension > 100, assume mm and scale to meters.
    raw_bounds = mesh.bounds  # [[xmin,ymin,zmin],[xmax,ymax,zmax]]
    max_dim = max(
        raw_bounds[1][0] - raw_bounds[0][0],  # x extent
        raw_bounds[1][1] - raw_bounds[0][1],  # y extent
        raw_bounds[1][2] - raw_bounds[0][2],  # z extent
    )
    if max_dim > 100:
        print(f"[geometry] Model appears to be in mm (max_dim={max_dim:.1f}) — converting to meters", flush=True)
        mesh.vertices *= 0.001
    else:
        print(f"[geometry] Model appears to be in meters (max_dim={max_dim:.3f}m) — no conversion needed", flush=True)

    if abs(print_scale - 1.0) > 1e-6:
        mesh.apply_scale(float(print_scale))

    bounds       = mesh.bounds
    total_height = float(bounds[1][2])
    layer_height = float(np.clip(layer_height, LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M))

    if total_height < layer_height:
        raise ValueError(f"Model height {total_height*1000:.1f}mm < layer height {layer_height*1000:.1f}mm")

    # ── Layer count ───────────────────────────────────────────────────────────
    total_layers  = max(1, int(total_height / layer_height))
    print(f"[geometry] total_height={total_height:.3f}m layers={total_layers} layer_height={layer_height*1000:.1f}mm", flush=True)
    if total_layers > 1000:
        raise ValueError(f"Unrealistic layer count ({total_layers}) — model may be in wrong units after conversion. Check file.")
    num_layers    = min(total_layers, max_layers) if max_layers else total_layers
    layer_indices = list(range(num_layers))

    geometry:    Geometry   = []
    layer_metas: List[dict] = []
    max_segs = 0

    for idx, layer_i in enumerate(layer_indices):
        z        = (layer_i + 0.5) * layer_height
        segments = _slice_layer(mesh, z, nozzle_width, slicing_mode, idx)
        geometry.append(segments)

        n        = len(segments)
        max_segs = max(max_segs, n)

        perim   = sum(_seg_len(s[0], s[1]) for s in segments) if segments else 0.0
        all_pts = [p for s in segments for p in s]
        if all_pts:
            xs   = [p[0] for p in all_pts]
            ys   = [p[1] for p in all_pts]
            area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        else:
            area = 0.0

        layer_metas.append({
            "index":            idx,
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
        "total_layers":      total_layers,
        "subsampled":        num_layers < total_layers,
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
    mesh,
    z_height:     float,
    nozzle_width: float,
    slicing_mode: str = 'geometry',
    layer_idx:    int = 0,
) -> List[Segment]:
    z_sample = float(z_height) + 1e-5
    MIN_LEN  = float(nozzle_width) * 0.1

    # ── Geometry mode: collapse inner/outer face pairs to centerlines ──────────
    # mesh_plane() returns one segment per triangle face crossing the plane.
    # Each concrete element has two faces (inner + outer surface), so we get two
    # nearly-parallel segments per element. We pair them by opposite face normals
    # and average their endpoints to produce one centerline segment per element.
    if slicing_mode == 'geometry':
        try:
            raw = trimesh.intersections.mesh_plane(
                mesh,
                plane_normal=[0, 0, 1],
                plane_origin=[0, 0, z_sample],
                return_faces=True,
            )
        except Exception as e:
            print(f"[geometry] layer={layer_idx} mesh_plane failed: {e}", flush=True)
            return []

        if raw is None:
            return []

        lines, face_idx = (raw if isinstance(raw, tuple) and len(raw) == 2
                           else (raw, None))

        if lines is None or len(lines) == 0:
            return []

        # Project to 2D, filter slivers, collect face normals (XY only)
        segs_2d:  List[Segment]                = []
        norms_2d: List[Optional[Tuple[float, float]]] = []

        for i, line in enumerate(lines):
            p0 = (float(line[0][0]), float(line[0][1]))
            p1 = (float(line[1][0]), float(line[1][1]))
            if _seg_len(p0, p1) < MIN_LEN:
                continue
            segs_2d.append((p0, p1))
            if face_idx is not None:
                n = mesh.face_normals[int(face_idx[i])]
                norms_2d.append((float(n[0]), float(n[1])))
            else:
                norms_2d.append(None)

        if not segs_2d:
            return []

        # Pair inner/outer faces of the same element and average to centerline.
        # A valid pair must satisfy all three:
        #   1. Opposite face normals: n1·n2 < -0.5  (inner vs outer surface)
        #   2. Close midpoints: distance < nozzle_width * 3
        #   3. Roughly parallel: |dir1·dir2| > 0.85
        n_segs     = len(segs_2d)
        paired     = [False] * n_segs
        merge_dist = float(nozzle_width) * 3.0
        centerlines: List[Segment] = []

        for i in range(n_segs):
            if paired[i]:
                continue
            s1 = segs_2d[i]
            n1 = norms_2d[i]
            dx1 = s1[1][0] - s1[0][0]
            dy1 = s1[1][1] - s1[0][1]
            len1 = (dx1*dx1 + dy1*dy1) ** 0.5
            if len1 < 1e-9:
                paired[i] = True
                continue
            mid1 = ((s1[0][0]+s1[1][0]) * 0.5, (s1[0][1]+s1[1][1]) * 0.5)
            best_j, best_d = -1, float('inf')

            for j in range(i + 1, n_segs):
                if paired[j]:
                    continue
                n2 = norms_2d[j]
                # Condition 1: opposite normals
                if n1 is not None and n2 is not None:
                    if n1[0]*n2[0] + n1[1]*n2[1] > -0.5:
                        continue
                # Condition 2: close midpoints
                s2   = segs_2d[j]
                mid2 = ((s2[0][0]+s2[1][0]) * 0.5, (s2[0][1]+s2[1][1]) * 0.5)
                d    = _seg_len(mid1, mid2)
                if d > merge_dist:
                    continue
                # Condition 3: roughly parallel
                dx2 = s2[1][0] - s2[0][0]
                dy2 = s2[1][1] - s2[0][1]
                len2 = (dx2*dx2 + dy2*dy2) ** 0.5
                if len2 < 1e-9:
                    continue
                if abs((dx1*dx2 + dy1*dy2) / (len1*len2)) < 0.85:
                    continue
                if d < best_d:
                    best_d, best_j = d, j

            if best_j >= 0:
                s2  = segs_2d[best_j]
                dx2 = s2[1][0] - s2[0][0]
                dy2 = s2[1][1] - s2[0][1]
                # Align s2 direction with s1 before averaging
                if dx1*dx2 + dy1*dy2 < 0:
                    s2 = (s2[1], s2[0])
                cl = (
                    ((s1[0][0]+s2[0][0]) * 0.5, (s1[0][1]+s2[0][1]) * 0.5),
                    ((s1[1][0]+s2[1][0]) * 0.5, (s1[1][1]+s2[1][1]) * 0.5),
                )
                if _seg_len(cl[0], cl[1]) >= MIN_LEN:
                    centerlines.append(cl)
                paired[i] = True
                paired[best_j] = True
            else:
                centerlines.append(s1)
                paired[i] = True

        print(
            f"[geometry] layer={layer_idx} z={z_height:.3f}m "
            f"mode=geometry raw={len(lines)} segs={len(segs_2d)} centerlines={len(centerlines)}",
            flush=True,
        )
        return centerlines

    # ── Shell mode: section contours = closed loops (both sides of each element) ──
    try:
        section = mesh.section(
            plane_origin=[0, 0, z_sample],
            plane_normal=[0, 0, 1],
        )
    except Exception as e:
        print(f"[geometry] layer={layer_idx} section failed: {e}", flush=True)
        return []

    if section is None:
        return []

    try:
        section_2d, _ = section.to_planar()
    except Exception as e:
        print(f"[geometry] layer={layer_idx} to_planar failed: {e}", flush=True)
        return []

    if section_2d is None:
        return []

    if not hasattr(section_2d, 'entities') or len(section_2d.entities) == 0:
        return []

    MIN_PERIM = float(nozzle_width) * 4.0
    contours  = []

    for entity in section_2d.entities:
        try:
            indices = entity.points
            pts_raw = section_2d.vertices[indices]
            n = len(pts_raw)
            if n < 3:
                continue

            perim = 0.0
            for i in range(n):
                dx = float(pts_raw[(i + 1) % n][0]) - float(pts_raw[i][0])
                dy = float(pts_raw[(i + 1) % n][1]) - float(pts_raw[i][1])
                perim += (dx * dx + dy * dy) ** 0.5

            if perim < MIN_PERIM:
                continue

            points_list = [(float(pts_raw[i][0]), float(pts_raw[i][1])) for i in range(n)]
            contours.append({'points': points_list, 'perimeter': perim})
        except Exception as e:
            print(f"[geometry] layer={layer_idx} contour error: {e}", flush=True)
            continue

    if not contours:
        return []

    def contour_to_segments(points_list, closed=True) -> List[Segment]:
        segs = []
        m    = len(points_list)
        end  = m if closed else m - 1
        for i in range(end):
            segs.append((points_list[i], points_list[(i + 1) % m]))
        return segs

    segments: List[Segment] = []
    for contour in contours:
        segments.extend(contour_to_segments(contour['points'], closed=True))

    print(
        f"[geometry] layer={layer_idx} z={z_height:.3f}m "
        f"mode=shell contours={len(contours)} segments={len(segments)}",
        flush=True,
    )
    return segments



def _walk_ring(coords) -> List[Segment]:
    pts = list(coords)
    out = []
    for j in range(len(pts) - 1):
        p0 = (float(pts[j][0]),   float(pts[j][1]))
        p1 = (float(pts[j+1][0]), float(pts[j+1][1]))
        if _seg_len(p0, p1) > 1e-9:
            out.append((p0, p1))
    return out


def _nn_chain(segs: List[Segment]) -> List[Segment]:
    if not segs:
        return []
    if len(segs) <= 2:
        return segs

    def rnd(p): return (round(p[0], 6), round(p[1], 6))

    from collections import defaultdict
    start_map = defaultdict(list)
    rounded   = [(rnd(s[0]), rnd(s[1])) for s in segs]
    for i, (p0, p1) in enumerate(rounded):
        start_map[p0].append(i)

    used    = [False] * len(segs)
    ordered = []

    for start_i in range(len(segs)):
        if used[start_i]:
            continue
        chain         = [segs[start_i]]
        used[start_i] = True
        cur_end       = rounded[start_i][1]

        while True:
            next_i = next((i for i in start_map.get(cur_end, []) if not used[i]), None)
            if next_i is None:
                break
            used[next_i] = True
            chain.append(segs[next_i])
            cur_end = rounded[next_i][1]

        ordered.extend(chain)

    for i, seg in enumerate(segs):
        if not used[i]:
            ordered.append(seg)

    return ordered


def _dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return float(np.hypot(b[0] - a[0], b[1] - a[1]))


def _seg_len(p0: Tuple[float, float], p1: Tuple[float, float]) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))


