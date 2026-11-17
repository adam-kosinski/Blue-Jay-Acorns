/**
 * The seasons: a timeline of eight equal segments (summer, three of fall, three of winter, spring) that
 * the game clock walks along once, from the start of summer to mid-spring. The season sets the base
 * acorn drop rate (see `baseDropRate`).
 */

/** Seconds from the start of summer to the end of spring. */
export const YEAR_SECONDS = 600

/** Seconds in one segment of the timeline (summer and spring are as long as one part of fall or winter). */
export const SEGMENT_SECONDS = YEAR_SECONDS / 8

/** The timeline stops advancing by itself in the middle of spring. */
export const SEASON_AUTO_END_SECONDS = SEGMENT_SECONDS * 7.5

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

/** Where along its change (0-1) a tree or bush is green, half colorful, fully colorful, half bare, and bare. */
const LEAF_KEYS = [0, 1 / 6, 1 / 2, 5 / 6, 1]
/** The share of its leaves that are there at each of those moments. */
const LEAF_PRESENCE = [1, 1, 1, 0.5, 0]
/** The share of the leaves there that are in fall color at each of those moments. */
const LEAF_FALL = [0, 0.5, 1, 1, 1]

/**
 * Linear interpolation along a list of keyed values.
 *
 * @param keys - Increasing positions.
 * @param values - The value at each position.
 * @param at - Where to read.
 */
function along(keys: number[], values: number[], at: number): number {
  for (let i = 1; i < keys.length; i += 1) {
    const k1 = keys[i] ?? 1
    if (at <= k1) {
      const k0 = keys[i - 1] ?? 0
      const v0 = values[i - 1] ?? 0
      const v1 = values[i] ?? 0
      return v0 + ((v1 - v0) * (at - k0)) / (k1 - k0)
    }
  }
  return values[values.length - 1] ?? 0
}

/**
 * The look of a tree's or bush's leaves at a point of its change: green, then half colorful, then fully
 * colorful (a third of the change each), then half of the leaves gone, then all of them gone.
 *
 * @param progress - Its progress, 0-1 (see `transitionProgress`).
 */
export function leafLook(progress: number): { presence: number; fall: number } {
  return { presence: along(LEAF_KEYS, LEAF_PRESENCE, progress), fall: along(LEAF_KEYS, LEAF_FALL, progress) }
}

/**
 * The same look as the opacity of a green and of a fall-colored crown drawn over each other (for
 * objects drawn from ready-made images).
 *
 * @param progress - Its progress, 0-1.
 */
export function leafAlphas(progress: number): { green: number; fall: number } {
  const { presence, fall } = leafLook(progress)
  return { green: presence * (1 - fall), fall: presence * fall }
}

/** The number of moments along the timeline that images of the far layers are made for (one every quarter segment). */
export const SAMPLE_COUNT = 13

/**
 * The time of one of the sample moments: the first is the start of early fall (all summer before it), the
 * last the start of winter, with one every quarter segment (all winter after it).
 *
 * @param index - 0 to `SAMPLE_COUNT` - 1.
 */
export function sampleTime(index: number): number {
  return SEGMENT_SECONDS * (1 + 0.25 * index)
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
 * The two sample moments a time lies between and how far (0-1) the fade from the first to the second has
 * come: 0 for most of the interval, then a short fade (`FADE_SECONDS`) in the middle of it, then 1. So an
 * image is shown as it is, and two images are only blended during the short fade between them.
 *
 * @param time - Seconds along the timeline.
 */
export function sampleAt(time: number): { k: number; t: number } {
  const x = (time / SEGMENT_SECONDS - 1) / 0.25
  if (x <= 0) {
    return { k: 0, t: 0 }
  }
  if (x >= SAMPLE_COUNT - 1) {
    return { k: SAMPLE_COUNT - 2, t: 1 }
  }
  const k = Math.floor(x)
  const half = FADE_SECONDS / (0.25 * SEGMENT_SECONDS) / 2
  return { k, t: smooth((x - k - (0.5 - half)) / (2 * half)) }
}

/** The looks of the leaves of a tree or bush it holds between changes: green, half colorful, fully colorful, half bare (then bare). */
export const STAGE_LOOKS: { presence: number; fall: number }[] = [
  { presence: 1, fall: 0 },
  { presence: 1, fall: 0.5 },
  { presence: 1, fall: 1 },
  { presence: 0.5, fall: 1 },
]

/** Where along its change a tree or bush passes from one of those looks to the next (halfway between their keys). */
const STAGE_BOUNDARIES = [1 / 12, 1 / 3, 2 / 3, 11 / 12]

/**
 * The look of a tree's or bush's leaves for objects drawn from ready-made images: which look it holds
 * (`a`, 0-3, or 4 for bare), and while it passes to the next (`b`) over a few seconds, how far (`w`).
 *
 * @param progress - Its progress, 0-1 (see `transitionProgress`).
 */
export function leafStageMix(progress: number): { a: number; b: number; w: number } {
  const width = FADE_SECONDS / (TRANSITION_SEGMENTS * SEGMENT_SECONDS)
  let stage = 0
  for (const [index, boundary] of STAGE_BOUNDARIES.entries()) {
    if (progress >= boundary + width / 2) {
      stage = index + 1
    } else if (progress > boundary - width / 2) {
      return { a: index, b: index + 1, w: smooth((progress - (boundary - width / 2)) / width) }
    }
  }
  return { a: stage, b: stage, w: 0 }
}

/**
 * How far the air has gone to its winter look (light blue haze): 0 until the start of winter, then a
 * linear fade to 1 in the middle of mid winter (it stays through spring for now).
 *
 * @param time - Seconds along the timeline.
 */
export function winterTintAt(time: number): number {
  const u = time / SEGMENT_SECONDS
  return Math.max(0, Math.min(1, (u - 4) / 1.5))
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

/** Highest base drop rate the trend and wobble can reach (the graph's scale). */
export const MAX_BASE_DROP_RATE = PEAK_RATE * (1 + WOBBLE)

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
 * Moves the clock forward, stopping at mid-spring (a clock already past it, set by hand, stays put).
 *
 * @param clock - The clock.
 * @param dt - Elapsed seconds.
 */
export function advanceSeason(clock: SeasonClock, dt: number): void {
  if (clock.time < SEASON_AUTO_END_SECONDS) {
    clock.time = Math.min(SEASON_AUTO_END_SECONDS, clock.time + dt)
  }
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
  const trend = trendDropRate(time)
  if (trend <= 0) {
    return 0
  }
  let wobble = 0
  WAVES.forEach(([period, weight], index) => {
    wobble += weight * Math.sin((time / period) * Math.PI * 2 + (clock.phases[index] ?? 0))
  })
  return Math.max(0, trend * (1 + WOBBLE * wobble))
}
