/**
 * Falling snow: a few hundred flakes in screen space over the foreground, when it is snowing. It snows for
 * about 20 seconds in the middle of early winter, at the start of mid winter and halfway through mid
 * winter (see `snowfallAt`), the first two as the ground whitens (see `snowThickness`).
 */
import { SEGMENT_SECONDS } from './seasons'

/** Seconds a snowfall lasts (and the ground's fades). */
export const SNOWFALL_SECONDS = 20

/** The moments (in segments along the timeline) the middle of a snowfall is at. */
export const SNOWFALL_CENTERS = [4.5, 5, 5.5]

/** Most flakes in the air at once. */
const MAX_FLAKES = 260

/** Seconds a snowfall takes to build up and to die down. */
const RAMP_SECONDS = 4

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
 * How hard it is snowing, 0-1.
 *
 * @param time - Seconds along the timeline.
 */
export function snowfallAt(time: number): number {
  let strongest = 0
  for (const center of SNOWFALL_CENTERS) {
    const d = time - center * SEGMENT_SECONDS
    const half = SNOWFALL_SECONDS / 2
    strongest = Math.max(strongest, smooth((d + half) / RAMP_SECONDS) * smooth((half - d) / RAMP_SECONDS))
  }
  return strongest
}

/** The three sizes of flake: radius, fall speed, sideways drift (px) and how much the camera moves them (depth), opacity. */
const CLASSES = [
  { radius: 1.1, speed: 38, sway: 12, depth: 0.3, alpha: 0.6 },
  { radius: 1.8, speed: 62, sway: 16, depth: 0.55, alpha: 0.8 },
  { radius: 2.7, speed: 92, sway: 20, depth: 0.85, alpha: 0.92 },
]

const flakeX = new Float32Array(MAX_FLAKES)
const flakeY = new Float32Array(MAX_FLAKES)
const flakePhase = new Float32Array(MAX_FLAKES)
const flakeRate = new Float32Array(MAX_FLAKES)
let seeded = false
let lastMs = 0
let clock = 0

/**
 * Moves the flakes and draws the ones in the air, in screen space.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param time - Seconds along the timeline.
 * @param cameraX - View left edge in the world (the flakes drift a little against it).
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 */
export function drawSnowfall(ctx: CanvasRenderingContext2D, time: number, cameraX: number, viewWidth: number, viewHeight: number): void {
  const intensity = snowfallAt(time)
  const now = performance.now()
  const dt = Math.min(0.05, Math.max(0, (now - lastMs) / 1000))
  lastMs = now
  if (intensity <= 0) {
    return
  }
  if (!seeded) {
    for (let i = 0; i < MAX_FLAKES; i += 1) {
      flakeX[i] = Math.random() * viewWidth
      flakeY[i] = Math.random() * viewHeight
      flakePhase[i] = Math.random() * Math.PI * 2
      flakeRate[i] = 0.6 + Math.random() * 0.8
    }
    seeded = true
  }
  clock += dt
  const active = Math.ceil(MAX_FLAKES * intensity)
  ctx.fillStyle = '#ffffff'
  for (let c = 0; c < CLASSES.length; c += 1) {
    const kind = CLASSES[c]
    if (!kind) {
      continue
    }
    ctx.globalAlpha = kind.alpha * Math.min(1, 0.3 + intensity)
    ctx.beginPath()
    // Flake i is of class i % 3, so every class is thinned out evenly as it eases off.
    for (let i = c; i < active; i += CLASSES.length) {
      let y = (flakeY[i] ?? 0) + kind.speed * (flakeRate[i] ?? 1) * dt
      if (y > viewHeight + 6) {
        y = -6
        flakeX[i] = Math.random() * viewWidth
      }
      flakeY[i] = y
      const wrapped = (((flakeX[i] ?? 0) - cameraX * kind.depth) % viewWidth + viewWidth) % viewWidth
      const x = wrapped + Math.sin(clock * (flakeRate[i] ?? 1) + (flakePhase[i] ?? 0)) * kind.sway
      ctx.moveTo(x + kind.radius, y)
      ctx.arc(x, y, kind.radius, 0, Math.PI * 2)
    }
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
