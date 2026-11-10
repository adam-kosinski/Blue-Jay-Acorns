import {
  BEAK_REACH_X,
  HOP_DURATION,
  HOVER_OFFSET_IN_SIZES,
  MOVE_SPEED_IN_SIZES,
  WALK_SPEED_FACTOR,
  VERTICAL_SPEED_IN_SIZES,
} from './constants'
import { groundYAt, inWater } from './terrain'

/** How far a floating bird's feet line sits below the water surface, in player sizes. */
const FLOAT_SINK_IN_SIZES = 0.24
import type { KeyState, Player, World } from './types'

/**
 * Places a new player standing in the horizontal center of the world.
 *
 * @param world - Current play space.
 * @param size - Square size in pixels.
 */
export function createPlayer(world: World, size: number): Player {
  return {
    x: world.width / 2 - size / 2,
    y: groundYAt(world.terrain, world.width / 2) - size,
    size,
    state: 'standing',
    takingOff: false,
    facing: 1,
    animTime: 0,
    walking: false,
    held: null,
    hunger: 1,
    eatTimer: 0,
    hopT: HOP_DURATION,
    hopRest: 0,
    action: null,
    digFailX: null,
    dugSites: [],
    burials: [],
    invisible: false,
    hops: 0,
    floating: false,
    species: 'jay',
    reach: BEAK_REACH_X,
    hungerScale: 1,
    hidden: false,
    climbH: 0,
    climbDir: 0,
    climbSide: 1,
    sniff: -1,
  }
}

/**
 * Ground surface Y under the horizontal center of the player.
 *
 * @param player - Player pose.
 * @param world - Play space with terrain.
 */
export function groundUnder(player: Player, world: World): number {
  const x = player.x + player.size / 2
  if (inWater(world.terrain, x)) {
    // Over the creek a bird lands on the surface and floats, its body sunk a little.
    return world.terrain.creek.waterY + FLOAT_SINK_IN_SIZES * player.size
  }
  return groundYAt(world.terrain, x)
}

/**
 * Y coordinate of the sprite top when hovering at the takeoff altitude.
 *
 * @param groundY - Y coordinate of the ground surface.
 * @param playerSize - Current player square size.
 */
export function hoverTopY(groundY: number, playerSize: number): number {
  return groundY - HOVER_OFFSET_IN_SIZES * playerSize - playerSize
}

/**
 * Keeps the player inside the world after a resize or size change.
 *
 * @param player - Mutable player.
 * @param world - Current play space.
 * @param size - Square size to apply.
 */
export function syncPlayerToWorld(player: Player, world: World, size: number): void {
  const wasStanding = player.state === 'standing'
  player.size = size
  player.x = Math.max(0, Math.min(world.width - player.size, player.x))
  const groundY = groundUnder(player, world)
  if (wasStanding) {
    player.y = groundY - player.size
  } else {
    player.y = Math.max(0, Math.min(groundY - player.size, player.y))
  }
}

/**
 * Moves a standing bird by hopping. Only the hops themselves are discrete, and only vertically:
 * horizontal movement always follows the A/D keys held at that moment (so a direction change, or a
 * release, takes effect immediately, even in mid-hop). A hop in progress always finishes its arc; if
 * A or D is held when the bird lands, it hops again at once (the first press hops immediately).
 * Within a hop the ground speed is 1.4x the average at the start, easing to 0.6x at the end.
 *
 * @param player - Mutable player.
 * @param dir - Held direction: -1 left, 1 right, 0 none.
 * @param dt - Elapsed seconds.
 * @param speedScale - Speed multiplier (NPCs are slower).
 * @param restAfterHop - Seconds the bird stands still after every hop before it can hop again (squirrels).
 */
function hopOnGround(
  player: Player,
  dir: number,
  dt: number,
  speedScale: number,
  restAfterHop: number,
): void {
  const average = MOVE_SPEED_IN_SIZES * WALK_SPEED_FACTOR * speedScale * player.size
  let left = dt
  // Standing still after a hop (counts down whether or not a key is held).
  const rest = (): void => {
    if (player.hopT >= HOP_DURATION && player.hopRest > 0) {
      const used = Math.min(left, player.hopRest)
      player.hopRest -= used
      left -= used
    }
  }
  rest()
  while (left > 1e-9) {
    if (player.hopT >= HOP_DURATION) {
      if (dir === 0) {
        break
      }
      player.hopT = 0
      player.hops += 1
    }
    const step = Math.min(left, HOP_DURATION - player.hopT)
    const p = (player.hopT + step / 2) / HOP_DURATION
    player.x += dir * average * (1.4 - 0.8 * p) * step
    player.hopT += step
    left -= step
    if (player.hopT >= HOP_DURATION) {
      // Landed: rest before the next hop.
      player.hopRest = restAfterHop
      rest()
    }
  }
  // Keep hopping without a landing frame when the key is still held (unless the bird has to rest).
  if (player.hopT >= HOP_DURATION && dir !== 0 && player.hopRest <= 0) {
    player.hopT = 0
    player.hops += 1
  }
}

/**
 * Advances player movement and standing/flying transitions for one frame.
 *
 * @param player - Mutable player to update.
 * @param keys - Currently held WASD keys.
 * @param dt - Elapsed seconds since the last frame.
 * @param world - Play-space bounds and ground.
 * @param speedScale - Multiplier on flying, climbing and hopping speed (NPCs are slower).
 * @param restAfterHop - Seconds a standing bird stands still after each hop (squirrels).
 */
export function updatePlayer(
  player: Player,
  keys: KeyState,
  dt: number,
  world: World,
  speedScale = 1,
  restAfterHop = 0,
): void {
  // While a pick-up, bury or dig-up animation plays the bird stays put.
  const busy = player.action !== null
  const wantsUp = keys.w && !busy
  const dir = busy ? 0 : (keys.d ? 1 : 0) - (keys.a ? 1 : 0)
  if (dir !== 0) {
    player.facing = dir > 0 ? 1 : -1
  }
  if (player.state === 'standing' && inWater(world.terrain, player.x + player.size / 2)) {
    // On the creek there is nothing to hop from: the bird glides sideways smoothly at walking speed.
    player.x += dir * MOVE_SPEED_IN_SIZES * WALK_SPEED_FACTOR * speedScale * player.size * dt
    player.hopT = HOP_DURATION
  } else if (player.state === 'standing') {
    hopOnGround(player, dir, dt, speedScale, restAfterHop)
  } else {
    player.x += dir * MOVE_SPEED_IN_SIZES * speedScale * player.size * dt
    player.hopT = HOP_DURATION
  }
  player.animTime += dt
  player.x = Math.max(0, Math.min(world.width - player.size, player.x))

  // Standing sticks to the terrain (uphill and downhill) unless W lifts off.
  const groundY = groundUnder(player, world)
  const wasStanding = player.state === 'standing'
  const standingOnGround = wasStanding ? !wantsUp : player.y + player.size >= groundY
  if (standingOnGround) {
    player.y = groundY - player.size
    player.state = 'standing'
    player.takingOff = false
  } else {
    player.state = 'flying'
  }
  player.walking = player.state === 'standing' && dir !== 0
  player.floating = player.state === 'standing' && inWater(world.terrain, player.x + player.size / 2)

  const dy = VERTICAL_SPEED_IN_SIZES * speedScale * player.size * dt
  const hoverY = hoverTopY(groundY, player.size)

  if (player.state === 'standing') {
    if (wantsUp) {
      player.y -= dy
      player.state = 'flying'
      player.takingOff = true
    }
    return
  }

  if (keys.s) {
    player.takingOff = false
    player.y += dy
  } else if (wantsUp) {
    player.y -= dy
    if (player.y <= hoverY) {
      player.takingOff = false
    }
  } else if (player.takingOff) {
    player.y = Math.max(hoverY, player.y - dy)
    if (player.y <= hoverY) {
      player.takingOff = false
    }
  }

  player.y = Math.max(0, player.y)
  const landingY = groundUnder(player, world)
  if (player.y + player.size >= landingY) {
    player.y = landingY - player.size
    player.state = 'standing'
    player.takingOff = false
    player.floating = inWater(world.terrain, player.x + player.size / 2)
  }
}
