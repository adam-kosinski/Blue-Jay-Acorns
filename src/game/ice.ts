/**
 * Ice on the creek: it freezes over (a fade to a lighter, shinier blue) in the first part of mid winter and
 * melts at the start of late winter by breaking up into floes that shrink away, much like the snow patches.
 */
import { SEGMENT_SECONDS } from './seasons'

/** The ice's colors (lighter and bluer than the water). */
export const ICE_TOP = '#e3f2fc'
export const ICE_BOTTOM = '#b9d9ee'

/** Width and height of a cell of the floe grid, in world pixels. */
export const ICE_CELL_X = 110
export const ICE_CELL_Y = 62

/** Length of the freezing fade, in segments (about 14 seconds). */
const FREEZE_FADE = 14 / SEGMENT_SECONDS

/**
 * Smoothstep.
 *
 * @param x - 0-1 (clamped).
 */
function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}

/**
 * How frozen the creek is, 0-1: a fade a quarter of the way into mid winter.
 *
 * @param time - Seconds along the timeline.
 */
export function iceFreeze(time: number): number {
  const u = time / SEGMENT_SECONDS
  return smooth((u - (5.25 - FREEZE_FADE / 2)) / FREEZE_FADE)
}

/**
 * How much of the creek's surface is still ice, 0-1: all of it until the start of late winter, then breaking
 * up and melting away in floes over about 0.8 of a segment.
 *
 * @param time - Seconds along the timeline.
 */
export function iceCover(time: number): number {
  const u = time / SEGMENT_SECONDS
  if (u <= 6) {
    return 1
  }
  if (u >= 6.8) {
    return 0
  }
  return 1 - (u - 6) / 0.8
}

/**
 * A repeatable number in [0, 1) for a cell and a purpose.
 *
 * @param i - Cell column.
 * @param j - Cell row.
 * @param k - Which number.
 */
export function iceHash(i: number, j: number, k: number): number {
  let h = Math.imul(i + 4093, 374761393) ^ Math.imul(j + 1297, 668265263) ^ Math.imul(k + 31, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** One floe, in cell units. */
export type Floe = { x: number; y: number; rx: number; ry: number; p1: number; p2: number }

/**
 * The floe in a cell for a share of the surface that is ice (null once it has melted): each floe has its own
 * point at which it is gone, and shrinks toward it; together they close up into one sheet at a cover of 1.
 *
 * @param i - Cell column.
 * @param j - Cell row.
 * @param cover - Share of the surface that is ice, 0-1.
 */
export function iceFloe(i: number, j: number, cover: number): Floe | null {
  const grow = Math.max(0, Math.min(1, (cover - 0.7 * iceHash(i, j, 3)) / 0.3))
  if (grow <= 0) {
    return null
  }
  const eased = smooth(grow)
  const merge = smooth((cover - 0.9) / 0.1)
  const size = 0.62 + 0.45 * merge
  return {
    x: i + 0.5 + (iceHash(i, j, 1) - 0.5) * 0.5,
    y: j + 0.5 + (iceHash(i, j, 2) - 0.5) * 0.5,
    rx: 0.55 * size * 1.5 * eased,
    ry: 0.55 * size * 1.5 * eased,
    p1: iceHash(i, j, 4) * Math.PI * 2,
    p2: iceHash(i, j, 5) * Math.PI * 2,
  }
}

/**
 * How far a floe's outline is stretched in a direction (an angular, broken-ice edge).
 *
 * @param floe - The floe.
 * @param angle - Direction, radians.
 */
export function floeStretch(floe: Floe, angle: number): number {
  return 1 + 0.16 * Math.sin(3 * angle + floe.p1) + 0.1 * Math.sin(5 * angle + floe.p2) + 0.06 * Math.sin(8 * angle + floe.p1 * 2)
}
