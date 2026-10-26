import { EthShapeBatch } from "./eth-diamond-draw";
import {
  blendEthColors,
  ethFlowField,
  getCyclesPerLoop,
  getEthMilestoneBand,
  getEthWaveRadius,
  type EthDiamondGeometry,
  type EthMilestoneRender,
  type EthShapeType,
} from "./eth-diamond-shading";

/** The field grid never gets finer than this many rows, so a very dense mark
 * grid does not explode the background cost. Matches the 3D shader. */
export const ETH_FIELD_MAX_ROWS = 100;

/** Background marks are this fraction of the gem's mark size. */
const FIELD_MARK_SCALE = 0.8;

const mixedPool: Exclude<EthShapeType, "mixed">[] = ["dot", "circle", "square", "triangle", "line", "cross", "diamond"];

export type EthBackgroundFieldParams = {
  /** Spacing between the gem's mark centers (css px); the field uses the same
   * grid density, at most ETH_FIELD_MAX_ROWS rows. */
  cellSpacing: number;
  color: string;
  cssHeight: number;
  cssWidth: number;
  dataPulse: number;
  flow: number;
  geometry: EthDiamondGeometry;
  loopProgress: number;
  maxSize: number;
  /** Only marks centered in this rectangle (css px) are drawn, e.g. the
   * typography's text block. */
  region?: { bottom: number; left: number; right: number; top: number };
  /** Turns the field's lattice about the canvas center, in degrees. */
  patternAngleDeg?: number;
  /** 0..1 random size spread per mark (not in uniform mode). */
  sizeVariation?: number;
  /** Milestone wave continuing past the gem into the background. */
  milestone?: EthMilestoneRender | null;
  /** The gem's colors: each mark takes Color A or Color B (same share as
   * the gem), or with Color gradient the blend from A at the top to B at
   * the bottom. Without it every mark uses `color`. */
  palette?: { colorA: string; colorB: string; colorBShare: number; gradient: boolean };
  rotationDeg: number;
  shapeType: EthShapeType;
  /** Speed of the marks; pass 0 when Animation is None so the field holds still. */
  speed: number;
  /** 0..1; 0 draws nothing. */
  strength: number;
  /** Typography pattern: every mark at full opacity, no edge falloff, no
   * milestone ring and no diamond clip (the caller masks the result). */
  uniform?: boolean;
  /** Mark size as a share of the gem's mark size (default 0.8). */
  markScale?: number;
  /** Uniform mode only: light each mark (color and opacity) from its wave
   * radius (`getEthWaveRadius` in half gem heights); null skips the mark. */
  markLight?: (waveRadius: number) => { alpha: number; color: string } | null;
  /** Field density (Background > Field density), 1..3: marks per row
   * relative to the gem's grid; the Story's letters use it too. */
  density?: number;
};

/** Field density 1..3 from Background > Field density (200 % default): a
 * denser Field forms the Story's pattern letters from more marks. */
export function resolveEthFieldDensity(values: Record<string, unknown>): number {
  return Math.min(3, Math.max(1, Number(values["scene.fieldDensity"] ?? 200) / 100));
}

/** Field strength 0..1 from the Background controls; 0 for Solid. */
export function resolveEthFieldStrength(values: Record<string, unknown>): number {
  if (values["scene.backgroundStyle"] !== "field") {
    return 0;
  }

  return Math.min(1, Math.max(0, Number(values["scene.fieldStrength"] ?? 60) / 100));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

/** Deterministic 0..1 hash per grid cell (and salt). */
function cellHash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;

  h = Math.imul(h ^ (h >>> 13), 1274126177);

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Field background (blueprint 2026-10-08): the gem's own pattern (same Shape,
 * grid density and colors) continues around it, following the same flow
 * field as the Flow animation in coordinates normalized to the diamond. Each
 * mark travels along its stream, grows in and out at the ends (seamless
 * loop), turns to follow the stream, is brightest near the diamond and is
 * never drawn inside it. Same formula as the 3D shader's background field.
 */
export function drawEthBackgroundField(ctx: CanvasRenderingContext2D, params: EthBackgroundFieldParams): void {
  const { color, cssHeight, cssWidth, dataPulse, flow, geometry, loopProgress, speed, strength } = params;

  if (strength <= 0) {
    return;
  }

  const density = Math.min(3, Math.max(1, params.density ?? 1));
  const cell = Math.max(params.cellSpacing / density, cssHeight / ETH_FIELD_MAX_ROWS);
  // Pattern angle: the lattice is turned about the canvas center, so it
  // spans the canvas's circumscribed circle and skips marks off the canvas.
  const patternAngle = ((params.patternAngleDeg ?? 0) * Math.PI) / 180;
  const patternCos = Math.cos(patternAngle);
  const patternSin = Math.sin(patternAngle);
  const halfWidth = cssWidth / 2;
  const halfHeight = cssHeight / 2;
  const reach = Math.hypot(halfWidth, halfHeight) + cell;
  let firstColumn = Math.floor((halfWidth - reach) / cell);
  let lastColumn = Math.ceil((halfWidth + reach) / cell);
  let firstRow = Math.floor((halfHeight - reach) / cell);
  let lastRow = Math.ceil((halfHeight + reach) / cell);

  if (params.region) {
    // Only the lattice cells that can land in the region (the typography's
    // text block): its corners turned back into lattice space. Walking the
    // whole canvas lattice and skipping cell by cell cost about a sixth of
    // every Story frame.
    const { bottom, left, right, top } = params.region;
    const corners = [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ].map(([x, y]) => {
      const dx = x! - halfWidth;
      const dy = y! - halfHeight;

      return [halfWidth + dx * patternCos + dy * patternSin, halfHeight - dx * patternSin + dy * patternCos] as const;
    });
    const margin = 2 * cell;

    firstColumn = Math.max(firstColumn, Math.floor((Math.min(...corners.map(([x]) => x)) - margin) / cell));
    lastColumn = Math.min(lastColumn, Math.ceil((Math.max(...corners.map(([x]) => x)) + margin) / cell));
    firstRow = Math.max(firstRow, Math.floor((Math.min(...corners.map(([, y]) => y)) - margin) / cell));
    lastRow = Math.min(lastRow, Math.ceil((Math.max(...corners.map(([, y]) => y)) + margin) / cell));
  }
  const gemWidth = geometry.halfWidth * 2 || 1;
  const gemHeight = geometry.bottomY - geometry.topY || 1;
  const cycles = getCyclesPerLoop(speed);
  const fieldTime = cycles === 0 ? 0 : loopProgress * Math.PI * 2;
  // Denser rows carry smaller marks so neighbors do not merge.
  const markSize = (params.maxSize * (params.markScale ?? FIELD_MARK_SCALE)) / Math.sqrt(density);
  const uniform = params.uniform === true;
  const rotationRad = (params.rotationDeg * Math.PI) / 180;

  ctx.save();

  if (!uniform) {
    // Outside the diamond only: canvas rect plus the gem path, even-odd.
    ctx.beginPath();
    ctx.rect(0, 0, cssWidth, cssHeight);
    geometry.points.forEach(([x, y], index) => {
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.clip("evenodd");
  }

  // Thousands of marks: collected per color and opacity, filled once each.
  const batch = new EthShapeBatch();

  const palette = uniform ? null : (params.palette ?? null);
  const region = params.region ?? null;
  const sizeVariation = uniform ? 0 : (params.sizeVariation ?? 0);
  // Color gradient: A at the top to B at the bottom, cached in 128 steps.
  const gradientColors = new Map<number, string>();
  const gradientColorAt = (y: number): string => {
    const step = Math.round(Math.min(1, Math.max(0, y / cssHeight + palette!.colorBShare - 0.5)) * 128);
    let value = gradientColors.get(step);

    if (value === undefined) {
      value = blendEthColors(palette!.colorA, palette!.colorB, step / 128);
      gradientColors.set(step, value);
    }

    return value;
  };

  for (let row = firstRow; row < lastRow; row++) {
    for (let column = firstColumn; column < lastColumn; column++) {
      const latticeX = (column + 0.5) * cell + (cellHash(column, row, 1) - 0.5) * cell * 0.25 - halfWidth;
      const latticeY = (row + 0.5) * cell + (cellHash(column, row, 2) - 0.5) * cell * 0.25 - halfHeight;
      const centerX = halfWidth + latticeX * patternCos - latticeY * patternSin;
      const centerY = halfHeight + latticeX * patternSin + latticeY * patternCos;

      if (centerX < -cell || centerX > cssWidth + cell || centerY < -cell || centerY > cssHeight + cell) {
        continue;
      }

      if (
        region &&
        (centerX < region.left - cell || centerX > region.right + cell || centerY < region.top - cell || centerY > region.bottom + cell)
      ) {
        continue;
      }

      const qx = (centerX - geometry.cx) / gemWidth;
      const qy = -(centerY - geometry.cy) / gemHeight;
      const radius = Math.hypot(qx, qy);
      // Brightest next to the diamond, fading toward the canvas edges.
      const alpha = uniform ? 1 : strength * (1 - 0.75 * smoothstep(0.5, 1.6, radius));

      if (alpha < 0.02) {
        continue;
      }

      const field = ethFlowField([qx, qy, 0], fieldTime, flow * 1.2);
      let dx = field[0];
      let dy = -field[1];

      if (dataPulse > 0 && radius > 0.0001) {
        const swirl = dataPulse * 1.5 * Math.max(0, 1 - radius * 1.6);

        dx += (qy / radius) * swirl;
        dy += (qx / radius) * swirl;
      }

      const length = Math.hypot(dx, dy) || 1;

      dx /= length;
      dy /= length;

      const along = qx * dx - qy * dy;
      const travel = (loopProgress * cycles - along * 2 + cellHash(column, row, 3)) % 1;
      const s = travel < 0 ? travel + 1 : travel;
      // Size variation: a stable random spread per mark, like the gem.
      const size =
        markSize *
        smoothstep(0, 0.1, s) *
        smoothstep(1, 0.9, s) *
        Math.max(0, 1 + (cellHash(column, row, 7) - 0.5) * 2 * sizeVariation);
      const offset = cell * 0.45 * (s - 0.5);
      const shape = params.shapeType === "mixed" ? mixedPool[Math.floor(cellHash(column, row, 4) * 7) % 7]! : params.shapeType;
      // Like Flow: a Line lies along the stream, other shapes point downstream.
      const angle = rotationRad + Math.atan2(dy, dx) + (shape === "line" ? 0 : Math.PI / 2);

      // Circular ring in the same units as the gem and the ring text
      // (distance over half the gem's height).
      // Wave tied to the pattern: shaped by this mark's stream (outward
      // flow is reached first) with a per-mark ignition delay.
      const outX = centerX - geometry.cx;
      const outY = centerY - geometry.cy;
      const outLength = Math.hypot(outX, outY) || 1;
      const waveRadius = getEthWaveRadius(
        outLength / (gemHeight / 2),
        (dx * outX + dy * outY) / outLength,
        cellHash(column, row, 5),
      );

      if (uniform && params.markLight) {
        const light = params.markLight(waveRadius);

        if (!light || light.alpha < 0.01) {
          continue;
        }

        batch.add(shape, centerX + dx * offset, centerY + dy * offset, size, angle, light.color, light.alpha);
        continue;
      }

      const milestoneBand = uniform ? 0 : getEthMilestoneBand(waveRadius, params.milestone ?? null);
      const markColor = palette
        ? palette.gradient
          ? gradientColorAt(centerY)
          : cellHash(column, row, 6) < 1 - palette.colorBShare
            ? palette.colorA
            : palette.colorB
        : color;

      if (milestoneBand > 0.01) {
        // Color in 16 steps so the batches stay few.
        const ringColor = blendEthColors(markColor, params.milestone!.color, Math.round(milestoneBand * 16) / 16);

        batch.add(
          shape,
          centerX + dx * offset,
          centerY + dy * offset,
          size * (1 + 0.55 * milestoneBand),
          angle,
          ringColor,
          Math.min(1, alpha + milestoneBand * 0.8),
        );
        continue;
      }

      batch.add(shape, centerX + dx * offset, centerY + dy * offset, size, angle, markColor, alpha);
    }
  }

  batch.flush(ctx);
  ctx.restore();
}
