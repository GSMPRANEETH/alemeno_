import { applyHomography, computeHomography } from './geometry';
import type { Point, Rectangle, RgbaImage } from './types';

export type ConnectedComponent = {
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  points: Point[];
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function pixelIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function luminance(red: number, green: number, blue: number): number {
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

export function downsampleImage(image: RgbaImage, maxDimension: number): RgbaImage {
  const longestSide = Math.max(image.width, image.height);

  if (longestSide <= maxDimension) {
    return {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.data),
    };
  }

  const scale = maxDimension / longestSide;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.round(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.round(x / scale));
      const sourceIndex = pixelIndex(image.width, sourceX, sourceY);
      const destinationIndex = pixelIndex(width, x, y);

      data[destinationIndex] = image.data[sourceIndex];
      data[destinationIndex + 1] = image.data[sourceIndex + 1];
      data[destinationIndex + 2] = image.data[sourceIndex + 2];
      data[destinationIndex + 3] = image.data[sourceIndex + 3];
    }
  }

  return { width, height, data };
}

export function createDarkMask(image: RgbaImage, threshold = 96): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = pixelIndex(image.width, x, y);
      const tone = luminance(image.data[index], image.data[index + 1], image.data[index + 2]);
      mask[y * image.width + x] = tone <= threshold ? 1 : 0;
    }
  }

  return mask;
}

export function regionRatio(mask: Uint8Array, width: number, height: number, rectangle: Rectangle): number {
  const startX = clamp(Math.floor(rectangle.x), 0, width);
  const startY = clamp(Math.floor(rectangle.y), 0, height);
  const endX = clamp(Math.ceil(rectangle.x + rectangle.width), 0, width);
  const endY = clamp(Math.ceil(rectangle.y + rectangle.height), 0, height);

  if (endX <= startX || endY <= startY) {
    return 0;
  }

  let matches = 0;
  const area = (endX - startX) * (endY - startY);

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      matches += mask[y * width + x];
    }
  }

  return matches / area;
}

export function contentRatio(image: RgbaImage, rectangle: Rectangle): number {
  const startX = clamp(Math.floor(rectangle.x), 0, image.width);
  const startY = clamp(Math.floor(rectangle.y), 0, image.height);
  const endX = clamp(Math.ceil(rectangle.x + rectangle.width), 0, image.width);
  const endY = clamp(Math.ceil(rectangle.y + rectangle.height), 0, image.height);

  if (endX <= startX || endY <= startY) {
    return 0;
  }

  let contentPixels = 0;
  let totalPixels = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = pixelIndex(image.width, x, y);
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      const tone = luminance(red, green, blue);
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

      if (tone < 220 || chroma > 18) {
        contentPixels += 1;
      }

      totalPixels += 1;
    }
  }

  return totalPixels === 0 ? 0 : contentPixels / totalPixels;
}

export function findConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minimumArea: number,
): ConnectedComponent[] {
  const visited = new Uint8Array(mask.length);
  const components: ConnectedComponent[] = [];

  for (let startY = 0; startY < height; startY += 1) {
    for (let startX = 0; startX < width; startX += 1) {
      const startIndex = startY * width + startX;
      if (!mask[startIndex] || visited[startIndex]) {
        continue;
      }

      const stackX = [startX];
      const stackY = [startY];
      const points: Point[] = [];
      visited[startIndex] = 1;

      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;

      while (stackX.length > 0) {
        const x = stackX.pop() as number;
        const y = stackY.pop() as number;
        points.push({ x, y });

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
          for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
            if (deltaX === 0 && deltaY === 0) {
              continue;
            }

            const nextX = x + deltaX;
            const nextY = y + deltaY;

            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
              continue;
            }

            const nextIndex = nextY * width + nextX;
            if (!mask[nextIndex] || visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            stackX.push(nextX);
            stackY.push(nextY);
          }
        }
      }

      if (points.length >= minimumArea) {
        components.push({
          area: points.length,
          minX,
          maxX,
          minY,
          maxY,
          points,
        });
      }
    }
  }

  return components;
}

function bilinearSample(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const clampedX = clamp(x, 0, image.width - 1);
  const clampedY = clamp(y, 0, image.height - 1);

  const left = Math.floor(clampedX);
  const right = Math.min(image.width - 1, left + 1);
  const top = Math.floor(clampedY);
  const bottom = Math.min(image.height - 1, top + 1);

  const tx = clampedX - left;
  const ty = clampedY - top;

  const topLeftIndex = pixelIndex(image.width, left, top);
  const topRightIndex = pixelIndex(image.width, right, top);
  const bottomLeftIndex = pixelIndex(image.width, left, bottom);
  const bottomRightIndex = pixelIndex(image.width, right, bottom);

  const channels: [number, number, number, number] = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const topValue =
      image.data[topLeftIndex + channel] * (1 - tx) + image.data[topRightIndex + channel] * tx;
    const bottomValue =
      image.data[bottomLeftIndex + channel] * (1 - tx) +
      image.data[bottomRightIndex + channel] * tx;
    channels[channel] = Math.round(topValue * (1 - ty) + bottomValue * ty);
  }

  return channels;
}

export function warpPerspective(
  image: RgbaImage,
  sourceCorners: [Point, Point, Point, Point],
  outputSize: number,
): RgbaImage {
  const destinationCorners: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: outputSize - 1, y: 0 },
    { x: outputSize - 1, y: outputSize - 1 },
    { x: 0, y: outputSize - 1 },
  ];
  const inverseHomography = computeHomography(destinationCorners, sourceCorners);
  const data = new Uint8ClampedArray(outputSize * outputSize * 4);

  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const source = applyHomography({ x, y }, inverseHomography);
      const sample = bilinearSample(image, source.x, source.y);
      const index = pixelIndex(outputSize, x, y);

      data[index] = sample[0];
      data[index + 1] = sample[1];
      data[index + 2] = sample[2];
      data[index + 3] = sample[3];
    }
  }

  return {
    width: outputSize,
    height: outputSize,
    data,
  };
}

export function rotateSquareImage90(image: RgbaImage, steps: number): RgbaImage {
  const normalizedSteps = ((steps % 4) + 4) % 4;

  if (normalizedSteps === 0) {
    return {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.data),
    };
  }

  const output = new Uint8ClampedArray(image.data.length);
  const size = image.width;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sourceX = x;
      let sourceY = y;

      if (normalizedSteps === 1) {
        sourceX = y;
        sourceY = size - 1 - x;
      } else if (normalizedSteps === 2) {
        sourceX = size - 1 - x;
        sourceY = size - 1 - y;
      } else if (normalizedSteps === 3) {
        sourceX = size - 1 - y;
        sourceY = x;
      }

      const sourceIndex = pixelIndex(size, sourceX, sourceY);
      const destinationIndex = pixelIndex(size, x, y);

      output[destinationIndex] = image.data[sourceIndex];
      output[destinationIndex + 1] = image.data[sourceIndex + 1];
      output[destinationIndex + 2] = image.data[sourceIndex + 2];
      output[destinationIndex + 3] = image.data[sourceIndex + 3];
    }
  }

  return {
    width: size,
    height: size,
    data: output,
  };
}
