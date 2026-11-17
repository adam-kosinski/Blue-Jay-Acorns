/**
 * Snow on the ground: how thick it is and how much of the ground it covers over the winter, and where the
 * patches are while it melts. Thin in early winter, a full blanket in mid winter, patchy in late winter as it
 * melts, gone in the middle of spring.
 */
import { SEGMENT_SECONDS } from './seasons'

/** Snow colors (a light blue-white, a little darker and bluer lower down in shade). */
export const SNOW_TOP = '#f7fbff'
export const SNOW_BOTTOM = '#c3d8ee'

/** The tones of the snow a hop kicks up. */
export const SNOW_PARTICLE_TONES = ['#ffffff', '#eef6ff', '#dcebfa']

/** Length of a change of the snow, in segments (about 20 seconds: while it snows). */
const SNOW_FADE = 20 / SEGMENT_SECONDS

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
 * How thick the snow is, 0-1 (it decides how much of the litter below shows through): none until the middle
 * of early winter, where it comes in thin over about 20 seconds, then at the start of mid winter it goes to a
 * full layer the same way (it snows during both, see `snowfallAt`).
 *
 * @param time - Seconds along the timeline.
 */
export function snowThickness(time: number): number {
  const u = time / SEGMENT_SECONDS
  return 0.55 * smooth((u - (4.5 - SNOW_FADE / 2)) / SNOW_FADE) + 0.45 * smooth((u - (5 - SNOW_FADE / 2)) / SNOW_FADE)
}

/**
 * The share of the particles a hop kicks up that are snow where there is snow: none before the middle of
 * early winter, half in its second half, all of them from mid winter on.
 *
 * @param time - Seconds along the timeline.
 */
export function snowKickShare(time: number): number {
  const u = time / SEGMENT_SECONDS
  return u < 4.5 ? 0 : u < 5 ? 0.5 : 1
}

/**
 * How much snow lies on top of a rock or other object (the same schedule as the ground's, and melting at its
 * own moment of the melt).
 *
 * @param time - Seconds along the timeline.
 * @param key - A number 0-1 of its own (its moment of the melt).
 */
export function snowCapAmount(time: number, key: number): number {
  const thickness = snowThickness(time)
  if (thickness <= 0) {
    return 0
  }
  return thickness * smooth((snowCover(time) - 0.6 * key) / 0.4)
}

/**
 * How much of the ground the snow covers, 0-1: all of it through mid winter, then melting away in patches
 * through late winter and spring.
 *
 * @param time - Seconds along the timeline.
 */
export function snowCover(time: number): number {
  const u = time / SEGMENT_SECONDS
  if (u <= 6) {
    return 1
  }
  if (u >= 7.4) {
    return 0
  }
  return 1 - (u - 6) / 1.4
}

/** Width of a cell of the patch grid, along the ground. */
export const SNOW_CELL_X = 150

/** Height of a cell of the patch grid, down into the ground from its surface. */
export const SNOW_CELL_DEPTH = 100

/**
 * A repeatable number in [0, 1) for a cell and a purpose.
 *
 * @param i - Cell column.
 * @param j - Cell row.
 * @param k - Which number.
 */
function hash(i: number, j: number, k: number): number {
  let h = Math.imul(i + 1013, 374761393) ^ Math.imul(j + 7919, 668265263) ^ Math.imul(k + 17, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** One patch of snow at some moment of the melt. */
export type SnowBlob = {
  x: number
  /** Depth below the ground surface of its center. */
  depth: number
  rx: number
  ry: number
  /** Shape wobble phases. */
  p1: number
  p2: number
}

/**
 * The patch in a grid cell as it is for a share of the ground covered, or null if it has melted away: each
 * patch has its own point at which it appears, and grows from there to its full size, which (with the
 * neighbours) covers the whole ground at a cover of 1.
 *
 * @param i - Cell column.
 * @param j - Cell row.
 * @param cover - Share of the ground covered, 0-1.
 */
export function snowBlob(i: number, j: number, cover: number): SnowBlob | null {
  const grow = Math.max(0, Math.min(1, (cover - 0.75 * hash(i, j, 3)) / 0.25))
  if (grow <= 0) {
    return null
  }
  const eased = grow * grow * (3 - 2 * grow)
  // The patches stay smaller than their cells until the very end of the melt (when they merge into one blanket).
  const merge = Math.max(0, Math.min(1, (cover - 0.9) / 0.1))
  const size = 0.7 + 0.35 * merge * merge * (3 - 2 * merge)
  return {
    x: (i + 0.5 + (hash(i, j, 1) - 0.5) * 0.6) * SNOW_CELL_X,
    depth: (j + 0.5 + (hash(i, j, 2) - 0.5) * 0.6) * SNOW_CELL_DEPTH,
    rx: SNOW_CELL_X * size * eased,
    ry: SNOW_CELL_DEPTH * size * 1.05 * eased,
    p1: hash(i, j, 4) * Math.PI * 2,
    p2: hash(i, j, 5) * Math.PI * 2,
  }
}

/**
 * How much a patch's outline is stretched in a direction (an uneven, organic edge).
 *
 * @param blob - The patch.
 * @param angle - Direction, radians.
 */
export function blobStretch(blob: SnowBlob, angle: number): number {
  return 1 + 0.12 * Math.sin(3 * angle + blob.p1) + 0.07 * Math.sin(5 * angle + blob.p2)
}

/**
 * Whether a point of the ground is under snow, 0-1 (the thickness if it is, 0 if the snow has melted there).
 *
 * @param x - Along the ground.
 * @param depth - Below the ground's surface (0 at the surface or above it).
 * @param time - Seconds along the timeline.
 */
export function snowAt(x: number, depth: number, time: number): number {
  const thickness = snowThickness(time)
  if (thickness <= 0) {
    return 0
  }
  const cover = snowCover(time)
  if (cover >= 0.999) {
    return thickness
  }
  if (cover <= 0) {
    return 0
  }
  const d = Math.max(0, depth)
  const ci = Math.floor(x / SNOW_CELL_X)
  const cj = Math.floor(d / SNOW_CELL_DEPTH)
  for (let i = ci - 1; i <= ci + 1; i += 1) {
    for (let j = cj - 1; j <= cj + 1; j += 1) {
      const blob = snowBlob(i, j, cover)
      if (!blob) {
        continue
      }
      const dx = (x - blob.x) / blob.rx
      const dy = (d - blob.depth) / blob.ry
      const distance = Math.hypot(dx, dy)
      if (distance < blobStretch(blob, Math.atan2(dy, dx))) {
        return thickness
      }
    }
  }
  return 0
}
