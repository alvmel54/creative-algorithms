export type EthGradientType = "angular" | "diamond" | "linear" | "radial";

export type EthBackgroundGradient = {
  angleDeg: number;
  /** Sorted by position; colors as sRGB 0..1, opacity 0..1. */
  stops: { alpha: number; position: number; rgb: [number, number, number] }[];
  type: EthGradientType;
};

/** Up to five stops, the gradient control's maximum (shader arrays match). */
export const ETH_GRADIENT_MAX_STOPS = 5;

function parseHex(color: unknown): [number, number, number] {
  const normalized = String(color ?? "").replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : normalized;
  const parsed = Number.parseInt(expanded, 16);

  if (expanded.length !== 6 || Number.isNaN(parsed)) {
    return [0, 0, 0];
  }

  return [((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The Gradient fill from the Background controls, or null for Color. */
export function resolveEthBackgroundGradient(values: Record<string, unknown>): EthBackgroundGradient | null {
  if (values["scene.backgroundFill"] !== "gradient") {
    return null;
  }

  const raw = (values["scene.backgroundGradient"] ?? {}) as {
    angle?: unknown;
    gradientType?: unknown;
    stops?: unknown;
  };
  const type: EthGradientType = ["angular", "diamond", "linear", "radial"].includes(String(raw.gradientType))
    ? (raw.gradientType as EthGradientType)
    : "linear";
  const stops = (Array.isArray(raw.stops) ? raw.stops : [])
    .slice(0, ETH_GRADIENT_MAX_STOPS)
    .map((stop: { color?: unknown; opacity?: unknown; position?: unknown }) => ({
      alpha: clamp01(Number(stop.opacity ?? 100) / 100),
      position: clamp01(Number.parseFloat(String(stop.position ?? "0")) / 100),
      rgb: parseHex(stop.color),
    }))
    .sort((a, b) => a.position - b.position);

  if (stops.length === 0) {
    return null;
  }

  return { angleDeg: Number.isFinite(Number(raw.angle)) ? Number(raw.angle) : 90, stops, type };
}

/** How Live data moves the gradient: the data level (0..1, 0.5 neutral)
 * widens or narrows the spread by up to 15 %, a pulse widens it briefly;
 * Angular turns instead. Neutral (scale 1, phase 0) without Live data. */
export function getEthGradientBreath(dataLevel: number, dataPulse: number): { phase: number; scale: number } {
  const offset = dataLevel - 0.5;

  return { phase: offset * 0.1 + dataPulse * 0.03, scale: 1 + offset * 0.3 + dataPulse * 0.25 };
}

/**
 * Gradient position 0..1 of a canvas point (same math as the 3D shader's
 * ethGradientT). Matches the gradient control's CSS preview: Linear uses the
 * CSS angle convention (0° up, 90° right) and gradient line length; Radial
 * is a circle reaching the farthest corner; Angular starts at 90° and runs
 * clockwise. Diamond uses rhombus contours, like the ETH gem.
 */
export function getEthGradientT(
  type: EthGradientType,
  angleDeg: number,
  x: number,
  y: number,
  width: number,
  height: number,
  breath: { phase: number; scale: number },
): number {
  const dx = x - width / 2;
  const dy = y - height / 2;

  switch (type) {
    case "linear": {
      const angle = (angleDeg * Math.PI) / 180;
      const length = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle)) || 1;
      const t = (dx * Math.sin(angle) - dy * Math.cos(angle)) / length;

      return 0.5 + t / breath.scale;
    }

    case "radial":
      return Math.hypot(dx, dy) / (Math.hypot(width / 2, height / 2) || 1) / breath.scale;

    case "diamond":
      return (Math.abs(dx) / (width / 2 || 1) + Math.abs(dy) / (height / 2 || 1)) / breath.scale;

    case "angular": {
      const turns = Math.atan2(dx, -dy) / (Math.PI * 2) - 0.25 + breath.phase;

      return turns - Math.floor(turns);
    }
  }
}

/** Color (sRGB 0..1) and opacity at gradient position t, clamped to the end
 * stops like CSS. */
export function sampleEthGradient(
  stops: EthBackgroundGradient["stops"],
  t: number,
): { alpha: number; rgb: [number, number, number] } {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;

  if (t <= first.position) {
    return { alpha: first.alpha, rgb: first.rgb };
  }

  if (t >= last.position) {
    return { alpha: last.alpha, rgb: last.rgb };
  }

  for (let index = 1; index < stops.length; index++) {
    const b = stops[index]!;

    if (t <= b.position) {
      const a = stops[index - 1]!;
      const k = (t - a.position) / (b.position - a.position || 1);

      return {
        alpha: a.alpha + (b.alpha - a.alpha) * k,
        rgb: [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k],
      };
    }
  }

  return { alpha: last.alpha, rgb: last.rgb };
}
