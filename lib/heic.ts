// heic-convert ships no type declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const convert = require('heic-convert');

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

/** Sniffs the ISO-BMFF ftyp box rather than trusting a client-reported MIME
 * type — browsers frequently mislabel HEIC uploads as image/jpeg. */
export function isHeicBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.includes(buf.toString('ascii', 8, 12));
}

/** Converts HEIC/HEIF bytes to a JPEG base64 string. Anthropic's vision API
 * only accepts JPEG/PNG/GIF/WEBP, and HEIC is the default photo format on
 * iPhone, so this runs automatically whenever an upload turns out to be one. */
export async function heicToJpegBase64(buf: Buffer, quality = 0.9): Promise<string> {
  const out = await convert({ buffer: buf, format: 'JPEG', quality });
  return Buffer.from(new Uint8Array(out)).toString('base64');
}
