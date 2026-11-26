/**
 * The seasons: a timeline of eight equal segments (summer, three of fall, three of winter, spring) that
 * the game clock walks along once, from the start of summer to the end of spring (7.5 minutes). The season sets the base
 * acorn drop rate (see `baseDropRate`).
 */

/** Seconds from the start of summer to the end of spring. */
export const YEAR_SECONDS = 450

/** Seconds in one segment of the timeline (summer and spring are as long as one part of fall or winter). */
export const SEGMENT_SECONDS = YEAR_SECONDS / 8

/** The timeline advances by itself until the end of spring, where the game is won. */
export const SEASON_AUTO_END_SECONDS = YEAR_SECONDS

/** The segments of the timeline, in order, with the colours of their rectangles. */
export const SEASON_SEGMENTS: { name: string; season: 'summer' | 'fall' | 'winter' | 'spring'; color: string; text: string }[] = [
  { name: 'Summer', season: 'summer', color: '#58b04a', text: '#0f2a0c' },
  { name: 'Early fall', season: 'fall', color: '#f2c94c', text: '#3a2a00' },
  { name: 'Mid fall', season: 'fall', color: '#e8892b', text: '#3a1c00' },
  { name: 'Late fall', season: 'fall', color: '#a8632d', text: '#fff4e6' },
  { name: 'Early winter', season: 'winter', color: '#bfe0f2', text: '#10303f' },
  { name: 'Mid winter', season: 'winter', color: '#fbfdff', text: '#10303f' },
  { name: 'Late winter', season: 'winter', color: '#bfe0f2', text: '#10303f' },
  { name: 'Spring', season: 'spring', color: '#a6e08f', text: '#17370f' },
]

/** The seasonal clock of a world: seconds along the timeline, and the phases of the random wobble of the drop rate. */
export type SeasonClock = {
  time: number
  phases: [number, number, number]
}

/** How long each tree's, bush's, fern's and moss's change from summer to winter lasts, in segments (two subseasons). */
export const TRANSITION_SEGMENTS = 2

/**
 * How far along its change an object is: 0 before it starts and 1 after it ends. Each object starts at its
 * own time somewhere in early fall (`start` is the share of early fall) so that it ends somewhere in late fall.
 *
 * @param start - The object's start, 0-1.
 * @param time - Seconds along the timeline.
 */
export function transitionProgress(start: number, time: number): number {
  const u = time / SEGMENT_SECONDS
  return Math.max(0, Math.min(1, (u - (1 + start)) / TRANSITION_SEGMENTS))
}

/**
 * What there is of a tree's or bush's leaves: the share of the large leafy shapes and of the small leaves still
 * there (0-1 each), and how far they are into their fall color (0-1).
 */
export type LeafAmounts = {
  shapes: number
  leaves: number
  fall: number
  spring?: boolean
  /** In spring, how big (as a share of full size) the first quarter of the leaves and the ones after it are. */
  sizes?: [number, number]
}

/**
 * The looks the leaves pass through, in order: green, half colorful, fully colorful; then the large shapes go in
 * three steps while all the small leaves stay (ending with the small leaves alone); then half of the small leaves
 * are left, then a quarter, then none (bare). In spring new small leaves come (no large shapes): a quarter of them,
 * later as many again (half in all), each coming in at a quarter of its size and growing to full size.
 */
export const STAGE_LOOKS: LeafAmounts[] = [
  { shapes: 1, leaves: 1, fall: 0 },
  { shapes: 1, leaves: 1, fall: 0.5 },
  { shapes: 1, leaves: 1, fall: 1 },
  { shapes: 2 / 3, leaves: 1, fall: 1 },
  { shapes: 1 / 3, leaves: 1, fall: 1 },
  { shapes: 0, leaves: 1, fall: 1 },
  { shapes: 0, leaves: 0.5, fall: 1 },
  { shapes: 0, leaves: 0.25, fall: 1 },
  { shapes: 0, leaves: 0, fall: 1 },
  { shapes: 0, leaves: 0.25, fall: 0, spring: true, sizes: [0.25, 0.25] },
  { shapes: 0, leaves: 0.25, fall: 0, spring: true, sizes: [0.45, 0.25] },
  { shapes: 0, leaves: 0.5, fall: 0, spring: true, sizes: [0.65, 0.25] },
  { shapes: 0, leaves: 0.5, fall: 0, spring: true, sizes: [0.82, 0.6] },
  { shapes: 0, leaves: 0.5, fall: 0, spring: true, sizes: [1, 1] },
]

/** The index of the bare look in `STAGE_LOOKS` (the looks before it are fall's, those after it spring's). */
export const BARE_STAGE = 8

/**
 * The spring leaves come in the second half of spring: each tree's and bush's change starts somewhere in the
 * first `spread` segments after `from` (by the same random start as its fall), lasts `length` segments and passes
 * from one look to the next at `boundaries` along it (bare, then the spring looks of `STAGE_LOOKS`); the last of
 * them is reached just before the year ends. Images of the new looks start to be wanted from `prepare` on.
 */
const SPRING = { prepare: 7.3, from: 7.5, spread: 0.08, length: 0.4, boundaries: [0.04, 0.27, 0.5, 0.73, 0.95] }

/**
 * How far along its spring change an object is (below 0 before it starts, above 1 after it ends).
 *
 * @param start - The object's start, 0-1.
 * @param time - Seconds along the timeline.
 */
function springProgress(start: number, time: number): number {
  return (time / SEGMENT_SECONDS - (SPRING.from + start * SPRING.spread)) / SPRING.length
}

/**
 * Where along its change (0-1) a tree or bush passes from each look to the next (the last is to bare). The same
 * for every one: only when its change starts is random (see `transitionProgress`).
 */
const STAGE_BOUNDARIES = [1 / 12, 1 / 3, 0.55, 0.62, 0.69, 0.77, 0.86, 0.95]

/** Where along its change the fall color has come halfway and all the way. */
const FALL_KEYS = { half: 1 / 6, full: 1 / 2 }

/**
 * The look of a tree's or bush's leaves at a time, for objects painted at that moment: in fall the color
 * changes smoothly, and the shapes and leaves go in the steps of `STAGE_LOOKS`; late in spring the new leaves come
 * in its last steps.
 *
 * @param start - The object's start, 0-1.
 * @param time - Seconds along the timeline.
 */
export function leafLookAt(start: number, time: number): LeafAmounts {
  if (time / SEGMENT_SECONDS >= SPRING.from) {
    const grown = SPRING.boundaries.filter((boundary) => springProgress(start, time) >= boundary).length
    return { ...(STAGE_LOOKS[BARE_STAGE + grown] ?? { shapes: 0, leaves: 0, fall: 1 }) }
  }
  const progress = transitionProgress(start, time)
  const stage = STAGE_BOUNDARIES.filter((boundary) => progress >= boundary).length
  const look = STAGE_LOOKS[stage] ?? { shapes: 0, leaves: 0, fall: 1 }
  const fall =
    progress <= FALL_KEYS.half
      ? (0.5 * progress) / FALL_KEYS.half
      : 0.5 + 0.5 * Math.min(1, (progress - FALL_KEYS.half) / (FALL_KEYS.full - FALL_KEYS.half))
  return { shapes: look.shapes, leaves: look.leaves, fall: Math.max(0, fall) }
}

/**
 * How far into its winter color a rock's or log's moss is, 0 (summer) to 1: it goes there in fall (see
 * `transitionProgress`) and comes back over the whole of spring.
 *
 * @param start - The object's start, 0-1.
 * @param time - Seconds along the timeline.
 */
export function mossFadeAt(start: number, time: number): number {
  const spring = Math.max(0, Math.min(1, time / SEGMENT_SECONDS - 7))
  return transitionProgress(start, time) * (1 - spring)
}

/** Segments between two sample moments (a sixth). */
const SAMPLE_STEP = 1 / 6

/** The fall's sample moments: one every sixth of a segment from the start of early fall to the start of winter. */
const FALL_SAMPLES = 19

/** The spring's sample moments, in segments along the timeline. */
const SPRING_SAMPLES = [7.25, 7.5, 7.6, 7.7, 7.8, 7.9, 8]

/** The start of spring (in segments): from here the images pass from the last of fall's moments on to spring's. */
const SPRING_APPROACH = 7

/** The number of moments along the timeline that images of the far layers are made for. */
export const SAMPLE_COUNT = FALL_SAMPLES + SPRING_SAMPLES.length

/**
 * The time of one of the sample moments: fall's (the first is the start of early fall, all summer before it; the
 * last the start of winter, which lasts until spring's), then spring's.
 *
 * @param index - 0 to `SAMPLE_COUNT` - 1.
 */
export function sampleTime(index: number): number {
  const spring = SPRING_SAMPLES[index - FALL_SAMPLES]
  return SEGMENT_SECONDS * (spring ?? 1 + SAMPLE_STEP * index)
}

/** How long, in seconds, a change from one look of the leaves to the next takes: they stay as they are, then fade over this. */
export const FADE_SECONDS = 3

/**
 * Smoothstep.
 *
 * @param x - 0-1.
 */
function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}

/**
 * Where a time is along the sample moments, as a fractional index (below 0 before the first, above the last
 * index after the last). It rests at the last of fall's moments through the winter.
 *
 * @param time - Seconds along the timeline.
 */
export function sampleIndexAt(time: number): number {
  const u = time / SEGMENT_SECONDS
  const lastFall = FALL_SAMPLES - 1
  if (u < SPRING_APPROACH) {
    return Math.min(lastFall, (u - 1) / SAMPLE_STEP)
  }
  // Through spring: the last of fall's moments stands at its start, followed by spring's.
  let from = SPRING_APPROACH
  for (const [index, to] of SPRING_SAMPLES.entries()) {
    if (u < to || index === SPRING_SAMPLES.length - 1) {
      return lastFall + index + (u - from) / (to - from)
    }
    from = to
  }
  return lastFall
}

/**
 * The two sample moments a time lies between and how far (0-1) the fade from the first to the second has
 * come: 0 for most of the interval, then a short fade (`FADE_SECONDS`) in the middle of it, then 1. So an
 * image is shown as it is, and two images are only blended during the short fade between them.
 *
 * @param time - Seconds along the timeline.
 */
export function sampleAt(time: number): { k: number; t: number } {
  const x = sampleIndexAt(time)
  if (x <= 0) {
    return { k: 0, t: 0 }
  }
  if (x >= SAMPLE_COUNT - 1) {
    return { k: SAMPLE_COUNT - 2, t: 1 }
  }
  const k = Math.floor(x)
  // The seconds the interval lasts (the one into spring runs from `SPRING_APPROACH`).
  const seconds = k === FALL_SAMPLES - 1 ? sampleTime(k + 1) - SPRING_APPROACH * SEGMENT_SECONDS : sampleTime(k + 1) - sampleTime(k)
  const half = FADE_SECONDS / seconds / 2
  return { k, t: smooth((x - k - (0.5 - half)) / (2 * half)) }
}

/** Seconds between two sample moments. */
const SAMPLE_SECONDS = SAMPLE_STEP * SEGMENT_SECONDS

/** Seconds before a fade that the images of later moments stop being started (what is being drawn then can finish). */
const BUILD_HOLD_LEAD = 2

/** Seconds after a fade that the images of later moments start being made again. */
const BUILD_HOLD_TAIL = 0.5

/** How far through the interval between two sample moments (0-1) the hold around its fade ends. */
export const BUILD_HOLD_END = 0.5 + (FADE_SECONDS / 2 + BUILD_HOLD_TAIL) / SAMPLE_SECONDS

/**
 * Whether the images of later moments should wait: drawing them keeps the graphics card busy, and during a fade
 * the frames need it most, so they are made between the fades.
 *
 * @param time - Seconds along the timeline.
 */
export function buildHoldAt(time: number): boolean {
  const position = sampleIndexAt(time)
  // (Not in spring: its moments follow each other too closely to hold anything back.)
  if (position < 0 || position >= FALL_SAMPLES - 1) {
    return false
  }
  const through = position - Math.floor(position)
  return through > 0.5 - (FADE_SECONDS / 2 + BUILD_HOLD_LEAD) / SAMPLE_SECONDS && through < BUILD_HOLD_END
}

/** Which look an object drawn from ready-made images holds and passes to (see `leafStageMixAt`). */
export type StageMix = { a: number; b: number; w: number; soon: boolean }

/**
 * The mix at a point along a row of changes.
 *
 * @param progress - Where along the change.
 * @param boundaries - Where each change happens.
 * @param first - The look held before the first change (an index into `STAGE_LOOKS`).
 * @param width - How much of the progress a change takes.
 * @param lead - How long before a change starts, in progress, the next look is wanted.
 */
function mixAlong(progress: number, boundaries: number[], first: number, width: number, lead: number): StageMix {
  let stage = 0
  for (const [index, boundary] of boundaries.entries()) {
    if (progress >= boundary + width / 2) {
      stage = index + 1
    } else if (progress > boundary - width / 2) {
      return { a: first + index, b: first + index + 1, w: smooth((progress - (boundary - width / 2)) / width), soon: true }
    }
  }
  const next = boundaries[stage]
  return { a: first + stage, b: first + stage, w: 0, soon: next !== undefined && progress > next - width / 2 - lead }
}

/**
 * The look of a tree's or bush's leaves for objects drawn from ready-made images: which look it holds
 * (`a`, an index into `STAGE_LOOKS`), and while it passes to the next (`b`) over a few seconds, how far (`w`);
 * `soon` is whether a change is about to start (the next look should be made).
 *
 * @param start - The object's start, 0-1.
 * @param time - Seconds along the timeline.
 */
export function leafStageMixAt(start: number, time: number): StageMix {
  if (time / SEGMENT_SECONDS < SPRING.prepare) {
    const seconds = TRANSITION_SEGMENTS * SEGMENT_SECONDS
    return mixAlong(transitionProgress(start, time), STAGE_BOUNDARIES, 0, FADE_SECONDS / seconds, 0.05)
  }
  // (The next look is wanted about 8 seconds ahead.)
  const seconds = SPRING.length * SEGMENT_SECONDS
  return mixAlong(springProgress(start, time), SPRING.boundaries, BARE_STAGE, FADE_SECONDS / seconds, 8 / seconds)
}

/**
 * How far the air has gone to its winter look (light blue haze): a linear fade through late fall, so it is
 * fully blue at the start of early winter (it stays through spring for now).
 *
 * @param time - Seconds along the timeline.
 */
export function winterTintAt(time: number): number {
  const u = time / SEGMENT_SECONDS
  return Math.max(0, Math.min(1, (u - 3) / 1))
}

/** Greatest relative wobble of the drop rate around the seasonal trend. */
const WOBBLE = 0.15

/** The wobble's three sine waves: periods in seconds and relative strength (they sum to 1). */
const WAVES: [number, number][] = [
  [41, 0.5],
  [17, 0.3],
  [7, 0.2],
]

/** The trend's peak, in the middle of mid fall (sized so the acorns that fall roughly match what the animals need). */
const PEAK_RATE = 2.4

/** The timeline's rates (the default setting) are this share of what the trend below says (it was lowered by a third). */
const TIMELINE_RATE_FACTOR = 0.75

/** Highest base drop rate the trend and wobble can reach (the graph's scale). */
export const MAX_BASE_DROP_RATE = PEAK_RATE * TIMELINE_RATE_FACTOR * (1 + WOBBLE)

/**
 * A new clock at the start of summer with its own random wobble.
 */
export function createSeasonClock(): SeasonClock {
  return {
    time: 0,
    phases: [Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2],
  }
}

/**
 * Moves the clock forward, stopping at the end of spring (a clock already there, set by hand, stays put).
 *
 * @param clock - The clock.
 * @param dt - Elapsed seconds.
 * @returns True if it has just reached the end of spring by itself.
 */
export function advanceSeason(clock: SeasonClock, dt: number): boolean {
  if (clock.time < SEASON_AUTO_END_SECONDS) {
    clock.time = Math.min(SEASON_AUTO_END_SECONDS, clock.time + dt)
    return clock.time >= SEASON_AUTO_END_SECONDS
  }
  return false
}

/**
 * Index into `SEASON_SEGMENTS` of the segment a time falls in.
 *
 * @param time - Seconds along the timeline.
 */
export function seasonIndexAt(time: number): number {
  return Math.max(0, Math.min(SEASON_SEGMENTS.length - 1, Math.floor(time / SEGMENT_SECONDS)))
}

/**
 * The general trend of the base drop rate, without the wobble: the default (1) all summer, rising
 * to a big surplus in the middle of mid fall (the animals must stock up for winter), falling fairly
 * quickly to 0 at the start of mid winter, and 0 after that.
 *
 * @param time - Seconds along the timeline.
 */
export function trendDropRate(time: number): number {
  const u = time / SEGMENT_SECONDS
  if (u <= 1) {
    return 1
  }
  if (u <= 2.5) {
    return 1 + ((PEAK_RATE - 1) * (u - 1)) / 1.5
  }
  if (u <= 5) {
    return PEAK_RATE * (1 - (u - 2.5) / 2.5)
  }
  return 0
}

/**
 * The base acorn drop rate (1 is the default rate): the seasonal trend with a little random wobble.
 *
 * @param clock - The clock (its phases shape the wobble).
 * @param time - Seconds along the timeline.
 */
export function baseDropRate(clock: SeasonClock, time: number): number {
  const trend = trendDropRate(time) * TIMELINE_RATE_FACTOR
  if (trend <= 0) {
    return 0
  }
  let wobble = 0
  WAVES.forEach(([period, weight], index) => {
    wobble += weight * Math.sin((time / period) * Math.PI * 2 + (clock.phases[index] ?? 0))
  })
  return Math.max(0, trend * (1 + WOBBLE * wobble))
}
