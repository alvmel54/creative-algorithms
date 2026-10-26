import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  type VideoCodec,
} from "mediabunny";

import type { ToolcraftAppComposition, ToolcraftPanelActionContext } from "@/toolcraft/runtime/react";
import {
  createToolcraftPngExportCanvas,
  getToolcraftVideoExportSize,
  shouldIncludeToolcraftPreviewBackground,
  type ToolcraftImageExportResolution,
  type ToolcraftVideoExportResolution,
} from "@/toolcraft/runtime";

import { appControlRenderers } from "./control-renderers";
import { resolveEthFieldDensity, resolveEthFieldStrength } from "./eth-background-field";
import { resolveEthBackgroundGradient } from "./eth-background-gradient";
import { resolveEthMilestoneRender } from "./eth-diamond-shading";
import { resolveEthTypographyRender } from "./eth-typography";
import { requestEthViewCenter } from "./eth-view-center";
import { resolveEthGlass } from "./eth-glass";
import { createEthGifEncoder, ETH_GIF_FPS, getEthGifSize } from "./eth-gif-export";
import { EthDiamondCanvas } from "./eth-diamond-canvas";
import {
  applyEthFormAmount,
  applyEthFormSize,
  ethDataFeed,
  resolveEthForm,
  resolveEthMotion,
  resolveEthPeriod,
} from "./eth-data-feed";
import { getSeedForDataSource, resolveEthColor, type EthDataSourceType, type EthShapeType } from "./eth-diamond-shading";
import {
  createEthDiamond3dExportSession,
  loadEthDiamondModelForExport,
  renderEthDiamond3dFrame,
} from "./eth-diamond-3d-export";
import type { EthDiamond3dRenderState } from "./eth-diamond-3d-shared";
import { appSchema } from "./app-schema";

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type EthVideoContainer = {
  codec: VideoCodec;
  extension: string;
  format: Mp4OutputFormat | WebMOutputFormat;
};

/** Picks the first container + codec this browser can actually encode at
 * `width`x`height`, preferring the requested format and falling back to the
 * other one. */
async function pickVideoContainer(preferMp4: boolean, width: number, height: number): Promise<EthVideoContainer> {
  const containers = [
    {
      codecs: ["avc", "hevc", "vp9", "av1"] as VideoCodec[],
      extension: "mp4",
      makeFormat: () => new Mp4OutputFormat({ fastStart: "in-memory" }),
    },
    { codecs: ["vp9", "vp8", "av1"] as VideoCodec[], extension: "webm", makeFormat: () => new WebMOutputFormat() },
  ];
  const ordered = preferMp4 ? containers : [...containers].reverse();

  for (const container of ordered) {
    const codec = await getFirstEncodableVideoCodec(container.codecs, { height, quality: QUALITY_HIGH, width });

    if (codec) {
      return { codec, extension: container.extension, format: container.makeFormat() };
    }
  }

  throw new Error("This browser cannot encode MP4 or WebM video.");
}

function readLoopProgress(state: ToolcraftPanelActionContext["state"]): number {
  return state.timeline.durationSeconds > 0
    ? (state.timeline.currentTimeSeconds % state.timeline.durationSeconds) / state.timeline.durationSeconds
    : 0;
}

function read3dRenderState(
  state: ToolcraftPanelActionContext["state"],
  backgroundColor: string,
  includeBackground: boolean,
  timelineProgress: number,
  outputHeight: number,
): EthDiamond3dRenderState {
  const { dataLevel, dataPulse, loopProgress, milestone, milestoneText, physics } = resolveEthMotion(
    state.values,
    timelineProgress,
    { durationSeconds: state.timeline.durationSeconds },
  );
  const milestoneRender = resolveEthMilestoneRender(state.values, milestone);
  const form = resolveEthForm(state.values, ethDataFeed.getFormSignals());
  // Outline width is in canvas px (like the live preview); the export renders
  // at its own pixel size, so scale it or a 4K export draws a hairline.
  const outlineScale = outputHeight / Math.max(1, state.canvas.size.height);

  return {
    amount: applyEthFormAmount(Number(state.values["geometry.amount"] ?? 250), form),
    animation: physics.animation,
    backgroundColor,
    // The shader draws the gradient only when the background is included.
    backgroundGradient: resolveEthBackgroundGradient(state.values),
    colorA: resolveEthColor(state.values["geometry.colorA"], "#7c5cff"),
    colorB: resolveEthColor(state.values["geometry.colorB"], "#7c5cff"),
    colorBShare: form.colorBShare,
    colorGradient: Boolean(state.values["geometry.colorGradient"] ?? false),
    dataLevel,
    dataPulse,
    // The shader draws the field only when the background is included.
    fieldStrength: resolveEthFieldStrength(state.values),
    fieldDensity: resolveEthFieldDensity(state.values),
    fingerprint:
      ethDataFeed.getFingerprint(
        (state.values["dataSource.type"] as EthDataSourceType) ?? "mix",
        resolveEthPeriod(state.values),
      )?.values ?? null,
    flow: physics.flow,
    includeBackground,
    loopProgress,
    maxSize: applyEthFormSize(Number(state.values["geometry.size"] ?? 5), form),
    meshRotationDeg: Number(state.values["geometry.meshRotation"] ?? 0),
    modelZoom: Number(state.values["geometry.modelZoom"] ?? 55) / 100,
    milestone: milestoneRender,
    outlineColor: resolveEthColor(state.values["geometry.outlineColor"], "#ffffff"),
    outlineWidth: Number(state.values["geometry.outlineWidth"] ?? 2) * outlineScale,
    patternAngleDeg: Number(state.values["geometry.patternAngle"] ?? 0),
    rotationDeg: Number(state.values["geometry.rotation"] ?? 45),
    sizeVariation: Number(state.values["geometry.sizeVariation"] ?? 0) / 100,
    glass: resolveEthGlass(state.values),
    seed:
      getSeedForDataSource((state.values["dataSource.type"] as EthDataSourceType) ?? "eth-price") +
      Number(state.values["dataSource.seed"] ?? 0),
    shapeType: (state.values["geometry.shapeType"] as EthShapeType) ?? "dot",
    showOutline: Boolean(state.values["geometry.showOutline"] ?? true),
    spacing: Number(state.values["geometry.spacing"] ?? 20),
    speed: physics.speed,
    // The shader draws the typography only when the background is included.
    typography: resolveEthTypographyRender(state.values, milestoneText),
    variationDeg: physics.variationDeg,
  };
}

async function exportEthDiamondPng(context: ToolcraftPanelActionContext): Promise<void> {
  const { state } = context;
  const resolution = String(state.values["export.image.resolution"] ?? "4k") as
    | ToolcraftImageExportResolution
    | string;
  const format = String(state.values["export.image.format"] ?? "png");
  const backgroundColor = resolveEthColor(state.values["scene.background"], "#0b0b10");

  // The GLB scene must be ready before the PNG helper's synchronous `render`
  // callback runs; the export path caches its own GLTFLoader load (separate
  // from the live preview's `useGLTF` cache) and awaits it here.
  const model3d = await loadEthDiamondModelForExport();

  const canvas = createToolcraftPngExportCanvas({
    background: backgroundColor,
    // Without this the helper falls back to the schema's fixed PNG
    // background setting and ignores the Include switch.
    includeBackground: shouldIncludeToolcraftPreviewBackground({ state }),
    render: ({ context: exportContext, cssHeight, cssWidth, includeBackground, pixelHeight, pixelWidth }) => {
      const offscreenCanvas = document.createElement("canvas");

      renderEthDiamond3dFrame(
        offscreenCanvas,
        pixelWidth,
        pixelHeight,
        model3d,
        read3dRenderState(state, backgroundColor, includeBackground, readLoopProgress(state), pixelHeight),
      );
      exportContext.drawImage(offscreenCanvas, 0, 0, cssWidth, cssHeight);
    },
    resolution,
    state,
  });

  const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.95));

  if (blob) {
    triggerBlobDownload(blob, `eth-diamond-${resolution}.${format === "jpg" ? "jpg" : "png"}`);
  }
}

async function exportEthDiamondVideo({
  reportProgress,
  state,
}: ToolcraftPanelActionContext): Promise<void> {
  const videoFormat = String(state.values["export.video.format"] ?? "mp4");
  const isGif = videoFormat === "gif";

  if (isGif ? typeof VideoFrame === "undefined" : typeof VideoEncoder === "undefined") {
    throw new Error(
      isGif
        ? "GIF export needs WebCodecs (VideoFrame), which this browser does not support."
        : "Video export needs WebCodecs (VideoEncoder), which this browser does not support.",
    );
  }

  const resolution = String(state.values["export.video.resolution"] ?? "current") as
    | ToolcraftVideoExportResolution
    | string;
  // GIF ignores Resolution: it always exports 720 px wide (see eth-gif-export.ts).
  const size = isGif
    ? getEthGifSize(state.canvas.size.width, state.canvas.size.height)
    : getToolcraftVideoExportSize({ resolution, state });
  const preferMp4 = videoFormat === "mp4";
  const backgroundColor = resolveEthColor(state.values["scene.background"], "#0b0b10");
  // Rendered straight into this canvas through its own WebGL session (the
  // post-processed dithering pass included).
  const canvas = document.createElement("canvas");

  canvas.width = size.width;
  canvas.height = size.height;

  const model3d = await loadEthDiamondModelForExport();

  const durationSeconds = Math.max(1, state.timeline.durationSeconds);
  const fps = isGif ? ETH_GIF_FPS : 30;
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  const frameDuration = durationSeconds / totalFrames;

  // One WebGL session reused across every frame (see
  // `createEthDiamond3dExportSession`'s doc comment): constructing a fresh
  // `WebGLRenderer` per frame would exhaust the browser's live context budget.
  const session3d = createEthDiamond3dExportSession(canvas, size.width, size.height, model3d);

  const drawFrame = (timelineProgress: number): void => {
    session3d.renderFrame(read3dRenderState(state, backgroundColor, true, timelineProgress, size.height));
  };

  if (isGif) {
    const gif = createEthGifEncoder(size.width, size.height, fps);

    try {
      for (let frame = 0; frame < totalFrames; frame += 1) {
        // frame / totalFrames never reaches 1, so the GIF loops seamlessly.
        drawFrame(frame / totalFrames);
        await gif.addFrame(canvas);
        reportProgress((frame + 1) / totalFrames);
      }
    } finally {
      session3d.dispose();
    }

    triggerBlobDownload(gif.finish(), "eth-diamond.gif");
    return;
  }

  // Offline encode: every frame gets its timeline timestamp (frame / fps), so
  // the file lasts exactly the timeline duration however long each render
  // takes. The previous captureStream + MediaRecorder path stamped frames
  // with wall-clock time; renders slower than 33 ms stretched an 8 s
  // timeline into a 50-60 s slow-motion video.
  const container = await pickVideoContainer(preferMp4, size.width, size.height);
  const target = new BufferTarget();
  const output = new Output({ format: container.format, target });
  const source = new CanvasSource(canvas, { codec: container.codec, quality: QUALITY_HIGH });

  output.addVideoTrack(source, { frameRate: fps });

  try {
    await output.start();

    for (let frame = 0; frame < totalFrames; frame += 1) {
      // frame / totalFrames never reaches 1, so the last frame leads straight
      // back into the first and the video loops seamlessly.
      drawFrame(frame / totalFrames);
      await source.add(frame * frameDuration, frameDuration);
      reportProgress((frame + 1) / totalFrames);
    }

    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    session3d.dispose();
  }

  if (!target.buffer || target.buffer.byteLength === 0) {
    throw new Error("Video export produced an empty file.");
  }

  triggerBlobDownload(new Blob([target.buffer], { type: container.format.mimeType }), `eth-diamond.${container.extension}`);
}

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <EthDiamondCanvas />,
  controlRenderers: appControlRenderers,
  onPanelAction: async (context) => {
    const { action, dispatch } = context;

    switch (action.value) {
      case "center-view": {
        requestEthViewCenter();
        return;
      }

      case "shuffle": {
        dispatch({
          label: "Shuffle pattern",
          target: "dataSource.seed",
          type: "controls.setValue",
          value: Math.floor(Math.random() * 100000),
        });
        return;
      }

      case "export-png": {
        await exportEthDiamondPng(context);
        return;
      }

      case "export-video": {
        await exportEthDiamondVideo(context);
        return;
      }

      default:
        return;
    }
  },
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
