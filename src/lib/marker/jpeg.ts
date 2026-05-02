import { Buffer } from 'buffer';
import * as jpeg from 'jpeg-js';

import type { RgbaImage } from './types';

export function decodeJpegBytes(bytes: Uint8Array): RgbaImage {
  const decoded = jpeg.decode(bytes, { useTArray: true });

  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

export function decodeJpegBase64(base64: string): RgbaImage {
  return decodeJpegBytes(Buffer.from(base64, 'base64'));
}

export function encodeJpegBase64(image: RgbaImage, quality = 92): string {
  const encoded = jpeg.encode(
    {
      width: image.width,
      height: image.height,
      data: Uint8Array.from(image.data),
    },
    quality,
  );

  return Buffer.from(encoded.data).toString('base64');
}
