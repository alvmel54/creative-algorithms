# Ethereum Dynamic Brand

A generative Ethereum identity mark rendered live in 3D (WebGL, stippled/dithered diamond), driven by real Ethereum data (ETH price, gas price, TVL, total staking, or a composite mix). Five built-in identities (Foundation, Blockchain, ETH, Developers, dApps) each set their own shape, palette, data source and motion; every control can also be tuned by hand. Exports to PNG/JPG and MP4/WebM/GIF.

## Parameters

### Canvas
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Aspect ratio | 1:1, 3:2, 16:9, 3:4, 9:16, 2:3, 4:3, Custom | 16:9 | Output canvas aspect ratio |
| Canvas width / height | Free text (px) | 1920 x 1080 | Output canvas size |
| Resolution scale | 1-2, step 0.25 | 1 | Supersamples the live preview (exports use their own Resolution setting) |
| Timeline | On / Off | On | Enables the playback timeline |

### Identity
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Preset | Foundation, Blockchain, ETH, Developers, dApps | Custom (shown once any control is edited by hand) | Sets shape, palette, accent color, density and Type of data together as one identity |
| Pattern seed (Shuffle) | Action | - | Reshuffles the mark's deterministic pattern |

### Data
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Type of data | Mix, ETH Price, Gas Price, TVL, Total Staking, None | Mix | The live data behind the mark: tells the Story, shapes the diamond's texture (the fingerprint) and, with Motion Source set to From data, drives speed, intensity, variation and animation style. None has no data: the mark is still, or moves with Manual motion. |
| Story | Off, Since inception, Last 10 years, Last 5 years | Since inception | Plays the data's history as a loop, with milestones called out in the Accent color. Off shows the latest 12 months with no milestones. |
| Text opacity | 0-100% | 100% | Visibility of the Story's milestone text behind the diamond |
| Transition | Dissolve, Fade, Off | Dissolve | How the mark changes when identity, data, shape, animation or gradient changes |

### Motion
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Source | From data, Manual | From data | From data: the data's history sets animation style, speed, intensity and variation. Manual: the controls below set them directly, while the data, Story and milestones stay active. Editing any Motion value switches to Manual; choosing an identity goes back to From data. |
| Animation | None, Fluid, Pulse, Orbit, Drift, Wave, Shimmer, Ripple, Flow | Flow | Motion style |
| Speed | 0-2, step 0.1 | 0.5 | How many motion cycles play across one timeline loop |
| Intensity | 0-2, step 0.1 | 0.8 | How far marks move or how much they grow |
| Variation | 0-100%, step 1 | 33% | How out of sync marks are with each other (0 = together, 100 = spread across the cycle) |

### Diamond
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Zoom | 30-200% | 55% | 3D camera distance (the mouse wheel over the canvas also zooms) |
| Diamond rotation | 0-360 degrees | 0 | Turns the 3D diamond around its vertical axis |
| View (Center view) | Action | - | Recenters the 3D view after dragging |
| Pattern | On / Off | On | The diamond's mark pattern (the data fingerprint). Off leaves only the outline (and the glass, if on). |
| Outline | On / Off | On | The white line along the diamond's facet edges |
| Outline color | Color picker | #ffffff | Outline color (shown when Outline is on) |
| Outline width | 0.25-6px, step 0.25 | 2px | Outline stroke width (shown when Outline is on) |

### Glass
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Show | On / Off | On | Renders the 3D diamond as liquid glass: bends the background, Field and milestone text, with frost, tint, rim light and glow |
| Refraction | 0-100% | 40% | How strongly the glass bends what is behind it |
| Fisheye | 0-100% | 10% | Wide-angle distortion through the middle of the glass |
| Frost | 0-100% | 0% | How soft what is behind the glass looks (0 = clear, 100 = frosted) |
| Tint | 0-100% | 0% | Veil in the identity's colors over the glass |
| Rim light | 0-100% | 30% | Bright edge line that draws the gem's contour |
| Glow | 0-100% | 10% | Soft glow fading in from the edge, in the identity's colors |

### Marks
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Shape | Dots, Lines, Squares, Circles, Triangles, Cross, Diamond, Mixed | Circle | Primitive used for every mark |
| Size | 1-20px | 9px | Maximum mark size at the darkest simulated value |
| Size variation | 0-100%, step 1 | 15% | Randomly varies each mark's size |
| Amount | 10-500, step 5 | 180 | Grid resolution (number of marks) |
| Spacing | 0-50px | 22px | Base grid cell size before density modulation |
| Mark rotation | 0-360 degrees | 0 | Rotates each mark in place |
| Pattern angle | 0-360 degrees | 0 | Rotates the whole pattern grid (diamond and Field background) |

### Palette
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Color A | Color picker | #7c5cff | First mark color |
| Color B | Color picker | #b9a8ff | Second mark color |
| Accent | Color picker | #d9b04e | Color of Story milestone waves and text |
| Color gradient | On / Off | Off | On blends every mark from Color A to Color B top to bottom; off assigns each mark either Color A or Color B |

### Background
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Include | On / Off | On | Whether the background is included in the export |
| Background color | Color picker | #0b0b10 | Scene background color |
| Fill | Color, Gradient | Color | Plain color fill, or a gradient over the color |
| Pattern | None, Field | Field | Field continues the marks' pattern around the diamond across the background |
| Field Strength | 0-100% | 60% | Visibility of the Field pattern over the background color (Field only) |
| Field density | 100-300%, step 10 | 200% | Marks per row in the Field, relative to the diamond's grid (Field only) |

### Image Export
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Format | PNG, JPG | PNG | Still image export format |
| Resolution | 2K, 4K, 8K | 4K | Still image export resolution |
| Brand: Diamond | Action | - | Exports the diamond alone as a transparent PNG (logo use): no background, Field, Story letters or shadow |
| Brand: Background | Action | - | Exports the background alone (color/gradient, Field, Story letters) without the diamond |
| Trim to mark | On / Off | On | Diamond export only: crops the PNG to the diamond plus about 4% padding |

### Video Export
| Name | Range / Options | Default | Effect |
|---|---|---|---|
| Format | MP4, WebM, GIF | MP4 | Video export format. GIF exports 720px wide at 15fps, 256 colors per frame. |
| Resolution | Current, 4K | Current | Video export resolution (not shown for GIF) |
| Duration | 1-60s | 30s | Length of the exported video; also sets the preview loop's timeline duration |
| Include diamond | On / Off | On | Off exports the video without the diamond (background, Field and Story letters only), for social posts. The live preview keeps the diamond. |

## Live data

Ethereum price, TVL and total staking are fetched live and feed the Mix/ETH Price/TVL/Total Staking data types; Gas Price is similarly live-driven. Each data type's full history also seeds the diamond's deterministic pattern.

## How to run

The published build at this folder's root (`index.html`, `assets/`, `models/`) is a static site; open `index.html` through any static server (it loads a `.glb` model, so it will not run from a plain `file://` URL).

The full source is in [`source/`](./source), a Vite + React + TanStack Router + three.js app built on the Toolcraft app framework:

```bash
cd source
npm install
npm run build           # outputs to source/dist
```

To serve locally under this repo's GitHub Pages subpath:
```bash
npx vite build --base=/creative-algorithms/ethereum-dynamic-brand/
```

![preview](./preview.gif)
