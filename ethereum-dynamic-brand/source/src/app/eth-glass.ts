/** Glass for the 3D diamond (blueprint 2026-10-10, liquid addendum round 8),
 * after Toolcraft's Liquid Glass: the six controls that change the look the
 * most. Edge width, facet shading, grain and scratches are fixed; there is
 * no color split. All values are 0..1; the shader in eth-dither-effect.ts
 * reads them. */
export type EthGlass = {
  /** Wide-angle view through the middle. */
  fisheye: number;
  /** How soft what is behind looks (0 clear, 1 frosted). */
  frost: number;
  /** Inner glow fading in from the edge. */
  glow: number;
  /** How strongly the glass bends what is behind it. */
  refraction: number;
  /** Clear line around the contour. */
  rim: number;
  /** Veil in the identity's colors; also makes the body brighter. */
  tint: number;
};

function percent(value: unknown, fallback: number): number {
  const number = Number(value ?? fallback);

  return Math.min(1, Math.max(0, (Number.isFinite(number) ? number : fallback) / 100));
}

/** The Glass section's values, or null when Glass is off. */
export function resolveEthGlass(values: Record<string, unknown>): EthGlass | null {
  if ((values["glass.enabled"] ?? true) !== true) {
    return null;
  }

  return {
    fisheye: percent(values["glass.fisheye"], 10),
    frost: percent(values["glass.frost"], 0),
    glow: percent(values["glass.glow"], 10),
    refraction: percent(values["glass.refraction"], 40),
    rim: percent(values["glass.rim"], 30),
    tint: percent(values["glass.tint"], 0),
  };
}
