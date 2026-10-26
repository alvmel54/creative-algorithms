import { drawEthBackgroundField, type EthBackgroundFieldParams } from "./eth-background-field";
import type { EthMilestoneText } from "./eth-data-feed";
import { resolveEthAccent, type EthDiamondGeometry } from "./eth-diamond-shading";

/** Big background type built from the mark's pattern (blueprint
 * 2026-10-09 typography): the milestone text of a Story. */
export type EthTypographyRender = {
  /** 0..1 Text opacity (Data > Text opacity), applied in the shader. */
  opacity: number;
  /** Size control value (unscaled by data): the letters keep the same marks
   * all loop long, even when a history Period shrinks the gem's marks. */
  markSize: number;
  /** The milestone text: revealed by its wave, held lit, and swept away by
   * the next milestone's wave (which reveals the new text behind its front). */
  milestone: {
    color: string;
    current: { subtitle: string | null; title: string };
    previous: { subtitle: string | null; title: string } | null;
    /** Sweep front (half gem heights) while a wave passes, else null. */
    sweep: number | null;
  } | null;
};

/** Opacity of a held milestone text. */
const HOLD_OPACITY = 0.9;

const FONT_FAMILY = '"Inter", "Arial Black", "Helvetica Neue", Arial, sans-serif';
/** Widest line as a share of the canvas width, capped by height. The
 * preview covers the screen and centers the gem beside the controls panel,
 * so only about the middle two thirds of the canvas width is visible: the
 * text stays well inside it, with generous padding. */
const TITLE_WIDTH = 0.5;
const TITLE_MAX_HEIGHT = 0.2;
const SUBTITLE_SCALE = 0.55;
/** Text marks are larger than the background marks so the letters read. */
const PATTERN_MARK_SCALE = 1.5;

let buffer: HTMLCanvasElement | null = null;
/** Text mask: both lines in one image, so a single destination-in keeps the
 * marks inside either line (two destination-in draws erased the first). */
let maskBuffer: HTMLCanvasElement | null = null;

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return canvas.getContext("2d");
}

function parseHex(color: string): [number, number, number] {
  const normalized = color.replace("#", "");
  const value = Number.parseInt(normalized.length === 3 ? normalized.replace(/./g, "$&$&") : normalized, 16);

  return Number.isNaN(value) ? [255, 255, 255] : [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

type MarkLight = (waveRadius: number) => { alpha: number; color: string } | null;

/** Per-mark light of a milestone text (steps 2 and hold). `reveal`: marks
 * the sweep has reached are lit, whiter right at the front; `fade`: marks it
 * has reached go dark (the old text being swept away). With no sweep the
 * text is simply held. The front follows the pattern's currents and
 * ignites mark by mark (`getEthWaveRadius`). */
function createMilestoneMarkLight(colorHex: string, sweep: number | null, mode: "fade" | "reveal"): MarkLight {
  const color = parseHex(colorHex);
  const held = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

  return (waveRadius) => {
    if (sweep === null) {
      return { alpha: HOLD_OPACITY, color: held };
    }

    const reached = smoothstep(sweep + 0.12, sweep - 0.12, waveRadius);

    if (mode === "fade") {
      return reached >= 1 ? null : { alpha: HOLD_OPACITY * (1 - reached), color: held };
    }

    if (reached <= 0) {
      return null;
    }

    // In 8 steps, so the batched marks share few colors.
    const edge = Math.round(Math.max(0, 1 - Math.abs(waveRadius - sweep) / 0.3) * 8) / 8;
    const [r, g, b] = color.map((channel) => Math.round(channel + (255 - channel) * edge * 0.5));

    return { alpha: Math.min(1, HOLD_OPACITY + edge * 0.1) * reached, color: `rgb(${r}, ${g}, ${b})` };
  };
}

/**
 * Big background typography from the mark's own pattern (same Shape,
 * density and flow as the Field background, larger marks), masked by the
 * text and lit by a fill (composited offscreen, so no pixel reads). The 3D
 * shader masks it with the mesh.
 */
export function drawEthTypography(
  ctx: CanvasRenderingContext2D,
  {
    cssHeight,
    cssWidth,
    field,
    geometry,
    markSizeScale = 1,
    typography,
  }: {
    /** Converts typography.markSize to this canvas (3D uses height / 1080). */
    markSizeScale?: number;
    cssHeight: number;
    cssWidth: number;
    /** Field parameters for the pattern (same grid as the background). */
    field: EthBackgroundFieldParams;
    geometry: EthDiamondGeometry;
    typography: EthTypographyRender | null;
  },
): void {
  if (!typography) {
    return;
  }

  // Each text is lit per mark: the held milestone, and the previous one
  // while the new wave sweeps it away.
  const layers: {
    fill: string | null;
    markLight?: MarkLight;
    subtitle: string | null;
    title: string;
  }[] = [];

  if (typography.milestone) {
    const { color, current, previous, sweep } = typography.milestone;

    if (previous && sweep !== null) {
      layers.push({ ...previous, fill: null, markLight: createMilestoneMarkLight(color, sweep, "fade") });
    }

    layers.push({ ...current, fill: null, markLight: createMilestoneMarkLight(color, sweep, "reveal") });
  }

  if (layers.length === 0) {
    return;
  }

  const scale = ctx.getTransform().a || 1;
  const pixelWidth = Math.max(1, Math.round(cssWidth * scale));
  const pixelHeight = Math.max(1, Math.round(cssHeight * scale));

  buffer ??= document.createElement("canvas");
  maskBuffer ??= document.createElement("canvas");

  const bufferContext = sizeCanvas(buffer, pixelWidth, pixelHeight);
  const maskContext = sizeCanvas(maskBuffer, pixelWidth, pixelHeight);

  if (!bufferContext || !maskContext) {
    return;
  }

  ctx.save();

  for (const layer of layers) {
    // Fit the title to the width, capped by height; the subtitle is smaller.
    maskContext.setTransform(scale, 0, 0, scale, 0, 0);
    maskContext.clearRect(0, 0, cssWidth, cssHeight);
    maskContext.font = `900 100px ${FONT_FAMILY}`;

    const titleSize = Math.min(
      (100 * cssWidth * TITLE_WIDTH) / Math.max(1, maskContext.measureText(layer.title).width),
      cssHeight * TITLE_MAX_HEIGHT,
    );
    const subtitleSize = titleSize * SUBTITLE_SCALE;
    const gap = titleSize * 0.08;
    const blockHeight = titleSize + (layer.subtitle ? gap + subtitleSize : 0);
    const titleY = geometry.cy - blockHeight / 2 + titleSize / 2;

    maskContext.textAlign = "center";
    maskContext.textBaseline = "middle";
    maskContext.fillStyle = "#ffffff";
    maskContext.font = `900 ${titleSize}px ${FONT_FAMILY}`;
    maskContext.fillText(layer.title, cssWidth / 2, titleY, cssWidth * TITLE_WIDTH);

    if (layer.subtitle) {
      maskContext.font = `900 ${subtitleSize}px ${FONT_FAMILY}`;
      maskContext.fillText(layer.subtitle, cssWidth / 2, titleY + titleSize / 2 + gap + subtitleSize / 2, cssWidth * TITLE_WIDTH);
    }

    // Only the text block needs marks: drawing the whole canvas's pattern
    // every frame and masking most of it away held a Story at about 9 fps.
    const pad = titleSize * 0.2;
    const left = Math.max(0, Math.floor(cssWidth * (0.5 - TITLE_WIDTH / 2) - pad));
    const top = Math.max(0, Math.floor(titleY - titleSize / 2 - pad));
    const right = Math.min(cssWidth, Math.ceil(cssWidth * (0.5 + TITLE_WIDTH / 2) + pad));
    const bottom = Math.min(cssHeight, Math.ceil(titleY - titleSize / 2 + blockHeight + pad));
    const regionWidth = Math.max(1, right - left);
    const regionHeight = Math.max(1, bottom - top);

    // Pattern marks, kept only inside the letters, then lit.
    bufferContext.setTransform(scale, 0, 0, scale, 0, 0);
    bufferContext.globalCompositeOperation = "source-over";
    bufferContext.clearRect(0, 0, cssWidth, cssHeight);
    drawEthBackgroundField(bufferContext, {
      ...field,
      color: "#ffffff",
      markLight: layer.markLight,
      markScale: PATTERN_MARK_SCALE,
      maxSize: typography.markSize * markSizeScale,
      milestone: null,
      region: { bottom, left, right, top },
      strength: 1,
      uniform: true,
    });
    bufferContext.globalCompositeOperation = "destination-in";
    bufferContext.drawImage(
      maskBuffer,
      left * scale,
      top * scale,
      regionWidth * scale,
      regionHeight * scale,
      left,
      top,
      regionWidth,
      regionHeight,
    );

    if (layer.fill) {
      // source-in, not source-atop: where the fill is transparent the marks
      // must vanish too (source-atop left them white).
      bufferContext.globalCompositeOperation = "source-in";
      bufferContext.fillStyle = layer.fill;
      bufferContext.fillRect(left, top, regionWidth, regionHeight);
    }

    bufferContext.globalCompositeOperation = "source-over";

    ctx.drawImage(
      buffer,
      left * scale,
      top * scale,
      regionWidth * scale,
      regionHeight * scale,
      left,
      top,
      regionWidth,
      regionHeight,
    );
  }

  ctx.restore();
}

/** Milestone typography of a Story (null when Story is Off). */
export function resolveEthTypographyRender(
  values: Record<string, unknown>,
  milestoneText: EthMilestoneText | null,
): EthTypographyRender | null {
  if (!milestoneText) {
    return null;
  }

  return {
    markSize: Number(values["geometry.size"] ?? 5),
    opacity: Math.min(1, Math.max(0, Number(values["dataSource.textOpacity"] ?? 100) / 100)),
    milestone: {
      color: resolveEthAccent(values),
      current: milestoneText.current,
      previous: milestoneText.previous,
      sweep: milestoneText.sweep,
    },
  };
}
