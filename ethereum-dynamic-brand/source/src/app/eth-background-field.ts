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
