import * as React from "react";

export type EthTransitionMode = "dissolve" | "fade" | "off";

export const ETH_TRANSITION_MS = 800;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Deterministic 0..1 hash per block, so the dissolve order is stable. */
function blockHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;

  h = Math.imul(h ^ (h >>> 13), 1274126177);

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type EthStateTransitionOptions = {
  /** Square size of one dissolve block, in CSS px (about two mark cells). */
  blockCssPx: number;
  containerRef: React.RefObject<HTMLElement | null>;
  cssHeight: number;
  cssWidth: number;
  mode: EthTransitionMode;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  pixelRatio: number;
  /** Changes whenever a discrete state change should transition. */
  transitionKey: string;
};

/**
 * Smooth transitions between states (blueprint 2026-10-07). When
 * `transitionKey` changes, the frame still on screen (2D layers or the WebGL
 * canvas, plus any transition already running) is copied into an overlay
 * canvas before the new state paints, then removed over ETH_TRANSITION_MS:
 * "dissolve" clears it block by block in a seeded order (the pattern
 * re-deals itself), "fade" lowers its opacity. Works on the rendered image,
 * so 2D and 3D behave the same; exports never see the overlay.
 *
 * Runs in a layout effect: the 2D layers redraw in passive effects and the
 * 3D canvas on the next animation frame, so at this point both still hold
 * the previous state.
 */
export function useEthStateTransition({
  blockCssPx,
  containerRef,
  cssHeight,
  cssWidth,
  mode,
  overlayRef,
  pixelRatio,
  transitionKey,
}: EthStateTransitionOptions): void {
  const previousKeyRef = React.useRef(transitionKey);
  const frameRef = React.useRef(0);

  React.useLayoutEffect(() => {
    if (previousKeyRef.current === transitionKey) {
      return;
    }

    previousKeyRef.current = transitionKey;

    const overlay = overlayRef.current;
    const container = containerRef.current;

    if (mode === "off" || !overlay || !container) {
      return;
    }

    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    const snapshot = document.createElement("canvas");

    snapshot.width = width;
    snapshot.height = height;

    const snapshotContext = snapshot.getContext("2d");

    if (!snapshotContext) {
      return;
    }

    // Visible layers in paint order, then the overlay itself so a transition
    // interrupted mid-way continues from what was actually on screen.
    const layers = Array.from(container.querySelectorAll("canvas")).filter(
      (canvas) => canvas !== overlay && canvas.getClientRects().length > 0,
    );

    for (const layer of [...layers, overlay]) {
      if (layer.width > 0 && layer.height > 0) {
        snapshotContext.drawImage(layer, 0, 0, width, height);
      }
    }

    overlay.width = width;
    overlay.height = height;
    overlay.style.opacity = "1";

    const context = overlay.getContext("2d");

    if (!context) {
      return;
    }

    context.drawImage(snapshot, 0, 0);

    const blockPx = Math.max(4, Math.round(blockCssPx * pixelRatio));
    const columns = Math.ceil(width / blockPx);
    const rows = Math.ceil(height / blockPx);
    const blocks: { at: number; x: number; y: number }[] = [];

    if (mode === "dissolve") {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          blocks.push({ at: blockHash(x, y), x, y });
        }
      }

      blocks.sort((a, b) => a.at - b.at);
    }

    cancelAnimationFrame(frameRef.current);

    const startedAt = performance.now();
    let cleared = 0;

    const step = (): void => {
      const t = Math.min(1, (performance.now() - startedAt) / ETH_TRANSITION_MS);
      const eased = smoothstep(t);

      if (mode === "fade") {
        overlay.style.opacity = String(1 - eased);
      } else {
        const target = Math.floor(eased * blocks.length);

        for (; cleared < target; cleared++) {
          const block = blocks[cleared]!;

          context.clearRect(block.x * blockPx, block.y * blockPx, blockPx, blockPx);
        }
      }

      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        context.clearRect(0, 0, width, height);
        overlay.style.opacity = "1";
      }
    };

    frameRef.current = requestAnimationFrame(step);
  }, [blockCssPx, containerRef, cssHeight, cssWidth, mode, overlayRef, pixelRatio, transitionKey]);

  React.useEffect(() => () => cancelAnimationFrame(frameRef.current), []);
}
