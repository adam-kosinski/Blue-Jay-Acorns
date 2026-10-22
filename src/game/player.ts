import {
  HOP_DURATION,
  HOP_LENGTH_IN_SIZES,
  HOVER_OFFSET_IN_SIZES,
  MOVE_SPEED_IN_SIZES,
  VERTICAL_SPEED_IN_SIZES,
} from './constants'
import { groundYAt } from './terrain'
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
    hopStartX: 0,
    hopDir: 1,
    action: null,
  }
}

/**
 * Ground surface Y under the horizontal center of the player.
 *
 * @param player - Player pose.
 * @param world - Play space with terrain.
 */
export function groundUnder(player: Player, world: World): number {
  return groundYAt(world.terrain, player.x + player.size / 2)
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
 * Moves a standing bird by hopping: while A/D are held it hops continuously at a constant ground
 * speed (half the flying speed), landing and taking off again with no pause. A hop in progress
 * always finishes; the first press hops immediately.
 *
 * @param player - Mutable player.
 * @param dir - Held direction: -1 left, 1 right, 0 none.
 * @param dt - Elapsed seconds.
 * @param speedScale - Speed multiplier (shortens the hops for slower birds).
 */
function hopOnGround(player: Player, dir: number, dt: number, speedScale: number): void {
  const length = HOP_LENGTH_IN_SIZES * player.size * speedScale
  let left = dt
  while (left > 1e-9) {
    if (player.hopT >= HOP_DURATION) {
      if (dir === 0) {
        break
      }
      player.hopT = 0
      player.hopStartX = player.x
      player.hopDir = dir > 0 ? 1 : -1
    }
    const step = Math.min(left, HOP_DURATION - player.hopT)
    player.hopT += step
    left -= step
    // Faster at the start of the hop, slower at the end (1.4x down to 0.6x of the average speed).
    const p = player.hopT / HOP_DURATION
    const eased = 0.6 * p + 0.4 * (1 - (1 - p) * (1 - p))
    player.x = player.hopStartX + player.hopDir * length * eased
  }
  // Keep hopping without a landing frame when the key is still held.
  if (player.hopT >= HOP_DURATION && dir !== 0) {
    player.hopT = 0
    player.hopStartX = player.x
    player.hopDir = dir > 0 ? 1 : -1
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
 */
export function updatePlayer(
  player: Player,
  keys: KeyState,
  dt: number,
  world: World,
  speedScale = 1,
): void {
  // While a pick-up, bury or dig-up animation plays the bird stays put.
  const busy = player.action !== null
  const wantsUp = keys.w && !busy
  const dir = busy ? 0 : (keys.d ? 1 : 0) - (keys.a ? 1 : 0)
  if (dir !== 0) {
    player.facing = dir > 0 ? 1 : -1
  }
  if (player.state === 'standing') {
    hopOnGround(player, dir, dt, speedScale)
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
  }
}
