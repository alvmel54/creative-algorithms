/** "Center view" (View > Rotation): the camera's orbit is view state, not a
 * control value, so the panel action reaches the live 3D scene through this
 * small event channel. */
const listeners = new Set<() => void>();

export function requestEthViewCenter(): void {
  listeners.forEach((listener) => listener());
}

export function onEthViewCenter(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
