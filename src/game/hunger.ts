import {
  ACORN_NUTRITION,
  EAT_DURATION,
  HUNGER_DRAIN_SECONDS,
  HUNGER_THRESHOLD,
} from './constants'
import type { KeyEdges, Player, World } from './types'

/**
 * Drains hunger over time and handles eating the held acorn (E) when below the threshold.
 *
 * Eating starts an animation; the acorn is consumed and the bar refilled when it ends.
 *
 * @param player - Mutable player.
 * @param edges - Fresh key presses since the last frame.
 * @param world - Acorn container (eaten acorns are removed).
 * @param dt - Elapsed seconds.
 * @param drain - False to hold hunger steady (the debug "pause hunger" toggle); eating still works.
 * @param threshold - Hunger level below which the bird may eat (the player's is higher).
 */
export function updateHunger(
  player: Player,
  edges: KeyEdges,
  world: World,
  dt: number,
  drain = true,
  threshold = HUNGER_THRESHOLD,
): void {
  if (player.eatTimer > 0) {
    player.eatTimer -= dt
    if (player.eatTimer <= 0) {
      player.eatTimer = 0
      const eaten = player.held
      if (eaten) {
        world.acorns = world.acorns.filter((acorn) => acorn !== eaten)
        player.held = null
        player.hunger = Math.min(1, player.hunger + ACORN_NUTRITION / player.hungerScale)
      }
    }
  } else if (edges.e && player.held && !player.action && player.hunger < threshold) {
    player.eatTimer = EAT_DURATION
  }
  if (drain) {
    player.hunger = Math.max(0, player.hunger - dt / (HUNGER_DRAIN_SECONDS * player.hungerScale))
  }
}
