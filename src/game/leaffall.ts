/**
 * Leaves falling in fall: now and then, in mid fall and the first half of late fall, a few come down at a time,
 * swinging from side to side as the air holds them back, from above the screen until they meet the ground of
 * the foreground or the creek, where they fade away. Leaves are only kept around the view; a stretch that comes
 * into it is filled with the leaves that would be in the air there, as if they had been falling all along.
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

/** How far above the screen leaves start. */
const SPAWN_HEIGHT = 40

/** The average speed leaves come down at (px per second; see `newLeaf` and the swing in `updateLeafFall`). */
const MEAN_FALL_SPEED = 75

/** Seconds a leaf that has come down takes to fade away. */
const FADE_SECONDS = 2

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
  /** Seconds since it came down (0 in the air). */
  down: number
  onWater: boolean
}

/** The stretch of the world leaves are kept for: from side to side, and from its top down to the ground. */
type View = { left: number; right: number; top: number }

type LeafFall = { leaves: FallingLeaf[]; lastMs: number; due: number; seen: View | null }

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
 * A new leaf in the air at a point, in the fall color of one of the trees.
 *
 * @param world - Play space.
 * @param x - World x.
 * @param y - World y.
 */
function newLeaf(world: World, x: number, y: number): FallingLeaf {
  const tree = world.trees[Math.floor(Math.random() * world.trees.length)]
  const tones = fallTones(tree?.shape.leaf.hue ?? 30, between(-8, 8), null, tree?.shape.leaf.sat)
  const phase = between(0, Math.PI * 2)
  const swing = between(28, 62)
  return {
    centerX: x - Math.sin(phase) * swing,
    x,
    y,
    phase,
    rate: between(1.7, 2.7),
    swing,
    speed: between(60, 90),
    drift: between(-12, 12),
    // About as big as the larger leaves of the litter.
    length: between(26, 36),
    angle: Math.PI / 2 - Math.sin(phase) * 0.8,
    color: tones[1 + Math.floor(Math.random() * (tones.length - 1))] ?? '#b5702f',
    landed: false,
    down: 0,
    onWater: false,
  }
}

/**
 * Where a leaf at x comes to rest: the water's surface over the creek, else just in the ground's surface.
 *
 * @param world - Play space.
 * @param x - World x.
 */
function surfaceAt(world: World, x: number): number {
  return inWater(world.terrain, x) ? world.terrain.creek.waterY : groundYAt(world.terrain, x) + 3
}

/**
 * Fills a part of the view's stretch that has just come into it with the leaves that would be in the air there:
 * as many as there are in a steady fall, each only if leaves were falling when it would have started.
 *
 * @param world - Play space.
 * @param leaves - The leaves (added to).
 * @param left - The part's left side.
 * @param right - Its right side.
 * @param top - Its top.
 * @param bottom - Its bottom (the ground cuts it off).
 * @param view - The whole stretch (its top is where leaves start, its width what they are spread over).
 */
function fillArea(
  world: World,
  leaves: FallingLeaf[],
  left: number,
  right: number,
  top: number,
  bottom: number,
  view: View,
): void {
  const size = Math.max(0, right - left) * Math.max(0, bottom - top)
  // Leaves per square pixel: those starting each second, over the stretch's width and the distance they fall in it.
  const expected = (size * SPAWN_PER_SECOND) / ((view.right - view.left) * MEAN_FALL_SPEED)
  const count = Math.floor(expected) + (Math.random() < expected - Math.floor(expected) ? 1 : 0)
  for (let i = 0; i < count; i += 1) {
    const x = between(left, right)
    const y = between(top, bottom)
    const age = (y - view.top) / MEAN_FALL_SPEED
    if (y < surfaceAt(world, x) && Math.random() < leafFallAt(world.season.time - age)) {
      leaves.push(newLeaf(world, x, y))
    }
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
    fall = { leaves: [], lastMs: performance.now(), due: 0, seen: null }
    falls.set(world, fall)
  }
  const now = performance.now()
  const dt = Math.min(0.05, Math.max(0, (now - fall.lastMs) / 1000))
  fall.lastMs = now
  const view: View = { left: cameraX - SPAWN_MARGIN, right: cameraX + viewWidth + SPAWN_MARGIN, top: cameraY - SPAWN_HEIGHT }
  const strength = leafFallAt(world.season.time)
  if (strength > 0) {
    fall.due += SPAWN_PER_SECOND * strength * dt
    while (fall.due >= 1) {
      fall.due -= 1
      fall.leaves.push(newLeaf(world, between(view.left, view.right), view.top - between(0, 30)))
    }
  }
  for (const leaf of fall.leaves) {
    if (leaf.landed) {
      leaf.down += dt
      continue
    }
    leaf.phase += leaf.rate * dt
    leaf.centerX += leaf.drift * dt
    leaf.x = leaf.centerX + Math.sin(leaf.phase) * leaf.swing
    // It drops fastest through the middle of a swing and nearly hangs at either end, tipped up toward that side.
    leaf.y += leaf.speed * (0.3 + 1.4 * Math.cos(leaf.phase) ** 2) * dt
    leaf.angle = Math.PI / 2 - Math.sin(leaf.phase) * 0.8
    const surface = surfaceAt(world, leaf.x)
    if (leaf.y >= surface) {
      leaf.y = surface
      leaf.landed = true
      leaf.onWater = inWater(world.terrain, leaf.x)
      leaf.angle = Math.PI / 2 + between(-0.25, 0.25)
    }
  }
  // Leaves that have faded away, or are in the air outside the stretch, are let go.
  fall.leaves = fall.leaves.filter((leaf) =>
    leaf.landed ? leaf.down < FADE_SECONDS : leaf.x > view.left - 100 && leaf.x < view.right + 100 && leaf.y > view.top - 100,
  )
  // What has just come into the stretch is filled: all of it the first time, then a strip at a side or at the top.
  const seen = fall.seen
  const ground = world.height
  if (!seen) {
    fillArea(world, fall.leaves, view.left, view.right, view.top, ground, view)
  } else {
    if (view.right > seen.right) {
      fillArea(world, fall.leaves, Math.max(view.left, seen.right), view.right, view.top, ground, view)
    }
    if (view.left < seen.left) {
      fillArea(world, fall.leaves, view.left, Math.min(view.right, seen.left), view.top, ground, view)
    }
    if (view.top < seen.top) {
      fillArea(world, fall.leaves, Math.max(view.left, seen.left), Math.min(view.right, seen.right), view.top, seen.top, view)
    }
  }
  fall.seen = view
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
      // One that has come down fades away (and does not show on snow).
      const alpha = (1 - leaf.down / FADE_SECONDS) * (leaf.onWater ? 1 : 1 - snowAt(leaf.x, 0, world.season.time))
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
