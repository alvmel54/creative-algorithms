/**
 * Pure geometry, lighting, and dithering-grid math for the Ethereum diamond
 * generative renderer. No React or DOM dependencies so the same functions
 * drive the live preview canvases and the PNG/video export passes.
 */

export type EthDiamondGeometry = {
  bottomY: number;
  cx: number;
  cy: number;
  halfWidth: number;
  height: number;
  midY: number;
  points: readonly [number, number][];
  topY: number;
  width: number;
};

export type EthShapeType =
  | "circle"
  | "cross"
  | "diamond"
  | "dot"
  | "line"
  | "mixed"
  | "square"
  | "triangle";

export type EthAnimationMode =
  | "drift"
  | "flow"
  | "fluid"
  | "none"
  | "orbit"
  | "pulse"
  | "ripple"
  | "shimmer"
  | "wave";

/** Type of data (blueprint 2026-10-09 narrative model): a data source that
 * moves the mark, or None. Custom was removed (manual motion blueprint
 * 2026-10-27): Motion > Source = Manual replaces it and keeps the data. */
export type EthDataSourceType =
  | "eth-price"
  | "gas-price"
  | "mix"
  | "none"
  | "total-staking"
  | "tvl";

export type EthPhysicsParams = {
  animation: EthAnimationMode;
  flow: number;
  speed: number;
  variationDeg: number;
};

const dataSourceSeeds: Record<EthDataSourceType, number> = {
  "eth-price": 505,
  none: 707,
  "gas-price": 404,
  mix: 606,
  "total-staking": 202,
  tvl: 303,
};

export function getSeedForDataSource(dataSource: EthDataSourceType): number {
  // 0 for a legacy saved "custom" until it is migrated.
  return dataSourceSeeds[dataSource] ?? 0;
}

/** Whether a data source drives the mark: always for a data type, never
 * for None (blueprint 2026-10-09 narrative model). A legacy saved "custom"
 * counts as no data until `useEthMotionControlsSync` migrates it. */
export function isEthLiveDataOn(values: Record<string, unknown>): boolean {
  const type = values["dataSource.type"] ?? "mix";

  return type !== "none" && type !== "custom";
}

export type EthMotionSource = "from-data" | "manual";

/** Motion > Source (manual motion blueprint 2026-10-27): From data measures
 * the motion from the data's history; Manual takes the Motion controls and
 * keeps the data, its Story and its breath (pace, Intensity swing, pulses).
 * A legacy saved Type of data "custom" reads as Manual. */
export function resolveEthMotionSource(values: Record<string, unknown>): EthMotionSource {
  return values["physics.motionSource"] === "manual" || values["dataSource.type"] === "custom" ? "manual" : "from-data";
}

/** Manual physics from the Animation/Speed/Flow/Variation controls. Rendered
 * motion goes through `resolveEthMotion` (eth-data-feed.ts), which uses
 * these while Real-time tracking is off and data-driven values while on. */
export function resolveEthPhysicsParams(values: Record<string, unknown>): EthPhysicsParams {
  return {
    animation: (values["physics.animation"] as EthAnimationMode) ?? "none",
    flow: Number(values["physics.flow"] ?? 0.8),
    speed: Number(values["physics.speed"] ?? 0.5),
    // Variation is a percent of the full cycle (100 % = 360°).
    variationDeg: Math.min(100, Math.max(0, Number(values["physics.variation"] ?? 33))) * 3.6,
  };
}

/** Deterministic 32-bit PRNG (mulberry32). Same seed always yields the same stream. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeDiamondGeometry(width: number, height: number): EthDiamondGeometry {
  const cx = width / 2;
  const cy = height / 2;
  const margin = Math.min(width, height) * 0.16;
  const usableHalfHeight = height / 2 - margin;
  const topY = cy - usableHalfHeight;
  const bottomY = cy + usableHalfHeight;
  const midY = cy - usableHalfHeight * 0.12;
  const halfWidth = usableHalfHeight * 0.62;

  return {
    bottomY,
    cx,
    cy,
    halfWidth,
    height,
    midY,
    points: [
      [cx, topY],
      [cx + halfWidth, midY],
      [cx, bottomY],
      [cx - halfWidth, midY],
    ],
    topY,
    width,
  };
}

/** Extracts a usable CSS color string from either a plain hex string or the
 * Toolcraft color control's committed `{ hex }` value shape. */
export function resolveEthColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "hex" in value &&
    typeof (value as { hex?: unknown }).hex === "string"
  ) {
    return (value as { hex: string }).hex;
  }

  return fallback;
}

function parseEthHexColor(hex: string): { b: number; g: number; r: number } {
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : normalized;
  const parsed = Number.parseInt(expanded, 16);

  if (expanded.length !== 6 || Number.isNaN(parsed)) {
    return { b: 255, g: 255, r: 255 };
  }

  return {
    b: parsed & 255,
    g: (parsed >> 8) & 255,
    r: (parsed >> 16) & 255,
  };
}

/** Linearly blends two hex colors (t=0 -> colorA, t=1 -> colorB) into a CSS
 * `rgb()` string, for the Gradient dual-color mode. */
/** A milestone wave as the renderers draw it (see getMilestoneWave in
 * eth-data-feed.ts). */
export type EthMilestoneRender = {
  color: string;
  /** Ring radius: 0 at the center, 1 at the gem's edge. */
  front: number;
  /** 0..1 age of the wave. */
  life: number;
  strength: number;
  /** Milestone text for the typography. */
  subtitle: string | null;
  title: string;
};

/** The identity's Accent (milestone color). Older saved settings kept it as
 * dataSource.milestoneColor. */
export function resolveEthAccent(values: Record<string, unknown>): string {
  return resolveEthColor(values["geometry.accentColor"] ?? values["dataSource.milestoneColor"], "#d9b04e");
}

/** Milestone wave with the identity's Accent. */
export function resolveEthMilestoneRender(
  values: Record<string, unknown>,
  wave: { front: number; life: number; strength: number; subtitle: string | null; title: string } | null,
): EthMilestoneRender | null {
  if (!wave) {
    return null;
  }

  return {
    color: resolveEthAccent(values),
    front: wave.front,
    life: wave.life,
    strength: wave.strength,
    subtitle: wave.subtitle,
    title: wave.title,
  };
}

/** 0..1 presence of the milestone ring at a radius (same units as front).
 * Same formula as the 3D shader. */
export function getEthMilestoneBand(radius: number, milestone: EthMilestoneRender | null): number {
  if (!milestone || milestone.strength <= 0) {
    return 0;
  }

  // Vibrant wave (2026-10-12): a longer trail behind the front than ahead of
  // it, and 1.35x the strength, so more marks take the full Accent.
  const offset = radius - milestone.front;
  const t = Math.min(1, Math.abs(offset) / (offset >= 0 ? 0.32 : 0.6));

  return Math.min(1, (1 - t * t * (3 - 2 * t)) * milestone.strength * 1.35);
}

/** Milestone wave tied to the pattern (blueprint 2026-10-09 step 2): the
 * radius a mark is "reached" at. Marks whose stream flows outward are
 * reached earlier (`align` = dot of the flow direction and the outward
 * direction, -1..1), so the front takes the shape of the currents, and each
 * mark gets its own small delay (`grain`, a 0..1 hash), so the edge ignites
 * mark by mark. Same formula as the 3D shader. */
export function getEthWaveRadius(radius: number, align: number, grain: number): number {
  return radius * (1 - 0.25 * align) + (grain - 0.5) * 0.22;
}

export function blendEthColors(colorA: string, colorB: string, t: number): string {
  const clampedT = Math.max(0, Math.min(1, t));
  const a = parseEthHexColor(colorA);
  const b = parseEthHexColor(colorB);
  const r = Math.round(a.r + (b.r - a.r) * clampedT);
  const g = Math.round(a.g + (b.g - a.g) * clampedT);
  const blendedB = Math.round(a.b + (b.b - a.b) * clampedT);

  return `rgb(${r}, ${g}, ${blendedB})`;
}

/**
 * Builds the static (non-animated) dithering grid: cell centers inside the
 * diamond, plus a stable per-cell seed index used for the Mixed shape choice
 * and per-particle phase offsets. Amount raises overall resolution; Spacing
 * sets the base cell size before that density modulation is applied.
 */
/**
 * Reference canvas area (the app's default 1920x1080 output) used to
 * calibrate Amount/Spacing against an absolute cell count instead of an
 * absolute pixel spacing. Without this, a user-editable large canvas.size
 * (Setup "Canvas width"/"Canvas height", up to the export hard limits) would
 * multiply the grid cell count by canvas area while cellSpacing stayed fixed
 * in pixels, turning "Amount" into an unbounded workload instead of the
 * resolution-independent dithering density the control describes.
 */
const referenceCanvasArea = 1920 * 1080;

/** Spacing between mark centers for the current Amount/Spacing, scaled with
 * the canvas area. Shared by the gem grid and the Field background. */
export function getDitherCellSpacing(amount: number, spacing: number, geometry: EthDiamondGeometry): number {
  const areaScale = Math.sqrt(Math.max(1, geometry.width * geometry.height) / referenceCanvasArea);
  const densityFactor = 200 / Math.max(10, amount);

  return Math.max(3 * areaScale, Math.min(60 * areaScale, Math.max(spacing, 2) * densityFactor * areaScale));
}

/** Integer full cycles per loop keep sine/cosine motion seamless at any Duration. */
export function getCyclesPerLoop(speed: number): number {
  return Math.max(0, Math.round(speed * 4));
}

/**
 * Flow field shared by the Field/typography canvas and the 3D shader (same
 * formula in eth-dither-effect.ts). `q` is the position in the gem's volume, about
 * -0.5..0.5 per axis with y up; `t` turns once per loop so the field evolves
 * and still loops seamlessly. A steady downward current bent by crossing
 * sine waves gives the curved stream lines of the original concept image;
 * `curl` (from Intensity) sets how strongly they bend.
 */
export function ethFlowField(
  q: readonly [number, number, number],
  t: number,
  curl: number,
): [number, number, number] {
  const f = 6;

  return [
    0.25 + curl * Math.sin(f * q[1] * 1.3 + f * q[2] + t),
    -1 + curl * 0.6 * Math.sin(f * q[2] * 1.1 + f * q[0] * 0.9 - t + 1.7),
    curl * Math.sin(f * q[0] * 1.2 + f * q[1] * 0.7 + t + 3.1),
  ];
}
