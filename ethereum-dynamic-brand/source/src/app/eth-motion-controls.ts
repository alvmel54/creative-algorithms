"use client";

import * as React from "react";

import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";

import { ethDataFeed, resolveEthPeriod } from "./eth-data-feed";
import { resolveEthMotionSource, type EthDataSourceType } from "./eth-diamond-shading";
import { ethIdentityPresets, matchEthIdentity } from "./eth-identity-presets";

type EthMotionValues = { animation: string; flow: number; speed: number; variation: number };

const motionTargets = {
  animation: "physics.animation",
  flow: "physics.flow",
  speed: "physics.speed",
  variation: "physics.variation",
} as const;

function readMotion(values: Record<string, unknown>): EthMotionValues {
  return {
    animation: String(values["physics.animation"] ?? "flow"),
    flow: Number(values["physics.flow"] ?? 0.8),
    speed: Number(values["physics.speed"] ?? 0.5),
    variation: Number(values["physics.variation"] ?? 33),
  };
}

function sameMotion(a: EthMotionValues, b: EthMotionValues): boolean {
  return (
    a.animation === b.animation &&
    Math.abs(a.flow - b.flow) < 1e-6 &&
    Math.abs(a.speed - b.speed) < 1e-6 &&
    Math.abs(a.variation - b.variation) < 1e-6
  );
}

/** Rounded to the sliders' steps (0.1 and 1°). */
function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Motion is always visible (blueprint 2026-10-09, Story addendum; manual
 * motion blueprint 2026-10-27). With Source = From data the Animation, Speed,
 * Intensity and Variation controls show the motion measured from the data
 * (None shows Animation None). Editing any of them switches Source to Manual
 * with those values; Type of data, the Story and the pattern stay as they
 * are. A legacy saved Type of data "custom" becomes Manual plus the
 * identity's own data (Mix when the look is custom). */
export function useEthMotionControlsSync({
  dataFeedVersion,
  dispatch,
  values,
}: {
  /** Re-runs when the history loads and the measured motion is ready. */
  dataFeedVersion: number;
  dispatch: ToolcraftCustomControlRendererProps["dispatch"];
  values: Record<string, unknown>;
}): void {
  const rawType = values["dataSource.type"];
  const type = (rawType as EthDataSourceType) ?? "mix";
  const source = resolveEthMotionSource(values);
  const period = resolveEthPeriod(values);
  // What this hook last wrote into the controls, for which data; `pending`
  // until the written values come back in state.
  const writtenRef = React.useRef<{ key: string; motion: EthMotionValues; pending: boolean } | null>(null);

  React.useEffect(() => {
    if (rawType === "custom") {
      const identity = matchEthIdentity(values);
      const data = ethIdentityPresets.find((preset) => preset.id === identity)?.values["dataSource.type"] ?? "mix";

      writtenRef.current = null;
      dispatch({ history: "skip", target: "physics.motionSource", type: "controls.setValue", value: "manual" });
      dispatch({ history: "skip", target: "dataSource.type", type: "controls.setValue", value: data });
      return;
    }

    if (source === "manual") {
      writtenRef.current = null;
      return;
    }

    const current = readMotion(values);
    const key = `${type}|${period}`;
    const written = writtenRef.current;

    if (written && written.key === key) {
      if (written.pending) {
        written.pending = !sameMotion(current, written.motion);
        return;
      }

      if (!sameMotion(current, written.motion)) {
        writtenRef.current = null;
        dispatch({ target: "physics.motionSource", type: "controls.setValue", value: "manual" });

        // A slider edited under None would stay static: give it a style.
        // Picking Animation None by hand keeps None.
        if (current.animation === "none" && written.motion.animation === "none") {
          dispatch({ history: "skip", target: "physics.animation", type: "controls.setValue", value: "flow" });
        }
      }

      return;
    }

    let motion: EthMotionValues;

    if (type === "none") {
      motion = { ...current, animation: "none" };
    } else {
      const profile = ethDataFeed.getMotionProfile(type, period);

      if (!profile) {
        // Still measuring: the controls keep their values until it lands.
        writtenRef.current = null;
        return;
      }

      motion = {
        animation: profile.animation,
        flow: tenths(profile.flow),
        speed: tenths(profile.speed),
        // The control is a percent of the full cycle (100 % = 360°).
        variation: Math.round(profile.variationDeg / 3.6),
      };
    }

    writtenRef.current = { key, motion, pending: !sameMotion(current, motion) };

    (Object.keys(motionTargets) as (keyof EthMotionValues)[]).forEach((name) => {
      if (current[name] !== motion[name]) {
        dispatch({ history: "skip", target: motionTargets[name], type: "controls.setValue", value: motion[name] });
      }
    });
  }, [dataFeedVersion, dispatch, period, rawType, source, type, values]);
}
