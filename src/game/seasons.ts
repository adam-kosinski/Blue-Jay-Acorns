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

/**
 * Times (in segments, 1 = the start of early fall) at which the trees' leaves change, so a bounded number
 * of distinct looks exists: a quarter, half, three quarters and all of the trees turn color at 1.5, 2, 2.5
 * and 3 (half of them by the end of early fall, all of them by the end of mid fall); a quarter, half and
 * all of them have lost their leaves at 3.33, 3.67 and 4 (the start of winter).
 */
const LEAF_STEPS = [1.5, 2, 2.5, 3, 10 / 3, 11 / 3, 4]
const COLORED_AT = [0.25, 0.5, 0.75, 1]
const BARE_AT = [0.25, 0.5, 1]

/**
 * The leaf stage at a time: how many of the steps have passed (0 is summer, all green). The trees only
 * look different when the stage changes.
 *
 * @param time - Seconds along the timeline.
 */
export function leafStageAt(time: number): number {
  const u = time / SEGMENT_SECONDS
  return LEAF_STEPS.filter((step) => u >= step).length
}

/**
 * What a tree's leaves look like at a time: green in summer, in its fall color once its rank has come
 * up (a quarter of the trees at 1.5 segments, half by the end of early fall, all by the end of mid
 * fall), and gone once its other rank has (a quarter, then half of the trees in late fall, all of them
 * from the start of winter, through spring for now).
 *
 * @param leaf - The tree's seasonal traits.
 * @param time - Seconds along the timeline.
 */
export function leafStateAt(leaf: { colorRank: number; bareRank: number }, time: number): 'green' | 'fall' | 'bare' {
  const stage = leafStageAt(time)
  const colored = stage >= 1 ? (COLORED_AT[Math.min(stage, 4) - 1] ?? 0) : 0
  const bare = stage >= 5 ? (BARE_AT[stage - 5] ?? 1) : 0
  if (leaf.bareRank < bare) {
    return 'bare'
  }
  return leaf.colorRank < colored ? 'fall' : 'green'
}

/** Greatest relative wobble of the drop rate around the seasonal trend. */
const WOBBLE = 0.15

/** The wobble's three sine waves: periods in seconds and relative strength (they sum to 1). */
const WAVES: [number, number][] = [
  [41, 0.5],
  [17, 0.3],
  [7, 0.2],
]

/** Highest base drop rate the trend and wobble can reach (the graph's scale). */
export const MAX_BASE_DROP_RATE = 1.25 * (1 + WOBBLE)

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
 * to a 25% surplus in the middle of mid fall, falling to 0 in the middle of mid winter, and 0 after that.
 *
 * @param time - Seconds along the timeline.
 */
export function trendDropRate(time: number): number {
  const u = time / SEGMENT_SECONDS
  if (u <= 1) {
    return 1
  }
  if (u <= 2.5) {
    return 1 + (0.25 * (u - 1)) / 1.5
  }
  if (u <= 5.5) {
    return 1.25 * (1 - (u - 2.5) / 3)
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
