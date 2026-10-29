/**
 * Real data behind "Real-time tracking" (blueprint:
 * Generative Mind Resources/2026-10-06-ethereum-real-time-data-blueprint.md).
 *
 * Each data type fetches a recent history once per session, which is
 * normalized to 0..1, resampled, and stretched over the timeline loop (the
 * end blends into the start so the loop stays seamless and exports stay
 * deterministic). While tracking is on, the latest value is polled and each
 * new value is appended and fires a live pulse in the preview. Any fetch
 * failure falls back to a seeded simulated series.
 *
 * All endpoints were verified from the app origin: no key, CORS allowed.
 */
import {
  createSeededRandom,
  getCyclesPerLoop,
  getSeedForDataSource,
  isEthLiveDataOn,
  resolveEthMotionSource,
  resolveEthPhysicsParams,
  type EthAnimationMode,
  type EthDataSourceType,
  type EthMotionSource,
  type EthPhysicsParams,
} from "./eth-diamond-shading";

type EthFeedKind = Exclude<EthDataSourceType, "mix" | "none">;
/** A data type that moves the mark. */
type EthDataKind = EthFeedKind | "mix";

const feedKinds: readonly EthFeedKind[] = ["eth-price", "gas-price", "tvl", "total-staking"];

const SAMPLE_COUNT = 256;
const LIVE_MOTION_BASE = { flow: 0.8, speed: 0.5, variationDeg: 120 };
const SEAM_BLEND_START = 0.9;
const LIVE_PULSE_DECAY_MS = 900;
/** Rise time of the burst when a polled value arrives; an instant rise
 * read as a flash. */
const LIVE_PULSE_ATTACK_MS = 150;

const liveRefreshMs: Record<EthFeedKind, number> = {
  "eth-price": 60_000,
  "gas-price": 12_000,
  "total-staking": 600_000,
  tvl: 600_000,
};

const dataSourceLabels: Record<EthDataSourceType, string> = {
  "eth-price": "ETH Price",
  "gas-price": "Gas Price",
  mix: "Mix",
  none: "None",
  "total-staking": "Total Staking",
  tvl: "TVL",
};

const animationLabels: Record<EthAnimationMode, string> = {
  drift: "Drift",
  flow: "Flow",
  fluid: "Fluid",
  none: "None",
  orbit: "Orbit",
  pulse: "Pulse",
  ripple: "Ripple",
  shimmer: "Shimmer",
  wave: "Wave",
};

/** Read-only line in Motion: where the values below come from, e.g.
 * "Drift, measured from Gas Price since inception. Editing any value switches
 * to Manual." (blueprint 2026-10-09 narrative model; manual motion blueprint
 * 2026-10-27). */
export function describeEthDataMotion(type: EthDataSourceType, period: EthDataPeriod, source: EthMotionSource): string {
  if (source === "manual") {
    return type === "none"
      ? "Manual motion, with no data. From data keeps the mark still."
      : "Manual motion. The data and the Story stay on; From data restores the measured motion.";
  }

  if (type === "none") {
    return "No data moves the mark. Editing any value switches to Manual.";
  }

  if (period === "recent") {
    return "";
  }

  const profile = ethDataFeed.getMotionProfile(type, period);
  const span = `${dataSourceLabels[type]} ${motionSpanLabels[period]}`;

  return profile
    ? `${animationLabels[profile.animation]}, measured from ${span}. Editing any value switches to Manual.`
    : `Measuring ${span}…`;
}

const PUBLICNODE_RPC = "https://ethereum-rpc.publicnode.com";

/** History period the loop spans (blueprint 2026-10-09 narrative model):
 * Since inception (from when that data exists), the last 10 years or the last 5 years.
 * Story Off plays the last 12 months without milestones. "recent" is
 * internal: no data drives the mark (None / Custom). */
export type EthDataPeriod = "recent" | "all" | "10y" | "5y" | "1y";

const DAY_SECONDS = 86_400;
/** Period end, fixed for the session (whole day), so the preview and every
 * export map the loop to the same dates. */
const SESSION_END_SECONDS = Math.floor(Date.now() / 1000 / DAY_SECONDS) * DAY_SECONDS;
/** Story periods (2026-10-12): Since inception, Last 10 years, Last 5
 * years. Story Off measures the last 12 months ("1y", internal). Since The
 * Merge was dropped: its milestones came too close together. */
const STORY_YEARS: Partial<Record<Exclude<EthDataPeriod, "recent">, number>> = { "10y": 10, "1y": 1, "5y": 5 };

const periodLabels: Record<Exclude<EthDataPeriod, "recent">, string> = {
  "10y": "last 10 years",
  "1y": "12 months",
  "5y": "last 5 years",
  all: "since inception",
};

/** How the Motion line names the measured span (with Story Off too, which
 * measures the last 12 months). */
const motionSpanLabels: Record<Exclude<EthDataPeriod, "recent">, string> = {
  "10y": "over the last 10 years",
  "1y": "over the last 12 months",
  "5y": "over the last 5 years",
  all: "since inception",
};

/** First day of each data's history (Since inception): ETH price and fees from
 * August 2015, Ethereum TVL from 2017, Lido staking from December 2020. Mix
 * starts with the earliest source. */
const ALL_TIME_START_SECONDS: Record<EthDataKind, number> = {
  "eth-price": Date.UTC(2015, 7, 7) / 1000,
  "gas-price": Date.UTC(2015, 7, 7) / 1000,
  mix: Date.UTC(2015, 7, 7) / 1000,
  "total-staking": Date.UTC(2020, 11, 19) / 1000,
  tvl: Date.UTC(2017, 8, 27) / 1000,
};

/** The period of the data that moves the mark; "recent" for None/Custom.
 * Story Off (and older saved "recent") plays the last 12 months; older saved
 * Stories "Since The Merge" and "12 months" read as Last 5 years. */
export function resolveEthPeriod(values: Record<string, unknown>): EthDataPeriod {
  // Since inception is the default Story (blueprint 2026-10-12).
  const period = values["dataSource.period"] ?? "all";

  if (!isEthLiveDataOn(values)) {
    return "recent";
  }

  if (period === "all" || period === "10y" || period === "5y") {
    return period;
  }

  return period === "merge" || period === "1y" ? "5y" : "1y";
}

/** Story (blueprint 2026-10-09, Story addendum): a period is chosen, so its
 * milestones arrive one by one, each with its wave and its text. Off: the
 * data moves the mark, with no waves and no milestone text. */
export function isEthStoryOn(values: Record<string, unknown>): boolean {
  // Since inception is the default Story (blueprint 2026-10-12).
  const period = values["dataSource.period"] ?? "all";

  return isEthLiveDataOn(values) && ["all", "10y", "5y", "merge", "1y"].includes(String(period));
}

function getPeriodRange(period: Exclude<EthDataPeriod, "recent">, type: EthDataKind): { end: number; start: number } {
  const years = STORY_YEARS[period];
  // A data that began later than the window starts at its own beginning.
  const start = years
    ? Math.max(ALL_TIME_START_SECONDS[type], SESSION_END_SECONDS - Math.round(years * 365.25) * DAY_SECONDS)
    : ALL_TIME_START_SECONDS[type];

  return { end: SESSION_END_SECONDS, start };
}

/** Loop position of a milestone (a milestone just before the data begins,
 * like Genesis, fires at the start). */
function milestonePosition(milestone: EthMilestone, start: number, end: number): number {
  return Math.max(0.004, (milestone.seconds - start) / (end - start));
}

export type EthMilestoneId =
  | "beacon"
  | "dao"
  | "dencun"
  | "etfs"
  | "fusaka"
  | "genesis"
  | "london"
  | "merge"
  | "pectra"
  | "shapella";

export type EthMilestone = {
  id: EthMilestoneId;
  /** Data types this milestone belongs to; the first one measures its
   * impact under Mix. */
  kinds: readonly EthFeedKind[];
  label: string;
  /** UTC date. */
  seconds: number;
};

/** Network milestones and the data each one moved (blueprint 2026-10-08
 * milestones v2). Mix shows all of them. */
export const ETH_MILESTONES: readonly EthMilestone[] = [
  { id: "genesis", kinds: ["eth-price", "gas-price"], label: "Genesis", seconds: Date.UTC(2015, 6, 30) / 1000 },
  { id: "dao", kinds: ["eth-price"], label: "The DAO fork", seconds: Date.UTC(2016, 6, 20) / 1000 },
  { id: "beacon", kinds: ["total-staking"], label: "Beacon Chain", seconds: Date.UTC(2020, 11, 1) / 1000 },
  { id: "london", kinds: ["gas-price", "eth-price"], label: "London", seconds: Date.UTC(2021, 7, 5) / 1000 },
  { id: "merge", kinds: ["total-staking", "eth-price", "tvl"], label: "The Merge", seconds: Date.UTC(2022, 8, 15) / 1000 },
  { id: "shapella", kinds: ["total-staking"], label: "Shapella", seconds: Date.UTC(2023, 3, 12) / 1000 },
  { id: "dencun", kinds: ["gas-price", "tvl"], label: "Dencun", seconds: Date.UTC(2024, 2, 13) / 1000 },
  { id: "etfs", kinds: ["eth-price"], label: "Spot ETH ETFs", seconds: Date.UTC(2024, 6, 23) / 1000 },
  { id: "pectra", kinds: ["total-staking", "gas-price"], label: "Pectra", seconds: Date.UTC(2025, 4, 7) / 1000 },
  { id: "fusaka", kinds: ["gas-price"], label: "Fusaka", seconds: Date.UTC(2025, 11, 3) / 1000 },
];

const metricLabels: Record<EthDataKind, string> = {
  "eth-price": "ETH",
  mix: "Index",
  "gas-price": "Fees",
  "total-staking": "Staking",
  tvl: "TVL",
};

/** Milestones of a data type inside a period (all of them for Mix). */
export function getEthMilestonesFor(type: EthDataSourceType, period: EthDataPeriod): EthMilestone[] {
  if (period === "recent") {
    return [];
  }

  if (type === "none") {
    return [];
  }

  const { end, start } = getPeriodRange(period, type);

  // Up to 30 days before the data begins still counts (Genesis), firing at
  // the start of the period.
  return ETH_MILESTONES.filter(
    (milestone) =>
      milestone.seconds >= start - 30 * DAY_SECONDS &&
      milestone.seconds <= end &&
      (type === "mix" || milestone.kinds.includes(type)),
  );
}

/** Days after a milestone its impact is measured over. */
const IMPACT_DAYS = 90;
/** A change of this size (30 %) gives a full-strength wave. */
const FULL_IMPACT = 0.3;

export type EthMilestoneImpact = {
  /** Relative change of the data over IMPACT_DAYS (0.23 = +23 %). */
  change: number;
  kind: EthDataKind;
};

/** "+23%" style text for an impact. */
export function formatEthImpact(impact: EthMilestoneImpact): string {
  const percent = Math.round(impact.change * 100);

  return `${metricLabels[impact.kind]} ${percent >= 0 ? "+" : ""}${percent}%`;
}

/** How far the wave travels by the end of its life, in half gem heights
 * (1 = the gem's edge): the data's change picks a reach in this range. */
const MILESTONE_MIN_REACH = 1.6;
const MILESTONE_MAX_REACH = 4;

export type EthMilestoneWave = {
  /** Ring radius: 0 at the center, about 1 at the gem's edge, beyond it in
   * the Field background. */
  front: number;
  /** 0..1 age of the wave (0 when it fires). */
  life: number;
  /** 0..1 strength (soft start, fades over its life, scaled by impact). */
  strength: number;
  /** Impact line for the typography ("FEES -73% / 90D"), or null. */
  subtitle: string | null;
  /** Milestone name for the typography ("DENCUN"). */
  title: string;
};

/** Story pacing (blueprint 2026-10-09 narrative model, "tiempo narrativo"):
 * each milestone stays on screen at least this long, and a wave lasts about
 * this long, whatever the loop duration. */
const MILESTONE_HOLD_SECONDS = 3;
const MILESTONE_WAVE_SECONDS = 1.6;

/** Maps screen time (timeline progress) to the period's dates. Years without
 * milestones pass quickly and busy stretches slow down so each milestone
 * holds at least MILESTONE_HOLD_SECONDS; inside each stretch time stays
 * linear, so data and milestones remain in sync. */
type EthStoryClock = {
  /** Date position (0..1) of each knot: start, the milestones, end. */
  dateKnots: number[];
  milestones: EthMilestone[];
  /** Screen position (0..1) of each knot. */
  screenKnots: number[];
};

function getStoryClock(
  type: EthDataKind,
  period: Exclude<EthDataPeriod, "recent">,
  durationSeconds: number,
  story: boolean,
): EthStoryClock {
  const { end, start } = getPeriodRange(period, type);
  // Story Off: no milestones, so the clock is linear.
  const milestones = story ? getEthMilestonesFor(type, period) : [];
  const dateKnots = [0, ...milestones.map((milestone) => milestonePosition(milestone, start, end)), 1];
  const hold = Math.min(MILESTONE_HOLD_SECONDS / Math.max(1, durationSeconds), 0.9 / Math.max(1, milestones.length));
  // Every stretch after a milestone gets at least `hold` of the screen; the
  // rest of the loop is shared in proportion to the dates (so long empty
  // years are what shrinks). Solve the scale k with
  // sum(max(hold, gap * k)) = 1 (the first stretch is gap * k), by bisection.
  const gaps = dateKnots.slice(1).map((date, index) => Math.max(0, date - dateKnots[index]!));
  const shares = (k: number): number[] => gaps.map((gap, index) => (index === 0 ? gap * k : Math.max(hold, gap * k)));
  let low = 0;
  let high = 1;

  while (shares(high).reduce((sum, share) => sum + share, 0) < 1 && high < 1e6) {
    high *= 2;
  }

  for (let step = 0; step < 50; step += 1) {
    const middle = (low + high) / 2;

    if (shares(middle).reduce((sum, share) => sum + share, 0) < 1) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const screenShares = shares(high);
  const total = screenShares.reduce((sum, share) => sum + share, 0) || 1;
  const screenKnots = [0];

  screenShares.forEach((share) => screenKnots.push(screenKnots[screenKnots.length - 1]! + share / total));

  return { dateKnots, milestones, screenKnots };
}

/** Date position (0..1) shown at a screen position (0..1). */
function storyDateAt(clock: EthStoryClock, screen: number): number {
  const { dateKnots, screenKnots } = clock;

  for (let index = 1; index < screenKnots.length; index += 1) {
    if (screen <= screenKnots[index]! || index === screenKnots.length - 1) {
      const from = screenKnots[index - 1]!;
      const span = screenKnots[index]! - from;
      const t = span > 1e-9 ? Math.min(1, Math.max(0, (screen - from) / span)) : 1;

      return dateKnots[index - 1]! + (dateKnots[index]! - dateKnots[index - 1]!) * t;
    }
  }

  return screen;
}

/** The youngest active wave of the enabled milestones. It always leaves the
 * diamond outward; the size of the data's change (up or down) sets how far
 * it reaches and how bright it is. */
function getMilestoneWave(
  values: Record<string, unknown>,
  period: EthDataPeriod,
  progress: number,
  clock: EthStoryClock,
  durationSeconds: number,
): EthMilestoneWave | null {
  if (period === "recent") {
    return null;
  }

  const type = (values["dataSource.type"] as EthDataKind) ?? "mix";
  // No selection: every milestone of the data appears in turn, at its
  // place in story time.
  const enabled = clock.milestones;
  const positions = clock.screenKnots.slice(1, -1);
  const waveShare = MILESTONE_WAVE_SECONDS / Math.max(1, durationSeconds);
  let youngest: { age: number; life: number; milestone: EthMilestone } | null = null;

  for (let index = 0; index < enabled.length; index += 1) {
    const milestone = enabled[index]!;
    const at = positions[index]!;
    // A wave ends (fully faded) before the next milestone fires, so close
    // milestones (Dencun and the ETFs are four months apart) never cut each
    // other off.
    const next = enabled.length > 1 ? positions[(index + 1) % enabled.length]! : at + 1;
    const gap = next - at - Math.floor(next - at) || 1;
    const waveLife = Math.min(waveShare, gap * 0.95);
    const age = progress - at - Math.floor(progress - at);

    if (age < waveLife && (youngest === null || age < youngest.age)) {
      youngest = { age, life: age / waveLife, milestone };
    }
  }

  if (youngest === null) {
    return null;
  }

  const life = youngest.life;
  const impact = ethDataFeed.getMilestoneImpact(youngest.milestone, type, period);
  // How much the data moved (either way): a big change carries the light to
  // the canvas edges, a small one barely leaves the diamond.
  const magnitude = impact ? Math.min(1, Math.abs(impact.change) / FULL_IMPACT) : 0.5;

  return {
    // Always outward from the diamond (blueprint 2026-10-09 step 2).
    front: life * (MILESTONE_MIN_REACH + (MILESTONE_MAX_REACH - MILESTONE_MIN_REACH) * magnitude),
    life,
    strength: smoothstep(0, 0.08, life) * (1 - life) * (0.55 + 0.45 * magnitude),
    subtitle: impact ? `${formatEthImpact(impact)} / ${IMPACT_DAYS}D`.toUpperCase() : null,
    title: youngest.milestone.label.toUpperCase(),
  };
}

export type EthHeadline = { subtitle: string | null; title: string };

/** Milestone typography (blueprint 2026-10-09, hold): the latest milestone
 * reached stays lit until the next milestone's wave sweeps it away and
 * reveals the new one. Cyclic, so the last milestone holds across the loop
 * seam until the first one replaces it. */
export type EthMilestoneText = {
  current: EthHeadline;
  /** Text being swept away while `sweep` is set. */
  previous: EthHeadline | null;
  /** Sweep front in half gem heights while the current milestone's wave is
   * active (it always passes the whole text), else null. */
  sweep: number | null;
};

/** The sweep reaches past the ends of the widest text (about 2.6 half gem
 * heights plus the per-mark delay) by the end of the wave. */
const TEXT_SWEEP_REACH = 3.4;

function milestoneHeadline(milestone: EthMilestone, type: EthDataSourceType, period: EthDataPeriod): EthHeadline {
  const impact = ethDataFeed.getMilestoneImpact(milestone, type, period);

  return {
    subtitle: impact ? `${formatEthImpact(impact)} / ${IMPACT_DAYS}D`.toUpperCase() : null,
    title: milestone.label.toUpperCase(),
  };
}

function getMilestoneText(
  values: Record<string, unknown>,
  period: EthDataPeriod,
  progress: number,
  clock: EthStoryClock,
  durationSeconds: number,
): EthMilestoneText | null {
  if (period === "recent") {
    return null;
  }

  const type = (values["dataSource.type"] as EthDataKind) ?? "mix";
  const enabled = clock.milestones;

  if (enabled.length === 0) {
    return null;
  }

  const positions = clock.screenKnots.slice(1, -1);
  // Latest reached, wrapping to the last one before the first milestone.
  let currentIndex = enabled.length - 1;

  positions.forEach((at, index) => {
    if (at <= progress) {
      currentIndex = index;
    }
  });

  const at = positions[currentIndex]!;
  const next = enabled.length > 1 ? positions[(currentIndex + 1) % enabled.length]! : at + 1;
  const gap = next - at - Math.floor(next - at) || 1;
  const waveLife = Math.min(MILESTONE_WAVE_SECONDS / Math.max(1, durationSeconds), gap * 0.95);
  const age = progress - at - Math.floor(progress - at);
  const sweeping = age < waveLife;
  const previous = enabled.length > 1 ? enabled[(currentIndex - 1 + enabled.length) % enabled.length]! : null;

  return {
    current: milestoneHeadline(enabled[currentIndex]!, type, period),
    previous: sweeping && previous ? milestoneHeadline(previous, type, period) : null,
    sweep: sweeping ? (age / waveLife) * TEXT_SWEEP_REACH : null,
  };
}

type DatedPoint = { seconds: number; value: number };

/** Dated history from `startSeconds` to now (verified from the app origin:
 * no key, CORS allowed). Gas has no free long history, so it uses the daily
 * fees paid on Ethereum as its activity proxy. */
const datedFetchers: Record<EthFeedKind, (startSeconds: number) => Promise<DatedPoint[]>> = {
  "eth-price": async (startSeconds) => {
    // At most 500 points per request: widen the step for long periods.
    const days = Math.ceil((SESSION_END_SECONDS - startSeconds) / DAY_SECONDS);
    const step = Math.max(1, Math.ceil(days / 480));
    const chart = await getJson<{ coins: Record<string, { prices: { price: number; timestamp: number }[] }> }>(
      `https://coins.llama.fi/chart/coingecko:ethereum?start=${startSeconds}&span=${Math.ceil(days / step)}&period=${step}d`,
    );
    const prices = Object.values(chart.coins)[0]?.prices ?? [];

    return prices.map((point) => ({ seconds: point.timestamp, value: point.price }));
  },
  "gas-price": async (startSeconds) => {
    const fees = await getJson<{ totalDataChart?: [number, number][] }>(
      "https://api.llama.fi/summary/fees/ethereum?dataType=dailyFees&excludeTotalDataChartBreakdown=true",
    );

    return (fees.totalDataChart ?? [])
      .filter(([seconds]) => seconds >= startSeconds)
      .map(([seconds, value]) => ({ seconds, value }));
  },
  "total-staking": async (startSeconds) => {
    const lido = await getJson<{
      chainTvls?: { Ethereum?: { tokens?: { date: number; tokens: Record<string, number> }[] } };
    }>("https://api.llama.fi/protocol/lido");

    return (lido.chainTvls?.Ethereum?.tokens ?? [])
      .filter((point) => point.date >= startSeconds)
      .map((point) => ({ seconds: point.date, value: point.tokens.WETH ?? point.tokens.ETH ?? 0 }))
      .filter((point) => point.value > 0);
  },
  tvl: async (startSeconds) => {
    const points = await getJson<{ date: number; tvl: number }[]>(
      "https://api.llama.fi/v2/historicalChainTvl/Ethereum",
    );

    return points.filter((point) => point.date >= startSeconds).map((point) => ({ seconds: point.date, value: point.tvl }));
  },
};

/** Samples dated points evenly in time over [start, end], so loop progress
 * maps linearly to dates (and milestones land on their day). */
function resampleByTime(points: readonly DatedPoint[], start: number, end: number, count: number): number[] {
  const sorted = [...points].sort((a, b) => a.seconds - b.seconds);
  let cursor = 0;

  return Array.from({ length: count }, (_, index) => {
    const seconds = start + ((end - start) * index) / (count - 1);

    while (cursor < sorted.length - 2 && sorted[cursor + 1]!.seconds < seconds) {
      cursor += 1;
    }

    const a = sorted[cursor]!;
    const b = sorted[Math.min(sorted.length - 1, cursor + 1)]!;

    if (seconds <= a.seconds) {
      return a.value;
    }

    if (seconds >= b.seconds) {
      return b.value;
    }

    return a.value + ((b.value - a.value) * (seconds - a.seconds)) / (b.seconds - a.seconds);
  });
}

type RawFeed = {
  /** Time-ordered raw values in display units (USD, gwei, ETH). */
  history: number[];
  latest: number;
  simulated: boolean;
};

export type EthDataSeries = {
  label: string;
  /** Normalized 0..1 value per sample, seam-blended. */
  values: number[];
  /** 0..1 pulse envelope per sample, fired by sharp changes. */
  pulses: number[];
  /** Cumulative 0..1 phase: faster where the value is higher. */
  warp: number[];
  simulated: boolean;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(PUBLICNODE_RPC, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const json = (await response.json()) as { error?: { message: string }; result?: T };

  if (!response.ok || json.error || json.result === undefined) {
    throw new Error(json.error?.message ?? `RPC ${method} failed (${response.status})`);
  }

  return json.result;
}

/** Requests for the same URL within this window share one response: the
 * history and the latest-value loaders both ask for TVL and Lido at
 * startup, and Lido's payload is large. Polls are spaced well past it. */
const JSON_SHARE_MS = 30_000;
const sharedJson = new Map<string, { at: number; promise: Promise<unknown> }>();

async function getJson<T>(url: string): Promise<T> {
  const now = Date.now();
  const shared = sharedJson.get(url);

  if (shared && now - shared.at < JSON_SHARE_MS) {
    return shared.promise as Promise<T>;
  }

  const promise = (async () => {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`${url} failed (${response.status})`);
    }

    return (await response.json()) as T;
  })();

  sharedJson.set(url, { at: now, promise });
  promise.catch(() => sharedJson.delete(url));

  return promise;
}

const weiHexToGwei = (hex: string): number => Number(BigInt(hex)) / 1e9;

async function fetchLidoStakedEth(): Promise<number[]> {
  const lido = await getJson<{
    chainTvls?: { Ethereum?: { tokens?: { date: number; tokens: Record<string, number> }[] } };
  }>("https://api.llama.fi/protocol/lido");
  const tokens = lido.chainTvls?.Ethereum?.tokens ?? [];

  return tokens.map((point) => point.tokens.WETH ?? point.tokens.ETH ?? 0).filter((value) => value > 0);
}

async function fetchEthereumTvl(): Promise<number[]> {
  const points = await getJson<{ date: number; tvl: number }[]>(
    "https://api.llama.fi/v2/historicalChainTvl/Ethereum",
  );

  return points.map((point) => point.tvl);
}

type DappsActivity = { active24h: number; active30d: number };

/** Protocols with fee activity on Ethereum (DefiLlama fees overview, about
 * 1 MB; the full protocol list is 9 MB). Active today vs active this month
 * gives a value that moves daily. */
async function fetchDappsActivity(): Promise<DappsActivity> {
  const overview = await getJson<{ protocols?: { total24h?: number | null; total30d?: number | null }[] }>(
    "https://api.llama.fi/overview/fees/ethereum?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true",
  );
  const protocols = overview.protocols ?? [];

  return {
    active24h: protocols.filter((protocol) => (protocol.total24h ?? 0) > 0).length,
    active30d: protocols.filter((protocol) => (protocol.total30d ?? 0) > 0).length,
  };
}

const FORM_REFRESH_MS = 600_000;

const historyFetchers: Record<EthFeedKind, () => Promise<number[]>> = {
  "eth-price": async () => {
    const chart = await getJson<{ prices: [number, number][] }>(
      "https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=1",
    );

    return chart.prices.map(([, price]) => price);
  },
  "gas-price": async () => {
    const feeHistory = await rpc<{ baseFeePerGas: string[] }>("eth_feeHistory", ["0x400", "latest", []]);

    return feeHistory.baseFeePerGas.map(weiHexToGwei);
  },
  "total-staking": async () => (await fetchLidoStakedEth()).slice(-90),
  tvl: async () => (await fetchEthereumTvl()).slice(-90),
};

const latestFetchers: Record<EthFeedKind, () => Promise<number>> = {
  "eth-price": async () => {
    const price = await getJson<{ ethereum: { usd: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );

    return price.ethereum.usd;
  },
  "gas-price": async () => {
    const feeHistory = await rpc<{ baseFeePerGas: string[] }>("eth_feeHistory", ["0x1", "latest", []]);

    return weiHexToGwei(feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1]!);
  },
  "total-staking": async () => (await fetchLidoStakedEth()).at(-1) ?? 0,
  tvl: async () => {
    const chains = await getJson<{ name: string; tvl: number }[]>("https://api.llama.fi/v2/chains");

    return chains.find((chain) => chain.name === "Ethereum")?.tvl ?? 0;
  },
};

/** Smooth seeded random walk, used when an API is unreachable. */
function simulateHistory(kind: EthFeedKind): number[] {
  const random = createSeededRandom(getSeedForDataSource(kind) * 7919);
  const values: number[] = [];
  let value = 0.5;
  let velocity = 0;

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    velocity = velocity * 0.9 + (random() - 0.5) * 0.04;
    value = Math.min(1, Math.max(0, value + velocity));
    values.push(value);
  }

  return values;
}

function resample(values: readonly number[], count: number): number[] {
  if (values.length === 0) {
    return new Array<number>(count).fill(0.5);
  }

  return Array.from({ length: count }, (_, index) => {
    const position = (index / (count - 1)) * (values.length - 1);
    const low = Math.floor(position);
    const high = Math.min(values.length - 1, low + 1);
    const t = position - low;

    return values[low]! * (1 - t) + values[high]! * t;
  });
}

function normalize(values: readonly number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  return span > 1e-9 ? values.map((value) => (value - min) / span) : values.map(() => 0.5);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

/** The loop's last stretch blends back to its first value, so the last frame
 * flows into the first without a jump. */
function blendSeam(values: readonly number[]): number[] {
  const first = values[0] ?? 0.5;

  return values.map((value, index) => {
    const blend = smoothstep(SEAM_BLEND_START, 1, index / (values.length - 1));

    return value * (1 - blend) + first * blend;
  });
}

/** Spikes are steps above the 90th percentile of step size; each spike
 * decays over a few samples. Two passes so a spike near the end carries over
 * the seam into the start of the loop. A reverse pass then gives every spike
 * a soft attack: an instant 0 -> 1 step (one sample, about 30 ms of an 8 s
 * loop) made the marks jump in size and read as flicker with Live data. */
function computePulses(values: readonly number[]): number[] {
  const steps = values.map((value, index) => Math.abs(value - values[(index - 1 + values.length) % values.length]!));
  const sorted = [...steps].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const spikes = steps.map((step) => (max - threshold > 1e-9 ? Math.max(0, (step - threshold) / (max - threshold)) : 0));
  const decay = Math.exp(-1 / 5);
  const envelope = new Array<number>(values.length).fill(0);
  let carry = 0;

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < values.length; index += 1) {
      carry = Math.max(spikes[index]!, carry * decay);
      envelope[index] = Math.max(envelope[index]!, carry);
    }
  }

  const attack = Math.exp(-1 / 3);

  carry = 0;

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      carry = Math.max(envelope[index]!, carry * attack);
      envelope[index] = carry;
    }
  }

  return envelope;
}

/** Cumulative phase where higher values advance faster. Starts at 0 and ends
 * at 1, so a whole number of animation cycles still fits the loop. */
function computeWarp(values: readonly number[]): number[] {
  const rates = values.map((value) => 0.4 + value);
  const warp: number[] = [0];
  let running = 0;

  for (let index = 0; index < rates.length - 1; index += 1) {
    running += (rates[index]! + rates[index + 1]!) / 2;
    warp.push(running);
  }

  const total = running || 1;

  return warp.map((value) => value / total);
}

/** Circular Gaussian low-pass (wraps around the loop seam). */
function smoothCircular(values: readonly number[], sigma: number): number[] {
  const radius = Math.ceil(sigma * 3);
  const weights = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  return values.map((_, index) => {
    let total = 0;

    for (let k = -radius; k <= radius; k += 1) {
      total += values[(index + k + values.length) % values.length]! * weights[k + radius]!;
    }

    return total / weightSum;
  });
}

/** Motion (Intensity swing and phase warp) reads a smoothed copy: the raw
 * resampled history changes every sample (about 30 ms of an 8 s loop), which
 * shook the marks back and forth with Live data on. Spikes are still found
 * on the raw values so sharp changes keep their pulse. */
const MOTION_SMOOTHING_SAMPLES = 10;

function buildSeries(normalized: readonly number[], label: string, simulated: boolean): EthDataSeries {
  const raw = blendSeam(resample(normalized, SAMPLE_COUNT));
  const values = smoothCircular(raw, MOTION_SMOOTHING_SAMPLES);

  return { label, pulses: computePulses(raw), simulated, values, warp: computeWarp(values) };
}

const compactNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, notation: "compact" });
const priceNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatLatest(kind: EthFeedKind, value: number): string {
  switch (kind) {
    case "eth-price":
      return `ETH $${priceNumber.format(value)}`;
    case "gas-price":
      return `Gas ${value.toFixed(value < 10 ? 2 : 1)} gwei`;
    case "tvl":
      return `TVL $${compactNumber.format(value)}`;
    case "total-staking":
      return `Lido ${compactNumber.format(value)} ETH`;
  }
}

/** Mix as a composite index (blueprint 2026-10-09 narrative model): each
 * step averages the % changes of the sources that exist at that date,
 * chained from 100, so a source joining later (TVL 2017, staking 2020) adds
 * no jump. Sources are sampled from their own time ranges. */
function buildCompositeIndex(
  sources: readonly { history: readonly number[]; range: { end: number; start: number } }[],
  range: { end: number; start: number },
): number[] {
  const count = SAMPLE_COUNT;
  const valueAt = (source: (typeof sources)[number], seconds: number): number | null => {
    if (seconds < source.range.start) {
      return null;
    }

    const position = ((seconds - source.range.start) / (source.range.end - source.range.start)) * (source.history.length - 1);
    const low = Math.max(0, Math.min(source.history.length - 1, Math.floor(position)));
    const high = Math.min(source.history.length - 1, low + 1);
    const t = Math.min(1, Math.max(0, position - low));
    const value = source.history[low]! * (1 - t) + source.history[high]! * t;

    return value > 0 ? value : null;
  };
  const index = [100];

  for (let step = 1; step < count; step += 1) {
    const before = range.start + ((range.end - range.start) * (step - 1)) / (count - 1);
    const now = range.start + ((range.end - range.start) * step) / (count - 1);
    let total = 0;
    let used = 0;

    for (const source of sources) {
      const a = valueAt(source, before);
      const b = valueAt(source, now);

      if (a !== null && b !== null) {
        total += Math.log(b / a);
        used += 1;
      }
    }

    index.push(index[step - 1]! * Math.exp(used > 0 ? total / used : 0));
  }

  return index;
}

export type EthMotionProfile = EthPhysicsParams;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Motion measured from a data series (blueprint 2026-10-09 narrative model).
 * No per-data presets: one fixed calibration maps the measures of any
 * series to the motion controls. The ranges come from the real series
 * (Aug 2015 - Oct 2026, measured 2026-10-09): staking moves ~0.1-0.5 %/day,
 * price and TVL ~2-4 %, network fees ~18-33 %.
 *
 * - Typical daily move (robust: median absolute deviation of log returns,
 *   so a few extreme jumps do not dominate) sets Speed, log-scaled
 *   0.2 %/day -> 0.25, 30 %/day -> 1.75.
 * - Amplitude, ln(max / min) over the period, sets Intensity, log-scaled
 *   0.15 -> 0.3, 16 -> 1.6 (a 1.2x range up to a 10-million-fold one).
 * - Roughness, mean abs 2nd difference / mean abs 1st difference of the log
 *   series, sets Variation (0.7 -> 30 deg, 1.6 -> 330 deg).
 * - Character picks the style, in order:
 *   1. a nervous series (typical move > 10 %/day) gives Shimmer;
 *   2. a trend (efficiency > 0.25) gives Drift when calm (< 1 %/day), else
 *      Flow;
 *   3. bursts (excess kurtosis > 3) give Pulse;
 *   4. oscillation (detrended zero crossings > 4 %) gives Wave;
 *   5. otherwise Fluid.
 */
function measureEthMotion(history: readonly number[], stepDays: number): EthMotionProfile {
  const logs = history.filter((value) => value > 0).map((value) => Math.log(value));
  const returns = logs.slice(1).map((value, index) => value - logs[index]!);

  if (returns.length < 8) {
    return { ...LIVE_MOTION_BASE, animation: "fluid" };
  }

  const median = (values: readonly number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const center = median(returns);
  const typicalDaily = (median(returns.map((value) => Math.abs(value - center))) * 1.4826) / Math.sqrt(Math.max(stepDays, 1 / 24));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const amplitude = Math.max(...logs) - Math.min(...logs);
  const firstDiff = returns.reduce((sum, value) => sum + Math.abs(value), 0) / returns.length;
  const secondDiff =
    returns.slice(1).reduce((sum, value, index) => sum + Math.abs(value - returns[index]!), 0) / Math.max(1, returns.length - 1);
  const roughness = firstDiff > 1e-12 ? secondDiff / firstDiff : 0;
  const kurtosis = variance > 1e-18 ? returns.reduce((sum, value) => sum + (value - mean) ** 4, 0) / returns.length / variance ** 2 - 3 : 0;
  const efficiency = firstDiff > 1e-12 ? Math.abs(logs[logs.length - 1]! - logs[0]!) / (firstDiff * returns.length) : 0;
  // Zero crossings of the series around its straight-line trend.
  const slope = (logs[logs.length - 1]! - logs[0]!) / (logs.length - 1);
  let crossings = 0;
  let previousSign = 0;

  logs.forEach((value, index) => {
    const sign = Math.sign(value - (logs[0]! + slope * index));

    if (sign !== 0 && previousSign !== 0 && sign !== previousSign) {
      crossings += 1;
    }

    if (sign !== 0) {
      previousSign = sign;
    }
  });

  const animation: EthAnimationMode =
    typicalDaily > 0.1
      ? "shimmer"
      : efficiency > 0.25
        ? typicalDaily < 0.01
          ? "drift"
          : "flow"
        : kurtosis > 3
          ? "pulse"
          : crossings / logs.length > 0.04
            ? "wave"
            : "fluid";
  const lerp = (from: number, to: number, t: number): number => from + (to - from) * clamp01(t);
  const logRatio = (value: number, low: number, high: number): number =>
    (Math.log(Math.max(value, 1e-9)) - Math.log(low)) / (Math.log(high) - Math.log(low));

  return {
    animation,
    flow: lerp(0.3, 1.6, logRatio(amplitude, 0.15, 16)),
    speed: lerp(0.25, 1.75, logRatio(typicalDaily, 0.002, 0.3)),
    variationDeg: lerp(30, 330, (roughness - 0.7) / 0.9),
  };
}

class EthDataFeedStore {
  private feeds = new Map<EthFeedKind, RawFeed>();
  private loading = new Map<EthFeedKind, Promise<void>>();
  private seriesCache = new Map<string, EthDataSeries>();
  private periodFeeds = new Map<string, RawFeed>();
  private periodLoading = new Map<string, Promise<void>>();
  private profileCache = new Map<string, EthMotionProfile>();
  private listeners = new Set<() => void>();
  private pollTimers: number[] = [];
  private active: string | null = null;
  private dapps: DappsActivity | null = null;
  private dappsLoading: Promise<void> | null = null;
  private version = 0;
  lastLivePulseAt = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private notify(): void {
    this.version += 1;
    this.seriesCache.clear();
    this.profileCache.clear();
    this.listeners.forEach((listener) => listener());
  }

  private kindsFor(type: EthDataSourceType): readonly EthFeedKind[] {
    if (type === "none") {
      return [];
    }

    return type === "mix" ? feedKinds : [type];
  }

  private load(kind: EthFeedKind): Promise<void> {
    const existing = this.loading.get(kind);

    if (existing) {
      return existing;
    }

    const promise = historyFetchers[kind]()
      .then((history) => {
        if (history.length < 2) {
          throw new Error(`${kind}: empty history`);
        }

        this.feeds.set(kind, { history, latest: history[history.length - 1]!, simulated: false });
      })
      .catch(() => {
        const history = simulateHistory(kind);

        this.feeds.set(kind, { history, latest: history[history.length - 1]!, simulated: true });
      })
      .finally(() => this.notify());

    this.loading.set(kind, promise);

    return promise;
  }

  /** Dated history of one kind over a period, resampled by time. Falls back
   * to the simulated series (milestones still fire). */
  private loadPeriod(kind: EthFeedKind, period: Exclude<EthDataPeriod, "recent">): Promise<void> {
    const key = `${kind}:${period}`;
    const existing = this.periodLoading.get(key);

    if (existing) {
      return existing;
    }

    const { end, start } = getPeriodRange(period, kind);
    const promise = datedFetchers[kind](start)
      .then((points) => {
        if (points.length < 2) {
          throw new Error(`${key}: empty history`);
        }

        const history = resampleByTime(points, start, end, SAMPLE_COUNT);

        this.periodFeeds.set(key, { history, latest: history[history.length - 1]!, simulated: false });
      })
      .catch(() => {
        const history = simulateHistory(kind);

        this.periodFeeds.set(key, { history, latest: history[history.length - 1]!, simulated: true });
      })
      .finally(() => this.notify());

    this.periodLoading.set(key, promise);

    return promise;
  }

  /** Change of the data from the 30 days before a milestone to the 30 days
   * ending IMPACT_DAYS after it (averages, so noisy daily fees do not
   * decide it). Null until that history has loaded. */
  getMilestoneImpact(milestone: EthMilestone, type: EthDataSourceType, period: EthDataPeriod): EthMilestoneImpact | null {
    if (period === "recent" || type === "none") {
      return null;
    }

    // Mix measures the composite index.
    const raw = this.getRawHistory(type, period);

    if (!raw) {
      return null;
    }

    const kind: EthDataKind = type;
    const feed = { history: raw.history };
    const { end, start } = getPeriodRange(period, type);
    const average = (from: number, to: number): number => {
      const samples = feed.history.length;
      const first = Math.max(0, Math.floor(((from - start) / (end - start)) * (samples - 1)));
      const last = Math.min(samples - 1, Math.ceil(((to - start) / (end - start)) * (samples - 1)));
      let total = 0;

      for (let index = first; index <= last; index += 1) {
        total += feed.history[index]!;
      }

      return total / Math.max(1, last - first + 1);
    };
    const before = average(milestone.seconds - 30 * DAY_SECONDS, milestone.seconds);
    const afterEnd = Math.min(end, milestone.seconds + IMPACT_DAYS * DAY_SECONDS);
    const after = average(afterEnd - 30 * DAY_SECONDS, afterEnd);

    return Math.abs(before) > 1e-9 ? { change: (after - before) / Math.abs(before), kind } : null;
  }

  private async poll(kind: EthFeedKind): Promise<void> {
    const feed = this.feeds.get(kind);

    if (!feed || feed.simulated) {
      return;
    }

    try {
      const latest = await latestFetchers[kind]();

      if (!Number.isFinite(latest) || latest <= 0 || latest === feed.latest) {
        return;
      }

      feed.history = [...feed.history.slice(1), latest];
      feed.latest = latest;
      this.lastLivePulseAt = performance.now();
      this.notify();
    } catch {
      // Keep the last good history; the next poll retries.
    }
  }

  start(type: EthDataSourceType, period: EthDataPeriod): void {
    const activeKey = `${type}:${period}`;

    if (this.active === activeKey) {
      return;
    }

    this.stop();
    this.active = activeKey;

    if (period === "recent") {
      return;
    }

    // The period's dated history (Mix: all four sources for the composite),
    // plus the latest value polled live: a new value fires a pulse.
    for (const kind of this.kindsFor(type)) {
      void this.loadPeriod(kind, period);
      void this.load(kind);
      this.pollTimers.push(window.setInterval(() => void this.poll(kind), liveRefreshMs[kind]));
    }
  }

  /** Raw (unnormalized) history of a data type over a period, evenly spaced
   * in time; Mix is the composite index. Null until it loads. */
  getRawHistory(type: EthDataSourceType, period: EthDataPeriod): { history: number[]; simulated: boolean } | null {
    if (period === "recent" || type === "none") {
      return null;
    }

    if (type !== "mix") {
      const feed = this.periodFeeds.get(`${type}:${period}`);

      return feed ? { history: feed.history, simulated: feed.simulated } : null;
    }

    const feeds = feedKinds.map((kind) => ({ feed: this.periodFeeds.get(`${kind}:${period}`), kind }));

    if (feeds.some(({ feed }) => !feed)) {
      return null;
    }

    return {
      history: buildCompositeIndex(
        feeds.map(({ feed, kind }) => ({ history: feed!.history, range: getPeriodRange(period, kind) })),
        getPeriodRange(period, "mix"),
      ),
      simulated: feeds.some(({ feed }) => feed!.simulated),
    };
  }

  /** Motion measured from the data itself (cached until new data). */
  getMotionProfile(type: EthDataSourceType, period: EthDataPeriod): EthMotionProfile | null {
    const key = `${type}:${period}`;
    const cached = this.profileCache.get(key);

    if (cached) {
      return cached;
    }

    const raw = this.getRawHistory(type, period);

    if (!raw || type === "none" || period === "recent") {
      return null;
    }

    const { end, start } = getPeriodRange(period, type);
    const profile = measureEthMotion(raw.history, (end - start) / DAY_SECONDS / (raw.history.length - 1));

    this.profileCache.set(key, profile);

    return profile;
  }

  private loadDapps(): Promise<void> {
    if (!this.dappsLoading) {
      this.dappsLoading = fetchDappsActivity()
        .then((activity) => {
          if (activity.active30d > 0) {
            this.dapps = activity;
          }
        })
        .catch(() => {
          // Keep the last good value; a missing value leaves Amount neutral.
        })
        .finally(() => this.notify());
    }

    return this.dappsLoading;
  }

  /** 0..1 form signals: staking and TVL by position in their recent range,
   * dApps as active-today over active-this-month. Missing sources are null. */
  getFormSignals(): EthFormSignals {
    const position = (kind: EthFeedKind): { latest: number; value: number; simulated: boolean } | null => {
      const feed = this.feeds.get(kind);

      if (!feed) {
        return null;
      }

      const min = Math.min(...feed.history);
      const max = Math.max(...feed.history);

      return {
        latest: feed.latest,
        simulated: feed.simulated,
        value: max - min > 1e-9 ? (feed.latest - min) / (max - min) : 0.5,
      };
    };
    const staking = position("total-staking");
    const tvl = position("tvl");
    const dapps = this.dapps
      ? { latest: this.dapps.active24h, simulated: false, value: Math.min(1, this.dapps.active24h / this.dapps.active30d) }
      : null;
    const parts = [
      tvl && `${formatLatest("tvl", tvl.latest)}${tvl.simulated ? " (simulated)" : ""}`,
      staking && `${formatLatest("total-staking", staking.latest)}${staking.simulated ? " (simulated)" : ""}`,
      dapps && `${dapps.latest} dApps`,
    ].filter(Boolean);

    return {
      dapps: dapps?.value ?? null,
      label: parts.length > 0 ? parts.join(", ") : null,
      staking: staking?.value ?? null,
      tvl: tvl?.value ?? null,
    };
  }

  stop(): void {
    this.pollTimers.forEach((timer) => window.clearInterval(timer));
    this.pollTimers = [];
    this.active = null;
  }

  getSeries(type: EthDataSourceType, period: EthDataPeriod = "recent"): EthDataSeries | null {
    const cacheKey = `${type}:${period}`;
    const cached = this.seriesCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    if (type === "none") {
      return null;
    }

    if (period !== "recent") {
      // History: the raw series (Mix: composite index), normalized.
      const raw = this.getRawHistory(type, period);

      if (!raw) {
        return null;
      }

      const latest = type === "mix" || type === "gas-price" ? undefined : this.feeds.get(type)?.latest;
      const head =
        type === "gas-price"
          ? "Network fees"
          : type === "mix"
            ? "Ethereum index"
            : latest !== undefined
              ? formatLatest(type, latest)
              : dataSourceLabels[type];
      const label = `${head} · ${periodLabels[period]}${raw.simulated ? " (simulated)" : ""}`;
      const series = buildSeries(resample(normalize(raw.history), SAMPLE_COUNT), label, raw.simulated);

      this.seriesCache.set(cacheKey, series);

      return series;
    }

    const kinds = this.kindsFor(type);
    const feeds = kinds.map((kind) =>
      period === "recent" ? this.feeds.get(kind) : this.periodFeeds.get(`${kind}:${period}`),
    );

    if (feeds.some((feed) => !feed)) {
      return null;
    }

    const normalized = feeds.map((feed) => resample(normalize(feed!.history), SAMPLE_COUNT));
    const averaged = normalized[0]!.map((_, index) => normalized.reduce((sum, series) => sum + series[index]!, 0) / normalized.length);
    const simulated = feeds.some((feed) => feed!.simulated);
    // History periods read gas as daily network fees, not gwei.
    const gasLabel = period === "recent" ? formatLatest("gas-price", feeds[1]?.latest ?? 0) : "network fees";
    const latestLabel =
      type === "mix" ? `Mix: ${formatLatest("eth-price", feeds[0]!.latest)}, ${gasLabel}` : formatLatest(type, feeds[0]!.latest);
    // Gas history is the daily fees proxy: name it instead of showing a
    // dollar amount as gwei.
    const label =
      period === "recent"
        ? latestLabel
        : `${type === "gas-price" ? "Network fees" : latestLabel} · ${periodLabels[period]}`;
    const series = buildSeries(averaged, simulated ? `${label} (simulated)` : label, simulated);

    this.seriesCache.set(cacheKey, series);

    return series;
  }

  private fingerprintCache = new Map<string, { fingerprint: EthFingerprint; version: number }>();

  /** Data fingerprint (2026-10-13): the period's history in
   * ETH_FINGERPRINT_SAMPLES bins from its first day (the gem's base) to
   * today (its tip). Null for None/Custom or until the history loads. */
  getFingerprint(type: EthDataSourceType, period: EthDataPeriod): EthFingerprint | null {
    if (period === "recent" || type === "none") {
      return null;
    }

    const key = `${type}:${period}`;
    const cached = this.fingerprintCache.get(key);

    if (cached && cached.version === this.version) {
      return cached.fingerprint;
    }

    const raw = this.getRawHistory(type, period);

    if (!raw) {
      return null;
    }

    // Mix reads its sources' own values on hover (its composite index has
    // no unit a viewer knows).
    const sources =
      type === "mix"
        ? feedKinds.flatMap((kind) => {
            const feed = this.periodFeeds.get(`${kind}:${period}`);

            return feed && !feed.simulated ? [{ kind, raw: feed.history, ...getPeriodRange(period, kind) }] : [];
          })
        : [];
    const fingerprint = { ...buildFingerprint(raw.history, type, period), sources };

    this.fingerprintCache.set(key, { fingerprint, version: this.version });

    return fingerprint;
  }
}

/** Bins in the data fingerprint (the shader's uFingerprint array). */
export const ETH_FINGERPRINT_SAMPLES = 64;

export type EthFingerprint = {
  end: number;
  /** Mix: each source's own history, read on hover. */
  sources?: { end: number; kind: EthFeedKind; raw: number[]; start: number }[];
  kind: EthDataKind;
  milestones: EthMilestone[];
  /** Raw history in display units, evenly spaced from start to end. */
  raw: number[];
  start: number;
  /** 0..1 level per bin, base (start) to tip (today). */
  values: number[];
};

/** Half width, in bins, of the era each bin is compared with: about an
 * eighth of the period either side (1.4 years since inception, 1.5 months for
 * the last 12 months). */
const FINGERPRINT_ERA_BINS = 8;

/** Bins average the history, so daily noise (fees) does not read as
 * texture. Each bin's level is relative to its own era (2026-10-28): the log
 * of its value placed between the lowest and highest bins within
 * FINGERPRINT_ERA_BINS around it. A level against the whole history left the
 * early years small (fees and prices grew by orders of magnitude), so the
 * gem's lower half read empty; now every era shows its own peaks and lows,
 * and the hover still reads the real values. */
function buildFingerprint(history: readonly number[], type: EthDataKind, period: Exclude<EthDataPeriod, "recent">): EthFingerprint {
  const bins = Array.from({ length: ETH_FINGERPRINT_SAMPLES }, (_, bin) => {
    const from = Math.floor((bin / ETH_FINGERPRINT_SAMPLES) * history.length);
    const to = Math.max(from + 1, Math.floor(((bin + 1) / ETH_FINGERPRINT_SAMPLES) * history.length));
    let total = 0;

    for (let index = from; index < to; index += 1) {
      total += history[Math.min(history.length - 1, index)]!;
    }

    return total / (to - from);
  });
  // Empty days (no fees yet) take the smallest real value, so a zero does
  // not squash its whole era.
  const positive = bins.filter((value) => value > 0);
  const floor = positive.length > 0 ? Math.min(...positive) : 1;
  const logs = bins.map((value) => Math.log(Math.max(value, floor)));
  const values = logs.map((value, bin) => {
    const era = logs.slice(Math.max(0, bin - FINGERPRINT_ERA_BINS), bin + FINGERPRINT_ERA_BINS + 1);
    const low = Math.min(...era);
    const high = Math.max(...era);

    return high - low > 1e-6 ? (value - low) / (high - low) : 0.5;
  });
  const { end, start } = getPeriodRange(period, type);

  return {
    end,
    kind: type,
    milestones: getEthMilestonesFor(type, period),
    raw: [...history],
    start,
    values,
  };
}

export type EthFingerprintReading = {
  date: string;
  milestone: string | null;
  /** One line per value (Mix: one per source that existed then). */
  values: string[];
};

/** Hover text for a height on the gem (0 base .. 1 tip): its date, the
 * data's value then, and a milestone that falls in that band. */
export function readEthFingerprint(fingerprint: EthFingerprint, fromBase: number): EthFingerprintReading {
  const t = Math.min(1, Math.max(0, fromBase));
  const seconds = fingerprint.start + (fingerprint.end - fingerprint.start) * t;
  const date = new Date(seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
  const values = fingerprint.sources?.length
    ? fingerprint.sources
        .filter((source) => seconds >= source.start)
        .map((source) =>
          formatFingerprintValue(source.kind, sampleAt(source.raw, (seconds - source.start) / Math.max(1, source.end - source.start))),
        )
    : [formatFingerprintValue(fingerprint.kind, sampleAt(fingerprint.raw, t))];
  const window = 1.5 / ETH_FINGERPRINT_SAMPLES;
  let milestone: EthMilestone | null = null;

  for (const candidate of fingerprint.milestones) {
    const at = (candidate.seconds - fingerprint.start) / (fingerprint.end - fingerprint.start);

    if (Math.abs(at - t) < window && (!milestone || Math.abs(at - t) < Math.abs((milestone.seconds - fingerprint.start) / (fingerprint.end - fingerprint.start) - t))) {
      milestone = candidate;
    }
  }

  return { date, milestone: milestone?.label ?? null, values };
}

function formatFingerprintValue(kind: EthDataKind, value: number): string {
  switch (kind) {
    case "eth-price":
      return `ETH $${priceNumber.format(value)}`;
    case "gas-price":
      return `Fees $${compactNumber.format(value)}/day`;
    case "tvl":
      return `TVL $${compactNumber.format(value)}`;
    case "total-staking":
      return `Lido ${compactNumber.format(value)} ETH`;
    case "mix":
      return `Index ${compactNumber.format(value)}`;
  }
}

export const ethDataFeed = new EthDataFeedStore();

/** 0..1 burst after a polled value: smooth rise over LIVE_PULSE_ATTACK_MS,
 * then exponential decay. */
function livePulseEnvelope(elapsedMs: number): number {
  if (elapsedMs < 0) {
    return 0;
  }

  const rise = Math.min(1, elapsedMs / LIVE_PULSE_ATTACK_MS);

  return rise * rise * (3 - 2 * rise) * Math.exp(-Math.max(0, elapsedMs - LIVE_PULSE_ATTACK_MS) / LIVE_PULSE_DECAY_MS);
}

function sampleAt(samples: readonly number[], progress: number): number {
  const position = Math.min(1, Math.max(0, progress)) * (samples.length - 1);
  const low = Math.floor(position);
  const high = Math.min(samples.length - 1, low + 1);
  const t = position - low;

  return samples[low]! * (1 - t) + samples[high]! * t;
}

export type EthFormSignals = {
  dapps: number | null;
  label: string | null;
  staking: number | null;
  tvl: number | null;
};

export type EthForm = {
  /** Multiplier on Amount (grid density). */
  amountScale: number;
  /** 0..1 share of marks in Color B (0.5 = even split). */
  colorBShare: number;
  /** Multiplier on Size. */
  sizeScale: number;
};

export const neutralEthForm: EthForm = { amountScale: 1, colorBShare: 0.5, sizeScale: 1 };

/** Size and Amount schema maximums: data can scale up to them, never past,
 * so the existing workload limits still hold. */
const FORM_LIMITS = { amount: 500, size: 20 };

export function applyEthFormSize(size: number, form: EthForm): number {
  return Math.min(FORM_LIMITS.size, size * form.sizeScale);
}

export function applyEthFormAmount(amount: number, form: EthForm): number {
  return Math.min(FORM_LIMITS.amount, amount * form.amountScale);
}

/** Base form: neutral. The look belongs to Identity; the data's form is its
 * fingerprint (the history from the gem's base to its tip). The global
 * +/-20 % size swing with the current date was removed (2026-10-13): it told
 * the same history a second way and blurred what a mark's size means. The old
 * three-source cross-mapping (dApps -> Amount, staking -> Size, TVL ->
 * Color B) was removed (blueprint 2026-10-09 narrative model). */
export function resolveEthForm(_values: Record<string, unknown>, _signals?: EthFormSignals): EthForm {
  return neutralEthForm;
}

export type EthMotion = {
  /** 0..1 level of the series at this point of the loop (0.5 without Live
   * data); the Gradient background breathes with it. */
  dataLevel: number;
  /** 0..1 burst size from the data (spikes, plus live updates in preview). */
  dataPulse: number;
  /** Held milestone text and its sweep, or null (Recent, none enabled). */
  milestoneText: EthMilestoneText | null;
  /** Loop progress to animate with: time-warped by the data when tracking. */
  loopProgress: number;
  /** Active milestone wave, or null. */
  milestone: EthMilestoneWave | null;
  physics: EthPhysicsParams;
};

/** Single source of truth for rendered motion (preview, PNG, video).
 * Tracking off: manual controls, untouched loop progress. Tracking on: the
 * user's Animation style on a fixed speed/intensity/variation base that the
 * series modulates (phase warp and a 0.5x-1.5x Intensity swing), plus pulses
 * from sharp changes. `includeLivePulse` adds the decaying burst from
 * the latest polled value; exports leave it off so they stay deterministic. */
export function resolveEthMotion(
  values: Record<string, unknown>,
  loopProgress: number,
  { durationSeconds = 8, includeLivePulse = false }: { durationSeconds?: number; includeLivePulse?: boolean } = {},
): EthMotion {
  // Speed is per 8 seconds, not per loop: a longer loop plays more cycles
  // instead of slowing every motion down.
  const perSecond = (physics: EthPhysicsParams): EthPhysicsParams => ({
    ...physics,
    speed: physics.speed * (Math.max(1, durationSeconds) / 8),
  });

  const manualMotion = resolveEthMotionSource(values) === "manual";

  if (!isEthLiveDataOn(values)) {
    // None: static, or the Motion controls with Source = Manual.
    const manual = perSecond(resolveEthPhysicsParams(values));

    return {
      dataLevel: 0.5,
      dataPulse: 0,
      milestoneText: null,
      loopProgress,
      milestone: null,
      physics: manualMotion ? manual : { ...manual, animation: "none" },
    };
  }

  const type = (values["dataSource.type"] as EthDataKind) ?? "mix";
  const period = resolveEthPeriod(values) as Exclude<EthDataPeriod, "recent">;
  const series = ethDataFeed.getSeries(type, period);
  // Story time: the screen position (timeline progress) shows this date.
  const clock = getStoryClock(type, period, durationSeconds, isEthStoryOn(values));
  const dateProgress = storyDateAt(clock, loopProgress);
  const milestone = getMilestoneWave(values, period, loopProgress, clock, durationSeconds);
  const milestoneText = getMilestoneText(values, period, loopProgress, clock, durationSeconds);
  // Motion measured from the data itself: style, speed, intensity and
  // variation (a neutral Fluid base until the history loads). Manual takes
  // them from the Motion controls; the data's breath below applies to both.
  const profile = manualMotion ? null : ethDataFeed.getMotionProfile(type, period);
  const physics: EthPhysicsParams = perSecond(
    manualMotion ? resolveEthPhysicsParams(values) : (profile ?? { ...LIVE_MOTION_BASE, animation: "fluid" }),
  );

  if (!series || physics.animation === "none" || getCyclesPerLoop(physics.speed) === 0) {
    return { dataLevel: 0.5, dataPulse: 0, loopProgress, milestone, milestoneText, physics };
  }

  const value = sampleAt(series.values, dateProgress);
  // Phase warp in screen time (faster where the data is higher), so story
  // pacing never speeds up or stalls the motion itself.
  const screenWarp = computeWarp(
    Array.from({ length: 128 }, (_, index) => sampleAt(series.values, storyDateAt(clock, index / 127))),
  );
  const livePulse = includeLivePulse
    ? livePulseEnvelope(performance.now() - ethDataFeed.lastLivePulseAt)
    : 0;

  return {
    dataLevel: value,
    dataPulse: Math.min(1, Math.max(sampleAt(series.pulses, dateProgress), livePulse)),
    loopProgress: sampleAt(screenWarp, loopProgress),
    milestoneText,
    milestone,
    // The data swings Intensity from 0.5x to 1.5x of the base. Not for
    // Drift: there Intensity sets a whole number of rows scrolled per loop
    // (the 3D shader rounds it), so a swinging value jumped the grid between
    // row counts and flickered; Drift follows the data through the warp.
    physics: physics.animation === "drift" ? physics : { ...physics, flow: physics.flow * (0.5 + value) },
  };
}
