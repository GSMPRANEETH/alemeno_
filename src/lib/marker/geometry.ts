import type { Point } from './types';

type RectangleMetrics = {
  area: number;
  width: number;
  height: number;
  corners: [Point, Point, Point, Point];
  angle: number;
};

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function rotate(point: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) {
    return points.slice();
  }

  const sorted = [...points].sort((left, right) => {
    if (left.x === right.x) {
      return left.y - right.y;
    }

    return left.x - right.x;
  });

  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }

    lower.push(point);
  }

  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }

    upper.push(point);
  }

  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

export function orderQuadrilateral(points: Point[]): [Point, Point, Point, Point] {
  const topLeft = [...points].reduce((best, point) =>
    point.x + point.y < best.x + best.y ? point : best,
  );
  const bottomRight = [...points].reduce((best, point) =>
    point.x + point.y > best.x + best.y ? point : best,
  );
  const topRight = [...points].reduce((best, point) =>
    point.y - point.x < best.y - best.x ? point : best,
  );
  const bottomLeft = [...points].reduce((best, point) =>
    point.y - point.x > best.y - best.x ? point : best,
  );

  return [topLeft, topRight, bottomRight, bottomLeft];
}

export function minimumAreaRectangle(points: Point[]): RectangleMetrics | null {
  if (points.length < 4) {
    return null;
  }

  const hull = convexHull(points);

  if (hull.length < 4) {
    return null;
  }

  let best: RectangleMetrics | null = null;

  for (let index = 0; index < hull.length; index += 1) {
    const start = hull[index];
    const end = hull[(index + 1) % hull.length];
    const angle = Math.atan2(end.y - start.y, end.x - start.x);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of hull) {
      const rotated = rotate(point, -angle);
      minX = Math.min(minX, rotated.x);
      minY = Math.min(minY, rotated.y);
      maxX = Math.max(maxX, rotated.x);
      maxY = Math.max(maxY, rotated.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const area = width * height;

    if (width === 0 || height === 0) {
      continue;
    }

    if (best && best.area <= area) {
      continue;
    }

    const rotatedCorners: Point[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];

    const corners = rotatedCorners.map((corner) => rotate(corner, angle));

    best = {
      area,
      width,
      height,
      corners: orderQuadrilateral(corners),
      angle,
    };
  }

  return best;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => row.concat(vector[index]));

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot;

    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];

    const pivotValue = augmented[pivot][pivot];
    if (Math.abs(pivotValue) < 1e-8) {
      throw new Error('Unable to solve homography for nearly singular marker candidate.');
    }

    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

export function computeHomography(
  source: [Point, Point, Point, Point],
  destination: [Point, Point, Point, Point],
): number[] {
  const matrix: number[][] = [];
  const vector: number[] = [];

  for (let index = 0; index < 4; index += 1) {
    const from = source[index];
    const to = destination[index];

    matrix.push([from.x, from.y, 1, 0, 0, 0, -to.x * from.x, -to.x * from.y]);
    vector.push(to.x);

    matrix.push([0, 0, 0, from.x, from.y, 1, -to.y * from.x, -to.y * from.y]);
    vector.push(to.y);
  }

  const solution = solveLinearSystem(matrix, vector);
  solution.push(1);

  return solution;
}

export function applyHomography(point: Point, homography: number[]): Point {
  const denominator = homography[6] * point.x + homography[7] * point.y + homography[8];

  return {
    x: (homography[0] * point.x + homography[1] * point.y + homography[2]) / denominator,
    y: (homography[3] * point.x + homography[4] * point.y + homography[5]) / denominator,
  };
}
