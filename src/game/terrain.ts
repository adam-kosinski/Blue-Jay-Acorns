import { PLAYER_VIEW_FRACTION } from './constants'
import type { Creek, Terrain } from './types'

/** Horizontal spacing of precomputed ground heights, in pixels. */
export const TERRAIN_STEP = 8

/** Large-scale land pattern: amplitude and wavelength in viewport heights. */
const LARGE_AMPLITUDE_VIEW_FRACTION = 0.5
const LARGE_WAVELENGTH_VIEW_FRACTION = 6

/** Small-scale local variation: finer wavelength, smaller amplitude. */
const SMALL_AMPLITUDE_VIEW_FRACTION = 0.09
const SMALL_WAVELENGTH_VIEW_FRACTION = 0.3

/** Creek geometry in player sizes: half the water width, bank slope width, and deepest point below the waterline. */
const CREEK_HALF_WIDTH_IN_SIZES = 3
const CREEK_BANK_IN_SIZES = 5
const CREEK_DEPTH_IN_SIZES = 1.8
/** Waterline height above the flat reference ground, in player sizes. */
const CREEK_WATER_LEVEL_IN_SIZES = 0.6

/** Sideways drift per layer toward the creek's overall direction, in creek half widths. */
export const CREEK_DRIFT = 0.35

/** The creek in the layer in front of the foreground is this fraction as wide as the foreground's creek. */
const CREEK_FRONT_SHRINK = 0.78

/**
 * Standard normal sample (Box-Muller).
 */
function randNormal(): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Smoothstep falloff for creek banks: 1 up to the water's edge, 0 beyond the bank's top.
 *
 * @param distance - Horizontal distance from the creek's center.
 * @param halfWidth - Half the water width.
 * @param bank - Width of the sloping bank.
 */
export function creekWeight(distance: number, halfWidth: number, bank: number): number {
  if (distance <= halfWidth) {
    return 1
  }
  if (distance >= halfWidth + bank) {
    return 0
  }
  const t = (distance - halfWidth) / bank
  return 1 - t * t * (3 - 2 * t)
}

/**
 * Whether x is within `margin` of the creek's water (inside the water counts).
 *
 * @param creek - Creek.
 * @param x - World x.
 * @param margin - Extra distance beyond the water's edge.
 */
export function nearCreek(creek: Creek, x: number, margin: number): boolean {
  return Math.abs(x - creek.x) < creek.halfWidth + margin
}

/**
 * Whether x lies over the creek's water.
 *
 * @param terrain - Terrain holding the creek.
 * @param x - World x.
 */
export function inWater(terrain: Terrain, x: number): boolean {
  return Math.abs(x - terrain.creek.x) < terrain.creek.halfWidth
}

/**
 * Bed height below the waterline at a distance from the creek's center (0 at the edges).
 *
 * @param distance - Horizontal distance from the center.
 * @param halfWidth - Half the water width.
 * @param depth - Deepest point.
 */
export function creekBedDepth(distance: number, halfWidth: number, depth: number): number {
  // Squared so the bed levels off at the water's edge: the water tapers in smoothly, with no point.
  const u = distance / halfWidth
  const bowl = Math.max(0, 1 - u * u)
  return depth * bowl * bowl
}

/**
 * Smoothstep fade used by Perlin noise.
 *
 * @param t - Value in `[0, 1]`.
 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Creates a 1D Perlin noise function with random gradients.
 *
 * @returns Function mapping x to a value roughly in `[-1, 1]`.
 */
function createPerlin1D(): (x: number) => number {
  const size = 256
  const gradients = Array.from({ length: size }, () => Math.random() * 2 - 1)
  return (x: number): number => {
    const xi = Math.floor(x)
    const t = x - xi
    const g0 = gradients[xi & (size - 1)] ?? 0
    const g1 = gradients[(xi + 1) & (size - 1)] ?? 0
    const a = g0 * t
    const b = g1 * (t - 1)
    return 2 * (a + (b - a) * fade(t))
  }
}

/**
 * Builds ground heights for the whole world from two scales of Perlin noise.
 *
 * A large, tall scale shapes the overall land; a small, fine scale adds local bumps.
 * Terrain only rises above the flat reference line, so the dirt strip always reaches the world bottom.
 *
 * @param worldWidth - Full world width.
 * @param baseY - Flat reference ground Y (the lowest the surface gets).
 * One location is chosen for a creek (away from the world's edges and the player's start): the land
 * there is lowered to the waterline, with a bed just below it and banks sloping up to the normal terrain.
 *
 * @param viewHeight - Window height (scales wavelengths and amplitudes).
 */
export function buildTerrain(worldWidth: number, baseY: number, viewHeight: number): Terrain {
  const large = createPerlin1D()
  const small = createPerlin1D()
  const largeAmp = viewHeight * LARGE_AMPLITUDE_VIEW_FRACTION
  const smallAmp = viewHeight * SMALL_AMPLITUDE_VIEW_FRACTION
  const largeLen = viewHeight * LARGE_WAVELENGTH_VIEW_FRACTION
  const smallLen = viewHeight * SMALL_WAVELENGTH_VIEW_FRACTION
  const size = viewHeight * PLAYER_VIEW_FRACTION
  const halfWidth = CREEK_HALF_WIDTH_IN_SIZES * size
  let creekX = worldWidth / 2
  while (Math.abs(creekX - worldWidth / 2) < worldWidth * 0.1) {
    creekX = worldWidth * (0.12 + 0.76 * Math.random())
  }
  // One random direction shared by every layer: the creek tends to wander that way as it recedes.
  const drift = Math.random() < 0.5 ? -1 : 1
  const creek: Creek = {
    x: creekX,
    halfWidth,
    bank: CREEK_BANK_IN_SIZES * size,
    waterY: baseY - CREEK_WATER_LEVEL_IN_SIZES * size,
    depth: CREEK_DEPTH_IN_SIZES * size,
    // The imaginary layer in front of the foreground follows the same rule as the background ones,
    // mirrored: a gaussian offset (4 SD = the creek's width, at most half of it) and a wider creek.
    drift,
    frontOffset: Math.max(
      -halfWidth,
      Math.min(halfWidth, -drift * halfWidth * CREEK_DRIFT + (randNormal() * halfWidth) / 2),
    ),
    frontHalfWidth: halfWidth / CREEK_FRONT_SHRINK,
  }
  const count = Math.ceil(worldWidth / TERRAIN_STEP) + 2
  const heights = new Float32Array(count)
  const coarse = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const x = i * TERRAIN_STEP
    coarse[i] = largeAmp * (0.5 + 0.5 * Math.max(-1, Math.min(1, large(x / largeLen))))
    const lift =
      coarse[i] +
      smallAmp * (0.5 + 0.5 * Math.max(-1, Math.min(1, small(x / smallLen))))
    const land = baseY - lift
    const distance = Math.abs(x - creek.x)
    const weight = creekWeight(distance, creek.halfWidth, creek.bank)
    const bed = creek.waterY + creekBedDepth(distance, creek.halfWidth, creek.depth)
    heights[i] = land + (bed - land) * weight
  }
  return { step: TERRAIN_STEP, heights, creek, coarse }
}

/**
 * Samples a lift array (coarse or fine terrain noise, in pixels above the base line) at x with
 * linear interpolation; x outside the array clamps to its ends.
 *
 * @param samples - Lift values at `TERRAIN_STEP` spacing.
 * @param x - Position along the array's own x axis.
 */
export function liftAt(samples: Float32Array, x: number): number {
  const last = samples.length - 1
  const f = Math.max(0, Math.min(last, x / TERRAIN_STEP))
  const i = Math.min(last - 1, Math.floor(f))
  const a = samples[i] ?? 0
  const b = samples[i + 1] ?? a
  return a + (b - a) * (f - i)
}

/**
 * Builds one background layer's own fine terrain noise (the same small-scale Perlin as the
 * foreground's fine layer, but an independent instance), so layers share the coarse hills of the
 * foreground terrain and differ only in their small bumps.
 *
 * @param length - Width of the layer.
 * @param viewHeight - Window height (scales wavelength and amplitude).
 */
export function buildFineNoise(length: number, viewHeight: number): Float32Array {
  const small = createPerlin1D()
  const amp = viewHeight * SMALL_AMPLITUDE_VIEW_FRACTION
  const len = viewHeight * SMALL_WAVELENGTH_VIEW_FRACTION
  const count = Math.ceil(length / TERRAIN_STEP) + 2
  const fine = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    fine[i] = amp * (0.5 + 0.5 * Math.max(-1, Math.min(1, small((i * TERRAIN_STEP) / len))))
  }
  return fine
}

/**
 * Ground surface Y at a world x, linearly interpolated between samples.
 *
 * @param terrain - Precomputed heights.
 * @param x - World x.
 */
export function groundYAt(terrain: Terrain, x: number): number {
  const last = terrain.heights.length - 1
  const f = Math.max(0, Math.min(last, x / terrain.step))
  const i = Math.min(last - 1, Math.floor(f))
  const a = terrain.heights[i] ?? 0
  const b = terrain.heights[i + 1] ?? a
  return a + (b - a) * (f - i)
}
