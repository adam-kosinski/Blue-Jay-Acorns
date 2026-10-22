import type { Terrain } from './types'

/** Horizontal spacing of precomputed ground heights, in pixels. */
export const TERRAIN_STEP = 8

/** Large-scale land pattern: amplitude and wavelength in viewport heights. */
const LARGE_AMPLITUDE_VIEW_FRACTION = 0.5
const LARGE_WAVELENGTH_VIEW_FRACTION = 6

/** Small-scale local variation: finer wavelength, smaller amplitude. */
const SMALL_AMPLITUDE_VIEW_FRACTION = 0.09
const SMALL_WAVELENGTH_VIEW_FRACTION = 0.3

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
 * @param viewHeight - Window height (scales wavelengths and amplitudes).
 */
export function buildTerrain(worldWidth: number, baseY: number, viewHeight: number): Terrain {
  const large = createPerlin1D()
  const small = createPerlin1D()
  const largeAmp = viewHeight * LARGE_AMPLITUDE_VIEW_FRACTION
  const smallAmp = viewHeight * SMALL_AMPLITUDE_VIEW_FRACTION
  const largeLen = viewHeight * LARGE_WAVELENGTH_VIEW_FRACTION
  const smallLen = viewHeight * SMALL_WAVELENGTH_VIEW_FRACTION
  const count = Math.ceil(worldWidth / TERRAIN_STEP) + 2
  const heights = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const x = i * TERRAIN_STEP
    const lift =
      largeAmp * (0.5 + 0.5 * Math.max(-1, Math.min(1, large(x / largeLen)))) +
      smallAmp * (0.5 + 0.5 * Math.max(-1, Math.min(1, small(x / smallLen))))
    heights[i] = baseY - lift
  }
  return { step: TERRAIN_STEP, heights }
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
