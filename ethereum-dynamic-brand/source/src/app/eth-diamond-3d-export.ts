/**
 * Offscreen (non-React) three.js render path for 3D-mode PNG/video export.
 * Runs a real WebGLRenderer + `postprocessing` EffectComposer at the exact
 * requested export resolution, independent of the live preview's on-screen
 * canvas size, then hands the resulting WebGL canvas back so the caller can
 * `drawImage` it into `createToolcraftPngExportCanvas` (PNG) or encode it
 * frame by frame with timeline timestamps (video, see app-composition).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer, EffectPass, RenderPass } from "postprocessing";

import { buildDitherEffectParams, EthDitherEffect } from "./eth-dither-effect";
import {
  applyEthFlatShading,
  createEthFacetNormalTarget,
  createEthVolumePositionTarget,
  renderEthFacetNormalPass,
  renderEthVolumePositionPass,
  syncEthModelFrame,
} from "./eth-diamond-3d-facets";
import {
  collectOrCreateEthOutlineEdges,
  hideEthDecorativeMeshes,
  renderEthOutlineOverlay,
} from "./eth-diamond-3d-outline";
import { ethLiveCameraHandle, type EthDiamond3dRenderState } from "./eth-diamond-3d-shared";

const MODEL_URL = `${import.meta.env.BASE_URL}models/ethereum-holo.glb`;

let cachedModelPromise: Promise<THREE.Object3D> | null = null;

/** Loads (and caches) the GLB once. The live preview loads it separately
 * through `useGLTF`/drei's own cache; this export path uses a plain
 * `GLTFLoader` so it can render synchronously-enough inside the
 * `createToolcraftPngExportCanvas` `render` callback once pre-warmed. */
export function loadEthDiamondModelForExport(): Promise<THREE.Object3D> {
  if (!cachedModelPromise) {
    const loader = new GLTFLoader();

    cachedModelPromise = loader.loadAsync(MODEL_URL).then((gltf) => gltf.scene);
  }

  return cachedModelPromise;
}

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  margin = 1.15,
): { center: THREE.Vector3; distance: number } {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fitDistance = (maxDim * margin) / (2 * Math.tan((camera.fov * Math.PI) / 360));

  // See the matching correction in `eth-diamond-3d-scene.tsx` for the
  // empirical basis (~10% upward bias observed across multiple screenshots,
  // independent of the DOM/CSS wrapper) — kept in sync here so exported
  // PNG/video frames match the live-preview framing.
  const verticalCorrection = size.y * 0.01;
  const target = new THREE.Vector3(center.x, center.y + verticalCorrection, center.z);

  camera.position.set(target.x, target.y, target.z + fitDistance);
  camera.near = Math.max(0.01, fitDistance / 100);
  camera.far = fitDistance * 100;
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  return { center: target, distance: fitDistance };
}

export type EthDiamond3dExportSession = {
  dispose: () => void;
  renderFrame: (renderState: EthDiamond3dRenderState) => void;
};

/**
 * Builds one reusable WebGLRenderer + EffectComposer session at a fixed
 * `width`x`height`. PNG export uses it for a single frame; video export
 * reuses the same session across every recorded frame instead of
 * constructing a fresh `WebGLRenderer` per frame — repeated
 * construction/disposal on the same canvas can exhaust the browser's live
 * WebGL-context budget well before a multi-second recording finishes.
 */
export function createEthDiamond3dExportSession(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  modelScene: THREE.Object3D,
): EthDiamond3dExportSession {
  const scene = new THREE.Scene();
  const modelClone = modelScene.clone(true);

  hideEthDecorativeMeshes(modelClone);
  applyEthFlatShading(modelClone);
  scene.add(modelClone);

  const facetNormalTarget = createEthFacetNormalTarget(width, height);
  const volumePositionTarget = createEthVolumePositionTarget(width, height);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const directional = new THREE.DirectionalLight(0xffffff, 2.4);

  directional.position.set(3.2, 4.2, 5);

  const fillLight = new THREE.DirectionalLight(0x7c5cff, 0.4);

  fillLight.position.set(-3, -2, -4);
  scene.add(ambient, directional, fillLight);

  const camera = new THREE.PerspectiveCamera(35, width / Math.max(1, height), 0.1, 100);

  const fit = fitCameraToObject(camera, modelClone);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    preserveDrawingBuffer: true,
  });

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const effect = new EthDitherEffect(
    buildDitherEffectParams({
      amount: 250,
      animation: "none",
      backgroundColorHex: "#0b0b10",
      colorAHex: "#ffffff",
      colorBHex: "#7c5cff",
      colorBShare: 0.5,
      colorGradient: false,
      dataPulse: 0,
      flow: 0.8,
      height,
      includeBackground: true,
      loopProgress: 0,
      maxSize: 5,
      rotationDeg: 45,
      seed: 0,
      shapeType: "dot",
      spacing: 20,
      speed: 0.5,
      variationDeg: 120,
      width,
    }),
    facetNormalTarget.texture,
    volumePositionTarget.texture,
  );

  composer.addPass(new EffectPass(camera, effect));
  composer.setSize(width, height);

  return {
    dispose: () => {
      composer.dispose();
      renderer.dispose();
      facetNormalTarget.dispose();
      volumePositionTarget.dispose();
      modelClone.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
        }
      });
    },
    renderFrame: (renderState) => {
      modelClone.rotation.y = (renderState.meshRotationDeg * Math.PI) / 180;
      collectOrCreateEthOutlineEdges(
        modelClone,
        { color: renderState.outlineColor, widthPx: renderState.outlineWidth },
        width,
        height,
      ).forEach((edge) => {
        edge.visible = renderState.showOutline;
      });
      const liveCamera = ethLiveCameraHandle.current;

      if (liveCamera) {
        camera.position.copy(liveCamera.position);
        camera.quaternion.copy(liveCamera.quaternion);
        camera.updateMatrixWorld();
      } else {
        // No live view to copy: the fitted front view at the chosen zoom.
        camera.position.set(fit.center.x, fit.center.y, fit.center.z + fit.distance / Math.max(0.05, renderState.modelZoom));
        camera.lookAt(fit.center);
        camera.updateMatrixWorld();
      }

      syncEthModelFrame(modelClone, camera);
      renderEthFacetNormalPass(renderer, scene, camera, facetNormalTarget);
      renderEthVolumePositionPass(renderer, scene, camera, volumePositionTarget);
      effect.updateParams(
        buildDitherEffectParams({
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
          spacing: renderState.spacing,
          speed: renderState.speed,
          variationDeg: renderState.variationDeg,
          width,
        }),
      );
      composer.render();
      renderEthOutlineOverlay(renderer, scene, camera);
    },
  };
}

/** One-shot helper for PNG export: builds a session, renders exactly one
 * frame, and disposes it immediately. */
export function renderEthDiamond3dFrame(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  modelScene: THREE.Object3D,
  renderState: EthDiamond3dRenderState,
): void {
  const session = createEthDiamond3dExportSession(canvas, width, height, modelScene);

  session.renderFrame(renderState);
  session.dispose();
}
