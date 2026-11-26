/**
 * Leaves falling in fall: now and then, in mid fall and the first half of late fall, a few come down at a time,
 * swinging from side to side as the air holds them back, from above the screen until they meet the ground of
 * the foreground (where they stay lying) or the creek (where they soon sink out of sight).
 */
import { fallTones } from './leafColors'
import { drawLeaf } from './oak'
import { SEGMENT_SECONDS } from './seasons'
import { snowAt } from './snow'
import { groundYAt, inWater } from './terrain'
import type { World } from './types'

/** The spells in which leaves fall: when each starts and ends, in segments (mid fall is 2-3, late fall 3-4). */
const SPELLS: [number, number][] = [
  [2.06, 2.3],
  [2.5, 2.72],
  [2.92, 3.14],
  [3.3, 3.5],
]

/** Seconds a spell takes to build up and to die down. */
const RAMP_SECONDS = 3

/** Leaves starting to fall per second at a spell's height, over the stretch leaves are made for. */
const SPAWN_PER_SECOND = 1.35

/** How far past each side of the screen leaves are made too (so some are already there when the view moves). */
const SPAWN_MARGIN = 300

/** Most leaves left lying (the oldest go first). */
const MAX_RESTING = 80

/** Seconds a leaf that fell on the water takes to sink out of sight. */
const SINK_SECONDS = 2.5

/** A falling leaf, or one that has come down. */
type FallingLeaf = {
  /** Where the middle of its swing is. */
  centerX: number
  x: number
  y: number
  /** Where along its swing it is (radians), how fast that goes, and how wide it is (px). */
  phase: number
  rate: number
  swing: number
  /** Average fall speed (px per second) and sideways drift. */
  speed: number
  drift: number
  length: number
  angle: number
  color: string
  landed: boolean
  /** On the water: seconds since it landed (0 on the ground). */
  sinking: number
  onWater: boolean
}

type LeafFall = { leaves: FallingLeaf[]; lastMs: number; due: number }

const falls = new WeakMap<World, LeafFall>()

/**
 * Random number in `[min, max)`.
 *
 * @param min - Inclusive lower bound.
 * @param max - Exclusive upper bound.
 */
function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * How strongly leaves are falling, 0-1.
 *
 * @param time - Seconds along the timeline.
 */
export function leafFallAt(time: number): number {
  let strongest = 0
  for (const [from, to] of SPELLS) {
    const rise = Math.max(0, Math.min(1, (time - from * SEGMENT_SECONDS) / RAMP_SECONDS))
    const ebb = Math.max(0, Math.min(1, (to * SEGMENT_SECONDS - time) / RAMP_SECONDS))
    strongest = Math.max(strongest, rise * ebb)
  }
  return strongest
}

/**
 * A new leaf just above the screen, in the fall color of one of the trees.
 *
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param cameraY - View top edge.
 * @param viewWidth - Viewport width.
 */
function newLeaf(world: World, cameraX: number, cameraY: number, viewWidth: number): FallingLeaf {
  const tree = world.trees[Math.floor(Math.random() * world.trees.length)]
  const tones = fallTones(tree?.shape.leaf.hue ?? 30, between(-8, 8), null, tree?.shape.leaf.sat)
  const x = cameraX + between(-SPAWN_MARGIN, viewWidth + SPAWN_MARGIN)
  return {
    centerX: x,
    x,
    y: cameraY - between(20, 60),
    phase: between(0, Math.PI * 2),
    rate: between(1.7, 2.7),
    swing: between(28, 62),
    speed: between(60, 90),
    drift: between(-12, 12),
    // About as big as the larger leaves of the litter.
    length: between(26, 36),
    angle: Math.PI / 2,
    color: tones[1 + Math.floor(Math.random() * (tones.length - 1))] ?? '#b5702f',
    landed: false,
    sinking: 0,
    onWater: false,
  }
}

/**
 * Moves the falling leaves on and starts new ones during a spell.
 *
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param cameraY - View top edge.
 * @param viewWidth - Viewport width.
 */
export function updateLeafFall(world: World, cameraX: number, cameraY: number, viewWidth: number): void {
  let fall = falls.get(world)
  if (!fall) {
    fall = { leaves: [], lastMs: performance.now(), due: 0 }
    falls.set(world, fall)
  }
  const now = performance.now()
  const dt = Math.min(0.05, Math.max(0, (now - fall.lastMs) / 1000))
  fall.lastMs = now
  const strength = leafFallAt(world.season.time)
  if (strength > 0) {
    fall.due += SPAWN_PER_SECOND * strength * dt
    while (fall.due >= 1) {
      fall.due -= 1
      fall.leaves.push(newLeaf(world, cameraX, cameraY, viewWidth))
    }
  }
  let resting = 0
  for (const leaf of fall.leaves) {
    if (leaf.landed) {
      resting += 1
      if (leaf.onWater) {
        leaf.sinking += dt
      }
      continue
    }
    leaf.phase += leaf.rate * dt
    leaf.centerX += leaf.drift * dt
    leaf.x = leaf.centerX + Math.sin(leaf.phase) * leaf.swing
    // It drops fastest through the middle of a swing and nearly hangs at either end, tipped up toward that side.
    leaf.y += leaf.speed * (0.3 + 1.4 * Math.cos(leaf.phase) ** 2) * dt
    leaf.angle = Math.PI / 2 - Math.sin(leaf.phase) * 0.8
    const water = inWater(world.terrain, leaf.x)
    const surface = water ? world.terrain.creek.waterY : groundYAt(world.terrain, leaf.x) + 3
    if (leaf.y >= surface) {
      leaf.y = surface
      leaf.landed = true
      leaf.onWater = water
      leaf.angle = Math.PI / 2 + between(-0.25, 0.25)
    }
  }
  // Leaves sunk, left far behind in the air, or over the number that may lie about are let go.
  let extra = resting - MAX_RESTING
  fall.leaves = fall.leaves.filter((leaf) => {
    if (leaf.sinking >= SINK_SECONDS) {
      return false
    }
    if (!leaf.landed) {
      return leaf.x > cameraX - viewWidth && leaf.x < cameraX + viewWidth * 2
    }
    if (extra > 0) {
      extra -= 1
      return false
    }
    return true
  })
}

/**
 * Draws the leaves that have come down, or the ones still in the air.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param which - 'resting' (behind the birds) or 'air' (in front of the scene).
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
export function drawLeafFall(
  ctx: CanvasRenderingContext2D,
  world: World,
  which: 'resting' | 'air',
  cameraX: number,
  viewWidth: number,
): void {
  for (const leaf of falls.get(world)?.leaves ?? []) {
    if (leaf.landed !== (which === 'resting') || leaf.x < cameraX - 30 || leaf.x > cameraX + viewWidth + 30) {
      continue
    }
    if (leaf.landed) {
      // One on the ground disappears under the snow; one on the water sinks.
      const alpha = leaf.onWater ? 1 - leaf.sinking / SINK_SECONDS : 1 - snowAt(leaf.x, 0, world.season.time)
      if (alpha <= 0.01) {
        continue
      }
      ctx.globalAlpha = alpha
      drawLeaf(ctx, leaf.x, leaf.y, leaf.length, leaf.angle, leaf.color, true)
      ctx.globalAlpha = 1
    } else {
      // Turning over as it swings: seen more edge-on at the ends of a swing.
      ctx.save()
      ctx.translate(leaf.x, leaf.y)
      ctx.rotate(leaf.angle - Math.PI / 2)
      ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(leaf.phase)))
      drawLeaf(ctx, 0, 0, leaf.length, Math.PI / 2, leaf.color, true)
      ctx.restore()
    }
  }
}
