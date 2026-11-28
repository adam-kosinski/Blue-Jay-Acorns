/**
 * What happens when the player's jay has starved: it takes no more controls, drifts down to the ground or the
 * creek's surface, slumps onto its belly as it comes down and closes its eyes; then the world goes dark around it and
 * the message comes up. Only the timing and the bird's path are here: render.ts draws the pose and the screen.
 */
import { HOP_DURATION } from './constants'
import { groundUnder } from './player'
import { groundYAt, inWater } from './terrain'
import type { Death, Player, World } from './types'

/** How fast a drifting bird sinks, in sizes per second, from however high. */
const SINK_SPEED_IN_SIZES = 4

/** Seconds it takes to get up to that speed. */
const SINK_EASE_SECONDS = 0.3

/** How far a drifting bird still carries forward, in sizes per second. */
const GLIDE_SPEED_IN_SIZES = 0.75

/** How fast its wings still beat on the way down, as a share of normal. */
const WEAK_WINGBEAT = 0.4

/** A bird coming down starts to slump this many seconds before it touches the ground, so that the two run together. */
const SLUMP_LEAD_SECONDS = 0.3

/** The steepest slope (radians) the slumped bird lies along. */
const SLOPE_LIMIT = 0.6

/** Seconds after the slump starts: when it runs, the eyes close, the dark comes and the message shows. */
const SLUMP = { from: 0, seconds: 1 }
const EYES = { from: 0.3, seconds: 0.93 }
const DARK = { from: 1.38, seconds: 1.8 }
const MESSAGE = { from: 2.88, seconds: 0.6 }

/** How far closed the eyes already get on the way down. */
const DROWSY = 0.35

/**
 * Smoothstep of how far into a stretch of time something is, 0 to 1.
 *
 * @param seconds - Time since the slump started (negative: not yet).
 * @param stretch - When it begins and how long it takes.
 */
function through(seconds: number, stretch: { from: number; seconds: number }): number {
  const t = Math.max(0, Math.min(1, (seconds - stretch.from) / stretch.seconds))
  return t * t * (3 - 2 * t)
}

/**
 * Seconds since the bird started to slump, or -1 before that.
 *
 * @param death - The collapse.
 */
function slumpingFor(death: Death): number {
  return death.slumpAt === null ? -1 : death.time - death.slumpAt
}

/** How far the bird has slumped onto its belly, 0-1. */
export function slumpOf(death: Death): number {
  return through(slumpingFor(death), SLUMP)
}

/** How far its eyes have closed, 0-1. */
export function eyesClosedOf(death: Death): number {
  const drowsy = DROWSY * Math.min(1, death.time)
  return drowsy + (1 - drowsy) * through(slumpingFor(death), EYES)
}

/** Seconds the hunger bar takes to fade away once the bird has starved. */
const HUNGER_BAR_FADE_SECONDS = 2

/** How solid the hunger bar still is, 1 down to 0 over the start of the collapse. */
export function hungerBarOf(death: Death): number {
  return 1 - through(death.time, { from: 0, seconds: HUNGER_BAR_FADE_SECONDS })
}

/** How far the world around it has gone dark, 0-1. */
export function darknessOf(death: Death): number {
  return through(slumpingFor(death), DARK)
}

/** How far the message (and the button to try again) has come in, 0-1. */
export function messageOf(death: Death): number {
  return through(slumpingFor(death), MESSAGE)
}

/**
 * Begins the collapse of a starved bird: whatever it was doing stops, and an acorn in its beak falls.
 *
 * @param player - Mutable player.
 */
export function startDeath(player: Player): void {
  const { size, held } = player
  if (held) {
    held.state = 'ground'
    held.vy = 0
    held.x = player.x + size / 2 + player.facing * size * 0.55
    held.y = player.y + size * 0.4
    player.held = null
  }
  player.action = null
  player.eatTimer = 0
  player.hopT = HOP_DURATION
  player.hopRest = 0
  player.takingOff = false
  player.walking = false
  player.death = {
    time: 0,
    landedAt: null,
    slumpAt: null,
    fromAir: player.state === 'flying',
    onWater: false,
    slope: 0,
  }
}

/**
 * Moves a collapsing bird on by one frame: down until it is on the ground or the creek, where it stays. The slump
 * starts on the way, just before it gets there.
 *
 * @param player - Mutable player, collapsing (see `startDeath`).
 * @param world - The creek and the ground.
 * @param dt - Elapsed seconds.
 */
export function updateDeath(player: Player, world: World, dt: number): void {
  const death = player.death
  if (!death) {
    return
  }
  death.time += dt
  if (death.landedAt !== null) {
    if (death.fromAir) {
      // The last wingbeats die away as it slumps.
      player.animTime += dt * WEAK_WINGBEAT * (1 - slumpOf(death))
    }
    return
  }
  const { size } = player
  if (player.state === 'flying') {
    const ahead = player.x + player.facing * GLIDE_SPEED_IN_SIZES * size * dt
    player.x = Math.max(0, Math.min(world.width - size, ahead))
  }
  const ground = groundUnder(player, world)
  if (player.state === 'flying') {
    const lower = player.y + SINK_SPEED_IN_SIZES * size * Math.min(1, death.time / SINK_EASE_SECONDS) * dt
    player.y = Math.min(ground - size, lower)
    if (player.y + size >= ground - 0.5) {
      player.state = 'standing'
    }
  }
  if (player.state === 'standing') {
    player.y = ground - size
  }
  // (A bird that came down from the air keeps its weak wingbeats, easing off as it slumps.)
  player.animTime += dt * (death.fromAir ? WEAK_WINGBEAT * (1 - slumpOf(death)) : 1)
  player.floating = player.state === 'standing' && inWater(world.terrain, player.x + size / 2)
  const landed = player.state === 'standing'
  if (landed) {
    death.landedAt = death.time
  }
  // Seconds until a bird in the air is down.
  const left = (ground - size - player.y) / (SINK_SPEED_IN_SIZES * size)
  if (death.slumpAt === null && (landed || (player.state === 'flying' && left <= SLUMP_LEAD_SECONDS))) {
    death.slumpAt = death.time
    // Where it is coming down (a bird still in the air carries on forward until then).
    const x = player.x + size / 2 + (landed ? 0 : player.facing * GLIDE_SPEED_IN_SIZES * size * left)
    const reach = size * 0.4
    const rise = groundYAt(world.terrain, x + reach) - groundYAt(world.terrain, x - reach)
    // On the creek it lies level, on the surface.
    death.onWater = inWater(world.terrain, x)
    death.slope = death.onWater ? 0 : Math.max(-SLOPE_LIMIT, Math.min(SLOPE_LIMIT, Math.atan2(rise, reach * 2)))
  }
}
