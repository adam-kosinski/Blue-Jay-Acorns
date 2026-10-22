import {
  HOVER_OFFSET_IN_SIZES,
  MOVE_SPEED_IN_SIZES,
  VERTICAL_SPEED_IN_SIZES,
  WALK_SPEED_FACTOR,
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
 * Advances player movement and standing/flying transitions for one frame.
 *
 * @param player - Mutable player to update.
 * @param keys - Currently held WASD keys.
 * @param dt - Elapsed seconds since the last frame.
 * @param world - Play-space bounds and ground.
 */
export function updatePlayer(player: Player, keys: KeyState, dt: number, world: World): void {
  const speedFactor = player.state === 'standing' ? WALK_SPEED_FACTOR : 1
  const dx = MOVE_SPEED_IN_SIZES * speedFactor * player.size * dt
  if (keys.a) {
    player.x -= dx
    player.facing = -1
  }
  if (keys.d) {
    player.x += dx
    player.facing = 1
  }
  player.animTime += dt
  player.x = Math.max(0, Math.min(world.width - player.size, player.x))

  // Standing sticks to the terrain (uphill and downhill) unless W lifts off.
  const groundY = groundUnder(player, world)
  const wasStanding = player.state === 'standing'
  const standingOnGround = wasStanding ? !keys.w : player.y + player.size >= groundY
  if (standingOnGround) {
    player.y = groundY - player.size
    player.state = 'standing'
    player.takingOff = false
  } else {
    player.state = 'flying'
  }
  player.walking = player.state === 'standing' && keys.a !== keys.d

  const dy = VERTICAL_SPEED_IN_SIZES * player.size * dt
  const hoverY = hoverTopY(groundY, player.size)

  if (player.state === 'standing') {
    if (keys.w) {
      player.y -= dy
      player.state = 'flying'
      player.takingOff = true
    }
    return
  }

  if (keys.s) {
    player.takingOff = false
    player.y += dy
  } else if (keys.w) {
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
