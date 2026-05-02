export type Point = {
  x: number;
  y: number;
};

export type CornerName = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

export type Rectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

export type MarkerDetectionDebug = {
  borderRatios: [number, number, number, number];
  anchorRatio: number;
  contentRatio: number;
  workingSize: {
    width: number;
    height: number;
  };
  candidateCount: number;
};

export type MarkerDetection = {
  confidence: number;
  anchorCorner: CornerName;
  corners: [Point, Point, Point, Point];
  output: RgbaImage;
  preview: RgbaImage;
  debug: MarkerDetectionDebug;
};
