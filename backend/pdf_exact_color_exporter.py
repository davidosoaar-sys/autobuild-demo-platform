#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF Exact Color Exporter with Color Picker
------------------------------------------

Purpose:
- Choose a PDF
- Pick a color from the PDF preview
- Scan the PDF for vector objects with EXACTLY this color
- Export ONLY those matching objects into a new PDF
- Keep original page sizes and original object coordinates

Important:
- No tolerance is used.
- A match is only true when the PDF vector fill color or stroke color has the exact same HEX value.
- The picker shows both:
    1. rendered pixel HEX
    2. nearby vector fill/stroke colors
- For best results, click on the hatch/patch and use the detected vector color, not only the rendered pixel color.
  Rendered pixels can differ because of anti-aliasing.

Dependency:
    pip install pymupdf

Start:
    python pdf_exact_color_exporter.py
"""

import csv
import math
import tempfile
import traceback
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None


# ------------------------------------------------------------
# Color helpers
# ------------------------------------------------------------

def normalize_color(c):
    """Return RGB tuple in 0..1 or None."""
    if c is None:
        return None

    if isinstance(c, (tuple, list)) and len(c) >= 3:
        return tuple(float(max(0, min(1, x))) for x in c[:3])

    if isinstance(c, (tuple, list)) and len(c) == 1:
        g = float(max(0, min(1, c[0])))
        return (g, g, g)

    return None


def rgb_to_hex(c):
    """Convert PDF color tuple to #RRGGBB."""
    c = normalize_color(c)

    if c is None:
        return "-"

    return "#{:02X}{:02X}{:02X}".format(
        int(round(c[0] * 255)),
        int(round(c[1] * 255)),
        int(round(c[2] * 255)),
    )


def clean_hex(value):
    """Normalize a user-entered HEX value to #RRGGBB or return None."""
    if not value:
        return None

    text = value.strip().upper()

    if not text.startswith("#"):
        text = "#" + text

    if len(text) != 7:
        return None

    try:
        int(text[1:3], 16)
        int(text[3:5], 16)
        int(text[5:7], 16)
    except ValueError:
        return None

    return text


# ------------------------------------------------------------
# Geometry / drawing helpers
# ------------------------------------------------------------

def point_xy(p):
    if hasattr(p, "x") and hasattr(p, "y"):
        return float(p.x), float(p.y)

    if isinstance(p, (tuple, list)) and len(p) >= 2:
        return float(p[0]), float(p[1])

    return None


def line_length(p1, p2):
    a = point_xy(p1)
    b = point_xy(p2)

    if not a or not b:
        return 0.0

    return math.hypot(a[0] - b[0], a[1] - b[1])


def rect_area(r):
    if r is None:
        return 0.0

    try:
        return abs(float(r.width) * float(r.height))
    except Exception:
        return 0.0


def rect_contains_point(rect, x, y, pad=5.0):
    if rect is None:
        return False

    try:
        return (
            rect.x0 - pad <= x <= rect.x1 + pad and
            rect.y0 - pad <= y <= rect.y1 + pad
        )
    except Exception:
        return False


def item_stats(items):
    line_count = 0
    curve_count = 0
    rect_count = 0
    total_len = 0.0

    for item in items or []:
        op = item[0] if item else None

        if op == "l" and len(item) >= 3:
            line_count += 1
            total_len += line_length(item[1], item[2])

        elif op == "re":
            rect_count += 1
            try:
                total_len += 2 * (abs(item[1].width) + abs(item[1].height))
            except Exception:
                pass

        elif op == "qu":
            line_count += 4

        elif op == "c":
            curve_count += 1

    return line_count, curve_count, rect_count, total_len


def classify_drawing(d):
    fill = normalize_color(d.get("fill"))
    stroke = normalize_color(d.get("color"))
    width = float(d.get("width") or 0)
    items = d.get("items") or []

    line_count, curve_count, rect_count, total_len = item_stats(items)
    area = rect_area(d.get("rect"))

    has_fill = fill is not None
    has_stroke = stroke is not None

    dash = d.get("dashes")
    dashed = bool(dash and str(dash).strip() not in ("[] 0", "None", ""))

    if has_fill and area > 0:
        kind = "Patch / filled area"
    elif has_stroke and line_count >= 6 and width <= 1.2:
        kind = "Hatch / line pattern"
    elif has_stroke and dashed:
        kind = "Dashed line"
    elif has_stroke:
        kind = "Lines"
    else:
        kind = "Other"

    return {
        "kind": kind,
        "has_fill": has_fill,
        "has_stroke": has_stroke,
        "width": width,
        "line_count": line_count,
        "curve_count": curve_count,
        "rect_count": rect_count,
        "total_len": total_len,
        "area": area,
        "dashed": dashed,
    }


def group_key(d):
    cls = classify_drawing(d)

    fill_hex = rgb_to_hex(d.get("fill"))
    stroke_hex = rgb_to_hex(d.get("color"))
    width = round(float(d.get("width") or 0), 3)

    dash = d.get("dashes")
    dash_text = str(dash) if dash else "-"

    return (
        cls["kind"],
        fill_hex,
        stroke_hex,
        width,
        dash_text,
    )


def drawing_matches_exact_color(d, target_hex):
    """
    Exact vector color match.
    No tolerance.
    """
    target_hex = clean_hex(target_hex)

    if target_hex is None:
        return False

    fill_hex = rgb_to_hex(d.get("fill"))
    stroke_hex = rgb_to_hex(d.get("color"))

    return fill_hex == target_hex or stroke_hex == target_hex


# ------------------------------------------------------------
# PDF scan
# ------------------------------------------------------------

def scan_pdf_exact_color(pdf_path, target_hex):
    target_hex = clean_hex(target_hex)

    if target_hex is None:
        raise ValueError("Invalid target HEX color. Use #RRGGBB, for example #CCFFFF.")

    doc = fitz.open(pdf_path)
    groups = {}

    total_drawings = 0
    total_matches = 0

    for page_index, page in enumerate(doc):
        drawings = page.get_drawings()

        for d in drawings:
            total_drawings += 1

            if not drawing_matches_exact_color(d, target_hex):
                continue

            total_matches += 1

            key = group_key(d)
            cls = classify_drawing(d)

            if key not in groups:
                groups[key] = {
                    "key": key,
                    "kind": key[0],
                    "fill": key[1],
                    "stroke": key[2],
                    "width": key[3],
                    "dash": key[4],
                    "count": 0,
                    "pages": set(),
                    "line_count": 0,
                    "area_sum": 0.0,
                    "length_sum": 0.0,
                }

            g = groups[key]
            g["count"] += 1
            g["pages"].add(page_index + 1)
            g["line_count"] += cls["line_count"]
            g["area_sum"] += cls["area"]
            g["length_sum"] += cls["total_len"]

    doc.close()

    result = []
    for g in groups.values():
        g["pages_text"] = ",".join(map(str, sorted(g["pages"])))
        result.append(g)

    result.sort(
        key=lambda x: (
            x["area_sum"],
            x["line_count"],
            x["count"],
        ),
        reverse=True,
    )

    return result, total_drawings, total_matches


# ------------------------------------------------------------
# PDF export
# ------------------------------------------------------------

def draw_pdf_item(shape, item):
    op = item[0] if item else None

    if op == "l" and len(item) >= 3:
        shape.draw_line(item[1], item[2])

    elif op == "re" and len(item) >= 2:
        shape.draw_rect(item[1])

    elif op == "qu" and len(item) >= 2:
        try:
            shape.draw_quad(item[1])
        except AttributeError:
            q = item[1]
            try:
                shape.draw_line(q.ul, q.ur)
                shape.draw_line(q.ur, q.lr)
                shape.draw_line(q.lr, q.ll)
                shape.draw_line(q.ll, q.ul)
            except Exception:
                pass

    elif op == "c" and len(item) >= 5:
        try:
            shape.draw_bezier(item[1], item[2], item[3], item[4])
        except Exception:
            pass


def finish_shape(shape, d):
    kwargs = {
        "color": d.get("color"),
        "fill": d.get("fill"),
        "width": d.get("width") if d.get("width") is not None else 1,
        "closePath": bool(d.get("closePath", False)),
        "even_odd": bool(d.get("even_odd", False)),
    }

    if d.get("dashes"):
        kwargs["dashes"] = d.get("dashes")

    if d.get("stroke_opacity") is not None:
        kwargs["stroke_opacity"] = d.get("stroke_opacity")

    if d.get("fill_opacity") is not None:
        kwargs["fill_opacity"] = d.get("fill_opacity")

    try:
        shape.finish(**kwargs)
    except TypeError:
        kwargs.pop("stroke_opacity", None)
        kwargs.pop("fill_opacity", None)

        try:
            shape.finish(**kwargs)
        except TypeError:
            kwargs.pop("dashes", None)
            shape.finish(**kwargs)


def export_exact_color_pdf(pdf_path, out_pdf_path, target_hex):
    """
    Export ONLY objects whose vector fill or stroke color exactly equals target_hex.
    """
    target_hex = clean_hex(target_hex)

    if target_hex is None:
        raise ValueError("Invalid target HEX color. Use #RRGGBB.")

    src = fitz.open(pdf_path)
    out = fitz.open()

    written = 0
    skipped = 0

    for page in src:
        new_page = out.new_page(width=page.rect.width, height=page.rect.height)
        shape = new_page.new_shape()

        for d in page.get_drawings():
            if not drawing_matches_exact_color(d, target_hex):
                skipped += 1
                continue

            before = written

            for item in d.get("items") or []:
                draw_pdf_item(shape, item)

            try:
                finish_shape(shape, d)
                written += 1
            except Exception:
                written = before
                skipped += 1

        shape.commit()

    out.save(out_pdf_path, garbage=4, deflate=True)
    out.close()
    src.close()

    return written, skipped


def write_csv(csv_path, groups, target_hex):
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")

        writer.writerow([
            "Target HEX",
            "Type",
            "Fill color",
            "Stroke color",
            "Line width",
            "Dash",
            "Object count",
            "Pages",
            "Line count",
            "Area sum",
            "Length sum",
        ])

        for g in groups:
            writer.writerow([
                target_hex,
                g["kind"],
                g["fill"],
                g["stroke"],
                g["width"],
                g["dash"],
                g["count"],
                g["pages_text"],
                g["line_count"],
                round(g["area_sum"], 2),
                round(g["length_sum"], 2),
            ])


# ------------------------------------------------------------
# Color picker window
# ------------------------------------------------------------

class PDFColorPicker(tk.Toplevel):
    def __init__(self, master, pdf_path, callback):
        super().__init__(master)

        self.title("PDF Color Picker")
        self.geometry("1150x820")

        self.pdf_path = pdf_path
        self.callback = callback

        self.doc = None
        self.page_index = tk.IntVar(value=0)
        self.zoom = tk.DoubleVar(value=2.0)

        self.pix = None
        self.photo = None
        self.tmp_png = None

        self.rendered_pixel_hex = tk.StringVar(value="-")
        self.selected_vector_hex = tk.StringVar(value="-")
        self.last_pdf_xy = tk.StringVar(value="-")
        self.info_text = tk.StringVar(
            value="Click on the PDF preview. Then choose the exact vector color if one is found."
        )

        self.nearby_vector_colors = []

        self.build_ui()
        self.open_pdf()
        self.render_page()

        self.protocol("WM_DELETE_WINDOW", self.close)

    def build_ui(self):
        top = ttk.Frame(self, padding=8)
        top.pack(fill=tk.X)

        ttk.Label(top, text="Page:").pack(side=tk.LEFT)

        self.page_spin = ttk.Spinbox(
            top,
            from_=1,
            to=1,
            width=6,
            command=self.render_page,
        )
        self.page_spin.pack(side=tk.LEFT, padx=4)
        self.page_spin.bind("<Return>", lambda e: self.render_page())

        ttk.Label(top, text="Zoom:").pack(side=tk.LEFT, padx=(16, 4))

        ttk.Spinbox(
            top,
            from_=0.5,
            to=5.0,
            increment=0.25,
            width=6,
            textvariable=self.zoom,
            command=self.render_page,
        ).pack(side=tk.LEFT)

        ttk.Button(
            top,
            text="Render page",
            command=self.render_page,
        ).pack(side=tk.LEFT, padx=8)

        ttk.Label(top, text="Rendered pixel:").pack(side=tk.LEFT, padx=(20, 4))
        ttk.Entry(top, textvariable=self.rendered_pixel_hex, width=10).pack(side=tk.LEFT)

        ttk.Label(top, text="Selected vector HEX:").pack(side=tk.LEFT, padx=(20, 4))
        ttk.Entry(top, textvariable=self.selected_vector_hex, width=10).pack(side=tk.LEFT)

        ttk.Button(
            top,
            text="Use selected color",
            command=self.use_selected_color,
        ).pack(side=tk.LEFT, padx=8)

        ttk.Label(top, textvariable=self.last_pdf_xy).pack(side=tk.RIGHT)

        info = ttk.Frame(self, padding=(8, 0, 8, 6))
        info.pack(fill=tk.X)

        ttk.Label(
            info,
            textvariable=self.info_text,
            wraplength=1100,
        ).pack(anchor="w")

        mid = ttk.Frame(self, padding=(8, 0, 8, 8))
        mid.pack(fill=tk.X)

        ttk.Label(mid, text="Nearby vector colors:").pack(side=tk.LEFT)

        self.vector_list = ttk.Combobox(
            mid,
            state="readonly",
            width=90,
            values=[],
        )
        self.vector_list.pack(side=tk.LEFT, padx=8, fill=tk.X, expand=True)
        self.vector_list.bind("<<ComboboxSelected>>", self.on_vector_choice)

        ttk.Button(
            mid,
            text="Use rendered pixel instead",
            command=self.use_rendered_pixel_as_selected,
        ).pack(side=tk.LEFT, padx=8)

        frame = ttk.Frame(self)
        frame.pack(fill=tk.BOTH, expand=True)

        self.canvas = tk.Canvas(frame, background="#EEEEEE")

        h_scroll = ttk.Scrollbar(frame, orient=tk.HORIZONTAL, command=self.canvas.xview)
        v_scroll = ttk.Scrollbar(frame, orient=tk.VERTICAL, command=self.canvas.yview)

        self.canvas.configure(
            xscrollcommand=h_scroll.set,
            yscrollcommand=v_scroll.set,
        )

        self.canvas.grid(row=0, column=0, sticky="nsew")
        v_scroll.grid(row=0, column=1, sticky="ns")
        h_scroll.grid(row=1, column=0, sticky="ew")

        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)

        self.canvas.bind("<Button-1>", self.pick_color)

    def open_pdf(self):
        if fitz is None:
            messagebox.showerror(
                "PyMuPDF missing",
                "Please install PyMuPDF first:\n\npip install pymupdf",
            )
            self.destroy()
            return

        self.doc = fitz.open(self.pdf_path)

        self.page_spin.configure(to=max(1, self.doc.page_count))
        self.page_spin.delete(0, tk.END)
        self.page_spin.insert(0, "1")

    def render_page(self):
        if not self.doc:
            return

        try:
            page_num = int(self.page_spin.get())
        except Exception:
            page_num = 1

        page_num = max(1, min(self.doc.page_count, page_num))
        self.page_index.set(page_num - 1)

        zoom = max(0.5, min(5.0, float(self.zoom.get())))

        page = self.doc[self.page_index.get()]
        matrix = fitz.Matrix(zoom, zoom)
        self.pix = page.get_pixmap(matrix=matrix, alpha=False)

        if self.tmp_png and Path(self.tmp_png).exists():
            try:
                Path(self.tmp_png).unlink()
            except Exception:
                pass

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        tmp.close()

        self.tmp_png = tmp.name
        self.pix.save(self.tmp_png)

        self.photo = tk.PhotoImage(file=self.tmp_png)

        self.canvas.delete("all")
        self.canvas.create_image(0, 0, image=self.photo, anchor="nw")
        self.canvas.configure(
            scrollregion=(0, 0, self.photo.width(), self.photo.height())
        )

    def pixel_rgb_at(self, x, y):
        if self.pix is None:
            return None

        ix = int(round(x))
        iy = int(round(y))

        if ix < 0 or iy < 0 or ix >= self.pix.width or iy >= self.pix.height:
            return None

        n = self.pix.n
        idx = (iy * self.pix.width + ix) * n
        samples = self.pix.samples

        if idx + 2 >= len(samples):
            return None

        return samples[idx], samples[idx + 1], samples[idx + 2]

    def find_nearby_vector_colors(self, pdf_x, pdf_y):
        page = self.doc[self.page_index.get()]
        found = []

        try:
            drawings = page.get_drawings()
        except Exception:
            return found

        for d in drawings:
            rect = d.get("rect")

            if not rect_contains_point(rect, pdf_x, pdf_y, pad=5.0):
                continue

            cls = classify_drawing(d)
            fill_hex = rgb_to_hex(d.get("fill"))
            stroke_hex = rgb_to_hex(d.get("color"))
            width = round(float(d.get("width") or 0), 3)

            if fill_hex != "-":
                found.append({
                    "hex": fill_hex,
                    "label": f"{fill_hex} | fill | {cls['kind']} | width {width}",
                })

            if stroke_hex != "-":
                found.append({
                    "hex": stroke_hex,
                    "label": f"{stroke_hex} | stroke | {cls['kind']} | width {width}",
                })

            if len(found) >= 12:
                break

        unique = []
        seen = set()

        for item in found:
            key = item["label"]

            if key not in seen:
                unique.append(item)
                seen.add(key)

        return unique

    def pick_color(self, event):
        zoom = float(self.zoom.get())

        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)

        rgb = self.pixel_rgb_at(canvas_x, canvas_y)

        if rgb is None:
            return

        pixel_hex = "#{:02X}{:02X}{:02X}".format(*rgb)
        self.rendered_pixel_hex.set(pixel_hex)

        pdf_x = canvas_x / zoom
        pdf_y = canvas_y / zoom

        self.last_pdf_xy.set(f"PDF point: x={pdf_x:.1f}, y={pdf_y:.1f}")

        self.nearby_vector_colors = self.find_nearby_vector_colors(pdf_x, pdf_y)

        if self.nearby_vector_colors:
            labels = [item["label"] for item in self.nearby_vector_colors]
            self.vector_list.configure(values=labels)
            self.vector_list.current(0)
            self.selected_vector_hex.set(self.nearby_vector_colors[0]["hex"])
            self.info_text.set(
                f"Rendered pixel is {pixel_hex}. "
                f"Using exact vector color {self.nearby_vector_colors[0]['hex']} by default."
            )
        else:
            self.vector_list.configure(values=[])
            self.vector_list.set("")
            self.selected_vector_hex.set(pixel_hex)
            self.info_text.set(
                f"No nearby vector object found. "
                f"Using rendered pixel {pixel_hex}. "
                f"Note: exact export may find 0 objects if this pixel is anti-aliased."
            )

    def on_vector_choice(self, event=None):
        idx = self.vector_list.current()

        if idx < 0 or idx >= len(self.nearby_vector_colors):
            return

        hex_code = self.nearby_vector_colors[idx]["hex"]
        self.selected_vector_hex.set(hex_code)
        self.info_text.set(f"Selected exact vector color: {hex_code}")

    def use_rendered_pixel_as_selected(self):
        hex_code = clean_hex(self.rendered_pixel_hex.get())

        if hex_code is None:
            messagebox.showwarning(
                "No rendered pixel",
                "Please click on the PDF preview first.",
            )
            return

        self.selected_vector_hex.set(hex_code)
        self.info_text.set(
            f"Selected rendered pixel color: {hex_code}. "
            f"Exact export may find 0 objects if this is not a PDF vector color."
        )

    def use_selected_color(self):
        hex_code = clean_hex(self.selected_vector_hex.get())

        if hex_code is None:
            messagebox.showwarning(
                "No color selected",
                "Please click on the PDF preview first.",
            )
            return

        self.callback(hex_code)
        self.close()

    def close(self):
        try:
            if self.doc:
                self.doc.close()
        except Exception:
            pass

        if self.tmp_png and Path(self.tmp_png).exists():
            try:
                Path(self.tmp_png).unlink()
            except Exception:
                pass

        self.destroy()


# ------------------------------------------------------------
# Main application
# ------------------------------------------------------------

class ExactColorExporterApp(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("PDF Exact Color Exporter")
        self.geometry("1280x760")

        self.pdf_path = tk.StringVar()
        self.out_dir = tk.StringVar()
        self.target_hex = tk.StringVar(value="")

        self.groups = []
        self.selected_keys = set()

        self.build_ui()

    def build_ui(self):
        top = ttk.Frame(self, padding=10)
        top.pack(fill=tk.X)

        ttk.Label(top, text="PDF:").grid(row=0, column=0, sticky="w")

        ttk.Entry(
            top,
            textvariable=self.pdf_path,
            width=100,
        ).grid(row=0, column=1, padx=5, sticky="ew")

        ttk.Button(
            top,
            text="Choose PDF",
            command=self.choose_pdf,
        ).grid(row=0, column=2, padx=5)

        ttk.Label(top, text="Output folder:").grid(
            row=1,
            column=0,
            sticky="w",
            pady=(6, 0),
        )

        ttk.Entry(
            top,
            textvariable=self.out_dir,
            width=100,
        ).grid(row=1, column=1, padx=5, sticky="ew", pady=(6, 0))

        ttk.Button(
            top,
            text="Choose folder",
            command=self.choose_out_dir,
        ).grid(row=1, column=2, padx=5, pady=(6, 0))

        top.columnconfigure(1, weight=1)

        color_frame = ttk.LabelFrame(self, text="Exact target color", padding=10)
        color_frame.pack(fill=tk.X, padx=10, pady=(0, 8))

        ttk.Label(color_frame, text="Target HEX:").pack(side=tk.LEFT)

        ttk.Entry(
            color_frame,
            textvariable=self.target_hex,
            width=12,
        ).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            color_frame,
            text="Pick exact color from PDF",
            command=self.open_color_picker,
        ).pack(side=tk.LEFT, padx=8)

        ttk.Button(
            color_frame,
            text="Scan exact matches",
            command=self.scan,
        ).pack(side=tk.LEFT, padx=8)

        ttk.Button(
            color_frame,
            text="Create PDF with this exact color only",
            command=self.export,
        ).pack(side=tk.RIGHT, padx=8)

        ttk.Label(
            color_frame,
            text="No tolerance is used. Fill or stroke color must match exactly.",
        ).pack(side=tk.LEFT, padx=20)

        columns = (
            "kind",
            "fill",
            "stroke",
            "width",
            "dash",
            "count",
            "pages",
            "lines",
            "area",
            "length",
        )

        self.tree = ttk.Treeview(
            self,
            columns=columns,
            show="headings",
            selectmode="browse",
        )

        headings = {
            "kind": "Type",
            "fill": "Fill color",
            "stroke": "Stroke color",
            "width": "Width",
            "dash": "Dash",
            "count": "Objects",
            "pages": "Pages",
            "lines": "Lines",
            "area": "Area",
            "length": "Length",
        }

        widths = {
            "kind": 190,
            "fill": 95,
            "stroke": 95,
            "width": 70,
            "dash": 170,
            "count": 80,
            "pages": 130,
            "lines": 80,
            "area": 100,
            "length": 100,
        }

        for col in columns:
            self.tree.heading(col, text=headings[col])
            self.tree.column(col, width=widths[col], anchor=tk.W)

        self.tree.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        bottom = ttk.Frame(self, padding=(10, 0, 10, 10))
        bottom.pack(fill=tk.X)

        self.status = tk.StringVar(value="Ready.")

        ttk.Label(bottom, textvariable=self.status).pack(side=tk.LEFT)

        ttk.Label(
            bottom,
            text=(
                "Workflow: Choose PDF → Pick exact vector color → Scan exact matches → Create PDF."
            ),
        ).pack(side=tk.RIGHT)

    def choose_pdf(self):
        path = filedialog.askopenfilename(
            title="Choose PDF",
            filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")],
        )

        if path:
            self.pdf_path.set(path)

            if not self.out_dir.get():
                self.out_dir.set(str(Path(path).parent))

    def choose_out_dir(self):
        path = filedialog.askdirectory(title="Choose output folder")

        if path:
            self.out_dir.set(path)

    def open_color_picker(self):
        pdf = self.pdf_path.get().strip()

        if not pdf or not Path(pdf).exists():
            messagebox.showwarning("PDF missing", "Please choose a PDF first.")
            return

        PDFColorPicker(self, pdf, self.set_target_color_from_picker)

    def set_target_color_from_picker(self, hex_code):
        hex_code = clean_hex(hex_code)

        if hex_code is None:
            messagebox.showerror("Invalid color", "The selected color is invalid.")
            return

        self.target_hex.set(hex_code)
        self.status.set(f"Target color set to {hex_code}. Now scan exact matches.")
        self.scan()

    def scan(self):
        if fitz is None:
            messagebox.showerror(
                "PyMuPDF missing",
                "Please install PyMuPDF first:\n\npip install pymupdf",
            )
            return

        pdf = self.pdf_path.get().strip()
        target_hex = clean_hex(self.target_hex.get())

        if not pdf or not Path(pdf).exists():
            messagebox.showwarning("PDF missing", "Please choose a PDF first.")
            return

        if target_hex is None:
            messagebox.showwarning(
                "Target color missing",
                "Please pick or enter a HEX color first, for example #CCFFFF.",
            )
            return

        try:
            self.status.set(f"Scanning exact matches for {target_hex} ...")
            self.update_idletasks()

            self.groups, total_drawings, total_matches = scan_pdf_exact_color(
                pdf,
                target_hex,
            )

            self.populate_tree()

            self.status.set(
                f"Scan complete: {total_matches} of {total_drawings} vector objects "
                f"match exact color {target_hex}. {len(self.groups)} groups found."
            )

        except Exception as e:
            traceback.print_exc()
            messagebox.showerror("Scan error", str(e))
            self.status.set("Scan error.")

    def populate_tree(self):
        self.tree.delete(*self.tree.get_children())

        for idx, g in enumerate(self.groups):
            self.tree.insert(
                "",
                tk.END,
                iid=str(idx),
                values=(
                    g["kind"],
                    g["fill"],
                    g["stroke"],
                    g["width"],
                    g["dash"],
                    g["count"],
                    g["pages_text"],
                    g["line_count"],
                    round(g["area_sum"], 1),
                    round(g["length_sum"], 1),
                ),
            )

    def export(self):
        if fitz is None:
            messagebox.showerror(
                "PyMuPDF missing",
                "Please install PyMuPDF first:\n\npip install pymupdf",
            )
            return

        pdf = self.pdf_path.get().strip()
        out_dir = self.out_dir.get().strip()
        target_hex = clean_hex(self.target_hex.get())

        if not pdf or not Path(pdf).exists():
            messagebox.showwarning("PDF missing", "Please choose a PDF first.")
            return

        if not out_dir:
            messagebox.showwarning(
                "Output folder missing",
                "Please choose an output folder.",
            )
            return

        if target_hex is None:
            messagebox.showwarning(
                "Target color missing",
                "Please pick or enter a HEX color first.",
            )
            return

        try:
            out_dir_path = Path(out_dir)
            out_dir_path.mkdir(parents=True, exist_ok=True)

            src = Path(pdf)
            color_label = target_hex.replace("#", "").lower()

            out_pdf = out_dir_path / f"{src.stem}_only_{color_label}.pdf"
            csv_path = out_dir_path / f"{src.stem}_only_{color_label}_report.csv"

            if out_pdf.exists():
                try:
                    out_pdf.unlink()
                except PermissionError:
                    messagebox.showerror(
                        "File is open",
                        f"The output file cannot be overwritten.\n\n"
                        f"Please close this file first:\n{out_pdf}",
                    )
                    return

            self.status.set(f"Creating PDF with exact color {target_hex} only ...")
            self.update_idletasks()

            written, skipped = export_exact_color_pdf(
                pdf_path=pdf,
                out_pdf_path=str(out_pdf),
                target_hex=target_hex,
            )

            if not self.groups:
                self.groups, _, _ = scan_pdf_exact_color(pdf, target_hex)
                self.populate_tree()

            write_csv(str(csv_path), self.groups, target_hex)

            size_kb = out_pdf.stat().st_size / 1024 if out_pdf.exists() else 0

            self.status.set(
                f"Done: {out_pdf.name} | {written} objects written | {size_kb:.1f} KB"
            )

            messagebox.showinfo(
                "PDF created",
                f"PDF created:\n{out_pdf}\n\n"
                f"CSV report:\n{csv_path}\n\n"
                f"Exact target color: {target_hex}\n"
                f"Written objects: {written}\n"
                f"Skipped objects: {skipped}\n"
                f"File size: {size_kb:.1f} KB",
            )

        except Exception as e:
            traceback.print_exc()
            messagebox.showerror("Export error", str(e))
            self.status.set("Export error.")


def main():
    app = ExactColorExporterApp()
    app.mainloop()


if __name__ == "__main__":
    main()
