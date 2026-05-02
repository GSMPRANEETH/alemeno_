import { minimumAreaRectangle } from './geometry';
import {
  contentRatio,
  createDarkMask,
  downsampleImage,
  findConnectedComponents,
  regionRatio,
  rotateSquareImage90,
  warpPerspective,
} from './image';
import type { CornerName, MarkerDetection, Point, Rectangle, RgbaImage } from './types';

const MARKER_WORKING_MAX_SIDE = 640;
const PREVIEW_SIZE = 220;

const CORNER_NAMES: CornerName[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rotationStepsToTopLeft(corner: CornerName): number {
  switch (corner) {
    case 'topLeft':
      return 0;
    case 'topRight':
      return 3;
    case 'bottomRight':
      return 2;
    case 'bottomLeft':
      return 1;
    default:
      return 0;
  }
}

function anchorWindow(size: number, corner: CornerName): Rectangle {
  const offset = Math.round(size * 0.13);
  const side = Math.round(size * 0.2);

  switch (corner) {
    case 'topLeft':
      return { x: offset, y: offset, width: side, height: side };
    case 'topRight':
      return { x: size - offset - side, y: offset, width: side, height: side };
    case 'bottomRight':
      return { x: size - offset - side, y: size - offset - side, width: side, height: side };
    case 'bottomLeft':
      return { x: offset, y: size - offset - side, width: side, height: side };
    default:
      return { x: offset, y: offset, width: side, height: side };
  }
}

function analyzeAnchor(
  darkMask: Uint8Array,
  size: number,
  corner: CornerName,
): { corner: CornerName; ratio: number; score: number } {
  const window = anchorWindow(size, corner);
  const startX = Math.round(window.x);
  const startY = Math.round(window.y);
  const endX = Math.round(window.x + window.width);
  const endY = Math.round(window.y + window.height);

  let darkPixels = 0;
  let minX = endX;
  let minY = endY;
  let maxX = startX;
  let maxY = startY;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (!darkMask[y * size + x]) {
        continue;
      }

      darkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const area = window.width * window.height;
  const ratio = area === 0 ? 0 : darkPixels / area;

  if (darkPixels === 0) {
    return { corner, ratio: 0, score: 0 };
  }

  const boundingWidth = Math.max(1, maxX - minX + 1);
  const boundingHeight = Math.max(1, maxY - minY + 1);
  const aspect = Math.max(boundingWidth, boundingHeight) / Math.min(boundingWidth, boundingHeight);
  const fill = darkPixels / (boundingWidth * boundingHeight);
  const occupiedRatio = (boundingWidth * boundingHeight) / area;

  const ratioScore = 1 - Math.min(1, Math.abs(ratio - 0.4) / 0.3);
  const fillScore = clamp01((fill - 0.3) / 0.4);
  const aspectScore = clamp01(1 - (aspect - 1) / 0.6);
  const occupiedScore = 1 - Math.min(1, Math.abs(occupiedRatio - 0.7) / 0.5);

  let score =
    ratioScore * 0.35 + fillScore * 0.3 + aspectScore * 0.2 + occupiedScore * 0.15;

  if (ratio < 0.08 || ratio > 0.82 || fill < 0.25 || aspect > 1.6) {
    score *= 0.35;
  }

  return { corner, ratio, score };
}

function scaleCorners(
  corners: [Point, Point, Point, Point],
  xScale: number,
  yScale: number,
): [Point, Point, Point, Point] {
  return corners.map((corner) => ({
    x: corner.x * xScale,
    y: corner.y * yScale,
  })) as [Point, Point, Point, Point];
}

function evaluateWarpedCandidate(image: RgbaImage) {
  const size = image.width;
  const darkMask = createDarkMask(image, 96);
  const strip = Math.max(14, Math.round(size * 0.1));

  const borderRatios: [number, number, number, number] = [
    regionRatio(darkMask, size, size, { x: 0, y: 0, width: size, height: strip }),
    regionRatio(darkMask, size, size, { x: size - strip, y: 0, width: strip, height: size }),
    regionRatio(darkMask, size, size, { x: 0, y: size - strip, width: size, height: strip }),
    regionRatio(darkMask, size, size, { x: 0, y: 0, width: strip, height: size }),
  ];

  if (Math.min(...borderRatios) < 0.42) {
    return null;
  }

  const anchorCandidates = CORNER_NAMES.map((corner) => analyzeAnchor(darkMask, size, corner)).sort(
    (left, right) => right.score - left.score,
  );

  const bestAnchor = anchorCandidates[0];
  const runnerUp = anchorCandidates[1];

  if (!bestAnchor || bestAnchor.score < 0.4 || runnerUp.score > bestAnchor.score * 0.88) {
    return null;
  }

  const rotationSteps = rotationStepsToTopLeft(bestAnchor.corner);
  const preview = rotateSquareImage90(image, rotationSteps);
  const previewSize = preview.width;
  const innerRectangle = {
    x: Math.round(previewSize * 0.22),
    y: Math.round(previewSize * 0.22),
    width: Math.round(previewSize * 0.56),
    height: Math.round(previewSize * 0.56),
  };
  const encodedContentRatio = contentRatio(preview, innerRectangle);

  if (encodedContentRatio < 0.055) {
    return null;
  }

  const borderScore = clamp01((borderRatios.reduce((sum, value) => sum + value, 0) / 4 - 0.42) / 0.35);
  const contentScore = clamp01((encodedContentRatio - 0.055) / 0.16);
  const confidence = borderScore * 0.45 + bestAnchor.score * 0.3 + contentScore * 0.25;

  return {
    confidence,
    anchorCorner: bestAnchor.corner,
    preview,
    borderRatios,
    anchorRatio: bestAnchor.ratio,
    contentRatio: encodedContentRatio,
  };
}

export function detectAndExtractMarker(
  image: RgbaImage,
  targetSize = 300,
): MarkerDetection | null {
  const working = downsampleImage(image, MARKER_WORKING_MAX_SIDE);
  const darkMask = createDarkMask(working, 96);
  const minimumArea = Math.max(64, Math.round((working.width * working.height) * 0.0015));
  const components = findConnectedComponents(darkMask, working.width, working.height, minimumArea);

  let bestCandidate:
    | {
        confidence: number;
        preview: RgbaImage;
        borderRatios: [number, number, number, number];
        anchorRatio: number;
        contentRatio: number;
        anchorCorner: CornerName;
        corners: [Point, Point, Point, Point];
      }
    | null = null;

  for (const component of components) {
    const boundingWidth = component.maxX - component.minX + 1;
    const boundingHeight = component.maxY - component.minY + 1;
    const boundingArea = boundingWidth * boundingHeight;

    if (boundingWidth < working.width * 0.08 || boundingHeight < working.height * 0.08) {
      continue;
    }

    if (boundingArea < working.width * working.height * 0.015) {
      continue;
    }

    const rectangle = minimumAreaRectangle(component.points);

    if (!rectangle) {
      continue;
    }

    const sideRatio = Math.max(rectangle.width, rectangle.height) / Math.min(rectangle.width, rectangle.height);

    if (sideRatio > 1.18) {
      continue;
    }

    const warped = warpPerspective(working, rectangle.corners, PREVIEW_SIZE);
    const evaluation = evaluateWarpedCandidate(warped);

    if (!evaluation) {
      continue;
    }

    if (!bestCandidate || evaluation.confidence > bestCandidate.confidence) {
      bestCandidate = {
        confidence: evaluation.confidence,
        preview: evaluation.preview,
        borderRatios: evaluation.borderRatios,
        anchorRatio: evaluation.anchorRatio,
        contentRatio: evaluation.contentRatio,
        anchorCorner: evaluation.anchorCorner,
        corners: rectangle.corners,
      };
    }
  }

  if (!bestCandidate) {
    return null;
  }

  const xScale = image.width / working.width;
  const yScale = image.height / working.height;
  const scaledCorners = scaleCorners(bestCandidate.corners, xScale, yScale);
  const corrected = rotateSquareImage90(
    warpPerspective(image, scaledCorners, targetSize),
    rotationStepsToTopLeft(bestCandidate.anchorCorner),
  );

  return {
    confidence: bestCandidate.confidence,
    anchorCorner: 'topLeft',
    corners: scaledCorners,
    output: corrected,
    preview: bestCandidate.preview,
    debug: {
      borderRatios: bestCandidate.borderRatios,
      anchorRatio: bestCandidate.anchorRatio,
      contentRatio: bestCandidate.contentRatio,
      workingSize: {
        width: working.width,
        height: working.height,
      },
      candidateCount: components.length,
    },
  };
}
