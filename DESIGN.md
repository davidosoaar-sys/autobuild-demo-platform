---
name: AutoBuild AI
description: Clean gray-and-white workspace for planning, printing and monitoring 3D concrete builds.
colors:
  ink: "#111827"
  ink-soft: "#4b5563"
  ink-quiet: "#9ca3af"
  paper: "#ffffff"
  mist: "#f9fafb"
  mist-deep: "#f3f4f6"
  hairline: "#e5e7eb"
  hairline-strong: "#d1d5db"
  signal-critical: "#ef4444"
  signal-warning: "#fbbf24"
  signal-ok: "#10b981"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "10px"
    fontWeight: 400
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  marketing:
    fontFamily: "Space Grotesk, sans-serif"
    fontWeight: 400
  marketing-mono:
    fontFamily: "JetBrains Mono, monospace"
    fontWeight: 400
rounded:
  sm: "4px"
  lg: "8px"
  xl: "12px"
  xxl: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.xl}"
    padding: "8px 20px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "8px 20px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.xxl}"
    padding: "20px"
  step-pill-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  step-pill-done:
    backgroundColor: "{colors.mist-deep}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
---

# Design System: AutoBuild AI

## Overview

**Creative North Star: "The Quiet Workbench"**

A clean, monochrome workspace where the plan, the 3D model and the numbers are the content and the interface stays out of the way. Surfaces are white and pale gray, separated by thin borders and generous rounding rather than heavy shadows. Color is rationed: the palette is black-and-gray, and red, amber and green appear only to say something about a print.

The system is deliberately plain. One typeface at one weight, near-black as the only "accent", and dark viewer panels that make 3D and camera content pop against the light chrome. It reads soft and approachable because of the large corner radii and open spacing, and serious because nothing decorative competes with the data.

This is the incumbent look, documented as it exists. The name is a working label and can be changed.

**Key Characteristics:**
- Monochrome gray and white; near-black (#111827) is the primary action color.
- Large rounded corners (12px and 16px) on cards and buttons; pills for steps and status.
- Depth from 1px borders and pale gray fills, with light shadows only on some cards.
- Red, amber and green are reserved for print and inspection status.
- Small type (10 to 14px) dominates; the interface is dense with readouts and labels.
- Dark (`bg-black`) panels are used for 3D, camera and inspection viewers.

## Colors

A restrained neutral palette with three status signals; there is no brand hue.

### Primary
- **Ink** (#111827): Primary buttons, the active step pill, headings and key values. It is the only strong "accent" in the interface.

### Neutral
- **Ink Soft** (#4b5563): Secondary text and completed-step labels.
- **Ink Quiet** (#9ca3af): Captions, placeholder text and locked steps.
- **Paper** (#ffffff): Cards, the nav bar (at 80% with blur) and main surfaces.
- **Mist** (#f9fafb): Page background and inset tiles (the most common fill).
- **Mist Deep** (#f3f4f6): Completed step pills, hover fills and dividers.
- **Hairline** (#e5e7eb): Nav and card borders.
- **Hairline Strong** (#d1d5db): Input borders and emphasized dividers.

### Status (semantic, not accent)
- **Signal Critical** (#ef4444): Defects, failures, errors (used with red-50 fills).
- **Signal Warning** (#fbbf24): Warnings and cautions (used with amber-50 fills).
- **Signal OK** (#10b981): Healthy and passing states (emerald-400 and 500 on dark viewers).

### Named Rules
**The Status-Only Color Rule.** Red, amber and green mean a print or inspection state and nothing else. Never use them for decoration, branding or emphasis.

**The One Ink Rule.** Near-black is the single action color. Do not introduce a second brand hue for buttons or links.

## Typography

**Display Font:** Inter (with system sans fallback)
**Body Font:** Inter
**Label/Mono Font:** JetBrains Mono, marketing pages only

**Character:** Neutral and even. `globals.css` forces Inter at weight 400 across the whole app, so hierarchy comes from size, color and spacing rather than weight. Marketing surfaces (`.mkt`) switch to Space Grotesk with JetBrains Mono for figures.

### Hierarchy
- **Title** (400, 20px): Section and page headings.
- **Body** (400, 14px): Default text and card content (text-sm).
- **Label** (400, 12px and 11px): Form labels, step pills, button text (text-xs, text-[11px]).
- **Caption** (400, 10px and 9px): Readout labels, badges and micro-annotations (text-[10px], text-[9px]).

### Named Rules
**The Single Weight Rule.** The app renders at weight 400 (enforced by an `!important` override). Do not rely on bold for hierarchy without first changing that override.

## Layout

Content is centered in a `max-w-7xl` container with 24px side padding. A sticky top bar holds the logo, a Home link, the project name and a five-step process indicator (Printer Setup, Pre-Print, Live Monitor, Post Processing, Report) where later steps are locked until reached. Pages use a flex column with the main region growing to fill the viewport. Grids of cards use consistent 16px gaps; dense readout panels use 8 to 12px. Spacing follows Tailwind's 4px scale.

## Elevation & Depth

Mostly flat: surfaces separate through 1px borders (gray-100 and gray-200) and a shift between white and gray-50 fills. Light shadows (`shadow-sm`) appear on some cards; larger shadows (`shadow-lg`, `shadow-2xl`) are reserved for overlays and modals. The nav uses translucency and a backdrop blur to stay legible over content. Dark viewer panels create depth by inversion, not by shadow.

### Named Rules
**The Border-First Rule.** Separate surfaces with a hairline border or a tonal fill before reaching for a shadow.

## Shapes

Soft and rounded. Cards use 16px (`rounded-2xl`) and buttons and tiles use 12px (`rounded-xl`), with 8px for smaller controls. Step pills, status chips and dots are fully round. Sharp corners are absent apart from the 4px logo mark.

## Components

### Buttons
- **Shape:** Gently curved (12px).
- **Primary:** Ink (#111827) fill, white text, 8px by 20px padding, 12px text.
- **Outline:** White or transparent with a 1px black border; on hover it fills black with white text.
- **Hover:** Color inversion with a quick transition (`transition-all`); on dark viewers, `hover:bg-white/10`.
- **Tile buttons:** Gray-50 tile that inverts to black on hover.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** White or gray-50; black for viewer panels.
- **Border:** 1px gray-100 or gray-200.
- **Shadow Strategy:** See Elevation & Depth; usually none or `shadow-sm`.
- **Internal Padding:** 16 to 20px.

### Navigation
- **Style:** Sticky top bar, white at 80% with blur, 1px gray-200 bottom border.
- **Step pills:** 11px text with a numbered or checked circle. Active is ink with white text; done is gray-100 with gray-700 text and hover gray-200; locked is gray-50 with gray-300 text and a not-allowed cursor. Steps are separated by a small "›".
- **Help:** A 24px circular "?" button to the right.

### Status chips
- Pill or dot with a red, amber or emerald fill on a tinted background (red-50, amber-50), used for bead, defect and camera states.

## Do's and Don'ts

### Do:
- **Do** keep surfaces white and gray-50 with 1px hairline borders.
- **Do** use ink (#111827) for the one primary action on a screen.
- **Do** keep red, amber and green for print and inspection status.
- **Do** use 12px radius for buttons and tiles, 16px for cards.
- **Do** put 3D, camera and inspection content on dark panels.

### Don't:
- **Don't** add a second brand color for buttons or links.
- **Don't** use status colors decoratively.
- **Don't** add heavy drop shadows to resting cards.
- **Don't** introduce a new typeface in the app; Space Grotesk and JetBrains Mono belong to marketing (`.mkt`) surfaces only.
