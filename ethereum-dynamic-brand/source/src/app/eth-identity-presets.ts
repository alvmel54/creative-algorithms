import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";

import { resolveEthColor } from "./eth-diamond-shading";

/**
 * Ecosystem identity presets (blueprint 2026-10-07, narrowed by the
 * 2026-10-09 narrative model, realigned 2026-10-12): one diamond, five
 * identities. An identity sets its look (shape, palette plus the milestone
 * Accent, density) and its own data, the heartbeat of its part of the
 * ecosystem: Foundation Mix, Blockchain Total Staking, ETH the ETH price,
 * Developers gas, dApps TVL. Changing Type of data by hand keeps the
 * identity (only the look decides Custom), so any identity can still tell
 * its story through another metric.
 */
export type EthIdentityId = "foundation" | "blockchain" | "eth" | "developers" | "dapps";

type EthIdentityIngredients = Readonly<Record<string, string | number | boolean>>;

type EthIdentityPreset = {
  id: EthIdentityId;
  label: string;
  values: EthIdentityIngredients;
};

export const ethIdentityPresets: readonly EthIdentityPreset[] = [
  {
    id: "foundation",
    label: "Foundation",
    values: {
      "dataSource.type": "mix",
      "geometry.shapeType": "circle",
      "geometry.colorA": "#7c5cff",
      "geometry.colorB": "#b9a8ff",
      "geometry.accentColor": "#d9b04e",
      "geometry.colorGradient": false,
      // 9 (was 7): its thin rings vanished on the darker lower facets.
      "geometry.size": 9,
      "geometry.amount": 180,
      "geometry.spacing": 22,
      "geometry.rotation": 0,
      "geometry.sizeVariation": 15,
    },
  },
  {
    id: "blockchain",
    label: "Blockchain",
    values: {
      "dataSource.type": "total-staking",
      "geometry.shapeType": "square",
      "geometry.colorA": "#2f5bff",
      "geometry.colorB": "#3fe0ff",
      "geometry.accentColor": "#ff9f43",
      "geometry.colorGradient": false,
      "geometry.size": 4,
      "geometry.amount": 220,
      "geometry.spacing": 24,
      "geometry.rotation": 0,
      "geometry.sizeVariation": 0,
    },
  },
  {
    id: "eth",
    label: "ETH",
    values: {
      "dataSource.type": "eth-price",
      "geometry.shapeType": "diamond",
      "geometry.colorA": "#627eea",
      "geometry.colorB": "#8f7bff",
      "geometry.accentColor": "#ff5fa2",
      "geometry.colorGradient": true,
      "geometry.size": 7,
      "geometry.amount": 220,
      "geometry.spacing": 20,
      "geometry.rotation": 45,
      "geometry.sizeVariation": 0,
    },
  },
  {
    id: "developers",
    label: "Developers",
    values: {
      "dataSource.type": "gas-price",
      "geometry.shapeType": "cross",
      "geometry.colorA": "#00c2ff",
      "geometry.colorB": "#5ff2b0",
      "geometry.accentColor": "#a3cb4d",
      "geometry.colorGradient": false,
      "geometry.size": 9,
      "geometry.amount": 240,
      "geometry.spacing": 20,
      "geometry.rotation": 0,
      "geometry.sizeVariation": 20,
    },
  },
  {
    id: "dapps",
    label: "dApps",
    values: {
      "dataSource.type": "tvl",
      "geometry.shapeType": "mixed",
      "geometry.colorA": "#ff4fb8",
      "geometry.colorB": "#ff9a3c",
      "geometry.accentColor": "#6af0ff",
      "geometry.colorGradient": true,
      "geometry.size": 6,
      "geometry.amount": 260,
      "geometry.spacing": 20,
      "geometry.rotation": 30,
      "geometry.sizeVariation": 60,
    },
  },
];

export const ethIdentityCustomValue = "custom";

function sameIngredient(target: string, current: unknown, expected: string | number | boolean): boolean {
  if (target === "geometry.colorA" || target === "geometry.colorB" || target === "geometry.accentColor") {
    return resolveEthColor(current, "").toLowerCase() === String(expected).toLowerCase();
  }

  if (typeof expected === "number") {
    return Math.abs(Number(current) - expected) < 1e-6;
  }

  if (typeof expected === "boolean") {
    return Boolean(current) === expected;
  }

  return current === expected;
}

/** Ingredients an identity sets but that do not decide Custom: its data. */
const ethIdentityUnmatchedTargets = new Set(["dataSource.type"]);

/** The identity is derived, not stored: the preset whose look ingredients
 * all match the current values, or "custom" as soon as any of them was
 * changed by hand. Undo, settings import and manual edits therefore never
 * leave the Identity select out of sync. */
export function matchEthIdentity(values: Record<string, unknown>): EthIdentityId | typeof ethIdentityCustomValue {
  const match = ethIdentityPresets.find((preset) =>
    Object.entries(preset.values).every(
      ([target, expected]) => ethIdentityUnmatchedTargets.has(target) || sameIngredient(target, values[target], expected),
    ),
  );

  return match ? match.id : ethIdentityCustomValue;
}

/** Applies every ingredient of `id`. Each changed control
 * is its own undo step: the runtime's "merge" history mode keeps only the
 * first patch's `before` and the last patch's `after`, so merging different
 * targets into one group would make undo restore just one of them (it is
 * built for repeated changes of one slider). Unchanged values add no step. */
export function applyEthIdentity(dispatch: ToolcraftCustomControlRendererProps["dispatch"], id: EthIdentityId): void {
  const preset = ethIdentityPresets.find((entry) => entry.id === id);

  if (!preset) {
    return;
  }

  const label = `Identity: ${preset.label}`;

  for (const [target, value] of Object.entries(preset.values)) {
    dispatch({ label, target, type: "controls.setValue", value });
  }
}
