/**
 * Facet buffers for the 3D dithering post-process, both in the model's own
 * frame (the frame `syncEthModelFrame` is given: the rotating model group),
 * so marks can be laid out on each facet's plane and stay attached to the
 * surface while the model rotates.
 *
 * Facet normal: the GLB's crown and pavilion share vertices between faces
 * (19 vertices for 8 triangles), so their stored vertex normals are averaged
 * and interpolate smoothly across each face. Sampling those made the
 * shader's facet seed, cell size and rotation drift per pixel, which sheared
 * every shape into diagonal bands. The normal is therefore derived from
 * screen-space derivatives of the position (the true geometric face normal,
 * constant per triangle) and the stored normals are ignored.
 */
import * as THREE from "three";

/** Most hull points the Glass shader reads (the GLB's hull has far fewer). */
export const ETH_GLASS_HULL_MAX = 16;

/** Shared by both pass materials and `EthDitherEffect`, updated in place
 * once per frame by `syncEthModelFrame`. */
export const ethModelFrameUniforms = {
  uBoundsMax: new THREE.Uniform(new THREE.Vector3(1, 1, 1)),
  uBoundsMin: new THREE.Uniform(new THREE.Vector3(0, 0, 0)),
  uModelToScreen: new THREE.Uniform(1),
  uModelToWorldRot: new THREE.Uniform(new THREE.Matrix3()),
  /** Model and world rotations into the camera's view space (Glass:
   * refraction offsets and glare follow the orbiting camera). */
  uModelToViewRot: new THREE.Uniform(new THREE.Matrix3()),
  uWorldToViewRot: new THREE.Uniform(new THREE.Matrix3()),
  uWorldToModel: new THREE.Uniform(new THREE.Matrix4()),
  /** Glass: the gem's silhouette on screen, the convex hull of its projected
   * vertices (counterclockwise, canvas uv with y up), plus its centroid (uv)
   * and inradius (fraction of canvas height). The shader turns it into an
   * exact distance to the edge, the liquid-glass lens shape. */
  uGlassHull: new THREE.Uniform(Array.from({ length: ETH_GLASS_HULL_MAX }, () => new THREE.Vector2())),
  uGlassHullCenter: new THREE.Uniform(new THREE.Vector2(0.5, 0.5)),
  uGlassHullCount: new THREE.Uniform(0),
  uGlassHullInradius: new THREE.Uniform(0.1),
  /** Farthest hull point from the centroid (canvas-height units): the
   * shadow is skipped beyond it. */
  uGlassHullOuterRadius: new THREE.Uniform(1),
};

const modelPositionVertexShader = /* glsl */ `
  uniform mat4 uWorldToModel;
  varying vec3 vEthModelPosition;
  void main() {
    vEthModelPosition = (uWorldToModel * modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const facetNormalMaterial = new THREE.ShaderMaterial({
  fragmentShader: /* glsl */ `
    varying vec3 vEthModelPosition;
    void main() {
      vec3 faceNormal = normalize(cross(dFdx(vEthModelPosition), dFdy(vEthModelPosition)));
      gl_FragColor = vec4(faceNormal * 0.5 + 0.5, 1.0);
    }
  `,
  uniforms: { uWorldToModel: ethModelFrameUniforms.uWorldToModel },
  vertexShader: modelPositionVertexShader,
});

const modelBoundsScratch = new THREE.Box3();
const meshBoundsScratch = new THREE.Box3();
const meshToModelScratch = new THREE.Matrix4();
const boundsCenterScratch = new THREE.Vector3();
const modelToViewScratch = new THREE.Matrix4();
const vertexScratch = new THREE.Vector3();
const projectedScratch: Array<[number, number]> = [];

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrew's monotone chain: the convex hull, counterclockwise. */
function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Array<[number, number]> = [];
  const upper: Array<[number, number]> = [];

  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Projects every visible mesh vertex and stores the silhouette hull in the
 * Glass uniforms. Points are aspect-corrected (x times the aspect) so the
 * hull, centroid and inradius are measured in canvas-height units. */
function syncEthGlassHull(root: THREE.Object3D, camera: THREE.PerspectiveCamera): void {
  const aspect = camera.aspect > 0 ? camera.aspect : 16 / 9;

  projectedScratch.length = 0;
  // traverseVisible: meshes under a hidden (decorative) group stay out.
  root.traverseVisible((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible || child.layers.mask !== 1) {
      return;
    }

    const position = child.geometry.getAttribute("position");

    if (!position) {
      return;
    }

    for (let index = 0; index < position.count; index += 1) {
      vertexScratch.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld).project(camera);

      if (vertexScratch.z < 1) {
        projectedScratch.push([(vertexScratch.x * 0.5 + 0.5) * aspect, vertexScratch.y * 0.5 + 0.5]);
      }
    }
  });

  let hull = projectedScratch.length >= 3 ? convexHull(projectedScratch) : [];

  if (hull.length > ETH_GLASS_HULL_MAX) {
    const step = hull.length / ETH_GLASS_HULL_MAX;
    const full = hull;

    hull = Array.from({ length: ETH_GLASS_HULL_MAX }, (_, index) => full[Math.floor(index * step)]!);
  }

  ethModelFrameUniforms.uGlassHullCount.value = hull.length >= 3 ? hull.length : 0;

  if (hull.length < 3) {
    return;
  }

  let centerX = 0;
  let centerY = 0;

  hull.forEach(([x, y]) => {
    centerX += x / hull.length;
    centerY += y / hull.length;
  });

  let inradius = Infinity;

  hull.forEach((point, index) => {
    const next = hull[(index + 1) % hull.length]!;
    const edgeX = next[0] - point[0];
    const edgeY = next[1] - point[1];
    const edgeLength = Math.hypot(edgeX, edgeY);

    if (edgeLength > 1e-6) {
      inradius = Math.min(inradius, Math.abs(edgeX * (centerY - point[1]) - edgeY * (centerX - point[0])) / edgeLength);
    }
  });

  ethModelFrameUniforms.uGlassHullOuterRadius.value = hull.reduce(
    (farthest, [x, y]) => Math.max(farthest, Math.hypot(x - centerX, y - centerY)),
    0,
  );

  const points = ethModelFrameUniforms.uGlassHull.value as THREE.Vector2[];

  hull.forEach(([x, y], index) => points[index]!.set(x / aspect, y));
  (ethModelFrameUniforms.uGlassHullCenter.value as THREE.Vector2).set(centerX / aspect, centerY);
  ethModelFrameUniforms.uGlassHullInradius.value = Number.isFinite(inradius) ? Math.max(0.005, inradius) : 0.1;
}

/** Call every frame before the facet passes. Reads `root`'s current world
 * transform (Shape rotation), the model-space bounds of its visible meshes,
 * and the camera distance, so `uModelToScreen` maps model units to the same
 * fraction-of-canvas-height units the dither grid uses. A frontal facet
 * therefore keeps the mark size it had in screen space. */
export function syncEthModelFrame(root: THREE.Object3D, camera: THREE.PerspectiveCamera): void {
  root.updateWorldMatrix(true, true);

  const worldToModel = ethModelFrameUniforms.uWorldToModel.value as THREE.Matrix4;

  worldToModel.copy(root.matrixWorld).invert();
  (ethModelFrameUniforms.uModelToWorldRot.value as THREE.Matrix3).setFromMatrix4(root.matrixWorld);
  camera.updateMatrixWorld();
  (ethModelFrameUniforms.uWorldToViewRot.value as THREE.Matrix3).setFromMatrix4(camera.matrixWorldInverse);
  modelToViewScratch.multiplyMatrices(camera.matrixWorldInverse, root.matrixWorld);
  (ethModelFrameUniforms.uModelToViewRot.value as THREE.Matrix3).setFromMatrix4(modelToViewScratch);

  modelBoundsScratch.makeEmpty();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible || child.layers.mask !== 1) {
      return;
    }

    if (!child.geometry.boundingBox) {
      child.geometry.computeBoundingBox();
    }

    meshToModelScratch.multiplyMatrices(worldToModel, child.matrixWorld);
    meshBoundsScratch.copy(child.geometry.boundingBox!).applyMatrix4(meshToModelScratch);
    modelBoundsScratch.union(meshBoundsScratch);
  });

  if (modelBoundsScratch.isEmpty()) {
    return;
  }

  (ethModelFrameUniforms.uBoundsMin.value as THREE.Vector3).copy(modelBoundsScratch.min);
  (ethModelFrameUniforms.uBoundsMax.value as THREE.Vector3).copy(modelBoundsScratch.max);

  modelBoundsScratch.getCenter(boundsCenterScratch).applyMatrix4(root.matrixWorld);

  const distance = Math.max(1e-4, camera.position.distanceTo(boundsCenterScratch));

  ethModelFrameUniforms.uModelToScreen.value = 1 / (2 * distance * Math.tan((camera.fov * Math.PI) / 360));

  syncEthGlassHull(root, camera);
}

/** Same root cause as the facet buffer above: the shared-vertex normals give
 * the beauty pass smooth lighting, so luminance (which drives mark size)
 * also drifts inside a facet. Flat shading lights each facet with one value.
 * Materials are shared between the live scene and the export clone, so this
 * only flags `needsUpdate` on the first change. */
export function applyEthFlatShading(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((material) => {
      if ("flatShading" in material && material.flatShading !== true) {
        material.flatShading = true;
        material.needsUpdate = true;
      }
    });
  });
}

export function createEthFacetNormalTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    depthBuffer: true,
    stencilBuffer: false,
  });
}

/** Renders only the default layer (0) — the outline overlay's own layer is
 * excluded automatically since the camera isn't switched to see it here —
 * so the facet buffer reflects the lit model geometry only. */
export function renderEthFacetNormalPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
): void {
  const previousOverrideMaterial = scene.overrideMaterial;
  const previousTarget = renderer.getRenderTarget();

  scene.overrideMaterial = facetNormalMaterial;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousTarget);
  scene.overrideMaterial = previousOverrideMaterial;
}

/** Model-space position buffer (raw units, float target). The dither shader
 * projects it onto each facet's plane to lay out the mark grid on the
 * surface, and normalizes it with `uBoundsMin`/`uBoundsMax` for the
 * volumetric animation phases. Kept as its own target rather than packed
 * into the facet normal buffer: that buffer's alpha carries the silhouette
 * signal the mask pipeline depends on. */
const volumePositionMaterial = new THREE.ShaderMaterial({
  fragmentShader: /* glsl */ `
    varying vec3 vEthModelPosition;
    void main() {
      gl_FragColor = vec4(vEthModelPosition, 1.0);
    }
  `,
  uniforms: { uWorldToModel: ethModelFrameUniforms.uWorldToModel },
  vertexShader: modelPositionVertexShader,
});

export function createEthVolumePositionTarget(width: number, height: number): THREE.WebGLRenderTarget {
  // Float + nearest: 8-bit positions step visibly across a facet, and float
  // textures are not linearly filterable everywhere.
  return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    depthBuffer: true,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    stencilBuffer: false,
    type: THREE.FloatType,
  });
}

export function renderEthVolumePositionPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
): void {
  const previousOverrideMaterial = scene.overrideMaterial;
  const previousTarget = renderer.getRenderTarget();

  scene.overrideMaterial = volumePositionMaterial;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousTarget);
  scene.overrideMaterial = previousOverrideMaterial;
}
