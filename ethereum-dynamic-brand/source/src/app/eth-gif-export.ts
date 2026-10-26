import { applyPalette, GIFEncoder, quantize } from "gifenc";

/** GIF export (Video Export > Format > GIF): 720 px wide at 15 fps, looping
 * the whole timeline (30 s was 10 MB at 960 px / 20 fps; about 4 MB now).
 * A GIF holds 256 colors per frame and grows fast with size and frame rate,
 * so it is smaller than the MP4/WebM exports. */
export const ETH_GIF_WIDTH = 720;
export const ETH_GIF_FPS = 15;

export function getEthGifSize(cssWidth: number, cssHeight: number): { height: number; pixelRatio: number; width: number } {
  const pixelRatio = ETH_GIF_WIDTH / Math.max(1, cssWidth);

  return {
    height: Math.max(2, Math.round(Math.max(1, cssHeight) * pixelRatio)),
    pixelRatio,
    width: ETH_GIF_WIDTH,
  };
}

/** One frame's pixels as RGBA, read through WebCodecs (VideoFrame.copyTo)
 * so it works with the WebGL export canvas. */
async function readCanvasRgba(canvas: HTMLCanvasElement): Promise<Uint8ClampedArray> {
  const frame = new VideoFrame(canvas, { timestamp: 0 });

  try {
    const rgbaOptions = { colorSpace: "srgb", format: "RGBA" } as VideoFrameCopyToOptions;

    try {
      const buffer = new Uint8ClampedArray(frame.allocationSize(rgbaOptions));

      await frame.copyTo(buffer, rgbaOptions);

      return buffer;
    } catch {
      // Browsers without format conversion copy the native layout; canvas
      // frames are RGBA/RGBX or BGRA/BGRX.
      const buffer = new Uint8ClampedArray(frame.allocationSize());

      await frame.copyTo(buffer);

      if (frame.format === "BGRA" || frame.format === "BGRX") {
        for (let offset = 0; offset < buffer.length; offset += 4) {
          const blue = buffer[offset]!;

          buffer[offset] = buffer[offset + 2]!;
          buffer[offset + 2] = blue;
        }
      }

      return buffer;
    }
  } finally {
    frame.close();
  }
}

export type EthGifEncoder = {
  /** Encodes the canvas's current frame. */
  addFrame: (canvas: HTMLCanvasElement) => Promise<void>;
  /** Ends the file; loops forever. */
  finish: () => Blob;
};

export function createEthGifEncoder(width: number, height: number, fps: number): EthGifEncoder {
  const gif = GIFEncoder();
  // gifenc takes milliseconds (a GIF stores centiseconds): 20 fps is 50 ms.
  const delay = Math.round(1000 / fps);

  return {
    addFrame: async (canvas) => {
      const rgba = await readCanvasRgba(canvas);
      // A palette per frame keeps the accent milestone colors exact.
      const palette = quantize(rgba, 256, { format: "rgb565" });
      const index = applyPalette(rgba, palette, "rgb565");

      gif.writeFrame(index, width, height, { delay, palette, repeat: 0 });
    },
    finish: () => {
      gif.finish();

      return new Blob([gif.bytes()], { type: "image/gif" });
    },
  };
}
