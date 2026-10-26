"use client";

import * as React from "react";

import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { SelectControl } from "@/toolcraft/ui";

import {
  applyEthIdentity,
  ethIdentityCustomValue,
  ethIdentityPresets,
  matchEthIdentity,
  type EthIdentityId,
} from "./eth-identity-presets";

const identityOptions = [
  ...ethIdentityPresets.map((preset) => ({ label: preset.label, value: preset.id })),
  { label: "Custom", value: ethIdentityCustomValue },
];

/**
 * Identity select at the top of Data. Its value is derived from the current
 * controls (see `matchEthIdentity`), so it reads "Custom" as soon as any
 * ingredient is changed by hand and returns to the preset on undo. Picking
 * a preset applies all its ingredients (one undo step per changed control,
 * see applyEthIdentity); picking Custom changes nothing. Returns a real
 * element (SelectControl owns the hooks)
 * because the runtime calls custom renderers as plain functions.
 */
export function IdentityPresetControl({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  return (
    <div data-testid="identity-preset">
      <SelectControl
        name="Preset"
        onValueChange={(value) => {
          if (value !== ethIdentityCustomValue) {
            applyEthIdentity(dispatch, value as EthIdentityId);
          }
        }}
        options={identityOptions}
        value={matchEthIdentity(state.values)}
      />
    </div>
  );
}
