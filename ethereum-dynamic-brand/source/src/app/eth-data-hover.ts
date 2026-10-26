/**
 * Data fingerprint hover (2026-10-13): where the pointer is on the gem, as a
 * height (0 base .. 1 tip) plus the canvas position for the tooltip. Kept
 * outside React state so a pointer move re-renders only the tooltip, not the
 * whole render state.
 */
export type EthDataHoverPoint = {
  fromBase: number;
  /** Pointer position in canvas CSS px. */
  x: number;
  y: number;
};

class EthDataHoverStore {
  private point: EthDataHoverPoint | null = null;
  private listeners = new Set<() => void>();

  get = (): EthDataHoverPoint | null => this.point;

  set(point: EthDataHoverPoint | null): void {
    if (point === null && this.point === null) {
      return;
    }

    this.point = point;
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };
}

export const ethDataHover = new EthDataHoverStore();
