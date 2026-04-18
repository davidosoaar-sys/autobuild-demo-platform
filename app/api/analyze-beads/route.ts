import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert in 3D concrete printing (3DCP) quality control. You analyse camera frames from a live concrete printer and assess bead quality.

You must respond ONLY with a valid JSON object — no prose, no markdown, no code fences.

Analyse the concrete bead layers visible in the image and return:

{
  "verdict": "straight" | "deviated" | "defect" | "unclear",
  "angle_deviation": <number, degrees from horizontal, positive = tilted right, negative = tilted left, 0 if unclear>,
  "defect_type": "none" | "gap" | "collapse" | "over-extrusion" | "under-extrusion" | "layer-shift" | "deformation" | "surface-crack",
  "severity": "none" | "low" | "medium" | "high",
  "description": "<one concise sentence describing what you see, max 120 chars>",
  "bead_count": <number of visible bead layers, 0 if unclear>,
  "confidence": "low" | "medium" | "high"
}

Rules:
- "verdict" is "straight" when the topmost visible bead is within ±2° of horizontal
- "verdict" is "deviated" when angle deviation is between 2° and 10°
- "verdict" is "defect" when a structural defect is present regardless of angle
- "verdict" is "unclear" when image quality is too poor to assess
- "severity" is "high" for collapse, severe gap, or deviation > 10°
- "severity" is "medium" for moderate deformation or deviation 5–10°
- "severity" is "low" for minor surface issues or deviation 2–5°
- "severity" is "none" for straight, clean beads
- If no concrete beads are visible, return verdict "unclear", severity "none"`;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
                data: imageBase64,
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

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('[analyze-beads]', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}