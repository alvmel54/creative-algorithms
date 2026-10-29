"use client";

import * as React from "react";

import { useToolcraft } from "@/toolcraft/runtime/react";
import { getToolcraftTimelineLoopTime, shouldIncludeToolcraftPreviewBackground } from "@/toolcraft/runtime";

import {
  getSeedForDataSource,
  isEthLiveDataOn,
  resolveEthColor,
  resolveEthMilestoneRender,
  type EthAnimationMode,
  type EthMilestoneRender,
  type EthDataSourceType,
  type EthShapeType,
} from "./eth-diamond-shading";
import {
  applyEthFormAmount,
  applyEthFormSize,
  ethDataFeed,
  resolveEthForm,
  resolveEthMotion,
  readEthFingerprint,
  resolveEthPeriod,
  type EthFingerprint,
  type EthForm,
} from "./eth-data-feed";
import { ethDataHover } from "./eth-data-hover";
import { resolveEthFieldDensity, resolveEthFieldStrength } from "./eth-background-field";
import { resolveEthBackgroundGradient, type EthBackgroundGradient } from "./eth-background-gradient";
import { EthDiamond3dCanvas } from "./eth-diamond-3d-scene";
import { resolveEthTypographyRender, type EthTypographyRender } from "./eth-typography";
import { useEthCoverViewport } from "./eth-cover-viewport";
import { resolveEthGlass } from "./eth-glass";
import { useEthMotionControlsSync } from "./eth-motion-controls";
import { useEthStateTransition, type EthTransitionMode } from "./eth-state-transition";
import type { EthDiamond3dRenderState, EthFrameSource } from "./eth-diamond-3d-shared";

export type EthDiamondRenderState = {
  amount: number;
  animation: EthAnimationMode;
  backgroundColor: string;
  /** Gradient fill over the background color; null for Color or when the
   * background is not drawn. */
  backgroundGradient: EthBackgroundGradient | null;
  colorA: string;
  colorB: string;
  colorBShare: number;
  colorGradient: boolean;
  /** 0..1 series level (0.5 without Live data). */
  dataLevel: number;
  /** 0..1 burst from Real-time tracking data (spikes and live updates). */
  dataPulse: number;
  dataSource: EthDataSourceType;
  /** 0..1 Field background strength; 0 for Solid or when the background is
   * not drawn. */
  fieldStrength: number;
  /** Field density 1..3 (Background > Field density). */
  fieldDensity: number;
  flow: number;
  includeBackground: boolean;
  loopProgress: number;
  maxSize: number;
  meshRotationDeg: number;
  modelZoom: number;
  /** Active milestone wave (history periods), or null. */
  milestone: EthMilestoneRender | null;
  outlineColor: string;
  outlineWidth: number;
  /** Pattern angle (geometry.patternAngle): turns the whole mark grid, in
   * the gem and in the Field background. */
  patternAngleDeg: number;
  /** Big background typography; null when off or when the background is
   * not drawn. */
  typography: EthTypographyRender | null;
  rotationDeg: number;
  seedOffset: number;
  shapeType: EthShapeType;
  showMarks: boolean;
  showOutline: boolean;
  sizeVariation: number;
  spacing: number;
  speed: number;
  variationDeg: number;
};

function readEthDiamondRenderState(
  values: Record<string, unknown>,
  timelineProgress: number,
  form: EthForm,
  durationSeconds: number,
): EthDiamondRenderState {
  const { dataLevel, dataPulse, loopProgress, milestone, milestoneText, physics } = resolveEthMotion(
    values,
    timelineProgress,
    { durationSeconds, includeLivePulse: true },
  );
  const milestoneRender = resolveEthMilestoneRender(values, milestone);

  return {
    amount: applyEthFormAmount(Number(values["geometry.amount"] ?? 250), form),
    animation: physics.animation,
    backgroundColor: resolveEthColor(values["scene.background"], "#0b0b10"),
    backgroundGradient: resolveEthBackgroundGradient(values),
    colorA: resolveEthColor(values["geometry.colorA"], "#7c5cff"),
    colorB: resolveEthColor(values["geometry.colorB"], "#7c5cff"),
    colorBShare: form.colorBShare,
    colorGradient: Boolean(values["geometry.colorGradient"] ?? false),
    dataLevel,
    dataPulse,
    dataSource: (values["dataSource.type"] as EthDataSourceType) ?? "eth-price",
    fieldStrength: resolveEthFieldStrength(values),
    fieldDensity: resolveEthFieldDensity(values),
    flow: physics.flow,
    includeBackground: Boolean(values["export.includeBackground"] ?? false),
    loopProgress,
    maxSize: applyEthFormSize(Number(values["geometry.size"] ?? 5), form),
    meshRotationDeg: Number(values["geometry.meshRotation"] ?? 0),
    modelZoom: Number(values["geometry.modelZoom"] ?? 55) / 100,
    milestone: milestoneRender,
    outlineColor: resolveEthColor(values["geometry.outlineColor"], "#ffffff"),
    outlineWidth: Number(values["geometry.outlineWidth"] ?? 2),
    patternAngleDeg: Number(values["geometry.patternAngle"] ?? 0),
    rotationDeg: Number(values["geometry.rotation"] ?? 45),
    seedOffset: Number(values["dataSource.seed"] ?? 0),
    shapeType: (values["geometry.shapeType"] as EthShapeType) ?? "dot",
    showMarks: (values["geometry.showMarks"] ?? true) !== false,
    showOutline: Boolean(values["geometry.showOutline"] ?? true),
    sizeVariation: Number(values["geometry.sizeVariation"] ?? 0) / 100,
    spacing: Number(values["geometry.spacing"] ?? 20),
    speed: physics.speed,
    typography: resolveEthTypographyRender(values, milestoneText),
    variationDeg: physics.variationDeg,
  };
}

/** How far past the last committed timeline time a 3D frame may be drawn. */
const MAX_FRAME_EXTRAPOLATION_MS = 66;

const FORM_EASE_MS = 1000;

/** Eases the data-driven Size and color share toward their target over about
 * a second, so new data morphs the diamond instead of jumping. Amount snaps:
 * every intermediate Amount re-cuts the grid, which reshuffled marks on every
 * frame of the ease and read as flicker. Exports use the target directly. */
function useEasedEthForm(target: EthForm): EthForm {
  const [current, setCurrent] = React.useState<EthForm>(target);
  const currentRef = React.useRef(current);

  currentRef.current = current;

  React.useEffect(() => {
    const from = currentRef.current;
    const startedAt = performance.now();
    let frame = 0;

    const step = (): void => {
      const t = Math.min(1, (performance.now() - startedAt) / FORM_EASE_MS);
      const eased = t * t * (3 - 2 * t);
      const lerp = (a: number, b: number): number => a + (b - a) * eased;

      setCurrent({
        amountScale: target.amountScale,
        colorBShare: lerp(from.colorBShare, target.colorBShare),
        sizeScale: lerp(from.sizeScale, target.sizeScale),
      });

      if (t < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [target.amountScale, target.colorBShare, target.sizeScale]);

  return current;
}

/** Neutral fingerprint level: mix(0.45, 1.75, level) = 1, the marks' plain
 * size before a history has loaded. */
const NEUTRAL_FINGERPRINT_LEVEL = 0.55 / 1.3;
const FINGERPRINT_EASE_MS = 1200;

/** Eases the fingerprint toward a new one (a loaded history, another
 * identity's data) instead of snapping: the gem looked full on a preset
 * change, then thinned out at once when the history arrived. */
function useEasedEthFingerprint(target: readonly number[] | null): readonly number[] | null {
  const [current, setCurrent] = React.useState<readonly number[] | null>(target);
  const currentRef = React.useRef(current);

  currentRef.current = current;

  React.useEffect(() => {
    if (!target) {
      setCurrent(null);

      return;
    }

    const from = currentRef.current ?? target.map(() => NEUTRAL_FINGERPRINT_LEVEL);
    const startedAt = performance.now();
    let frame = 0;

    const step = (): void => {
      const t = Math.min(1, (performance.now() - startedAt) / FINGERPRINT_EASE_MS);
      const eased = t * t * (3 - 2 * t);

      setCurrent(target.map((value, index) => (from[index] ?? value) + (value - (from[index] ?? value)) * eased));

      if (t < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [target]);

  return current;
}

export function EthDiamondCanvas(): React.JSX.Element {
  const { dispatch, state } = useToolcraft();
  const cssWidth = state.canvas.size.width;
  const cssHeight = state.canvas.size.height;
  const pixelRatio = Number(state.values["canvas.renderScale"] ?? state.schema.canvas.renderScale.defaultValue ?? 1);
  const loopProgress = React.useMemo(
    () =>
      state.timeline.durationSeconds > 0
        ? getToolcraftTimelineLoopTime({
            currentTimeSeconds: state.timeline.currentTimeSeconds,
            durationSeconds: state.timeline.durationSeconds,
          }) / state.timeline.durationSeconds
        : 0,
    [state.timeline.currentTimeSeconds, state.timeline.durationSeconds],
  );
  const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });
  const liveTracking = isEthLiveDataOn(state.values);
  const dataSourceType = (state.values["dataSource.type"] as EthDataSourceType) ?? "mix";
  const dataPeriod = resolveEthPeriod(state.values);
  // Re-render when real data arrives or a live value is polled.
  const dataFeedVersion = React.useSyncExternalStore(ethDataFeed.subscribe, ethDataFeed.getVersion);

  React.useEffect(() => {
    if (!liveTracking) {
      ethDataFeed.stop();
      return;
    }

    ethDataFeed.start(dataSourceType, dataPeriod);

    return () => ethDataFeed.stop();
  }, [liveTracking, dataSourceType, dataPeriod]);

  const targetForm = React.useMemo(
    () => resolveEthForm(state.values, ethDataFeed.getFormSignals()),
    // dataFeedVersion: new data changes the form signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.values, dataFeedVersion],
  );
  const form = useEasedEthForm(targetForm);
  const fingerprint = React.useMemo(
    () => ethDataFeed.getFingerprint(dataSourceType, dataPeriod),
    // dataFeedVersion: the history arrives after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSourceType, dataPeriod, dataFeedVersion],
  );
  const easedFingerprint = useEasedEthFingerprint(fingerprint?.values ?? null);

  const renderState = React.useMemo(
    () => readEthDiamondRenderState(state.values, loopProgress, form, state.timeline.durationSeconds),
    // dataFeedVersion: the feed store is read inside resolveEthMotion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.values, loopProgress, dataFeedVersion, form, state.timeline.durationSeconds],
  );

  // The frame always covers the screen and stays locked there; the wheel
  // zooms the 3D camera (the background stays put).
  const modelZoomRef = React.useRef(Number(state.values["geometry.modelZoom"] ?? 55));

  modelZoomRef.current = Number(state.values["geometry.modelZoom"] ?? 55);

  const handleWheelZoom = React.useCallback(
    (deltaY: number) => {
      const next = Math.round(Math.min(200, Math.max(30, modelZoomRef.current * Math.exp(-deltaY * 0.0007))));

      if (next !== modelZoomRef.current) {
        modelZoomRef.current = next;
        dispatch({ history: "skip", target: "geometry.modelZoom", type: "controls.setValue", value: next });
      }
    },
    [dispatch],
  );

  useEthCoverViewport({
    cssHeight,
    cssWidth,
    dispatch,
    offset: state.canvas.offset,
    onWheel: handleWheelZoom,
    zoom: state.canvas.zoom,
  });

  // Motion shows the data's measured values; editing one switches to Manual.
  useEthMotionControlsSync({ dataFeedVersion, dispatch, values: state.values });

  // Discrete changes that transition (identity, data, Live data, shape,
  // animation, gradient, and new data that changes Amount). Slider drags
  // stay immediate.
  const productRef = React.useRef<HTMLDivElement | null>(null);
  const transitionOverlayRef = React.useRef<HTMLCanvasElement | null>(null);
  const transitionKey = [
    state.values["dataSource.type"],
    liveTracking,
    state.values["geometry.shapeType"],
    state.values["physics.animation"],
    state.values["geometry.colorGradient"],
    targetForm.amountScale.toFixed(3),
    dataPeriod,
  ].join("|");
  const markCellCssPx =
    (Math.max(3, Math.min(60, (Math.max(renderState.spacing, 2) * 200) / Math.max(10, renderState.amount))) / 1080) *
    cssHeight;

  useEthStateTransition({
    blockCssPx: Math.max(8, markCellCssPx * 2),
    containerRef: productRef,
    cssHeight,
    cssWidth,
    mode: (state.values["physics.transition"] as EthTransitionMode) ?? "dissolve",
    overlayRef: transitionOverlayRef,
    pixelRatio,
    transitionKey,
  });

  const glass = resolveEthGlass(state.values);
  const toRender3dState = (renderState: EthDiamondRenderState): EthDiamond3dRenderState => ({
    amount: renderState.amount,
    animation: renderState.animation,
    backgroundColor: renderState.backgroundColor,
    backgroundGradient: renderState.backgroundGradient,
    colorA: renderState.colorA,
    colorB: renderState.colorB,
    colorBShare: renderState.colorBShare,
    colorGradient: renderState.colorGradient,
    dataLevel: renderState.dataLevel,
    dataPulse: renderState.dataPulse,
    fieldStrength: renderState.fieldStrength,
    fieldDensity: renderState.fieldDensity,
    fingerprint: easedFingerprint,
    flow: renderState.flow,
    includeBackground,
    loopProgress: renderState.loopProgress,
    maxSize: renderState.maxSize,
    meshRotationDeg: renderState.meshRotationDeg,
    modelZoom: renderState.modelZoom,
    milestone: renderState.milestone,
    outlineColor: renderState.outlineColor,
    outlineWidth: renderState.outlineWidth,
    patternAngleDeg: renderState.patternAngleDeg,
    rotationDeg: renderState.rotationDeg,
    sizeVariation: renderState.sizeVariation,
    glass,
    typography: renderState.typography,
    seed: getSeedForDataSource(renderState.dataSource) + renderState.seedOffset,
    shapeType: renderState.shapeType,
    showMarks: renderState.showMarks,
    showOutline: renderState.showOutline,
    spacing: renderState.spacing,
    speed: renderState.speed,
    variationDeg: renderState.variationDeg,
  });
  const render3dState = toRender3dState(renderState);

  // Smooth playback (2026-10-27): the timeline time reaches the canvas
  // through a React commit, and 11-19 % of the 3D frames were drawn before
  // that commit, repeating the previous time (then jumping twice as far).
  // The 3D scene asks for the state of each frame here instead: the last
  // committed time plus the time since it was committed, while playing.
  const frameSourceRef = React.useRef<EthFrameSource | null>(null);
  const committedTimeRef = React.useRef({ at: 0, time: Number.NaN });
  const timeline = state.timeline;

  React.useLayoutEffect(() => {
    if (committedTimeRef.current.time !== timeline.currentTimeSeconds) {
      committedTimeRef.current = { at: performance.now(), time: timeline.currentTimeSeconds };
    }
  });

  frameSourceRef.current = {
    stateAt: (nowMs) => {
      const committed = committedTimeRef.current;
      const durationSeconds = timeline.durationSeconds;

      if (!timeline.isPlaying || durationSeconds <= 0 || !Number.isFinite(committed.time)) {
        return render3dState;
      }

      // At most a few frames ahead: a stalled clock (scrub, hover pause)
      // must not run away.
      const ahead = Math.min(MAX_FRAME_EXTRAPOLATION_MS, Math.max(0, nowMs - committed.at)) / 1000;
      const progress =
        getToolcraftTimelineLoopTime({ currentTimeSeconds: committed.time + ahead, durationSeconds }) / durationSeconds;

      return toRender3dState(readEthDiamondRenderState(state.values, progress, form, durationSeconds));
    },
  };

  return (
    <div data-toolcraft-product-output="" ref={productRef} style={{ height: "100%", position: "relative", width: "100%" }}>
      <div
        data-eth-layer="scene-3d"
        style={{ height: "100%", left: 0, position: "absolute", top: 0, width: "100%" }}
      >
        <EthDiamond3dCanvas
          cssHeight={cssHeight}
          cssWidth={cssWidth}
          frameSourceRef={frameSourceRef}
          hoverEnabled={fingerprint !== null}
          renderState={render3dState}
        />
      </div>
      {fingerprint ? <EthFingerprintTooltip cssWidth={cssWidth} fingerprint={fingerprint} /> : null}
      <canvas
        aria-hidden="true"
        data-eth-layer="transition"
        ref={transitionOverlayRef}
        style={{ height: "100%", left: 0, pointerEvents: "none", position: "absolute", top: 0, width: "100%" }}
      />
    </div>
  );
}

/** Hover text (2026-10-13): the date of the band under the pointer, the
 * data's value then, and a milestone in that band. Written straight to the
 * DOM, at most once per frame: a React update per pointer move made React
 * flush the whole app (the controls panel too) a second time each frame. */
function EthFingerprintTooltip({
  cssWidth,
  fingerprint,
}: {
  cssWidth: number;
  fingerprint: EthFingerprint;
}): React.JSX.Element {
  const elementRef = React.useRef<HTMLDivElement | null>(null);
  const latestRef = React.useRef({ cssWidth, fingerprint });

  latestRef.current = { cssWidth, fingerprint };

  React.useEffect(() => {
    let frame = 0;
    let shownText = "";

    const apply = (): void => {
      frame = 0;

      const element = elementRef.current;
      const point = ethDataHover.get();

      if (!element) {
        return;
      }

      if (!point) {
        element.style.display = "none";
        shownText = "";

        return;
      }

      const reading = readEthFingerprint(latestRef.current.fingerprint, point.fromBase);
      const lines = [reading.date, ...reading.values, ...(reading.milestone ? [reading.milestone] : [])];
      const text = lines.join("|");

      if (text !== shownText) {
        element.replaceChildren(
          ...lines.map((line, index) => {
            const row = document.createElement("div");

            row.textContent = line;
            row.style.opacity = index === 0 ? "0.6" : index === lines.length - 1 && reading.milestone ? "0.85" : "1";

            return row;
          }),
        );
        shownText = text;
      }

      // Beside the pointer, flipped to its left near the right edge.
      const flip = point.x > latestRef.current.cssWidth - 240;

      element.style.display = "block";
      element.style.left = `${point.x + (flip ? -14 : 14)}px`;
      element.style.top = `${point.y - 14}px`;
      element.style.transform = `translate(${flip ? "-100%" : "0"}, -100%)`;
    };
    const unsubscribe = ethDataHover.subscribe(() => {
      frame ||= requestAnimationFrame(apply);
    });

    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      data-eth-layer="fingerprint-tooltip"
      ref={elementRef}
      style={{
        background: "rgba(11, 11, 16, 0.86)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        borderRadius: 6,
        color: "#f4f3ff",
        display: "none",
        font: "500 12px/1.45 ui-sans-serif, system-ui, sans-serif",
        padding: "6px 9px",
        pointerEvents: "none",
        position: "absolute",
        whiteSpace: "nowrap",
      }}
    />
  );
}
