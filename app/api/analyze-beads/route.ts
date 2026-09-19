import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { isHeicBuffer, heicToJpegBase64 } from '@/lib/heic';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert in 3D concrete printing (3DCP) quality control. You analyse camera frames from a live concrete printer and assess bead quality.

You must respond ONLY with a valid JSON object — no prose, no markdown, no code fences.

Analyse the concrete bead layers visible in the image and return:

{
  "verdict": "straight" | "deviated" | "defect" | "unclear",
  "angle_deviation": <number, degrees the printed structure leans away from true vertical (plumb), positive = leaning right, negative = leaning left, 0 if plumb or unclear>,
  "structure_axis": { "base": { "x": <0-1>, "y": <0-1> }, "top": { "x": <0-1>, "y": <0-1> } } | null,
  "defect_type": "none" | "gap" | "collapse" | "over-extrusion" | "under-extrusion" | "layer-shift" | "deformation" | "surface-crack",
  "severity": "none" | "low" | "medium" | "high",
  "description": "<2-4 sentences: what you see, where in the layer stack it is, its likely cause, and how it would affect the print if left unaddressed. Max 500 chars.>",
  "recommendation": "<one practical, actionable sentence for the operator — a specific parameter to adjust or action to take. Empty string if verdict is straight/unclear with no defect.>",
  "bead_count": <number of visible bead layers, 0 if unclear>,
  "confidence": "low" | "medium" | "high",
  "defect_location": { "x": <0-1, fraction of image width, left to right>, "y": <0-1, fraction of image height, top to bottom>, "radius": <0-1, fraction of image width, sized to just cover the affected area> } | null
}

Verdict is driven by overall print quality: bead consistency, adhesion, and freedom from defects — that is the primary judgement, and most photos (close-ups, top-down shots, shots without much height in frame) will let you judge it perfectly well even when they don't show enough vertical structure to also judge plumb.

Plumb is a second, independent check, layered on top of that quality judgement only when the frame actually allows it. When a printed column with meaningful height IS visible, also trace an imaginary plumb line straight up from its base and compare it to where the structure actually sits at its top — a stack of consistently-sized, well-adhered beads can still be a defect if the whole column leans, bows, or drifts off vertical as it rises, even though each layer looks fine relative to its neighbour.

Rules:
- "verdict" is "straight" when the visible beads are consistent and defect-free, AND — only if a vertical structure is actually in frame — that structure is within ±2° of true plumb. If no vertical structure is in frame, plumb is simply not a factor; do not let its absence pull the verdict toward "unclear".
- "verdict" is "deviated" when beads show minor unevenness, or a visible structure leans 2–10° off plumb
- "verdict" is "defect" when a structural defect is present (collapse, gap, deformation, etc.) regardless of lean angle
- "verdict" is "unclear" ONLY when the image itself is too blurry, dark, obstructed, or zoomed out to judge bead condition at all — never merely because the framing doesn't show enough height to also assess plumb
- "severity" is "high" for collapse, severe gap, or lean > 10°
- "severity" is "medium" for moderate deformation or lean 5–10°
- "severity" is "low" for minor surface issues or lean 2–5°
- "severity" is "none" for straight, clean, plumb prints
- If no concrete beads are visible at all, return verdict "unclear", severity "none"
- "structure_axis" MUST be provided with your best-estimate coordinates whenever a printed vertical structure with meaningful height is visible — pick a point at its visible base and a point at its visible top, along its actual centerline. Use null when the frame doesn't show enough vertical extent to judge (e.g. a close-up or top-down shot) — this is common and does not by itself indicate a problem.
- "defect_location" MUST be provided with your best-estimate coordinates whenever verdict is "deviated" or "defect" and a specific point of concern is visible (separate from the overall lean — e.g. a bulge, gap, or crack). Use null when there's no single locatable defect point (a whole-structure lean without a specific defect still gets defect_location: null, since structure_axis already conveys that).`;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    // iPhone photos default to HEIC, which Anthropic's vision API can't read.
    // Sniff the actual bytes (not the client-reported MIME type, which is
    // often wrong) and transparently convert before sending it on.
    let finalBase64 = imageBase64 as string;
    let finalMimeType = mimeType as 'image/jpeg' | 'image/png' | 'image/webp';
    let wasConverted = false;
    const inputBuffer = Buffer.from(imageBase64, 'base64');
    if (isHeicBuffer(inputBuffer)) {
      try {
        finalBase64 = await heicToJpegBase64(inputBuffer);
        finalMimeType = 'image/jpeg';
        wasConverted = true;
      } catch (e: any) {
        return NextResponse.json(
          { error: `Could not convert HEIC image: ${e.message || e}` },
          { status: 422 }
        );
      }
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: finalMimeType,
                data: finalBase64,
              },
            },
            {
              type: 'text',
              text: 'Analyse this concrete bead layer image. Return only the JSON object.',
            },
          ],
        },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse model response', raw },
        { status: 502 }
      );
    }

    if (wasConverted) {
      parsed.convertedImage = { base64: finalBase64, mimeType: finalMimeType };
    }

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('[analyze-beads]', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}