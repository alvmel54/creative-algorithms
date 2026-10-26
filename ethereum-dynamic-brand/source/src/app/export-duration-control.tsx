"use client";

import * as React from "react";

import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { SliderControl } from "@/toolcraft/ui";

/**
 * Video length, editable right in Video Export. It edits the runtime
 * timeline duration itself (the same value as "Dur" in the timeline bar), so
 * the preview loop and the exported video can never disagree, and the
 * Timeline switch no longer has to be on to change it. The duration only
 * changes when the user drags this slider; nothing writes it back from an
 * effect. Returns a real element (SliderControl owns the hooks) because the
 * runtime calls custom renderers as plain functions.
 */
export function ExportDurationControl({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  return (
    <div data-testid="export-video-duration">
      <SliderControl
        max={60}
        min={1}
        name="Duration"
        onValueChange={(durationSeconds) => dispatch({ durationSeconds, type: "timeline.setDuration" })}
        step={1}
        unit="s"
        value={state.timeline.durationSeconds}
        variant="continuous"
      />
    </div>
  );
}
