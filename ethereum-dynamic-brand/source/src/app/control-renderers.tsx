"use client";

import * as React from "react";

import type {
  ToolcraftControlRendererMap,
  ToolcraftCustomControlRendererProps,
} from "@/toolcraft/runtime/react";

import { describeEthDataMotion, ethDataFeed, resolveEthPeriod, type EthDataPeriod } from "./eth-data-feed";
import type { EthDataSourceType } from "./eth-diamond-shading";
import styles from "./eth-live-indicator.module.css";
import { ExportDurationControl } from "./export-duration-control";
import { IdentityPresetControl } from "./identity-preset-control";

/**
 * Read-only status pulse shown while "Real-time tracking" is Yes, with the
 * latest real value of the selected data (or "simulated" on fallback). No built-in
 * control can animate a live-status affordance next to a mode selection;
 * see builtInFitCheck on the "dataSource.liveIndicator" acceptance row.
 *
 * The controls-panel runtime invokes custom control renderers as a plain
 * function call rather than as JSX, so any hooks called directly in that top
 * level run against whichever fiber is currently rendering the surrounding
 * control list. Since this control only appears in that list while
 * `visibleWhen` is true, the hook count seen by that fiber would change
 * every time tracking flips between Yes/No, tripping React's "Rendered more
 * hooks than during the previous render" invariant. Keeping this outer
 * function hook-free and returning a real `<LiveTrackingIndicatorPulse />`
 * element instead means React mounts/unmounts a genuine component with its
 * own fiber and hook state through normal reconciliation, which is safe.
 */
function LiveTrackingIndicatorPulse({
  dataSourceType,
  period,
}: {
  dataSourceType: EthDataSourceType;
  period: EthDataPeriod;
}): React.JSX.Element {
  const [dim, setDim] = React.useState(false);

  React.useSyncExternalStore(ethDataFeed.subscribe, ethDataFeed.getVersion);

  const series = ethDataFeed.getSeries(dataSourceType, period);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setDim((current) => !current);
    }, 800);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className={styles.row} data-testid="live-tracking-indicator">
      <span className={dim ? `${styles.dot} ${styles.dotDim}` : styles.dot} />
      <span className={styles.label}>
        {series ? series.label : "Loading data…"}
      </span>
    </div>
  );
}

function LiveTrackingIndicator({ state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  return (
    <LiveTrackingIndicatorPulse
      dataSourceType={(state.values["dataSource.type"] as EthDataSourceType) ?? "mix"}
      period={resolveEthPeriod(state.values)}
    />
  );
}

/** Read-only line in Motion while a data type drives the mark: the motion
 * measured from that data ("Wave · Speed 1.2 · ... — from Gas Price, All
 * time"). A real component: it re-renders when the history loads. */
function MotionDataStatusLine({ dataSourceType, period }: { dataSourceType: EthDataSourceType; period: EthDataPeriod }): React.JSX.Element {
  React.useSyncExternalStore(ethDataFeed.subscribe, ethDataFeed.getVersion);

  return (
    <div className={styles.row} data-testid="motion-data-status">
      <span className={styles.label}>{describeEthDataMotion(dataSourceType, period)}</span>
    </div>
  );
}

function MotionDataStatus({ state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  return (
    <MotionDataStatusLine
      dataSourceType={(state.values["dataSource.type"] as EthDataSourceType) ?? "mix"}
      period={resolveEthPeriod(state.values)}
    />
  );
}

export const appControlRenderers: ToolcraftControlRendererMap = {
  exportDurationDisplay: ExportDurationControl,
  identityPreset: IdentityPresetControl,
  motionDataStatus: MotionDataStatus,
  liveTrackingIndicator: LiveTrackingIndicator,
};
