/**
 * Facet-edge outline overlay for 3D render mode, mirroring the 2D renderer's
 * "Show outline" stroke (`drawEthDiamondOutline` — configurable color/width)
 * but applied per-facet, since the loaded gem is one mesh tree, not a single
 * flat silhouette path. Each mesh gets its own edge-line child built from
 * `EdgesGeometry`, so the outline automatically follows that facet's own
 * transform (including the live "Shape rotation" control) without any extra
 * bookkeeping.
 *
 * Uses three.js's "fat lines" addon (`LineSegments2`/`LineMaterial`) instead
 * of plain `THREE.LineSegments`: standard `LineBasicMaterial.linewidth` is
 * ignored by almost every WebGL implementation (a long-standing platform
 * limitation, not a three.js bug), so an adjustable width control needs the
 * screen-space fat-line technique to actually render at more than 1px.
 */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

const ETH_OUTLINE_USER_DATA_KEY = "ethOutlineEdges";

/** The dithering post-process replaces the entire beauty-pass render with a
 * sparse grid of discrete marks, so a thin edge line baked into the lit
 * scene gets diluted away almost everywhere (a 1px line rarely lands inside
 * a dot's sample point). Edges are put on a dedicated layer instead, kept
 * out of the dithered `RenderPass` entirely (cameras only see layer 0 by
 * default) and drawn as a separate, un-dithered overlay pass afterward — see
 * `renderEthOutlineOverlay`. */
export const ETH_OUTLINE_LAYER = 1;

export type EthOutlineStyle = {
  color: string;
  widthPx: number;
};

/** True for the GLB's small decorative highlight-strip and corner-accent
 * meshes ("crown_edges_seg_0", "pavilion_edges_bead_2", ...) — but NOT for
 * the "..._bead_tip" meshes. Those turned out not to be decorative trim:
 * hiding them (this function originally matched any name containing
 * "_edges") left the pavilion's own body mesh with a flat, open cut instead
 * of a point — the tip bead is the cap that actually closes the shape off,
 * not an accent layered on top of an already-complete point. */
function isEthDecorativeAccentMesh(name: string): boolean {
  return name.includes("_edges") && !name.endsWith("_bead_tip");
}

/** The GLB carries ~24 small decorative meshes alongside the two main facet
 * bodies ("crown"/"pavilion") — thin edge-highlight strips and corner "bead"
 * accents named like "crown_edges_seg_0" / "pavilion_edges_bead_2". Their
 * dense, non-planar geometry reads as an unwanted crosshatched "mask" once
 * dithered, so they're hidden from the render entirely rather than just
 * excluded from the outline (excluding them from the outline alone left them
 * fully visible in the beauty pass, which was the actual source of the
 * covering artifact — the outline was never the only place they showed up).
 * The "..._bead_tip" caps are deliberately kept visible — see
 * `isEthDecorativeAccentMesh`. Idempotent: safe to call on every render. */
export function hideEthDecorativeMeshes(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && !(child instanceof LineSegments2) && isEthDecorativeAccentMesh(child.name)) {
      child.visible = false;
    }
  });
}

/** Idempotent: re-running against the same mesh tree (e.g. every render)
 * reuses the previously created `LineSegments2` instead of stacking
 * duplicate geometry, since `useGLTF`'s cached scene graph is shared across
 * mounts, while still applying the latest color/width/resolution. */
export function collectOrCreateEthOutlineEdges(
  root: THREE.Object3D,
  style: EthOutlineStyle,
  resolutionWidthPx: number,
  resolutionHeightPx: number,
): LineSegments2[] {
  const edges: LineSegments2[] = [];

  root.traverse((child) => {
    // `LineSegments2` (the fat-line class used for the edge overlay itself)
    // extends `THREE.Mesh`, so without this guard, adding one as a child
    // mid-traversal makes `Object3D.traverse` walk straight into it (it
    // re-reads `this.children` after the callback that just pushed the new
    // child), and this same callback would then build an edge-of-the-edge,
    // recursing without end — a real "Maximum call stack size exceeded"
    // crash hit in production, not a hypothetical.
    if (!(child instanceof THREE.Mesh) || child instanceof LineSegments2) {
      return;
    }

    // The GLB includes ~26 small decorative meshes alongside the two main
    // facet bodies ("crown"/"pavilion") — thin edge-highlight strips and
    // corner "bead" accents named like "crown_edges_seg_0" and
    // "pavilion_edges_bead_tip". Outlining those too (their own dense,
    // non-planar geometry) produced a crosshatched/masked look layered over
    // the main diamond outline. Only the two main body meshes should get the
    // facet-edge outline.
    if (child.name.includes("_edges")) {
      return;
    }

    let edgeLine = child.userData[ETH_OUTLINE_USER_DATA_KEY] as LineSegments2 | undefined;

    if (!edgeLine) {
      const sourceEdges = new THREE.EdgesGeometry(child.geometry, 1);
      const geometry = new LineSegmentsGeometry();

      geometry.setPositions(sourceEdges.attributes.position!.array as Float32Array);
      sourceEdges.dispose();

      const material = new LineMaterial({ depthTest: false, depthWrite: false, transparent: true });

      edgeLine = new LineSegments2(geometry, material);
      edgeLine.layers.set(ETH_OUTLINE_LAYER);
      child.add(edgeLine);
      child.userData[ETH_OUTLINE_USER_DATA_KEY] = edgeLine;
    }

    const material = edgeLine.material as LineMaterial;

    material.color.set(style.color);
    material.linewidth = style.widthPx;
    material.resolution.set(Math.max(1, resolutionWidthPx), Math.max(1, resolutionHeightPx));

    edges.push(edgeLine);
  });

  return edges;
}

/** Renders only `ETH_OUTLINE_LAYER` objects directly on top of whatever is
 * already in the renderer's current target (the dithered frame), bypassing
 * the `EffectComposer`/dithering shader entirely. Must run after the main
 * composer render each frame. */
export function renderEthOutlineOverlay(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  const previousMask = camera.layers.mask;
  const previousAutoClear = renderer.autoClear;

  renderer.autoClear = false;
  camera.layers.set(ETH_OUTLINE_LAYER);
  renderer.render(scene, camera);
  camera.layers.mask = previousMask;
  renderer.autoClear = previousAutoClear;
}
