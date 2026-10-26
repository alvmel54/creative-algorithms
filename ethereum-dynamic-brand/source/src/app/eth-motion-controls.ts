"use client";

import * as React from "react";

import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";

import { ethDataFeed, resolveEthPeriod } from "./eth-data-feed";
import { getSeedForDataSource, type EthDataSourceType } from "./eth-diamond-shading";

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

/** Motion is always visible (blueprint 2026-10-09, Story addendum): with a
 * data type the Animation, Speed, Intensity and Variation controls show the
 * motion measured from the data (None shows Animation None). Editing any of
 * them switches Type of data to Custom with those values, like Identity
 * shows Custom when the look is edited. The pattern seed is carried over so
 * the mark does not reshuffle on that switch. */
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
  const type = (values["dataSource.type"] as EthDataSourceType) ?? "mix";
  const period = resolveEthPeriod(values);
  // What this hook last wrote into the controls, for which data; `pending`
  // until the written values come back in state.
  const writtenRef = React.useRef<{ key: string; motion: EthMotionValues; pending: boolean } | null>(null);

  React.useEffect(() => {
    if (type === "custom") {
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
        dispatch({
          target: "dataSource.seed",
          type: "controls.setValue",
          value: Number(values["dataSource.seed"] ?? 0) + getSeedForDataSource(type) - getSeedForDataSource("custom"),
        });
        dispatch({ target: "dataSource.type", type: "controls.setValue", value: "custom" });

        // A slider edited under the None data type would stay static: give it
        // a style. Picking Animation None by hand keeps None.
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
  }, [dataFeedVersion, dispatch, period, type, values]);
}
