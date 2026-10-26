import type { EthShapeType } from "./eth-diamond-shading";

/**
 * Batched shapes for large mark counts (the Field background and its
 * typography): marks are collected into one Path2D per color and opacity
 * and filled once each, instead of a save/rotate/fill/restore per mark,
 * which the canvas rasterizer could not keep up with. Strokes (Circle, Line,
 * Cross) become filled rings and bars of the same width, matching the 3D
 * shader's shapes.
 *
 * Each batch is split into paths of at most BATCH_PATH_SHAPES shapes:
 * building one Chrome Path2D grows quadratically with its subpaths (4,000
 * squares took 56 ms, 8,000 took 225 ms), which held Developers' crosses at
 * about 4 fps.
 */
const BATCH_PATH_SHAPES = 200;

export class EthShapeBatch {
  private readonly batches = new Map<string, { alpha: number; color: string; count: number; paths: Path2D[] }>();

  add(
    shape: Exclude<EthShapeType, "mixed">,
    x: number,
    y: number,
    size: number,
    rotationRad: number,
    color: string,
    alpha: number,
  ): void {
    if (size <= 0.35 || alpha < 0.01) {
      return;
    }

    // Opacity in 32 steps keeps the batch count small.
    const steppedAlpha = Math.min(1, Math.round(alpha * 32) / 32);
    const key = `${color}|${steppedAlpha}`;
    let batch = this.batches.get(key);

    if (!batch) {
      batch = { alpha: steppedAlpha, color, count: 0, paths: [] };
      this.batches.set(key, batch);
    }

    if (batch.count % BATCH_PATH_SHAPES === 0) {
      batch.paths.push(new Path2D());
    }

    batch.count += 1;
    addShapeToPath(batch.paths[batch.paths.length - 1]!, shape, x, y, size, rotationRad);
  }

  /** Fills every batch (nonzero rule: ring holes wind the other way). */
  flush(ctx: CanvasRenderingContext2D): void {
    const previousAlpha = ctx.globalAlpha;

    for (const batch of this.batches.values()) {
      ctx.globalAlpha = previousAlpha * batch.alpha;
      ctx.fillStyle = batch.color;
      batch.paths.forEach((path) => ctx.fill(path));
    }

    ctx.globalAlpha = previousAlpha;
    this.batches.clear();
  }
}

function addPolygon(path: Path2D, x: number, y: number, cos: number, sin: number, points: readonly number[]): void {
  for (let index = 0; index < points.length; index += 2) {
    const px = x + points[index]! * cos - points[index + 1]! * sin;
    const py = y + points[index]! * sin + points[index + 1]! * cos;

    if (index === 0) {
      path.moveTo(px, py);
    } else {
      path.lineTo(px, py);
    }
  }

  path.closePath();
}

function addShapeToPath(
  path: Path2D,
  shape: Exclude<EthShapeType, "mixed">,
  x: number,
  y: number,
  size: number,
  rotationRad: number,
): void {
  const half = size / 2;

  switch (shape) {
    case "dot": {
      path.moveTo(x + half, y);
      path.arc(x, y, half, 0, Math.PI * 2);
      break;
    }

    case "circle": {
      // A stroked ring of width lw, as an annulus: outer clockwise, inner
      // counter-clockwise.
      const lineWidth = Math.max(0.6, size * 0.22);
      const outer = half + lineWidth / 2;
      const inner = Math.max(0, half - lineWidth / 2);

      path.moveTo(x + outer, y);
      path.arc(x, y, outer, 0, Math.PI * 2);

      if (inner > 0) {
        path.moveTo(x + inner, y);
        path.arc(x, y, inner, Math.PI * 2, 0, true);
      }

      break;
    }

    default: {
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);

      if (shape === "square") {
        addPolygon(path, x, y, cos, sin, [-half, -half, half, -half, half, half, -half, half]);
      } else if (shape === "triangle") {
        addPolygon(path, x, y, cos, sin, [0, -half, half, half, -half, half]);
      } else if (shape === "diamond") {
        const halfWidth = size * 0.31;

        addPolygon(path, x, y, cos, sin, [0, -half, halfWidth, 0, 0, half, -halfWidth, 0]);
      } else if (shape === "line") {
        const w = Math.max(0.6, size * 0.28) / 2;

        addPolygon(path, x, y, cos, sin, [-half, -w, half, -w, half, w, -half, w]);
      } else if (shape === "cross") {
        const w = Math.max(0.6, size * 0.24) / 2;

        addPolygon(path, x, y, cos, sin, [-half, -w, half, -w, half, w, -half, w]);
        addPolygon(path, x, y, cos, sin, [-w, -half, w, -half, w, half, -w, half]);
      }

      break;
    }
  }
}
