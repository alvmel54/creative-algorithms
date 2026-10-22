# Ethereum Dynamic Brand

A live generative brand tool that turns real-time Ethereum blockchain data — price, TVL, validators, gas, dApp count — into a precise, white-on-black geometric identity system. Runs entirely in the browser with three modes (Asset, Icons, Composition) and PNG/SVG export.

## Parameters

### Data Source (shared)
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Type of data | dApps, Total Staking, TVL, Gas Price, ETH Price, Mix | dApps | Chooses which live metric drives the generative output |
| Real-time tracking | Yes / No | No | Toggles continuous polling of live Ethereum data vs. a static snapshot |

### Asset tab — Background
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Background shape | Ethereum, Circle, Square, Hexagon | Ethereum | Shape used as the container/mask for the asset |
| Background colour | Color picker | Transparent (#000000) | Fill color of the background shape |
| Preview on | Black / White / Transparent | Black | Preview canvas backdrop (export only, doesn't affect output) |

### Asset tab — Geometry
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Geometric shape | Dots, Lines, Squares, Circles, Triangles, Cross, Mixed | Dots | Primitive shape used to fill the asset |
| Shape color | Color picker | #FFFFFF | Color of the generated shapes |
| Size | 1–20 | 5 | Size of each shape instance |
| Amount | 10–500 | 250 | Number of shape instances generated |
| Spacing | 0–50 | 20 | Gap between shape instances |
| Rotation | 0–360 | 45 | Rotation angle applied to shapes |

### Asset tab — Physics
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Animation | None, Fluid, Pulse, Orbit, Drift | None | Motion behavior applied to the shapes |
| Speed | 0–2 (step 0.05) | 0.5 | Animation playback speed |
| Flow | 0–2 (step 0.05) | 0.8 | Strength of the noise-driven motion field |
| Variation | 0–360 | 120 | Randomness/phase variation across shape instances |

### Icons tab — Grid
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Grid layout | Square, Horizontal, Vertical | Square | Overall aspect/arrangement of the icon grid |
| Background colour | Color picker | Transparent (#000000) | Fill color behind the icon grid |
| Preview on | Black / White / Transparent | Black | Preview canvas backdrop |
| Columns | 1–6 | 2 | Number of grid columns |
| Rows | 1–6 | 2 | Number of grid rows |
| Center elements | Yes / No | Yes | Centers icons within each grid cell |
| Uniform proportions | Yes / No | No | Forces equal width/height per icon cell |

### Icons tab — Icon Style
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Icon shape | Mixed, Square, Circle, Star, Diamond, Cross, Triangle | Mixed | Base shape used to draw each icon |
| Icon style | Outline, Filled, Nested, Fragmented | Nested | Rendering style of the icon |
| Line Thickness | 1–5 | 1 | Stroke weight for outline-based styles |
| Amount | 1–10 | 4 | Number of icon elements per cell |
| Spacing | 1–20 | 5 | Gap between icon elements |
| Rotation | 0–360 | 0 | Rotation angle applied to icons |
| Icon inner color | Color picker | #FFFFFF | Inner fill/stroke color |
| Icon outer color | Color picker | #FFFFFF | Outer fill/stroke color |

### Composition tab — Grid
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Grid layout | Square, Masonry, Asymmetric | Square | Arrangement pattern of the composition mosaic |
| Background colour | Color picker | Transparent (#000000) | Fill color behind the composition |
| Preview on | Black / White / Transparent | Black | Preview canvas backdrop |
| Columns | 1–6 | 2 | Number of mosaic columns |
| Rows | 1–10 | 10 | Number of mosaic rows |
| Columns overlapping | Yes / No | Yes | Allows column tiles to overlap |
| Rows overlapping | Yes / No | Yes | Allows row tiles to overlap |

### Composition tab — Elements
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Elements | Real-time data, Words, Icons, Images (multi-select) | Words, Icons | Which content types populate the mosaic tiles |
| Elements style | Outline, Filled | Outline | Rendering style of composition elements |
| Elements color | Color picker | #FFFFFF | Color of composition elements |
| Amount | 1–50 | 24 | Number of elements placed in the mosaic |
| Max. Amount | 1–50 | 25 | Upper cap on element count |
| Spacing | 1–20 | 5 | Gap between mosaic elements |
| Rotation | 0–360 | 0 | Rotation angle applied to elements |

### Seed
A seed (`ETH-XXXXXXXX`) captures the current parameter state. Copy it, copy a shareable link, or paste a seed back in to reload an exact configuration.

## How to run

This is a single self-contained HTML file with no build step or dependencies.

1. Open `ethereum-brand-generator.html` directly in a browser, or serve the folder with any static server, e.g.:
   ```bash
   npx serve .
   ```
2. Use the right-hand panel to switch between the **Asset**, **Icons**, and **Composition** tabs and adjust parameters.
3. Enable **Real-time tracking** to pull live Ethereum data (price, TVL, validators, gas, dApp count) from public APIs (CoinGecko, DefiLlama, Etherscan); without it, the tool uses simulated data.
4. Export the result via the **Download** menu as PNG (1x/2x/4x) or SVG.

![preview](./preview.gif)
