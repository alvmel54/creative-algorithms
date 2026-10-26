/** Tiles for the Shape image picker: each shows a small grid of that mark so
 * the dithering technique reads at a glance instead of from a word. */

type EthShapeValue = "circle" | "cross" | "diamond" | "dot" | "line" | "mixed" | "square" | "triangle";

const INK = "#e8e8ee";
const COLUMNS = [60, 120, 180, 240];
const ROWS = [55, 110, 165];

function markSvg(shape: Exclude<EthShapeValue, "mixed">, x: number, y: number): string {
  switch (shape) {
    case "dot":
      return `<circle cx="${x}" cy="${y}" r="11" fill="${INK}"/>`;
    case "circle":
      return `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="${INK}" stroke-width="5"/>`;
    case "square":
      return `<rect x="${x - 12}" y="${y - 12}" width="24" height="24" fill="${INK}" transform="rotate(45 ${x} ${y})"/>`;
    case "triangle":
      return `<polygon points="${x},${y - 14} ${x + 14},${y + 11} ${x - 14},${y + 11}" fill="${INK}"/>`;
    case "line":
      return `<line x1="${x - 15}" y1="${y + 15}" x2="${x + 15}" y2="${y - 15}" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
    case "diamond":
      return `<polygon points="${x},${y - 16} ${x + 10},${y} ${x},${y + 16} ${x - 10},${y}" fill="${INK}"/>`;
    case "cross":
      return `<path d="M${x - 14} ${y}H${x + 14}M${x} ${y - 14}V${y + 14}" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
  }
}

const mixedCycle: readonly Exclude<EthShapeValue, "mixed">[] = ["dot", "square", "line", "diamond", "triangle", "cross", "circle"];

function tileSvg(shape: EthShapeValue): string {
  const marks = ROWS.flatMap((y, row) =>
    COLUMNS.map((x, column) =>
      markSvg(shape === "mixed" ? mixedCycle[(row * COLUMNS.length + column) % mixedCycle.length]! : shape, x, y),
    ),
  ).join("");

  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 220">${marks}</svg>`,
  )}`;
}

const shapes: readonly { alt: string; value: EthShapeValue }[] = [
  { alt: "Dots", value: "dot" },
  { alt: "Lines", value: "line" },
  { alt: "Squares", value: "square" },
  { alt: "Circles", value: "circle" },
  { alt: "Triangles", value: "triangle" },
  { alt: "Cross", value: "cross" },
  { alt: "Diamond", value: "diamond" },
  { alt: "Mixed", value: "mixed" },
];

export const ethShapePickerItems = shapes.map(({ alt, value }) => ({ alt, src: tileSvg(value), value }));
