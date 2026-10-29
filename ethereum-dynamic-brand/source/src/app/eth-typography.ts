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

const FONT_FAMILY = '"Inter", "Arial Black", "Helvetica Neue", Arial, sans-serif';
/** Widest line as a share of the canvas width, capped by height. The
 * preview covers the screen and centers the gem beside the controls panel,
 * so only about the middle two thirds of the canvas width is visible: the
 * text stays well inside it, with generous padding. */
const TITLE_WIDTH = 0.5;
const TITLE_MAX_HEIGHT = 0.2;
/** Canvases narrower than 16:9 (1:1, 4:5, 9:16) keep the title as wide as
 * in 16:9 relative to the height (half of a 16:9 width), within this share
 * of their own width: half the width left a 9:16 title at about a third of
 * its 16:9 size (2026-10-27). */
const TITLE_NARROW_MAX_WIDTH = 0.85;

/** Widest line in css px: half the canvas width at 16:9 and wider. */
function getTitleWidth(cssWidth: number, cssHeight: number): number {
  return Math.max(cssWidth * TITLE_WIDTH, Math.min(((cssHeight * 16) / 9) * TITLE_WIDTH, cssWidth * TITLE_NARROW_MAX_WIDTH));
}
const SUBTITLE_SCALE = 0.55;

type EthHeadline = { subtitle: string | null; title: string };

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  headline: EthHeadline,
  fill: string,
  cssWidth: number,
  cssHeight: number,
  geometry: EthDiamondGeometry,
): void {
  const titleWidth = getTitleWidth(cssWidth, cssHeight);

  // Fit the title to the width, capped by height; the subtitle is smaller.
  ctx.font = `900 100px ${FONT_FAMILY}`;
  const titleSize = Math.min(
    (100 * titleWidth) / Math.max(1, ctx.measureText(headline.title).width),
    cssHeight * TITLE_MAX_HEIGHT,
  );
  const subtitleSize = titleSize * SUBTITLE_SCALE;
  const gap = titleSize * 0.08;
  const blockHeight = titleSize + (headline.subtitle ? gap + subtitleSize : 0);
  const titleY = geometry.cy - blockHeight / 2 + titleSize / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fill;
  ctx.font = `900 ${titleSize}px ${FONT_FAMILY}`;
  ctx.fillText(headline.title, cssWidth / 2, titleY, titleWidth);

  if (headline.subtitle) {
    ctx.font = `900 ${subtitleSize}px ${FONT_FAMILY}`;
    ctx.fillText(headline.subtitle, cssWidth / 2, titleY + titleSize / 2 + gap + subtitleSize / 2, titleWidth);
  }
}

/**
 * The milestone text as a mask for the shader (2026-10-28): the current
 * headline in red, the one being swept away in green, on black. The shader
 * draws the letters itself from the Field's own marks (larger, in the
 * Accent) wherever the mask is set, and lights them with the wave. The mask
 * only changes when the milestone or the canvas size does, so the letters
 * no longer cost a canvas redraw and a texture upload every frame (that was
 * about a fifth of the CPU while a Story played).
 */
export function drawEthTypographyMask(
  ctx: CanvasRenderingContext2D,
  {
    cssHeight,
    cssWidth,
    geometry,
    milestone,
  }: {
    cssHeight: number;
    cssWidth: number;
    geometry: EthDiamondGeometry;
    milestone: NonNullable<EthTypographyRender["milestone"]>;
  },
): void {
  ctx.save();
  ctx.setTransform(cssWidth > 0 ? ctx.canvas.width / cssWidth : 1, 0, 0, cssHeight > 0 ? ctx.canvas.height / cssHeight : 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  // Additive, so where both lines overlap each keeps its own channel.
  ctx.globalCompositeOperation = "lighter";

  if (milestone.previous && milestone.sweep !== null) {
    drawHeadline(ctx, milestone.previous, "#00ff00", cssWidth, cssHeight, geometry);
  }

  drawHeadline(ctx, milestone.current, "#ff0000", cssWidth, cssHeight, geometry);
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
