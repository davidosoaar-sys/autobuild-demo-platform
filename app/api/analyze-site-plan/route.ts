import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert architectural site plan analyser.
The user will provide an image of a site plan or site layout drawing.
Analyse it carefully and return ONLY a JSON object with no markdown, no explanation, no backticks.

Extract:
- Site dimensions in metres (estimate from scale bar, annotations, or visual proportion)
- Site shape: rectangular, l-shaped, or irregular
- Road: which side it is on (north/south/east/west or corner), approximate width in metres
- House or building footprint: its position as fractions (0–1) of the site, its dimensions in metres, and rotation in degrees
- Confidence: high if you can see clear dimensions, medium if estimating, low if very unclear
- Brief notes about what you observed

Return exactly this JSON shape:
{
  "width": <number>,
  "length": <number>,
  "shape": "rectangular" | "l-shaped" | "irregular",
  "road": {
    "present": <boolean>,
    "side": "north" | "south" | "east" | "west" | "corner-ne" | "corner-nw" | "corner-se" | "corner-sw" | "unknown",
    "width_m": <number>
  },
  "house": {
    "offset_x": <0-1>,
    "offset_z": <0-1>,
    "width": <number>,
    "length": <number>,
    "rotation": <number>
  },
  "confidence": "high" | "medium" | "low",
  "notes": "<string>"
}`;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1000,
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
              text: 'Analyse this site plan and return the JSON.',
            },
          ],
        },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
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
    console.error('[analyze-site-plan]', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
