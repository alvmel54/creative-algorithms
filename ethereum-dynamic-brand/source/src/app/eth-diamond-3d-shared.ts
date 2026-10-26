import type { EthGlass } from "./eth-glass";
import type { Camera } from "three";

import type { EthBackgroundGradient } from "./eth-background-gradient";
import type { EthAnimationMode, EthMilestoneRender, EthShapeType } from "./eth-diamond-shading";
import type { EthTypographyRender } from "./eth-typography";

/** Render state shared between the live R3F preview (`eth-diamond-3d-scene.tsx`)
 * and the offscreen export renderer (`eth-diamond-3d-export.ts`). Colors stay
 * as hex strings here (resolved once via `resolveEthColor`) and are converted
 * to shader-ready RGB floats inside `buildDitherEffectParams`. */
export type EthDiamond3dRenderState = {
  amount: number;
  animation: EthAnimationMode;
  backgroundColor: string;
  /** Gradient fill over the background color; null for Color. */
  backgroundGradient: EthBackgroundGradient | null;
  colorA: string;
  colorB: string;
  /** 0..1 share of marks in Color B (Live data TVL). */
  colorBShare: number;
  colorGradient: boolean;
  /** 0..1 series level (0.5 without Live data). */
  dataLevel: number;
  /** 0..1 burst from Real-time tracking data. */
  dataPulse: number;
  /** 0..1 Field background strength; 0 for Solid. */
  fieldStrength: number;
  /** Field density 1..3 (Background > Field density). */
  fieldDensity: number;
  /** Data fingerprint, base to tip (see EthFingerprint), or null. */
  fingerprint: readonly number[] | null;
  flow: number;
  includeBackground: boolean;
  loopProgress: number;
  maxSize: number;
  meshRotationDeg: number;
  /** Camera zoom (1 = fitted framing); the background is unaffected. */
  modelZoom: number;
  /** Active milestone wave (history periods), or null. */
  milestone: EthMilestoneRender | null;
  outlineColor: string;
  outlineWidth: number;
  rotationDeg: number;
  /** Pattern angle: turns every facet's mark grid and the Field grid. */
  patternAngleDeg: number;
  /** 0..1 random size spread per mark (gem and Field). */
  sizeVariation: number;
  /** Glass material, or null when off. */
  glass: EthGlass | null;
  /** Pattern seed: data type seed plus the Shuffle offset. */
  seed: number;
  shapeType: EthShapeType;
  showOutline: boolean;
  spacing: number;
  speed: number;
  /** Big background typography, or null. */
  typography: EthTypographyRender | null;
  variationDeg: number;
};

/** The live preview's camera, set while the 3D scene is mounted. Exports copy
 * its pose so the PNG/video show the same angle as the preview, including an
 * Interactive rotation drag, instead of re-fitting a front view. */
export const ethLiveCameraHandle: { current: Camera | null } = { current: null };
