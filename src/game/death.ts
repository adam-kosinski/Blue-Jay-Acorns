/**
 * What happens when the player's jay has starved: it takes no more controls, drifts down to the ground (to the
 * nearer bank if it is over the creek), slumps onto its belly and closes its eyes; then the world goes dark around
 * it and the message comes up. Only the timing and the bird's path are here: render.ts draws the pose and the screen.
 */
import { HOP_DURATION } from './constants'
import { groundUnder } from './player'
import { groundYAt, inWater } from './terrain'
import type { Death, Player, World } from './types'

/** The slowest a drifting bird sinks, and the longest the way down may take (it sinks faster from high up). */
const SINK_SPEED_IN_SIZES = 2.4
const SINK_LONGEST_SECONDS = 1.6

/** Seconds it takes to get up to that speed. */
const SINK_EASE_SECONDS = 0.3

/** How far a drifting bird still carries forward, in sizes per second. */
const GLIDE_SPEED_IN_SIZES = 0.75

/** How fast its wings still beat on the way down, as a share of normal. */
const WEAK_WINGBEAT = 0.4

/** A bird over (or right beside) the creek makes for the bank, to come down this far from the water. */
const BANK_CLEARANCE_IN_SIZES = 0.75
const BANK_SPEED_IN_SIZES = 3.2
const BANK_LONGEST_SECONDS = 1.4

/** The steepest slope (radians) the slumped bird lies along. */
const SLOPE_LIMIT = 0.6

/** Seconds after touching down: when the slump runs, the eyes close, the dark comes and the message shows. */
const SLUMP = { from: 0.17, seconds: 1 }
const EYES = { from: 0.47, seconds: 0.93 }
const DARK = { from: 1.55, seconds: 1.8 }
const MESSAGE = { from: 3.05, seconds: 0.6 }

/** How far closed the eyes already get on the way down. */
const DROWSY = 0.35

/**
 * Smoothstep of how far into a stretch of time something is, 0 to 1.
 *
 * @param seconds - Time since the bird touched down (negative: not yet).
 * @param stretch - When it begins and how long it takes.
 */
function through(seconds: number, stretch: { from: number; seconds: number }): number {
  const t = Math.max(0, Math.min(1, (seconds - stretch.from) / stretch.seconds))
  return t * t * (3 - 2 * t)
}

/**
 * Seconds since the bird touched down, or -1 while it is still on its way.
 *
 * @param death - The collapse.
 */
function downFor(death: Death): number {
  return death.landedAt === null ? -1 : death.time - death.landedAt
}

/** How far the bird has slumped onto its belly, 0-1. */
export function slumpOf(death: Death): number {
  return through(downFor(death), SLUMP)
}

/** How far its eyes have closed, 0-1. */
export function eyesClosedOf(death: Death): number {
  const drowsy = DROWSY * Math.min(1, death.time)
  return drowsy + (1 - drowsy) * through(downFor(death), EYES)
}

/** Seconds the hunger bar takes to fade away once the bird has starved. */
const HUNGER_BAR_FADE_SECONDS = 2

/** How solid the hunger bar still is, 1 down to 0 over the start of the collapse. */
export function hungerBarOf(death: Death): number {
  return 1 - through(death.time, { from: 0, seconds: HUNGER_BAR_FADE_SECONDS })
}

/** How far the world around it has gone dark, 0-1. */
export function darknessOf(death: Death): number {
  return through(downFor(death), DARK)
}

/** How far the message (and the button to try again) has come in, 0-1. */
export function messageOf(death: Death): number {
  return through(downFor(death), MESSAGE)
}

/**
 * Begins the collapse of a starved bird: whatever it was doing stops, and an acorn in its beak falls.
 *
 * @param player - Mutable player.
 * @param world - The creek and the ground.
 */
export function startDeath(player: Player, world: World): void {
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
  const center = player.x + size / 2
  const { creek } = world.terrain
  const clear = creek.halfWidth + BANK_CLEARANCE_IN_SIZES * size
  const side = center === creek.x ? player.facing : center > creek.x ? 1 : -1
  const bankX = Math.abs(center - creek.x) < clear ? creek.x + side * clear : null
  const height = Math.max(0, groundUnder(player, world) - (player.y + size))
  player.death = {
    time: 0,
    landedAt: null,
    bankX,
    across: bankX === null ? 0 : Math.max(BANK_SPEED_IN_SIZES * size, Math.abs(bankX - center) / BANK_LONGEST_SECONDS),
    sink: Math.max(SINK_SPEED_IN_SIZES * size, height / SINK_LONGEST_SECONDS),
    slope: 0,
  }
}

/**
 * Moves a collapsing bird on by one frame: down (and to the bank) until it is on the ground, where it stays.
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
    return
  }
  const { size } = player
  const { creek } = world.terrain
  let center = player.x + size / 2
  if (death.bankX !== null) {
    const left = death.bankX - center
    const step = death.across * dt
    if (Math.abs(left) <= step) {
      center = death.bankX
      death.bankX = null
    } else {
      player.facing = left > 0 ? 1 : -1
      center += player.facing * step
    }
  } else if (player.state === 'flying') {
    const ahead = center + player.facing * GLIDE_SPEED_IN_SIZES * size * dt
    // (Never back out over the water.)
    if (Math.abs(ahead - creek.x) >= creek.halfWidth + BANK_CLEARANCE_IN_SIZES * size) {
      center = ahead
    }
  }
  player.x = Math.max(0, Math.min(world.width - size, center - size / 2))
  const ground = groundUnder(player, world)
  if (player.state === 'flying') {
    // Still over the water, it stays a little above it until it has reached the bank.
    const floor = death.bankX !== null && inWater(world.terrain, center) ? ground - 0.35 * size : ground
    const lower = player.y + death.sink * Math.min(1, death.time / SINK_EASE_SECONDS) * dt
    player.y = Math.min(ground - size, Math.max(player.y, Math.min(floor - size, lower)))
    player.animTime += dt * WEAK_WINGBEAT
    if (player.y + size >= ground - 0.5) {
      player.state = 'standing'
    }
  }
  if (player.state === 'standing') {
    player.y = ground - size
    player.animTime += dt
  }
  player.floating = player.state === 'standing' && inWater(world.terrain, player.x + size / 2)
  if (player.state === 'standing' && death.bankX === null) {
    death.landedAt = death.time
    const x = player.x + size / 2
    const reach = size * 0.4
    const rise = groundYAt(world.terrain, x + reach) - groundYAt(world.terrain, x - reach)
    death.slope = Math.max(-SLOPE_LIMIT, Math.min(SLOPE_LIMIT, Math.atan2(rise, reach * 2)))
  }
}
