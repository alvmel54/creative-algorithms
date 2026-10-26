/** Types for gifenc 1.0.3 (the package ships none). */
declare module "gifenc" {
  export type GifPalette = number[][];
  export type GifColorFormat = "rgb565" | "rgb444" | "rgba4444";

  export type GifEncoderStream = {
    bytes: () => Uint8Array<ArrayBuffer>;
    finish: () => void;
    reset: () => void;
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        delay?: number;
        dispose?: number;
        palette?: GifPalette;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
      },
    ) => void;
  };

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderStream;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { clearAlpha?: boolean; format?: GifColorFormat; oneBitAlpha?: boolean | number },
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifColorFormat,
  ): Uint8Array;
}
