/**
 * Custom `postprocessing` Effect that reads the lit 3D render (already shaded
 * by the scene's directional light against the GLB mesh normals) and
 * thresholds it into the same halftone/dithering vocabulary as the 2D
 * renderer (`eth-diamond-shading.ts` / `eth-diamond-draw.ts`): a screen-space
 * grid of shapes (dot/circle/square/triangle/line/cross/mixed) whose size is
 * driven by per-pixel luminance (darker = larger mark, mirroring the 2D
 * "darkness" size curve), with density/size mapped from the same
 * Size/Amount/Spacing controls.
 *
 * This is intentionally new shader code, not a literal port of the Canvas 2D
 * draw routines: a fragment shader operates per-pixel on a screen-space grid,
 * not per discrete grid-cell object, so cell selection, jitter, and shape
 * masks are re-derived with GLSL-appropriate hashing/SDF math while keeping
 * the same semantic knobs (Size/Amount/Spacing/Rotation/animation).
 */
import { Effect } from "postprocessing";
import { CanvasTexture, Texture, Uniform, Vector2, Vector3 } from "three";

import { ETH_FINGERPRINT_SAMPLES } from "./eth-data-feed";
import { ethModelFrameUniforms } from "./eth-diamond-3d-facets";
import type { EthGlass } from "./eth-glass";
import { drawEthTypography, type EthTypographyRender } from "./eth-typography";
import { ETH_GRADIENT_MAX_STOPS, getEthGradientBreath, type EthBackgroundGradient } from "./eth-background-gradient";
import {
  computeDiamondGeometry,
  getCyclesPerLoop,
  getDitherCellSpacing,
  type EthAnimationMode,
  type EthMilestoneRender,
  type EthShapeType,
} from "./eth-diamond-shading";

const shapeTypeIndex: Record<Exclude<EthShapeType, "mixed">, number> = {
  circle: 1,
  cross: 5,
  diamond: 6,
  dot: 0,
  line: 4,
  square: 2,
  triangle: 3,
};

const animationModeIndex: Record<EthAnimationMode, number> = {
  drift: 4,
  flow: 8,
  fluid: 1,
  none: 0,
  orbit: 3,
  pulse: 2,
  ripple: 7,
  shimmer: 6,
  wave: 5,
};

const gradientTypeIndex: Record<EthBackgroundGradient["type"], number> = {
  angular: 3,
  diamond: 2,
  linear: 0,
  radial: 1,
};

const fragmentShader = /* glsl */ `
  // Loop bounds as uniforms (always 1 and 4): with constant bounds the
  // Direct3D compiler unrolled every loop and inlined the Field into each of
  // its six call sites, and compiling the shader froze the page for ~9 s.
  uniform int uCellReach;
  uniform int uFrostTaps;
  uniform float uCellSize;
  uniform float uMaxSize;
  uniform int uShapeType;
  uniform float uMixed;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uColorGradient;
  uniform float uIncludeBackground;
  uniform vec3 uBackgroundColor;
  uniform float uRotation;
  uniform float uPatternAngle;
  uniform float uSizeVariation;
  uniform int uAnimMode;
  uniform float uCycles;
  uniform float uFlow;
  uniform float uVariationRad;
  uniform float uLoopProgress;
  uniform float uDataPulse;
  uniform int uSeed;
  uniform float uColorBShare;
  uniform sampler2D tFacetNormal;
  uniform sampler2D tVolumePos;
  uniform vec3 uLightDir;
  uniform mat3 uModelToWorldRot;
  uniform mat3 uModelToViewRot;
  uniform mat3 uWorldToViewRot;
  uniform float uDataLevel;
  uniform float uGlassOn;
  uniform float uGlassRefraction;
  uniform float uGlassFisheye;
  uniform float uGlassFrost;
  uniform float uGlassTint;
  uniform float uGlassRim;
  uniform float uGlassGlow;
  uniform vec2 uGlassHull[16];
  uniform int uGlassHullCount;
  uniform vec2 uGlassHullCenter;
  uniform float uGlassHullInradius;
  uniform float uGlassHullOuterRadius;
  uniform float uModelToScreen;
  uniform vec3 uBoundsMin;
  uniform vec3 uBoundsMax;
  uniform float uFieldStrength;
  uniform float uFieldDensity;
  uniform float uAspect;
  uniform vec2 uFieldCenter;
  uniform vec2 uFieldSize;
  uniform int uGradType;
  uniform int uGradCount;
  uniform float uGradAngle;
  uniform float uGradScale;
  uniform float uGradPhase;
  uniform vec3 uGradColors[5];
  uniform float uGradAlphas[5];
  uniform float uGradPositions[5];
  uniform float uMilestoneFront;
  uniform float uMilestoneStrength;
  // The diamond's time and data (2026-10-13): the same values as the ones
  // above, frozen while the pointer reads the gem (the background, the Field
  // and the Story letters keep moving).
  uniform float uGemLoopProgress;
  uniform float uGemFlow;
  uniform float uGemDataPulse;
  uniform float uGemDataLevel;
  uniform float uGemMilestoneFront;
  uniform float uGemMilestoneStrength;
  uniform vec3 uMilestoneColor;
  uniform sampler2D tTypography;
  uniform float uTypographyOn;
  uniform float uFingerprint[${ETH_FINGERPRINT_SAMPLES}];
  uniform float uFingerprintOn;
  uniform float uHoverOn;
  uniform vec3 uHoverPoint;
  uniform float uHoverRadius;
  uniform float uTypographyOpacity;

  // Data fingerprint (2026-10-13): the data's level at a height of the gem
  // (0 base = the period's first day, 1 tip = today), between bin centers.
  float ethFingerprintAt(float t) {
    float position = clamp(t * ${ETH_FINGERPRINT_SAMPLES}.0 - 0.5, 0.0, ${ETH_FINGERPRINT_SAMPLES - 1}.0);
    int low = int(floor(position));
    int high = min(${ETH_FINGERPRINT_SAMPLES - 1}, low + 1);
    return mix(uFingerprint[low], uFingerprint[high], position - float(low));
  }

  // Hover: 1 on the marks around the pointer (a sphere in the model's own
  // space, so it follows the facets and the orbit), 0 away from it.
  float ethHoverSpot(vec3 modelPos) {
    return 1.0 - smoothstep(0.55 * uHoverRadius, uHoverRadius, length(modelPos - uHoverPoint));
  }

  // Wave radius tied to the pattern, same formula as getEthWaveRadius in
  // eth-diamond-shading.ts: outward-flowing streams are reached first and
  // each mark has its own small ignition delay.
  float ethWaveRadius(float radius, float align, float grain) {
    return radius * (1.0 - 0.25 * align) + (grain - 0.5) * 0.22;
  }

  // Milestone ring presence at a radius (0 center, 1 gem edge), same formula
  // as getEthMilestoneBand in eth-diamond-shading.ts.
  float ethMilestoneBandAt(float radius, float front, float strength) {
    if (strength <= 0.0) {
      return 0.0;
    }
    // Vibrant wave (2026-10-12): longer trail behind the front, 1.35x the
    // strength; same as getEthMilestoneBand.
    float offset = radius - front;
    float width = offset >= 0.0 ? 0.32 : 0.6;
    return min(1.0, (1.0 - smoothstep(0.0, width, abs(offset))) * strength * 1.35);
  }

  float ethMilestoneBand(float radius) {
    return ethMilestoneBandAt(radius, uMilestoneFront, uMilestoneStrength);
  }

  // The diamond's own copy of the wave: it holds still while the pointer
  // reads the gem, while the Field keeps moving.
  float ethGemMilestoneBand(float radius) {
    return ethMilestoneBandAt(radius, uGemMilestoneFront, uGemMilestoneStrength);
  }

  // Integer hash (pcg3d). The previous fract(sin-free) float hash scaled its
  // input by hundreds before fract(), so a one-ulp difference in GPU float
  // math (Direct3D does not guarantee bit-identical results frame to frame)
  // flipped the pattern seed, and every mark's offset, jitter and color
  // jumped for that frame: the 3D flicker. Integer inputs hash exactly.
  uvec3 ethPcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
  }

  // 0..1 hash of an integer cell, a salt (which value of the cell) and the
  // Pattern seed.
  float ethHash(ivec3 key, int salt) {
    uvec3 h = ethPcg3d(uvec3(key) ^ uvec3(uint(salt) * 0x9E3779B9u, uint(uSeed) * 0x85EBCA6Bu, uint(salt + uSeed) * 0xC2B2AE35u));
    return float(h.x >> 8u) / 16777216.0;
  }

  float ethSdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  // Flow field, same formula as ethFlowField in eth-diamond-shading.ts.
  vec3 ethFlowField(vec3 q, float t, float curl) {
    float f = 6.0;
    return vec3(
      0.25 + curl * sin(f * q.y * 1.3 + f * q.z + t),
      -1.0 + curl * 0.6 * sin(f * q.z * 1.1 + f * q.x * 0.9 - t + 1.7),
      curl * sin(f * q.x * 1.2 + f * q.y * 0.7 + t + 3.1)
    );
  }

  float ethShapeMask(int shape, vec2 pr, float size, float aa) {
    if (shape == 0) {
      return 1.0 - smoothstep(size * 0.5 - aa, size * 0.5, length(pr));
    }
    if (shape == 1) {
      // Ring line at least one pixel wide (aa is a pixel in this grid's
      // units): on facets turned away from the camera the line got thinner
      // than a pixel and Circle marks vanished from whole facets.
      float d = abs(length(pr) - size * 0.5);
      float halfLine = max(size * 0.12, aa);
      return 1.0 - smoothstep(halfLine - aa, halfLine, d);
    }
    if (shape == 2) {
      float sd = ethSdBox(pr, vec2(size * 0.5));
      return 1.0 - smoothstep(-aa, aa, sd);
    }
    if (shape == 3) {
      vec2 q = pr;
      q.y = -q.y;
      float half_ = size * 0.5;
      float k = sqrt(3.0);
      q.x = abs(q.x) - half_;
      q.y = q.y + half_ / k;
      if (q.x + k * q.y > 0.0) {
        q = vec2(q.x - k * q.y, -k * q.x - q.y) / 2.0;
      }
      q.x -= clamp(q.x, -2.0 * half_, 0.0);
      float sd = -length(q) * sign(q.y);
      return 1.0 - smoothstep(-aa, aa, sd);
    }
    if (shape == 4) {
      float thickness = max(aa * 1.5, size * 0.28);
      float inX = 1.0 - smoothstep(size * 0.5 - aa, size * 0.5, abs(pr.x));
      float inY = 1.0 - smoothstep(thickness * 0.5 - aa, thickness * 0.5, abs(pr.y));
      return inX * inY;
    }
    if (shape == 6) {
      // Small Ethereum glyph: a tall rhombus (half extents a, b).
      float a = size * 0.31;
      float b = size * 0.5;
      float d = (abs(pr.x) * b + abs(pr.y) * a - a * b) / length(vec2(a, b));
      return 1.0 - smoothstep(-aa, aa, d);
    }
    float thickness = max(aa * 1.5, size * 0.24);
    float horizX = 1.0 - smoothstep(size * 0.5 - aa, size * 0.5, abs(pr.x));
    float horizY = 1.0 - smoothstep(thickness * 0.5 - aa, thickness * 0.5, abs(pr.y));
    float vertX = 1.0 - smoothstep(thickness * 0.5 - aa, thickness * 0.5, abs(pr.x));
    float vertY = 1.0 - smoothstep(size * 0.5 - aa, size * 0.5, abs(pr.y));
    return max(horizX * horizY, vertX * vertY);
  }

  vec2 ethRotate(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  // Field background (blueprint 2026-10-08), same rules as
  // drawEthBackgroundField (eth-background-field.ts): the gem's own pattern
  // (Shape, grid density, colors) continues around it on a screen grid,
  // following the flow field in coordinates normalized to the diamond. Marks
  // travel along it, grow in and out at the ends, turn with the stream and
  // fade toward the edges. Position is in canvas-height units, y down.
  // Returns (mask, ring, ring color, Color B pick of the strongest mark).
  // One pixel in canvas-height units, set at the top of mainImage. The Field
  // is evaluated inside dynamic loops and branches (Glass, Frost), where
  // derivatives are undefined and made the compiler unroll.
  float ethPixel;

  vec4 ethBackgroundField(vec2 uv) {
    // Field density: more marks per row than the gem's grid, smaller marks.
    float cell = max(uCellSize / uFieldDensity, 1.0 / 100.0);
    vec2 pos = vec2(uv.x * uAspect, 1.0 - uv.y);
    // Pattern angle: the grid is turned about the canvas center.
    vec2 canvasCenter = vec2(uAspect * 0.5, 0.5);
    vec2 gridPos = canvasCenter + ethRotate(pos - canvasCenter, -uPatternAngle);
    vec2 base = floor(gridPos / cell);
    float cycles = uAnimMode == 0 ? 0.0 : uCycles;
    float t = cycles == 0.0 ? 0.0 : uLoopProgress * 6.28318530718;
    float pixel = ethPixel;
    float markSize = uMaxSize * 0.8 / sqrt(uFieldDensity);
    float ur = cos(uRotation);
    float us = sin(uRotation);
    float best = 0.0;
    float ringBest = 0.0;
    float ringColor = 0.0;
    float pickB = 0.0;

    for (int dy = -uCellReach; dy <= uCellReach; dy++) {
      for (int dx = -uCellReach; dx <= uCellReach; dx++) {
        vec2 c = base + vec2(float(dx), float(dy));
        ivec3 key = ivec3(ivec2(c), 9);
        vec2 latticeCenter = (c + 0.5) * cell + (vec2(ethHash(key, 10), ethHash(key, 11)) - 0.5) * cell * 0.25;
        vec2 center = canvasCenter + ethRotate(latticeCenter - canvasCenter, uPatternAngle);
        vec2 q = vec2((center.x - uFieldCenter.x) / uFieldSize.x, -(center.y - uFieldCenter.y) / uFieldSize.y);
        float radius = length(q);
        float falloff = 1.0 - 0.75 * smoothstep(0.5, 1.6, radius);
        vec3 stream = ethFlowField(vec3(q, 0.0), t, uFlow * 1.2);
        vec2 d = vec2(stream.x, -stream.y);
        if (radius > 0.0001) {
          d += vec2(q.y, q.x) / radius * uDataPulse * 1.5 * max(0.0, 1.0 - radius * 1.6);
        }
        d /= max(length(d), 0.0001);
        float along = q.x * d.x - q.y * d.y;
        float s = fract(uLoopProgress * cycles - along * 2.0 + ethHash(key, 12));
        float size = markSize * smoothstep(0.0, 0.1, s) * smoothstep(1.0, 0.9, s);
        size *= max(0.0, 1.0 + (ethHash(key, 16) - 0.5) * 2.0 * uSizeVariation);
        // Ring tied to the pattern: this mark's stream and ignition delay.
        vec2 outward = center - uFieldCenter;
        float outLength = max(length(outward), 0.00001);
        float band = ethMilestoneBand(ethWaveRadius(outLength / (uFieldSize.y * 0.5), dot(d, outward / outLength), ethHash(key, 14)));
        size *= 1.0 + 0.55 * band;
        vec2 p = pos - (center + d * cell * 0.45 * (s - 0.5));
        int shape = uMixed > 0.5 ? int(floor(ethHash(key, 13) * 7.0)) % 7 : uShapeType;
        vec2 aligned = shape == 4
          ? vec2(dot(p, d), dot(p, vec2(-d.y, d.x)))
          : vec2(dot(p, vec2(-d.y, d.x)), -dot(p, d));
        vec2 pr = vec2(aligned.x * ur - aligned.y * us, aligned.x * us + aligned.y * ur);
        float m = size <= 0.0005 ? 0.0 : ethShapeMask(shape, pr, size, pixel);
        if (m * falloff > best) {
          best = m * falloff;
          // Same A/B share as the gem's marks.
          pickB = step(1.0 - uColorBShare, ethHash(key, 15));
        }
        if (m * band > ringBest) {
          ringBest = m * band;
          ringColor = band;
        }
      }
    }

    return vec4(best, ringBest, ringColor, pickB);
  }

  // Gradient background (blueprint 2026-10-08), same math as
  // getEthGradientT / sampleEthGradient in eth-background-gradient.ts, in
  // canvas-height units with y down. Returns gamma-space color and opacity.
  vec4 ethBackgroundGradient(vec2 uv) {
    vec2 size = vec2(uAspect, 1.0);
    vec2 delta = vec2(uv.x * uAspect, 1.0 - uv.y) - size * 0.5;
    float t;
    if (uGradType == 0) {
      float lineLength = max(abs(size.x * sin(uGradAngle)) + abs(size.y * cos(uGradAngle)), 0.0001);
      t = 0.5 + (delta.x * sin(uGradAngle) - delta.y * cos(uGradAngle)) / lineLength / uGradScale;
    } else if (uGradType == 1) {
      t = length(delta) / length(size * 0.5) / uGradScale;
    } else if (uGradType == 2) {
      t = (abs(delta.x) / (size.x * 0.5) + abs(delta.y) / (size.y * 0.5)) / uGradScale;
    } else {
      t = fract(atan(delta.x, -delta.y) / 6.28318530718 - 0.25 + uGradPhase);
    }

    vec4 color = vec4(uGradColors[0], uGradAlphas[0]);
    for (int i = 1; i < uGradCount; i++) {
      float a = uGradPositions[i - 1];
      float b = uGradPositions[i];
      float k = clamp((t - a) / max(b - a, 0.00001), 0.0, 1.0);
      if (t > a) {
        color = mix(vec4(uGradColors[i - 1], uGradAlphas[i - 1]), vec4(uGradColors[i], uGradAlphas[i]), k);
      }
    }
    return color;
  }

  // The whole background at a screen position, in gamma space: color, then
  // the gradient, then the Field (weighted by cover, the share not covered
  // by the mesh: 1 outside it and for glass samples) and the typography.
  vec3 ethBackgroundGamma(vec2 p, float cover) {
    // The field is part of the background: only with Include on.
    vec4 fieldSample = uFieldStrength > 0.0 && uIncludeBackground > 0.5 && cover > 0.001
      ? ethBackgroundField(p)
      : vec4(0.0);
    // A milestone ring adds opacity and its color to the field marks it
    // crosses.
    float field = min(1.0, fieldSample.x * cover * uFieldStrength + fieldSample.y * cover * 0.5);
    // Blend in gamma space like the 2D canvas; a linear-space mix made the
    // same Strength read much brighter in 3D.
    vec3 baseGamma = pow(uBackgroundColor, vec3(1.0 / 2.2));
    if (uGradCount > 0 && uIncludeBackground > 0.5) {
      // Gradient stops sit over the background color by their opacity.
      vec4 gradient = ethBackgroundGradient(p);
      baseGamma = mix(baseGamma, gradient.rgb, gradient.a);
    }
    // The field takes the gem's colors: A or B per mark, or the gradient
    // (Color A at the top, like the 2D renderer).
    vec3 gradientAt = mix(uColorA, uColorB, clamp(1.0 - p.y + uColorBShare - 0.5, 0.0, 1.0));
    vec3 fieldMarkColor = uColorGradient > 0.5 ? gradientAt : mix(uColorA, uColorB, fieldSample.w);
    vec3 fieldColorGamma = mix(pow(fieldMarkColor, vec3(1.0 / 2.2)), pow(uMilestoneColor, vec3(1.0 / 2.2)), fieldSample.z);
    vec3 backgroundGamma = mix(baseGamma, fieldColorGamma, field);
    if (uTypographyOn > 0.5 && uIncludeBackground > 0.5) {
      // Big typography over the field, behind the mesh (drawn by
      // drawEthTypography into tTypography; canvas colors are gamma).
      vec4 typography = textureLod(tTypography, p, 0.0);
      backgroundGamma = mix(backgroundGamma, typography.rgb, typography.a * cover * uTypographyOpacity);
    }
    return backgroundGamma;
  }

  // Glass: signed distance (canvas-height units, negative inside) to the
  // gem's silhouette hull, at a point given in the same units.
  float ethGlassSdf(vec2 q) {
    vec2 toHeight = vec2(uAspect, 1.0);
    vec2 first = uGlassHull[0] * toHeight - q;
    float d = dot(first, first);
    float s = 1.0;
    for (int i = 0; i < uGlassHullCount; i++) {
      int j = i == 0 ? uGlassHullCount - 1 : i - 1;
      vec2 vi = uGlassHull[i] * toHeight;
      vec2 vj = uGlassHull[j] * toHeight;
      vec2 e = vj - vi;
      vec2 w = q - vi;
      vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-10), 0.0, 1.0);
      d = min(d, dot(b, b));
      bvec3 c = bvec3(q.y >= vi.y, q.y < vj.y, e.x * w.y > e.y * w.x);
      if (all(c) || all(not(c))) {
        s *= -1.0;
      }
    }
    return s * sqrt(d);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // Facet identity and layout, both in the model's own frame (see
    // eth-diamond-3d-facets.ts). The facet normal is constant per facet, so
    // its quantized hash is a stable per-facet seed, and it stays the same
    // while the model rotates.
    vec3 facetNormal = normalize(texture2D(tFacetNormal, uv).rgb * 2.0 - 1.0);
    vec3 modelPos = texture2D(tVolumePos, uv).xyz;
    ivec3 facetKey = ivec3(floor(facetNormal * 6.0 + 0.5));
    // Pattern seed (Type of data + Shuffle) offsets every hash, so a new seed
    // re-deals grid offsets, jitter, per-facet rotation, colors and Mixed shapes.
    float facetSeed = ethHash(facetKey, 1);
    vec3 worldNormal = normalize(uModelToWorldRot * facetNormal);
    float facetLight = clamp(dot(worldNormal, uLightDir) * 0.5 + 0.5, 0.0, 1.0);

    // The mark grid lives on the facet's own plane: an orthonormal basis
    // (tangent pointing along the facet, bitangent "up" the facet) projects
    // the model-space position to 2D facet coordinates, scaled so a frontal
    // facet keeps the same mark size as the screen-space grid. Inclined
    // facets foreshorten their marks and the grid moves with the surface.
    vec3 basisHelper = abs(facetNormal.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 facetTangent = normalize(cross(basisHelper, facetNormal));
    vec3 facetBitangent = cross(facetNormal, facetTangent);
    vec2 facetCoord = vec2(dot(modelPos, facetTangent), dot(modelPos, facetBitangent)) * uModelToScreen;
    float facetDepth = dot(modelPos, facetNormal);

    float cellSize = uCellSize * mix(0.8, 1.25, 1.0 - facetLight);
    vec2 facetGridOffset = vec2(facetSeed, ethHash(facetKey, 7)) * cellSize;
    float twoPiCycles = uGemLoopProgress * uCycles * 6.28318530718;

    // Drift scrolls the whole facet grid down the facet (all facets in sync)
    // instead of wrapping each mark with fract(), which jumped. The scroll is
    // a whole number of cells per loop and per-cell hashes repeat with that
    // same period vertically, so the last frame matches the first.
    float driftCellsPerCycle = max(1.0, floor(uGemFlow * 2.0 + 0.5));
    float driftRows = driftCellsPerCycle * max(uCycles, 1.0);
    float scroll = uAnimMode == 4 ? uGemLoopProgress * uCycles * driftCellsPerCycle * cellSize : 0.0;

    // Pattern angle turns each facet's grid (and its marks with it).
    vec2 gridPos = ethRotate(facetCoord, -uPatternAngle) + facetGridOffset + vec2(0.0, scroll);
    vec2 baseCell = floor(gridPos / cellSize);

    // The gem's center on this facet's plane: Pulse moves marks toward and
    // away from it, like the 2D renderer breathing around the diamond center.
    vec3 gemCenter = (uBoundsMin + uBoundsMax) * 0.5;
    vec2 gemCenterFacet = ethRotate(vec2(dot(gemCenter, facetTangent), dot(gemCenter, facetBitangent)) * uModelToScreen, -uPatternAngle);

    float facetRotation = uRotation + (facetSeed - 0.5) * 3.14159265 * 0.6;
    float cr = cos(facetRotation);
    float sr = sin(facetRotation);

    float luminance = dot(inputColor.rgb, vec3(0.299, 0.587, 0.114));
    float darkness = clamp(1.0 - luminance, 0.0, 1.0);
    float baseSize = uMaxSize * (0.75 + 0.25 * darkness) * mix(0.85, 1.15, facetLight);

    // Edge softness of one real pixel, in facet-grid units. A fixed width was
    // as wide as a small mark, so most mark pixels never reached full opacity
    // and shapes read blurry in preview and PNG. Clamped because the facet
    // coordinate jumps across facet boundaries.
    float pixelUv = fwidth(uv.y);
    ethPixel = max(pixelUv, 0.00001);
    float aa = clamp(max(fwidth(facetCoord.x), fwidth(facetCoord.y)), pixelUv * 0.5, cellSize * 0.25);

    // Animated marks travel up to about one cell, so each fragment checks its
    // own cell and the 8 neighbors. Evaluating only its own cell clipped any
    // mark that moved across a cell edge (Orbit, Fluid, Wave looked broken).
    float mask = 0.0;
    ivec2 markCell = ivec2(baseCell);
    float markHover = 0.0;
    float markMilestone = 0.0;
    // Milestone ring in screen space, like the 2D renderer (distance from
    // the gem's center over half its height): the 3D surface sits far from
    // the volume center, so a volume radius reached it only as the wave
    // faded.
    vec2 screenFromCenter = vec2(uv.x * uAspect, 1.0 - uv.y) - uFieldCenter;
    float screenRadius = length(screenFromCenter) / (uFieldSize.y * 0.5);
    // Flow at this pixel (same field as the background) shapes the front.
    float milestoneAlign = 0.0;
    if (uGemMilestoneStrength > 0.0) {
      vec2 flowQ = vec2(screenFromCenter.x / uFieldSize.x, -screenFromCenter.y / uFieldSize.y);
      vec3 flowAt = ethFlowField(vec3(flowQ, 0.0), uAnimMode == 0 ? 0.0 : uGemLoopProgress * 6.28318530718, uGemFlow * 1.2);
      vec2 flowDir = normalize(vec2(flowAt.x, -flowAt.y) + vec2(0.00001));
      milestoneAlign = dot(flowDir, screenFromCenter / max(length(screenFromCenter), 0.00001));
    }
    float milestoneCell = ethGemMilestoneBand(ethWaveRadius(screenRadius, milestoneAlign, 0.5));

    // Marks only where the mesh covers the pixel (they are clipped by its
    // alpha below): most of the frame is background, and running the
    // 9-cell loop there was most of the shader's cost.
    if (inputColor.a > 0.001) {
      for (int dy = -uCellReach; dy <= uCellReach; dy++) {
        for (int dx = -uCellReach; dx <= uCellReach; dx++) {
          vec2 cell = baseCell + vec2(float(dx), float(dy));
          ivec2 icell = ivec2(cell);
          int driftRowCount = int(driftRows);
          ivec2 hashCell = uAnimMode == 4 ? ivec2(icell.x, ((icell.y % driftRowCount) + driftRowCount) % driftRowCount) : icell;
          vec2 cellCenter = (cell + 0.5) * cellSize;
          vec2 jitter = (vec2(ethHash(ivec3(hashCell, 0), 2), ethHash(ivec3(hashCell, 0), 3)) - 0.5) * cellSize * 0.25;
          vec2 p = gridPos - cellCenter - jitter;

          // One volume position per CELL (not per fragment), rebuilt from the
          // cell's current center on the facet plane, so a shape's phase can
          // depend on where it sits inside the gem without warping it.
          vec2 cellFacet = cellCenter - facetGridOffset - vec2(0.0, scroll);
          vec2 cellCenterModel = ethRotate(cellFacet, uPatternAngle) / uModelToScreen;
          vec3 cellModelPos = facetTangent * cellCenterModel.x + facetBitangent * cellCenterModel.y + facetNormal * facetDepth;
          vec3 volumeCenter = (cellModelPos - uBoundsMin) / max(uBoundsMax - uBoundsMin, vec3(0.0001)) - 0.5;
          float volumeRadius = length(volumeCenter);

          // Per-cell phase only (no per-facet term), so neighboring facets
          // animate in sync instead of each facet running its own clock.
          float particlePhase = ethHash(ivec3(hashCell, 0), 4) * uVariationRad;
          float sizeMul = 1.0;
          vec2 flowDir = vec2(0.0);

          if (uAnimMode == 1) {
            float amp = uGemFlow * cellSize * 0.5;
            p += vec2(sin(twoPiCycles + particlePhase), cos(twoPiCycles + particlePhase * 1.3)) * amp;
          } else if (uAnimMode == 2) {
            // Pulse: one coherent breath from the gem's core outward (radius
            // drives the phase, variation only adds a slight offset), with
            // marks moving away from / toward the center as they grow.
            float breath = sin(twoPiCycles - volumeRadius * 6.0 + particlePhase * 0.15);
            sizeMul = 1.0 + uGemFlow * 0.35 * breath;
            vec2 fromCenter = cellFacet - gemCenterFacet;
            float fromCenterLength = length(fromCenter);
            if (fromCenterLength > 0.00001) {
              p -= (fromCenter / fromCenterLength) * breath * uGemFlow * cellSize * 0.3;
            }
          } else if (uAnimMode == 3) {
            float orbitRadius = uGemFlow * cellSize * 0.5;
            float angle = twoPiCycles + particlePhase;
            p += vec2(cos(angle), sin(angle)) * orbitRadius;
          } else if (uAnimMode == 5) {
            // Wave: one coherent wave traveling up through the gem's height.
            float amp = uGemFlow * cellSize * 0.45;
            p.y += sin(twoPiCycles - volumeCenter.y * 9.42477796 + particlePhase * 0.15) * amp;
          } else if (uAnimMode == 6) {
            sizeMul = max(0.0, 1.0 + uGemFlow * 0.5 * sin(twoPiCycles * 2.0 + particlePhase * 3.0));
          } else if (uAnimMode == 7) {
            // Ripple: radiates from the gem's true 3D center.
            sizeMul = max(0.0, 1.0 + uGemFlow * 0.4 * sin(twoPiCycles * 1.5 - volumeRadius * 22.0 + particlePhase * 0.3));
          } else if (uAnimMode == 8) {
            // Flow: the field lives in the gem's volume and is projected onto
            // this facet, so streams continue across facet edges. Each mark
            // travels a short segment along it and fades at both ends.
            vec3 stream = ethFlowField(volumeCenter, uGemLoopProgress * 6.28318530718, uGemFlow * 1.2);
            float swirlLength = length(volumeCenter.xz);
            if (swirlLength > 0.0001) {
              // Data burst: a swirl around the gem's axis, fading outward.
              stream += vec3(-volumeCenter.z, 0.0, volumeCenter.x) / swirlLength * uGemDataPulse * 1.5 * max(0.0, 1.0 - volumeRadius * 1.6);
            }
            vec2 onFacet = ethRotate(vec2(dot(stream, facetTangent), dot(stream, facetBitangent)), -uPatternAngle);
            float onFacetLength = length(onFacet);
            flowDir = onFacetLength > 0.0001 ? onFacet / onFacetLength : vec2(0.0, -1.0);
            float along = dot(volumeCenter, stream / max(length(stream), 0.0001));
            float s = fract(uGemLoopProgress * uCycles - along * 2.0 + particlePhase / 6.28318530718);
            // Facets nearly facing the stream show little travel, like foreshortening.
            float travel = cellSize * min(0.9, 0.35 + 0.45 * uGemFlow) * smoothstep(0.05, 0.3, onFacetLength / max(length(stream), 0.0001));
            p -= flowDir * (s - 0.5) * travel;
            sizeMul = smoothstep(0.0, 0.1, s) * smoothstep(1.0, 0.9, s);
          }

          int shapeType = uShapeType;
          if (uMixed > 0.5) {
            shapeType = int(floor(ethHash(ivec3(hashCell, 0), 5) * 7.0)) % 7;
          }

          vec2 pr = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);
          if (uAnimMode == 8) {
            // Turn the mark to follow its stream (a Line lies along it, other
            // shapes point downstream), then apply the user's Rotation.
            vec2 aligned = shapeType == 4
              ? vec2(dot(p, flowDir), dot(p, vec2(-flowDir.y, flowDir.x)))
              : vec2(dot(p, vec2(-flowDir.y, flowDir.x)), -dot(p, flowDir));
            float ur = cos(uRotation);
            float us = sin(uRotation);
            pr = vec2(aligned.x * ur - aligned.y * us, aligned.x * us + aligned.y * ur);
          }
          float size = max(0.0, baseSize * sizeMul);
          // Size variation: a stable random spread per mark.
          size *= max(0.0, 1.0 + (ethHash(ivec3(hashCell, 0), 16) - 0.5) * 2.0 * uSizeVariation);

          // Real-time tracking burst, strongest at the gem's core.
          // 0.35: larger boosts made neighboring marks overlap and swap colors.
          size *= 1.0 + uGemDataPulse * 0.35 * max(0.0, 1.0 - volumeRadius * 1.6);
          size *= 1.0 + 0.55 * milestoneCell;
          float fromBase = clamp(volumeCenter.y + 0.5, 0.0, 1.0);
          // Data fingerprint: marks are as large as the data was at their
          // height's date, so the gem's texture is the data's history.
          float hoverSpot = uHoverOn > 0.5 ? ethHoverSpot(cellModelPos) : 0.0;
          if (uFingerprintOn > 0.5) {
            float fingerprintSize = mix(0.45, 1.75, ethFingerprintAt(fromBase));
            // Under the pointer even a low year's marks show (at least 0.7x),
            // so the reading is visible anywhere on the gem.
            size *= mix(fingerprintSize, max(fingerprintSize, 0.7), hoverSpot);
          }
          size *= 1.0 + 0.5 * hoverSpot;

          float cellMask = size <= 0.0005 ? 0.0 : ethShapeMask(shapeType, pr, size, aa);

          if (cellMask > mask) {
            mask = cellMask;
            markCell = hashCell;
            markHover = hoverSpot;
          }
        }
      }
    }

    mask *= inputColor.a;

    vec3 flatColor = mix(uColorA, uColorB, step(1.0 - uColorBShare, ethHash(ivec3(markCell, 0), 6)));
    // Color A at the top, Color B at the bottom, like the 2D renderer (uv.y
    // grows upward here).
    vec3 gradientColor = mix(uColorA, uColorB, clamp(1.0 - uv.y + uColorBShare - 0.5, 0.0, 1.0));
    vec3 markColor = uColorGradient > 0.5 ? gradientColor : flatColor;
    if (uGemMilestoneStrength > 0.0) {
      // Per-mark ignition: each mark's own delay, so the front lights mark by
      // mark like the 2D renderer.
      markMilestone = ethGemMilestoneBand(ethWaveRadius(screenRadius, milestoneAlign, ethHash(ivec3(markCell, 0), 8)));
    }
    if (markMilestone > 0.0) {
      // Gamma-space blend like the 2D canvas; linear washed the gold out.
      markColor = pow(mix(pow(markColor, vec3(1.0 / 2.2)), pow(uMilestoneColor, vec3(1.0 / 2.2)), markMilestone), vec3(2.2));
    }
    if (uHoverOn > 0.5) {
      // The hovered band lights in a pale tint of the identity (the Accent is
      // the Story letters' color, so the band got lost in them); the rest
      // steps back a little.
      vec3 hoverColor = mix(uColorB, vec3(1.0), 0.55);
      markColor = mix(markColor * 0.7, hoverColor, markHover);
    }

    // The background (color, gradient, Field, typography), evaluated where
    // the mesh does not cover it.
    vec2 glassQ = vec2(uv.x * uAspect, uv.y);
    vec3 glassTint = pow(uColorGradient > 0.5 ? gradientColor : mix(uColorA, uColorB, 0.5), vec3(1.0 / 2.2));

    // Glass geometry first (blueprint 2026-10-10, liquid addendum round 8),
    // so the background below is sampled in one place: where the pixel is,
    // where the glass bends it to, and the Frost ring around that.
    bool glassActive = uGlassOn > 0.5 && uGlassHullCount >= 3 && inputColor.a > 0.001;
    float inradius = uGlassHullInradius;
    float sdf = 0.0;
    float glassCover = 0.0;
    vec2 outward = vec2(0.0);
    float tipFade = 0.0;
    vec3 viewNormal = vec3(0.0, 0.0, 1.0);
    vec2 hullCenter = uGlassHullCenter * vec2(uAspect, 1.0);
    vec2 sampleUv = uv;
    if (glassActive) {
      sdf = ethGlassSdf(glassQ);
      // Only inside the silhouette: the rendered tips reach a pixel or two
      // past the hull, and lit glass there drew small diamonds.
      float inHull = 1.0 - smoothstep(-0.0008, 0.0, sdf);
      glassCover = inputColor.a * inHull;
      float eps = 0.0015;
      outward = vec2(
        ethGlassSdf(glassQ + vec2(eps, 0.0)) - ethGlassSdf(glassQ - vec2(eps, 0.0)),
        ethGlassSdf(glassQ + vec2(0.0, eps)) - ethGlassSdf(glassQ - vec2(0.0, eps))
      );
      outward = length(outward) > 1e-6 ? normalize(outward) : vec2(0.0);
      // Thin tips (the apex): a step inward leaves the glass again, so the
      // edge effects fade there instead of filling the whole sliver.
      tipFade = smoothstep(0.0, 0.003, -ethGlassSdf(glassQ - outward * 0.005));
      // Bevel: 1 at the edge, 0 a third of the way in.
      float bevel = (1.0 - clamp(-sdf / (0.34 * inradius), 0.0, 1.0)) * tipFade;
      float inside = clamp(-sdf / inradius, 0.0, 1.0);
      viewNormal = normalize(uModelToViewRot * facetNormal);
      // The data level breathes the bend (+/-15 %); a data pulse sends a
      // ripple out from the gem's core.
      float strength = uGlassRefraction * (1.0 + 0.3 * (uGemDataLevel - 0.5));
      vec3 volumeAtPixel = (modelPos - uBoundsMin) / max(uBoundsMax - uBoundsMin, vec3(0.0001)) - 0.5;
      float ripple = uGemDataPulse * 0.6 * sin(length(volumeAtPixel) * 26.0 - uGemLoopProgress * max(uCycles, 1.0) * 6.28318530718);
      // Refraction as in Toolcraft's Liquid Glass: strong near the edge
      // (what is behind is pulled in from beyond the rim), calm in the
      // middle, plus a slight magnifier and a small per-facet shift.
      vec2 offset = -outward * (pow(bevel, 1.6) * 0.55 + ripple * 0.1) * inradius * strength;
      offset -= (glassQ - hullCenter) * 0.15 * strength;
      offset += vec2(-viewNormal.x, -viewNormal.y) * 0.08 * inradius * strength;
      // Fisheye: the middle shows a wider view.
      vec2 centered = (glassQ - hullCenter) * 0.5 / inradius;
      centered *= min(1.0, 0.5 / max(length(centered), 1e-5));
      offset += centered * inside * inside * uGlassFisheye * 0.6 * inradius;
      offset *= 1.0 + uGlassFisheye * inside * 0.4;
      sampleUv = uv + offset / vec2(uAspect, 1.0);
    }

    // The background (color, gradient, Field, typography) from ONE call
    // site in a loop: sample 0 where the mesh does not cover the pixel,
    // 1 what the glass shows, 2+ the Frost ring (what is behind turns soft,
    // so the Field reads as haze). The compiler inlines the Field at every
    // call site, and three of them took most of the ~4 s shader compile.
    int sampleCount = glassActive ? (uGlassFrost > 0.001 ? 2 + uFrostTaps : 2) : 1;
    float frostRadius = 0.004 + 0.02 * uGlassFrost;
    vec3 backgroundGamma = vec3(0.0);
    vec3 seen = vec3(0.0);
    vec3 frosted = vec3(0.0);
    for (int k = 0; k < sampleCount; k++) {
      vec2 samplePoint = k == 0 ? uv : sampleUv;
      if (k >= 2) {
        float angle = float(k - 2) * 1.5707963 + 0.785398;
        samplePoint += vec2(cos(angle) / uAspect, sin(angle)) * frostRadius;
      }
      vec3 sampled = ethBackgroundGamma(samplePoint, k == 0 ? 1.0 - inputColor.a : 1.0);
      if (k == 0) {
        backgroundGamma = sampled;
      } else if (k == 1) {
        seen = sampled;
      } else {
        frosted += sampled;
      }
    }

    vec3 fieldRgb = pow(backgroundGamma, vec3(2.2));
    vec3 baseRgb = uIncludeBackground > 0.5 ? fieldRgb : vec3(0.0);
    float outAlpha = uIncludeBackground > 0.5 ? 1.0 : mask;

    // Far from the gem (beyond its outer radius plus the blur) the shadow is
    // zero, so the 16-edge distance field is skipped there.
    float shadowReach = uGlassHullOuterRadius + 0.75 * uGlassHullInradius;
    if (uGlassHullCount >= 3 && uIncludeBackground > 0.5 && inputColor.a < 0.999 && length(glassQ - hullCenter) < shadowReach) {
      // The 3D gem lifts off what is behind it (the Field, the milestone
      // text): a soft dark shadow around it, a little lower, from the
      // silhouette's distance field. On with or without Glass.
      float shadowSdf = ethGlassSdf(glassQ + vec2(0.0, 0.12 * inradius));
      float blur = 0.55 * inradius;
      float shade = (1.0 - smoothstep(-blur * 0.3, blur, shadowSdf)) * 0.75 * (1.0 - inputColor.a);
      // Darkens whatever is behind (a fixed dark color would glow on a dark
      // background), with a hint of the identity's tint.
      baseRgb *= 1.0 - shade * (vec3(1.0) - 0.2 * pow(glassTint, vec3(2.2)));
    }

    if (glassActive) {
      // Glass, after Toolcraft's Liquid Glass: what is behind bends near
      // the edge (Refraction, Fisheye) and turns soft (Frost); a veil in the
      // identity's colors makes it glow (Tint); faces are lit by the scene
      // light; a clear rim (Rim light) and an inner glow (Glow) draw its
      // shape without the outline; grain and fine scratches give it a
      // surface.
      if (uGlassFrost > 0.001) {
        seen = mix(seen, (seen + frosted) / 5.0, min(1.0, uGlassFrost * 1.5));
      }
      // Light on screen (the scene light seen by the camera).
      vec3 lightView = normalize(uWorldToViewRot * uLightDir);
      vec2 lightAxis = normalize(lightView.xy + vec2(0.00001));
      float facing = abs(dot(outward, lightAxis));
      float facetLight = max(dot(viewNormal, lightView), 0.0);
      // Tint: a veil in the identity's colors makes the gem brighter than a
      // dark background, so it stands out on its own (white turned it gray).
      // Faces toward the light are lighter, so the volume reads without the
      // outline.
      vec3 veil = glassTint * (0.5 + 0.45 * facetLight);
      seen = mix(seen, veil, uGlassTint);
      seen *= 0.82 + 0.36 * facetLight;
      // Grain and fine scratches: the surface reads as a physical material.
      vec2 pixel = uv * vec2(textureSize(tFacetNormal, 0));
      float grain = ethHash(ivec3(ivec2(pixel), 0), 21) - 0.5;
      vec2 scratchSpace = ethRotate(glassQ - hullCenter, 0.6) * 140.0;
      vec2 scratchCell = floor(scratchSpace * vec2(1.0, 0.12));
      float scratchOn = step(0.9, ethHash(ivec3(ivec2(scratchCell), 0), 22));
      float scratch = scratchOn * (1.0 - smoothstep(0.0, 0.06, abs(fract(scratchSpace.x) - 0.5)));
      vec2 scratchSpace2 = ethRotate(glassQ - hullCenter, -0.9) * 110.0;
      vec2 scratchCell2 = floor(scratchSpace2 * vec2(1.0, 0.1));
      scratch += step(0.92, ethHash(ivec3(ivec2(scratchCell2), 1), 22)) * (1.0 - smoothstep(0.0, 0.06, abs(fract(scratchSpace2.x) - 0.5)));
      seen += vec3(grain * 0.035) + mix(glassTint, vec3(1.0), 0.5) * scratch * 0.07 * (0.4 + 0.6 * facetLight);
      // Edge light: a clear line around the whole contour (brighter facing
      // the light), an inner glow fading in from the edge, and a soft band
      // just inside the lit edges. Tinted by the identity, never pure white.
      float rimLine = pow(clamp(1.0 + sdf / 0.0032, 0.0, 1.0), 1.5) * (0.45 + 0.55 * pow(facing, 1.6)) * tipFade;
      float innerGlow = pow(1.0 - clamp(-sdf / (0.45 * inradius), 0.0, 1.0), 2.2) * (0.5 + 0.5 * facing) * tipFade;
      float insideEdge = -sdf;
      float band = smoothstep(0.004, 0.009, insideEdge) * (1.0 - smoothstep(0.012, 0.04, insideEdge));
      float highlight = band * pow(facing, 2.5) * (0.3 + 0.7 * facetLight) * tipFade;
      vec3 lightTint = mix(glassTint, vec3(1.0), 0.6);
      vec3 glareColor = mix(lightTint, pow(uMilestoneColor, vec3(1.0 / 2.2)), milestoneCell * uGemMilestoneStrength);
      vec3 edgeLight = glareColor * (rimLine * 0.8 + highlight * 0.3) * (uGlassRim / 0.7) + mix(glassTint, vec3(1.0), 0.35) * innerGlow * 0.75 * uGlassGlow;
      vec3 glassRgb = pow(clamp(seen + edgeLight, 0.0, 1.0), vec3(2.2));
      if (uIncludeBackground > 0.5) {
        baseRgb = mix(baseRgb, glassRgb, glassCover);
      } else {
        // Nothing behind to refract: the veil and the light.
        vec3 lit = veil * uGlassTint + edgeLight;
        baseRgb = pow(clamp(lit, 0.0, 1.0), vec3(2.2));
        outAlpha = max(mask, glassCover * clamp(0.35 + max(max(edgeLight.r, edgeLight.g), edgeLight.b), 0.0, 1.0));
      }
    }

    vec3 outRgb = mix(baseRgb, markColor, mask);

    outputColor = vec4(outRgb, outAlpha);
  }
`;

export type EthDitherEffectParams = {
  amount: number;
  animation: EthAnimationMode;
  backgroundColor: [number, number, number];
  /** Gradient fill over the background color; null for Color. */
  backgroundGradient: EthBackgroundGradient | null;
  colorA: [number, number, number];
  colorB: [number, number, number];
  colorBShare: number;
  colorGradient: boolean;
  /** 0..1 series level (0.5 without Live data). */
  dataLevel: number;
  dataPulse: number;
  /** 0..1 Field background strength; 0 for Solid. */
  fieldStrength: number;
  /** Field density 1..3 (Background > Field density). */
  fieldDensity: number;
  /** Data fingerprint: 0..1 level per bin from the gem's base to its tip,
   * or null (None/Custom, history not loaded). */
  fingerprint: readonly number[] | null;
  flow: number;
  height: number;
  includeBackground: boolean;
  loopProgress: number;
  maxSize: number;
  milestone: EthMilestoneRender | null;
  rotationDeg: number;
  patternAngleDeg: number;
  seed: number;
  shapeType: EthShapeType;
  sizeVariation: number;
  spacing: number;
  speed: number;
  /** Glass material (3D), or null when off. */
  glass: EthGlass | null;
  typography: EthTypographyRender | null;
  variationDeg: number;
  width: number;
};

/** Same Size/Amount/Spacing semantics as `buildDitherGrid` (spacing widens
 * the base cell, amount raises resolution / shrinks the cell), re-derived in
 * normalized screen-space (fraction of canvas height) since the shader has no
 * diamond-silhouette reference area to calibrate against. */
function computeCellSizeUv(amount: number, spacing: number): number {
  const densityFactor = 200 / Math.max(10, amount);
  const cellSizePx = Math.max(3, Math.min(60, Math.max(spacing, 2) * densityFactor));
  // 1080 is the same reference edge used by the 2D renderer's areaScale.
  return cellSizePx / 1080;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : normalized;
  const parsed = Number.parseInt(expanded, 16);

  if (expanded.length !== 6 || Number.isNaN(parsed)) {
    return [1, 1, 1];
  }

  return [srgbToLinear((parsed >> 16) & 255), srgbToLinear((parsed >> 8) & 255), srgbToLinear(parsed & 255)];
}

/** The effect composer encodes its output to sRGB, so colors handed to the
 * shader must be linear. Passing raw sRGB values encoded them twice: 3D
 * colors and the background read lighter than the same hex in 2D. */
function srgbToLinear(channel: number): number {
  const value = channel / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function buildDitherEffectParams(input: {
  amount: number;
  animation: EthAnimationMode;
  backgroundColorHex: string;
  backgroundGradient?: EthBackgroundGradient | null;
  colorAHex: string;
  colorBHex: string;
  colorBShare: number;
  colorGradient: boolean;
  dataLevel?: number;
  dataPulse: number;
  fieldStrength?: number;
  fieldDensity?: number;
  fingerprint?: readonly number[] | null;
  flow: number;
  height: number;
  includeBackground: boolean;
  loopProgress: number;
  maxSize: number;
  milestone?: EthMilestoneRender | null;
  rotationDeg: number;
  patternAngleDeg?: number;
  seed: number;
  shapeType: EthShapeType;
  sizeVariation?: number;
  spacing: number;
  speed: number;
  glass?: EthGlass | null;
  typography?: EthTypographyRender | null;
  variationDeg: number;
  width: number;
}): EthDitherEffectParams {
  return {
    amount: input.amount,
    animation: input.animation,
    backgroundColor: hexToRgb(input.backgroundColorHex),
    backgroundGradient: input.backgroundGradient ?? null,
    colorA: hexToRgb(input.colorAHex),
    colorB: hexToRgb(input.colorBHex),
    colorBShare: input.colorBShare,
    colorGradient: input.colorGradient,
    dataLevel: input.dataLevel ?? 0.5,
    dataPulse: input.dataPulse,
    fieldStrength: input.fieldStrength ?? 0,
    fieldDensity: input.fieldDensity ?? 2,
    fingerprint: input.fingerprint ?? null,
    flow: input.flow,
    height: input.height,
    includeBackground: input.includeBackground,
    loopProgress: input.loopProgress,
    maxSize: input.maxSize,
    milestone: input.milestone ?? null,
    typography: input.typography ?? null,
    rotationDeg: input.rotationDeg,
    patternAngleDeg: input.patternAngleDeg ?? 0,
    seed: input.seed,
    shapeType: input.shapeType,
    sizeVariation: input.sizeVariation ?? 0,
    glass: input.glass ?? null,
    spacing: input.spacing,
    speed: input.speed,
    variationDeg: input.variationDeg,
    width: input.width,
  };
}

/** Direction toward the scene's main directional light (`position={[3.2, 4.2,
 * 5]}` in `eth-diamond-3d-scene.tsx`/`eth-diamond-3d-export.ts`), used to
 * compute each facet's own lit amount for the per-facet density variation.
 * Not user-configurable, so it's a fixed constant rather than a uniform
 * threaded through `EthDitherEffectParams`. */
const mainLightDirection = (() => {
  const [x, y, z] = [3.2, 4.2, 5];
  const length = Math.sqrt(x * x + y * y + z * z);

  return new Vector3(x / length, y / length, z / length);
})();

export class EthDitherEffect extends Effect {
  constructor(params: EthDitherEffectParams, facetNormalTexture: Texture, volumePositionTexture: Texture) {
    super("EthDitherEffect", fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["uCellReach", new Uniform(1)],
        ["uFrostTaps", new Uniform(4)],
        ["uCellSize", new Uniform(0.05)],
        ["uMaxSize", new Uniform(0.02)],
        ["uShapeType", new Uniform(0)],
        ["uMixed", new Uniform(0)],
        ["uColorA", new Uniform(new Vector3(1, 1, 1))],
        ["uColorB", new Uniform(new Vector3(0.49, 0.36, 1))],
        ["uColorGradient", new Uniform(0)],
        ["uIncludeBackground", new Uniform(0)],
        ["uBackgroundColor", new Uniform(new Vector3(0, 0, 0))],
        ["uRotation", new Uniform(0)],
        ["uAnimMode", new Uniform(0)],
        ["uCycles", new Uniform(0)],
        ["uFlow", new Uniform(0.8)],
        ["uVariationRad", new Uniform(0)],
        ["uPatternAngle", new Uniform(0)],
        ["uSizeVariation", new Uniform(0)],
        ["uLoopProgress", new Uniform(0)],
        ["uDataPulse", new Uniform(0)],
        ["uSeed", new Uniform(0)],
        ["uColorBShare", new Uniform(0.5)],
        ["tFacetNormal", new Uniform(facetNormalTexture)],
        ["tVolumePos", new Uniform(volumePositionTexture)],
        ["uLightDir", new Uniform(mainLightDirection)],
        ["uModelToWorldRot", ethModelFrameUniforms.uModelToWorldRot],
        ["uModelToViewRot", ethModelFrameUniforms.uModelToViewRot],
        ["uWorldToViewRot", ethModelFrameUniforms.uWorldToViewRot],
        ["uDataLevel", new Uniform(0.5)],
        ["uGlassOn", new Uniform(0)],
        ["uGlassRefraction", new Uniform(0.6)],
        ["uGlassFisheye", new Uniform(0.28)],
        ["uGlassFrost", new Uniform(0.2)],
        ["uGlassTint", new Uniform(0.25)],
        ["uGlassRim", new Uniform(0.7)],
        ["uGlassGlow", new Uniform(0.4)],
        ["uGlassHull", ethModelFrameUniforms.uGlassHull],
        ["uGlassHullCount", ethModelFrameUniforms.uGlassHullCount],
        ["uGlassHullCenter", ethModelFrameUniforms.uGlassHullCenter],
        ["uGlassHullInradius", ethModelFrameUniforms.uGlassHullInradius],
        ["uGlassHullOuterRadius", ethModelFrameUniforms.uGlassHullOuterRadius],
        ["uModelToScreen", ethModelFrameUniforms.uModelToScreen],
        ["uBoundsMin", ethModelFrameUniforms.uBoundsMin],
        ["uBoundsMax", ethModelFrameUniforms.uBoundsMax],
        ["uFieldStrength", new Uniform(0)],
        ["uFieldDensity", new Uniform(2)],
        ["uAspect", new Uniform(16 / 9)],
        ["uFieldCenter", new Uniform(new Vector2(0.5, 0.5))],
        ["uFieldSize", new Uniform(new Vector2(0.4, 0.68))],
        ["uGradType", new Uniform(0)],
        ["uGradCount", new Uniform(0)],
        ["uGradAngle", new Uniform(0)],
        ["uGradScale", new Uniform(1)],
        ["uGradPhase", new Uniform(0)],
        ["uGradColors", new Uniform(Array.from({ length: ETH_GRADIENT_MAX_STOPS }, () => new Vector3()))],
        ["uGradAlphas", new Uniform(new Float32Array(ETH_GRADIENT_MAX_STOPS))],
        ["uGradPositions", new Uniform(new Float32Array(ETH_GRADIENT_MAX_STOPS))],
        ["uMilestoneFront", new Uniform(0)],
        ["uGemLoopProgress", new Uniform(0)],
        ["uGemFlow", new Uniform(0.8)],
        ["uGemDataPulse", new Uniform(0)],
        ["uGemDataLevel", new Uniform(0.5)],
        ["uGemMilestoneFront", new Uniform(0)],
        ["uGemMilestoneStrength", new Uniform(0)],
        ["uMilestoneStrength", new Uniform(0)],
        ["uMilestoneColor", new Uniform(new Vector3(1, 0.79, 0.3))],
        ["tTypography", new Uniform(null)],
        ["uTypographyOn", new Uniform(0)],
        ["uFingerprint", new Uniform(new Float32Array(ETH_FINGERPRINT_SAMPLES))],
        ["uFingerprintOn", new Uniform(0)],
        ["uHoverOn", new Uniform(0)],
        ["uHoverPoint", new Uniform(new Vector3())],
        ["uHoverRadius", new Uniform(0.1)],
        ["uTypographyOpacity", new Uniform(1)],
      ]),
    });

    this.updateParams(params);
  }

  /** Canvas the big typography is drawn into (full color, gamma), created
   * on first use and uploaded each frame it shows. */
  private labelCanvas: HTMLCanvasElement | null = null;
  private labelTexture: CanvasTexture | null = null;

  private updateTypography(params: EthDitherEffectParams): void {
    const typography = params.typography;
    const on = Boolean(typography) && params.includeBackground;

    this.uniforms.get("uTypographyOn")!.value = on ? 1 : 0;
    this.uniforms.get("uTypographyOpacity")!.value = typography?.opacity ?? 1;

    if (!on) {
      return;
    }

    const width = Math.max(1, Math.round(params.width));
    const height = Math.max(1, Math.round(params.height));

    if (!this.labelCanvas) {
      this.labelCanvas = document.createElement("canvas");
      this.labelTexture = new CanvasTexture(this.labelCanvas);
      this.uniforms.get("tTypography")!.value = this.labelTexture;
    }

    if (this.labelCanvas.width !== width || this.labelCanvas.height !== height) {
      this.labelCanvas.width = width;
      this.labelCanvas.height = height;
    }

    const context = this.labelCanvas.getContext("2d");

    if (!context) {
      return;
    }

    const geometry = computeDiamondGeometry(width, height);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    drawEthTypography(context, {
      cssHeight: height,
      cssWidth: width,
      // Same pattern as the background field, at this canvas's scale.
      field: {
        cellSpacing: getDitherCellSpacing(params.amount, params.spacing, geometry),
        color: "#ffffff",
        cssHeight: height,
        cssWidth: width,
        dataPulse: params.dataPulse,
        density: params.fieldDensity,
        flow: params.flow,
        geometry,
        loopProgress: params.loopProgress,
        maxSize: (params.maxSize * height) / 1080,
        rotationDeg: params.rotationDeg,
        shapeType: params.shapeType,
        speed: params.animation === "none" ? 0 : params.speed,
        strength: 1,
      },
      geometry,
      markSizeScale: height / 1080,
      typography: typography!,
    });
    this.labelTexture!.needsUpdate = true;
  }

  private gemHeld = false;

  /** Data fingerprint hover: the point under the pointer in the model's
   * own space and the spot's radius (model units), or null. Live preview
   * only; exports never set it. */
  setHover(hover: { point: Vector3; radius: number } | null): void {
    this.uniforms.get("uHoverOn")!.value = hover ? 1 : 0;
    // Reading holds the diamond still; the next params update catches it up
    // when the pointer leaves.
    this.gemHeld = hover !== null;

    if (hover) {
      (this.uniforms.get("uHoverPoint")!.value as Vector3).copy(hover.point);
      this.uniforms.get("uHoverRadius")!.value = hover.radius;
    }
  }

  override dispose(): void {
    this.labelTexture?.dispose();
    super.dispose();
  }

  updateParams(params: EthDitherEffectParams): void {
    const cellSizeUv = computeCellSizeUv(params.amount, params.spacing);
    const maxSizeUv = params.maxSize / 1080;
    const resolvedShapeType = params.shapeType === "mixed" ? "dot" : params.shapeType;

    this.uniforms.get("uCellSize")!.value = cellSizeUv;
    this.uniforms.get("uMaxSize")!.value = maxSizeUv;
    this.uniforms.get("uShapeType")!.value = shapeTypeIndex[resolvedShapeType];
    this.uniforms.get("uMixed")!.value = params.shapeType === "mixed" ? 1 : 0;
    (this.uniforms.get("uColorA")!.value as Vector3).set(...params.colorA);
    (this.uniforms.get("uColorB")!.value as Vector3).set(...params.colorB);
    this.uniforms.get("uColorGradient")!.value = params.colorGradient ? 1 : 0;
    this.uniforms.get("uIncludeBackground")!.value = params.includeBackground ? 1 : 0;
    (this.uniforms.get("uBackgroundColor")!.value as Vector3).set(...params.backgroundColor);
    this.uniforms.get("uRotation")!.value = (params.rotationDeg * Math.PI) / 180;
    this.uniforms.get("uAnimMode")!.value = animationModeIndex[params.animation];
    this.uniforms.get("uCycles")!.value = getCyclesPerLoop(params.speed);
    this.uniforms.get("uFlow")!.value = params.flow;
    this.uniforms.get("uVariationRad")!.value = (params.variationDeg * Math.PI) / 180;
    this.uniforms.get("uPatternAngle")!.value = (params.patternAngleDeg * Math.PI) / 180;
    this.uniforms.get("uSizeVariation")!.value = params.sizeVariation;
    this.uniforms.get("uDataLevel")!.value = params.dataLevel;
    this.uniforms.get("uGlassOn")!.value = params.glass ? 1 : 0;
    this.uniforms.get("uGlassRefraction")!.value = params.glass?.refraction ?? 0.6;
    this.uniforms.get("uGlassFisheye")!.value = params.glass?.fisheye ?? 0.28;
    this.uniforms.get("uGlassFrost")!.value = params.glass?.frost ?? 0.2;
    this.uniforms.get("uGlassTint")!.value = params.glass?.tint ?? 0.25;
    this.uniforms.get("uGlassRim")!.value = params.glass?.rim ?? 0.7;
    this.uniforms.get("uGlassGlow")!.value = params.glass?.glow ?? 0.4;
    this.uniforms.get("uLoopProgress")!.value = params.loopProgress;
    this.uniforms.get("uDataPulse")!.value = params.dataPulse;
    this.uniforms.get("uSeed")!.value = Math.abs(Math.trunc(params.seed)) % 65536;
    this.uniforms.get("uColorBShare")!.value = params.colorBShare;

    // Field background, in canvas-height units with the 2D diamond geometry.
    const height = Math.max(1, params.height);
    const geometry = computeDiamondGeometry(params.width, height);

    this.uniforms.get("uFieldStrength")!.value = params.fieldStrength;
    this.uniforms.get("uFieldDensity")!.value = params.fieldDensity;
    this.uniforms.get("uFingerprintOn")!.value = params.fingerprint ? 1 : 0;
    if (params.fingerprint) {
      const fingerprint = this.uniforms.get("uFingerprint")!.value as Float32Array;

      for (let index = 0; index < ETH_FINGERPRINT_SAMPLES; index += 1) {
        fingerprint[index] = params.fingerprint[index] ?? 0.5;
      }
    }
    this.updateTypography(params);
    this.uniforms.get("uMilestoneFront")!.value = params.milestone?.front ?? 0;
    this.uniforms.get("uMilestoneStrength")!.value = params.milestone?.strength ?? 0;

    if (!this.gemHeld) {
      this.uniforms.get("uGemLoopProgress")!.value = params.loopProgress;
      this.uniforms.get("uGemFlow")!.value = params.flow;
      this.uniforms.get("uGemDataPulse")!.value = params.dataPulse;
      this.uniforms.get("uGemDataLevel")!.value = params.dataLevel;
      this.uniforms.get("uGemMilestoneFront")!.value = params.milestone?.front ?? 0;
      this.uniforms.get("uGemMilestoneStrength")!.value = params.milestone?.strength ?? 0;
    }
    if (params.milestone) {
      (this.uniforms.get("uMilestoneColor")!.value as Vector3).set(...hexToRgb(params.milestone.color));
    }

    // Gradient background: stop colors stay in sRGB (gamma) because the
    // shader blends the background in gamma space, like the 2D canvas.
    const gradient = params.backgroundGradient;
    const breath = getEthGradientBreath(params.dataLevel, params.dataPulse);
    const gradientColors = this.uniforms.get("uGradColors")!.value as Vector3[];
    const gradientAlphas = this.uniforms.get("uGradAlphas")!.value as Float32Array;
    const gradientPositions = this.uniforms.get("uGradPositions")!.value as Float32Array;

    this.uniforms.get("uGradCount")!.value = gradient ? gradient.stops.length : 0;
    this.uniforms.get("uGradType")!.value = gradient ? gradientTypeIndex[gradient.type] : 0;
    this.uniforms.get("uGradAngle")!.value = gradient ? (gradient.angleDeg * Math.PI) / 180 : 0;
    this.uniforms.get("uGradScale")!.value = breath.scale;
    this.uniforms.get("uGradPhase")!.value = breath.phase;
    gradient?.stops.forEach((stop, index) => {
      gradientColors[index]!.set(...stop.rgb);
      gradientAlphas[index] = stop.alpha;
      gradientPositions[index] = stop.position;
    });
    this.uniforms.get("uAspect")!.value = params.width / height;
    (this.uniforms.get("uFieldCenter")!.value as Vector2).set(geometry.cx / height, geometry.cy / height);
    (this.uniforms.get("uFieldSize")!.value as Vector2).set(
      (geometry.halfWidth * 2) / height,
      (geometry.bottomY - geometry.topY) / height,
    );
  }
}
