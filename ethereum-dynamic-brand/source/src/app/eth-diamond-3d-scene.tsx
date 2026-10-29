"use client";

import * as React from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import { buildDitherEffectParams, EthDitherEffect, type EthDitherEffectParams } from "./eth-dither-effect";
import { onEthViewCenter } from "./eth-view-center";
import { ethDataHover } from "./eth-data-hover";
import {
  applyEthFlatShading,
  createEthFacetNormalTarget,
  createEthVolumePositionTarget,
  ethModelFrameUniforms,
  renderEthFacetNormalPass,
  renderEthVolumePositionPass,
  syncEthModelFrame,
} from "./eth-diamond-3d-facets";
import {
  collectOrCreateEthOutlineEdges,
  hideEthDecorativeMeshes,
  renderEthOutlineOverlay,
  type EthOutlineStyle,
} from "./eth-diamond-3d-outline";
import { ethLiveCameraHandle, type EthDiamond3dRenderState, type EthFrameSource } from "./eth-diamond-3d-shared";

const MODEL_URL = `${import.meta.env.BASE_URL}models/ethereum-holo.glb`;

/** Must be a stable reference, not an inline object literal in JSX: R3F
 * shallow-compares the `camera` prop against its previous value on every
 * render to decide whether to re-apply it to the actual camera instance. An
 * object (and especially the nested `position` array) recreated every render
 * never compares equal to its predecessor, so R3F kept re-applying this
 * default `position` and silently undoing `fitCameraToObject`'s imperative
 * framing on every re-render — which happens continuously while the timeline
 * plays. That was the real cause of the 3D view rendering far smaller/more
 * inconsistently sized than the 2D view. */
const initialCameraConfig = { fov: 35, near: 0.1, position: [0, 0, 5] as [number, number, number] };

/** The dither effect is constructed once and its uniforms are updated in
 * place. The `EffectComposer` child must also stay the same element:
 * `@react-three/postprocessing` rebuilds its EffectPass (re-processing the
 * whole shader text, uniform by uniform) whenever its `children` change, and
 * an element carrying per-frame params changed on every timeline tick. */
function useEthDitherEffect(
  params: EthDitherEffectParams,
  facetNormalTexture: THREE.Texture,
  volumePositionTexture: THREE.Texture,
): { effect: EthDitherEffect; element: React.JSX.Element } {
  const effect = React.useMemo(
    () => new EthDitherEffect(params, facetNormalTexture, volumePositionTexture),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const element = React.useMemo(() => <primitive dispose={null} object={effect} />, [effect]);

  return { effect, element };
}

function toDitherEffectParams(renderState: EthDiamond3dRenderState, width: number, height: number): EthDitherEffectParams {
  return buildDitherEffectParams({
    amount: renderState.amount,
    animation: renderState.animation,
    backgroundColorHex: renderState.backgroundColor,
    backgroundGradient: renderState.backgroundGradient,
    colorAHex: renderState.colorA,
    colorBHex: renderState.colorB,
    colorBShare: renderState.colorBShare,
    colorGradient: renderState.colorGradient,
    dataLevel: renderState.dataLevel,
    dataPulse: renderState.dataPulse,
    fieldStrength: renderState.fieldStrength,
    fieldDensity: renderState.fieldDensity,
    fingerprint: renderState.fingerprint,
    flow: renderState.flow,
    height,
    includeBackground: renderState.includeBackground,
    loopProgress: renderState.loopProgress,
    maxSize: renderState.maxSize,
    milestone: renderState.milestone,
    typography: renderState.typography,
    rotationDeg: renderState.rotationDeg,
    patternAngleDeg: renderState.patternAngleDeg,
    sizeVariation: renderState.sizeVariation,
    glass: renderState.glass,
    seed: renderState.seed,
    shapeType: renderState.shapeType,
    showMarks: renderState.showMarks,
    spacing: renderState.spacing,
    speed: renderState.speed,
    variationDeg: renderState.variationDeg,
    width,
  });
}

/** Updates the effect for every frame just before the composer draws it
 * (priority 1), from the frame source's state at this frame's time, so
 * playback advances on every frame even when the timeline's React commit is
 * late. Without a source, the committed state is used. */
function EthDitherFrameUpdate({
  cssHeight,
  cssWidth,
  effect,
  frameSourceRef,
  renderState,
}: {
  cssHeight: number;
  cssWidth: number;
  effect: EthDitherEffect;
  frameSourceRef?: React.RefObject<EthFrameSource | null>;
  renderState: EthDiamond3dRenderState;
}): null {
  const latestRef = React.useRef({ cssHeight, cssWidth, renderState });

  latestRef.current = { cssHeight, cssWidth, renderState };

  useFrame(() => {
    const latest = latestRef.current;
    const frameState = frameSourceRef?.current?.stateAt(performance.now()) ?? latest.renderState;

    effect.updateParams(toDitherEffectParams(frameState, latest.cssWidth, latest.cssHeight));
  }, 0.5);

  return null;
}

export type EthCameraFit = {
  center: THREE.Vector3;
  distance: number;
};

/** Fits the camera to `object` and returns the center/distance it used.
 * Callers that also drive `OrbitControls` need this same center as the
 * controls' orbit `target` — without it, `OrbitControls` orbits around its
 * default `(0,0,0)` instead of the model's actual center, which is what
 * caused the reported "object drifts / doesn't stay in frame" bug: the
 * controls fought `camera.lookAt(center)` every frame and re-pointed the
 * camera at the origin instead.
 *
 * `margin` default is empirically calibrated, not derived from the pinhole
 * geometry alone: this session's browser-automation tab cannot actually run
 * the R3F/WebGL render loop (confirmed separately — a debug value written
 * inside this function's caller never appeared even after the model
 * finished loading), so the fit could not be measured directly here. Two
 * screenshots from the user at different margins (1.7 and 1.35) both landed
 * at ~71% of this formula's naive vertical-FOV prediction, a consistent
 * ratio — so this value was solved from that ratio to target the 2D
 * renderer's ~74% frame-height fill, rather than re-derived from first
 * principles. If a real geometric cause (rather than an empirical
 * correction) is later found, replace this fudge-adjusted default with the
 * corrected formula. */
function fitCameraToObject(camera: THREE.PerspectiveCamera, object: THREE.Object3D, margin = 1.15): EthCameraFit {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fitDistance = (maxDim * margin) / (2 * Math.tan((camera.fov * Math.PI) / 360));

  // Empirically calibrated, same basis as `margin` above: the raw `Box3`
  // center consistently renders ~10% of the frame height too high (measured
  // from three separate user screenshots — the same upward bias persisted
  // across different margin values and after ruling out a DOM/CSS wrapper
  // positioning cause, so it is a property of this camera-fit math or the
  // model itself, not layout). Aiming the camera slightly higher than the
  // raw center shifts the rendered image down by the same amount, since
  // increasing the look-at target's Y moves everything else lower in frame.
  const verticalCorrection = size.y * 0.01;
  const target = new THREE.Vector3(center.x, center.y + verticalCorrection, center.z);

  camera.position.set(target.x, target.y, target.z + fitDistance);
  camera.near = Math.max(0.01, fitDistance / 100);
  camera.far = fitDistance * 100;
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  return { center: target, distance: fitDistance };
}

type EthHoverHit = { fromBase: number; point: THREE.Vector3; x: number; y: number };

/** The front-most visible mesh hit in the model's own space, with its
 * height on the gem (0 base .. 1 tip, model bounds), or null. Outline lines
 * and hidden accent meshes are skipped. */
function getEthHoverHit(event: ThreeEvent<PointerEvent>): EthHoverHit | null {
  const isShown = (object: THREE.Object3D): boolean => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) {
        return false;
      }
    }

    return true;
  };
  const hit = event.intersections.find(
    (intersection) =>
      intersection.object instanceof THREE.Mesh &&
      !(intersection.object instanceof LineSegments2) &&
      intersection.object.layers.mask === 1 &&
      isShown(intersection.object),
  );

  if (!hit) {
    return null;
  }

  const local = hit.point.clone().applyMatrix4(ethModelFrameUniforms.uWorldToModel.value as THREE.Matrix4);
  const min = ethModelFrameUniforms.uBoundsMin.value as THREE.Vector3;
  const max = ethModelFrameUniforms.uBoundsMax.value as THREE.Vector3;

  return {
    fromBase: Math.min(1, Math.max(0, (local.y - min.y) / Math.max(1e-6, max.y - min.y))),
    point: local,
    x: event.nativeEvent.offsetX,
    y: event.nativeEvent.offsetY,
  };
}

function EthDiamondModel({
  cssHeight,
  cssWidth,
  meshRotationDeg,
  onFit,
  onHover,
  outlineStyle,
  showOutline,
}: {
  cssHeight: number;
  cssWidth: number;
  meshRotationDeg: number;
  onFit: (fit: EthCameraFit) => void;
  /** Data fingerprint hover; undefined turns it off. */
  onHover?: (hover: EthHoverHit | null) => void;
  outlineStyle: EthOutlineStyle;
  showOutline: boolean;
}): React.JSX.Element {
  const { scene } = useGLTF(MODEL_URL);
  const groupRef = React.useRef<THREE.Group>(null);
  const { camera } = useThree();
  const onFitRef = React.useRef(onFit);

  onFitRef.current = onFit;

  React.useEffect(() => {
    hideEthDecorativeMeshes(scene);
    applyEthFlatShading(scene);

    if (groupRef.current && camera instanceof THREE.PerspectiveCamera) {
      onFitRef.current(fitCameraToObject(camera, groupRef.current));
    }
    // Fit once per loaded model; the group's own rotation never changes the
    // model's world-space bounding size (a diamond is rotationally
    // near-symmetric around Y), so re-fitting on every rotation tick is
    // unnecessary and would fight a user actively dragging the slider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera]);

  // Before the facet passes (priority 0): they and the dither effect read
  // the model frame (Shape rotation, bounds, camera distance, the Glass
  // silhouette) every frame. -0.5 runs after OrbitControls' own update (-1),
  // so the silhouette matches this frame's camera instead of lagging one
  // frame behind the gem while orbiting.
  useFrame(() => {
    if (groupRef.current && camera instanceof THREE.PerspectiveCamera) {
      syncEthModelFrame(groupRef.current, camera);
    }
  }, -0.5);

  React.useEffect(() => {
    const edges = collectOrCreateEthOutlineEdges(scene, outlineStyle, cssWidth, cssHeight);

    edges.forEach((edge) => {
      edge.visible = showOutline;
    });
  }, [scene, showOutline, outlineStyle, cssWidth, cssHeight]);

  return (
    <group
      onPointerMove={
        onHover
          ? (event) => {
              // No reading while dragging (orbiting).
              onHover(event.nativeEvent.buttons > 0 ? null : getEthHoverHit(event));
            }
          : undefined
      }
      onPointerOut={onHover ? () => onHover(null) : undefined}
      ref={groupRef}
      rotation={[0, (meshRotationDeg * Math.PI) / 180, 0]}
    >
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);

/** Draws the facet-edge outline (layer `ETH_OUTLINE_LAYER`) directly on top
 * of the already-dithered frame. Registered at a render priority after
 * `EffectComposer`'s own (default 1), so R3F calls it once the composer has
 * finished writing the dithered image for this frame. */
function EthOutlineOverlayPass(): null {
  const { gl, scene, camera } = useThree();

  useFrame(() => {
    renderEthOutlineOverlay(gl, scene, camera);
  }, 2);

  return null;
}

/** Renders a world-space facet-normal buffer into `target` before the main
 * dithered composer pass runs each frame (priority 0, ahead of
 * `EffectComposer`'s default priority 1), so `EthDitherEffect` can sample
 * this frame's up-to-date facet identity/lighting. */
function EthFacetNormalPass({ target }: { target: THREE.WebGLRenderTarget }): null {
  const { gl, scene, camera } = useThree();

  useFrame(() => {
    renderEthFacetNormalPass(gl, scene, camera, target);
  }, 0);

  return null;
}

/** Renders the volumetric-position buffer (see `eth-diamond-3d-facets.ts`)
 * at the same priority as the facet-normal pass — both are cheap
 * override-material passes that just need to land before `EffectComposer`
 * (priority 1) reads them. */
function EthVolumePositionPass({ target }: { target: THREE.WebGLRenderTarget }): null {
  const { gl, scene, camera } = useThree();

  useFrame(() => {
    renderEthVolumePositionPass(gl, scene, camera, target);
  }, 0);

  return null;
}

/**
 * Root cause (confirmed with exact pixel measurements in a real, foregrounded
 * browser tab — see the agent worklog): `react-use-measure` (which powers
 * R3F's `resize` prop) always measures via `getBoundingClientRect()`, which
 * includes every ancestor CSS transform — including the outer viewport's
 * zoom (`[data-toolcraft-canvas-world]`, `scale(zoom/100)`). R3F then applies
 * that already-zoomed measurement as the canvas's own explicit CSS
 * `width`/`height`, but the canvas is *itself* still a descendant of that
 * same zoom transform, so the browser paints the already-shrunk CSS box
 * shrunk again — compounding to zoom² instead of zoom. Because
 * `useThree().size` (and therefore `EffectComposer`'s internal buffers,
 * `camera.aspect`, and this file's own facet-normal/dither-effect sizing)
 * all derive from that same contaminated measurement, the mismatch reaches
 * far beyond just the canvas's own CSS box.
 *
 * A prior attempt just forced the canvas's CSS box to `100%`/`100%` (a pure
 * CSS percentage, matching how the 2D canvases avoid this bug entirely).
 * That alone was insufficient: it corrected the *painted* box, but left the
 * WebGL backing store resolution and `camera.aspect` still driven by the
 * old, contaminated measurement, so rendered content no longer matched the
 * now-correctly-sized frame (reported as content overflowing the canvas).
 *
 * This component drives all three from one shared, zoom-independent
 * measurement instead: `cssWidth`/`cssHeight`, the same
 * `state.canvas.size` value the 2D canvases already use (passed down from
 * `EthDiamondCanvas`, never derived from any DOM measurement of this
 * component's own subtree). It marks the camera `manual` so R3F's own
 * resize-driven `updateCamera` never fights it, and installs a
 * `MutationObserver` on the canvas's `style` attribute as a safety net: if
 * `react-use-measure` reasserts a contaminated size later (e.g. on a window
 * resize), this immediately re-applies the correct one.
 *
 * Calls `onReady` after the first correction lands. `EthDiamondSceneContents`
 * uses that to delay mounting `EffectComposer` — `EffectComposer` builds its
 * own internal render targets from `useThree().size`, which starts at
 * `{width:0, height:0}` before `react-use-measure`'s first real measurement
 * arrives. Mounting it against that zero size and then resizing later left
 * it producing a fully blank frame (confirmed by pixel-sampling the canvas —
 * every sampled region read 0 for R/G/B/A — while the equivalent direct
 * `gl.render(scene, camera)` with no composer involved rendered correctly).
 * Delaying the mount until the true size is already active avoids ever
 * constructing it against a degenerate size in the first place. */
function EthCanvasSizeSync({
  cssHeight,
  cssWidth,
  onReady,
}: {
  cssHeight: number;
  cssWidth: number;
  onReady: () => void;
}): null {
  const { camera, get, gl, setSize } = useThree();
  const onReadyRef = React.useRef(onReady);

  onReadyRef.current = onReady;

  React.useLayoutEffect(() => {
    const width = Math.max(1, cssWidth);
    const height = Math.max(1, cssHeight);

    const applyTrueSize = (): void => {
      const canvas = gl.domElement;
      const pixelRatio = gl.getPixelRatio();

      // Skip when nothing actually changed: re-assigning canvas.width (even
      // to the same value) clears the drawing buffer and the composer
      // reallocates its targets.
      const stateSize = get().size;

      if (
        stateSize.width === width &&
        stateSize.height === height &&
        canvas.style.width === `${width}px` &&
        canvas.style.height === `${height}px` &&
        canvas.width === Math.floor(width * pixelRatio) &&
        canvas.height === Math.floor(height * pixelRatio)
      ) {
        onReadyRef.current();

        return;
      }

      setSize(width, height);
      gl.setSize(width, height, true);

      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }

      onReadyRef.current();
    };

    applyTrueSize();

    const observer = new MutationObserver(applyTrueSize);

    observer.observe(gl.domElement, { attributeFilter: ["style"], attributes: true });

    return () => {
      observer.disconnect();
    };
  }, [camera, cssHeight, cssWidth, get, gl, setSize]);

  return null;
}

function EthDiamondSceneContents({
  cssHeight,
  cssWidth,
  frameSourceRef,
  hoverEnabled,
  renderState,
}: {
  cssHeight: number;
  cssWidth: number;
  frameSourceRef?: React.RefObject<EthFrameSource | null>;
  hoverEnabled: boolean;
  renderState: EthDiamond3dRenderState;
}): React.JSX.Element {
  const { camera } = useThree();
  const effectRef = React.useRef<EthDitherEffect | null>(null);
  // Data fingerprint hover: the shader lights the band, the tooltip reads
  // the store. Straight to the effect's uniforms, no React render.
  const handleHover = React.useCallback((hover: EthHoverHit | null) => {
    const min = ethModelFrameUniforms.uBoundsMin.value as THREE.Vector3;
    const max = ethModelFrameUniforms.uBoundsMax.value as THREE.Vector3;

    // The lit spot spans about a fifth of the gem's height.
    effectRef.current?.setHover(hover ? { point: hover.point, radius: 0.1 * (max.y - min.y) } : null);
    ethDataHover.set(hover ? { fromBase: hover.fromBase, x: hover.x, y: hover.y } : null);
  }, []);

  React.useEffect(() => {
    if (!hoverEnabled) {
      handleHover(null);
    }
  }, [handleHover, hoverEnabled]);
  const facetNormalTargetRef = React.useRef<THREE.WebGLRenderTarget | null>(null);
  const volumePositionTargetRef = React.useRef<THREE.WebGLRenderTarget | null>(null);
  const cameraFitRef = React.useRef<EthCameraFit | null>(null);
  const [orbitTarget, setOrbitTarget] = React.useState<THREE.Vector3 | null>(null);
  const [isSizeReady, setIsSizeReady] = React.useState(false);

  if (!facetNormalTargetRef.current) {
    facetNormalTargetRef.current = createEthFacetNormalTarget(cssWidth, cssHeight);
  }

  if (!volumePositionTargetRef.current) {
    volumePositionTargetRef.current = createEthVolumePositionTarget(cssWidth, cssHeight);
  }

  const facetNormalTarget = facetNormalTargetRef.current;
  const volumePositionTarget = volumePositionTargetRef.current;

  const modelZoomRef = React.useRef(renderState.modelZoom);

  modelZoomRef.current = renderState.modelZoom;

  // Zoom moves the camera along its current direction to the fitted
  // distance divided by the zoom (also while orbiting); the background is
  // drawn in screen space, so it stays put. Exports copy this camera.
  const applyModelZoom = React.useCallback(() => {
    const fit = cameraFitRef.current;

    if (!fit || !(camera instanceof THREE.PerspectiveCamera)) {
      return;
    }

    const direction = camera.position.clone().sub(fit.center);

    if (direction.lengthSq() < 1e-12) {
      direction.set(0, 0, 1);
    }

    direction.setLength(fit.distance / Math.max(0.05, modelZoomRef.current));
    camera.position.copy(fit.center).add(direction);
    camera.updateMatrixWorld();
  }, [camera]);

  const handleModelFit = React.useCallback(
    (fit: EthCameraFit) => {
      cameraFitRef.current = fit;
      setOrbitTarget(fit.center.clone());
      applyModelZoom();
    },
    [applyModelZoom],
  );

  React.useEffect(() => {
    applyModelZoom();
  }, [applyModelZoom, renderState.modelZoom]);

  const handleSizeReady = React.useCallback(() => {
    setIsSizeReady(true);
  }, []);

  // Dragging always orbits the camera (OrbitControls below). Center view
  // (View > Rotation) snaps it back to the fitted front view at the current
  // zoom.
  const controls = useThree((three) => three.controls) as { update?: () => void } | null;

  React.useEffect(
    () =>
      onEthViewCenter(() => {
        if (!cameraFitRef.current || !(camera instanceof THREE.PerspectiveCamera)) {
          return;
        }

        const { center, distance } = cameraFitRef.current;

        camera.position.set(center.x, center.y, center.z + distance / Math.max(0.05, modelZoomRef.current));
        camera.up.set(0, 1, 0);
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        controls?.update?.();
      }),
    [camera, controls],
  );

  React.useEffect(() => {
    facetNormalTargetRef.current?.setSize(Math.max(1, cssWidth), Math.max(1, cssHeight));
    volumePositionTargetRef.current?.setSize(Math.max(1, cssWidth), Math.max(1, cssHeight));
  }, [cssWidth, cssHeight]);

  React.useEffect(() => {
    ethLiveCameraHandle.current = camera;

    return () => {
      if (ethLiveCameraHandle.current === camera) {
        ethLiveCameraHandle.current = null;
      }
    };
  }, [camera]);

  React.useEffect(() => {
    return () => {
      facetNormalTargetRef.current?.dispose();
      facetNormalTargetRef.current = null;
      volumePositionTargetRef.current?.dispose();
      volumePositionTargetRef.current = null;
    };
  }, []);

  // Initial params only: EthDitherFrameUpdate updates them every frame.
  const { effect: ditherEffect, element: ditherEffectElement } = useEthDitherEffect(
    toDitherEffectParams(renderState, cssWidth, cssHeight),
    facetNormalTarget.texture,
    volumePositionTarget.texture,
  );

  effectRef.current = ditherEffect;

  const outlineStyle: EthOutlineStyle = React.useMemo(
    () => ({ color: renderState.outlineColor, widthPx: renderState.outlineWidth }),
    [renderState.outlineColor, renderState.outlineWidth],
  );

  return (
    <>
      <EthCanvasSizeSync cssHeight={cssHeight} cssWidth={cssWidth} onReady={handleSizeReady} />
      <ambientLight intensity={0.55} />
      <directionalLight
        castShadow={false}
        intensity={2.4}
        position={[3.2, 4.2, 5]}
      />
      <directionalLight color="#7c5cff" intensity={0.4} position={[-3, -2, -4]} />
      <React.Suspense fallback={null}>
        <EthDiamondModel
          cssHeight={cssHeight}
          cssWidth={cssWidth}
          meshRotationDeg={renderState.meshRotationDeg}
          onFit={handleModelFit}
          onHover={hoverEnabled ? handleHover : undefined}
          outlineStyle={outlineStyle}
          showOutline={renderState.showOutline}
        />
      </React.Suspense>
      {isSizeReady && (
        <>
          <EthFacetNormalPass target={facetNormalTarget} />
          <EthVolumePositionPass target={volumePositionTarget} />
          <EthDitherFrameUpdate
            cssHeight={cssHeight}
            cssWidth={cssWidth}
            effect={ditherEffect}
            frameSourceRef={frameSourceRef}
            renderState={renderState}
          />
          <EffectComposer autoClear multisampling={0}>
            {ditherEffectElement}
          </EffectComposer>
        </>
      )}
      <EthOutlineOverlayPass />
      {orbitTarget ? (
        <OrbitControls enablePan={false} enableRotate enableZoom={false} makeDefault target={orbitTarget} />
      ) : null}
    </>
  );
}

export type EthDiamond3dCanvasProps = {
  cssHeight: number;
  cssWidth: number;
  /** Per-frame render state (smooth playback); see EthDitherFrameUpdate. */
  frameSourceRef?: React.RefObject<EthFrameSource | null>;
  /** Data fingerprint hover (a data drives the gem). */
  hoverEnabled: boolean;
  renderState: EthDiamond3dRenderState;
};

/** Live-preview 3D renderer mounted by `EthDiamondCanvas` when
 * `physics.renderMode === "3d"`. Uses a real WebGL renderer via React Three
 * Fiber so facet shading comes from the directional light against the GLB
 * mesh normals, then post-processes through `EthDitherEffect` for the
 * halftone look. `cssWidth`/`cssHeight` are `state.canvas.size` — the same
 * zoom-independent logical size the 2D canvases use — passed through so
 * `EthCanvasSizeSync` can drive the canvas's real size from it instead of
 * R3F's own (zoom-contaminated) measurement; see that component for why. */
export function EthDiamond3dCanvas({
  cssHeight,
  cssWidth,
  frameSourceRef,
  hoverEnabled,
  renderState,
}: EthDiamond3dCanvasProps): React.JSX.Element {
  return (
    <Canvas
      camera={initialCameraConfig}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      // R3F measures its parent's layout box via ResizeObserver on mount to
      // size the WebGL drawing buffer; when the parent's size settles a
      // frame after this Canvas mounts (as it does here — the wrapper's
      // "is3d" branch and this canvas mount in the same commit, inside a
      // zoom-scaled ancestor), the default debounce can leave the buffer
      // stuck at the browser's built-in 300x150 default. Zero debounce
      // forces an immediate re-measure instead of waiting. `EthCanvasSizeSync`
      // then immediately overrides whatever this measurement produces with
      // the correct, zoom-independent size — this prop just makes sure that
      // correction happens as promptly as possible rather than removing the
      // need for it.
      // offsetSize: measure with offsetWidth/offsetHeight, which ignore the
      // viewport's zoom transform. Measured with getBoundingClientRect, R3F
      // re-applied the zoomed size on every React render (each timeline
      // tick) and EthCanvasSizeSync set it back: two full 4K canvas and
      // composer resizes per render, which cleared the canvas and dragged
      // the frame rate down.
      resize={{ debounce: { resize: 0, scroll: 0 }, offsetSize: true, scroll: false }}
      style={{ height: "100%", width: "100%" }}
    >
      <EthDiamondSceneContents
        cssHeight={cssHeight}
        cssWidth={cssWidth}
        frameSourceRef={frameSourceRef}
        hoverEnabled={hoverEnabled}
        renderState={renderState}
      />
    </Canvas>
  );
}
