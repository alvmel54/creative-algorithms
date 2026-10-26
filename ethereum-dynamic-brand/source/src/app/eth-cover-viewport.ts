"use client";

import * as React from "react";

import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";

/** Runtime zoom limits (percent). */
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

/**
 * The frame always fills the screen (blueprint 2026-10-09, Story addendum
 * rounds 2-4): the output canvas is scaled to cover the whole viewport, so
 * its edges (where the pattern ends) are never visible, and the diamond and
 * background are centered on the area the floating controls panel leaves
 * free (the cover takes that shift into account). The view is locked: the runtime's wheel pan
 * and zoom over the canvas are blocked (the wheel goes to `onWheel`, the 3D
 * zoom, instead), anything else that moves the view snaps back, and a
 * window resize refits. Exports keep the canvas size.
 */
export function useEthCoverViewport({
  cssHeight,
  cssWidth,
  dispatch,
  offset,
  onWheel,
  zoom,
}: {
  cssHeight: number;
  cssWidth: number;
  dispatch: ToolcraftCustomControlRendererProps["dispatch"];
  offset: { x: number; y: number };
  /** Wheel over the canvas (deltaY in pixels), e.g. the 3D zoom. */
  onWheel?: (deltaY: number) => void;
  zoom: number;
}): void {
  const viewRef = React.useRef({ offset, zoom });
  const fitRef = React.useRef<(() => void) | null>(null);
  const onWheelRef = React.useRef(onWheel);

  viewRef.current = { offset, zoom };
  onWheelRef.current = onWheel;

  React.useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('[data-slot="toolcraft-runtime-canvas"]');

    if (!viewport || cssWidth <= 0 || cssHeight <= 0) {
      return;
    }

    const getPanel = (): Element | null =>
      document.querySelector('[data-slot="toolcraft-runtime-panel-host"][data-panel-type="controls"]');

    const fit = (): void => {
      const rect = viewport.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      // Center on the free area beside the panel (it floats over the view).
      const panelRect = getPanel()?.getBoundingClientRect();
      let freeCenterX = rect.left + rect.width / 2;

      if (panelRect && panelRect.width > 0 && panelRect.width < rect.width * 0.6) {
        const panelOnRight = panelRect.left + panelRect.width / 2 > rect.left + rect.width / 2;
        const left = panelOnRight ? rect.left : panelRect.right;
        const right = panelOnRight ? panelRect.left : rect.right;

        freeCenterX = (left + right) / 2;
      }

      const offsetX = Math.round(freeCenterX - (rect.left + rect.width / 2));
      // Cover: the scaled canvas reaches every edge even with the shift.
      const nextZoom = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, Math.ceil(Math.max((rect.width + 2 * Math.abs(offsetX)) / cssWidth, rect.height / cssHeight) * 100)),
      );
      const current = viewRef.current;

      if (current.zoom !== nextZoom || current.offset.x !== offsetX || current.offset.y !== 0) {
        dispatch({ offset: { x: offsetX, y: 0 }, type: "canvas.setViewport", zoom: nextZoom });
      }
    };

    fitRef.current = fit;
    fit();

    const observer = new ResizeObserver(fit);
    const panel = getPanel();

    observer.observe(viewport);

    if (panel) {
      // The panel collapsing or moving changes the free area.
      observer.observe(panel);
    }

    // Runs before the runtime's own wheel handler (capture on window), so
    // scrolling over the canvas no longer pans or zooms the frame.
    const blockWheel = (event: WheelEvent): void => {
      if (event.target instanceof Node && viewport.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // Lines or pages to pixels, roughly.
        onWheelRef.current?.(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1));
      }
    };
    const listenerOptions: AddEventListenerOptions = { capture: true, passive: false };

    window.addEventListener("wheel", blockWheel, listenerOptions);

    return () => {
      fitRef.current = null;
      observer.disconnect();
      window.removeEventListener("wheel", blockWheel, listenerOptions);
    };
  }, [cssHeight, cssWidth, dispatch]);

  // Snap back when anything else moved the view (keyboard zoom, reset).
  React.useEffect(() => {
    fitRef.current?.();
  }, [offset.x, offset.y, zoom]);
}
