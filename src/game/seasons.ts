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
export type LeafAmounts = { shapes: number; leaves: number; fall: number }

/**
 * The looks the leaves pass through, in order: green, half colorful, fully colorful; then the large shapes go in
 * three steps while all the small leaves stay; then half of the small leaves go; after the last of these, bare.
 */
export const STAGE_LOOKS: LeafAmounts[] = [
  { shapes: 1, leaves: 1, fall: 0 },
  { shapes: 1, leaves: 1, fall: 0.5 },
  { shapes: 1, leaves: 1, fall: 1 },
  { shapes: 2 / 3, leaves: 1, fall: 1 },
  { shapes: 1 / 3, leaves: 1, fall: 1 },
  { shapes: 0, leaves: 1, fall: 1 },
  { shapes: 0, leaves: 0.5, fall: 1 },
]

/** After the last look. */
const BARE_LOOK: LeafAmounts = { shapes: 0, leaves: 0, fall: 1 }

/**
 * Where along its change (0-1) a tree or bush passes from each look to the next (the last is to bare). The same
 * for every one: only when its change starts is random (see `transitionProgress`).
 */
const STAGE_BOUNDARIES = [1 / 12, 1 / 3, 0.58, 0.66, 0.74, 0.84, 0.94]

/** Where along its change the fall color has come halfway and all the way. */
const FALL_KEYS = { half: 1 / 6, full: 1 / 2 }

/**
 * The look of a tree's or bush's leaves at a point of its change, for objects painted at that moment: the color
 * changes smoothly, and the shapes and leaves go in the steps of `STAGE_LOOKS`.
 *
 * @param progress - Its progress, 0-1 (see `transitionProgress`).
 */
export function leafLook(progress: number): LeafAmounts {
  const stage = STAGE_BOUNDARIES.filter((boundary) => progress >= boundary).length
  const look = STAGE_LOOKS[stage] ?? BARE_LOOK
  const fall =
    progress <= FALL_KEYS.half
      ? (0.5 * progress) / FALL_KEYS.half
      : 0.5 + 0.5 * Math.min(1, (progress - FALL_KEYS.half) / (FALL_KEYS.full - FALL_KEYS.half))
  return { shapes: look.shapes, leaves: look.leaves, fall: Math.max(0, fall) }
}

/** Segments between two sample moments (a sixth). */
const SAMPLE_STEP = 1 / 6

/** The number of moments along the timeline that images of the far layers are made for (one every sixth of a segment). */
export const SAMPLE_COUNT = 19

/**
 * The time of one of the sample moments: the first is the start of early fall (all summer before it), the
 * last the start of winter, with one every sixth of a segment (all winter after it).
 *
 * @param index - 0 to `SAMPLE_COUNT` - 1.
 */
export function sampleTime(index: number): number {
  return SEGMENT_SECONDS * (1 + SAMPLE_STEP * index)
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
 * index after the last).
 *
 * @param time - Seconds along the timeline.
 */
export function sampleIndexAt(time: number): number {
  return (time / SEGMENT_SECONDS - 1) / SAMPLE_STEP
}

/**
 * The two sample moments a time lies between and how far (0-1) the fade from the first to the second has
 * come: 0 for most of the interval, then a short fade (`FADE_SECONDS`) in the middle of it, then 1. So an
 * image is shown as it is, and two images are only blended during the short fade between them.
 *
 * @param time - Seconds along the timeline.
 */
export function sampleAt(time: number): { k: number; t: number } {
  const x = (time / SEGMENT_SECONDS - 1) / SAMPLE_STEP
  if (x <= 0) {
    return { k: 0, t: 0 }
  }
  if (x >= SAMPLE_COUNT - 1) {
    return { k: SAMPLE_COUNT - 2, t: 1 }
  }
  const k = Math.floor(x)
  const half = FADE_SECONDS / (SAMPLE_STEP * SEGMENT_SECONDS) / 2
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
  if (position < 0 || position >= SAMPLE_COUNT - 1) {
    return false
  }
  const through = position - Math.floor(position)
  return through > 0.5 - (FADE_SECONDS / 2 + BUILD_HOLD_LEAD) / SAMPLE_SECONDS && through < BUILD_HOLD_END
}

/**
 * The look of a tree's or bush's leaves for objects drawn from ready-made images: which look it holds
 * (`a`, an index into `STAGE_LOOKS`, or its length for bare), and while it passes to the next (`b`) over a few seconds, how far (`w`);
 * `soon` is whether a change is about to start (the next look should be made).
 *
 * @param progress - Its progress, 0-1 (see `transitionProgress`).
 */
export function leafStageMix(progress: number): { a: number; b: number; w: number; soon: boolean } {
  const width = FADE_SECONDS / (TRANSITION_SEGMENTS * SEGMENT_SECONDS)
  let stage = 0
  for (const [index, boundary] of STAGE_BOUNDARIES.entries()) {
    if (progress >= boundary + width / 2) {
      stage = index + 1
    } else if (progress > boundary - width / 2) {
      return { a: index, b: index + 1, w: smooth((progress - (boundary - width / 2)) / width), soon: true }
    }
  }
  // The next look is wanted when its change is near (about 8 seconds before it starts).
  const next = STAGE_BOUNDARIES[stage]
  return { a: stage, b: stage, w: 0, soon: next !== undefined && progress > next - width / 2 - 0.05 }
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
