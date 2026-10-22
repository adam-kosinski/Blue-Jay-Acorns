import { ACORN_GRAVITY_IN_SIZES, REACH_IN_SIZES } from './constants'
import { groundYAt } from './terrain'
import type { Acorn, KeyEdges, Player, World } from './types'

/**
 * Nearest acorn in `state` within reach of the bird's center, or null.
 *
 * @param player - Bird doing the reaching.
 * @param world - Acorn container.
 * @param state - Which acorns qualify.
 * @param horizontalOnly - Compare only along x (used for buried acorns).
 */
function nearestAcorn(
  player: Player,
  world: World,
  state: Acorn['state'],
  horizontalOnly: boolean,
): Acorn | null {
  const cx = player.x + player.size / 2
  const cy = player.y + player.size / 2
  const reach = REACH_IN_SIZES * player.size
  let best: Acorn | null = null
  let bestDist = reach
  for (const acorn of world.acorns) {
    if (acorn.state !== state) {
      continue
    }
    const dist = horizontalOnly ? Math.abs(acorn.x - cx) : Math.hypot(acorn.x - cx, acorn.y - cy)
    if (dist <= bestDist) {
      best = acorn
      bestDist = dist
    }
  }
  return best
}

/**
 * Applies S (pick up / drop on the ground) and B (bury / dig up) presses for this frame.
 *
 * Both only act on a fresh press while standing, so a held S that carried the bird
 * down to the ground does nothing.
 *
 * @param player - Mutable player (holds at most one acorn).
 * @param edges - Fresh key presses since the last frame.
 * @param world - Acorn container and terrain.
 */
export function handleAcornActions(player: Player, edges: KeyEdges, world: World): void {
  if (player.state !== 'standing' || player.eatTimer > 0) {
    return
  }

  if (edges.s) {
    if (player.held) {
      player.held.state = 'ground'
      player.held.vy = 0
      player.held.x = player.x + player.size / 2 + player.facing * player.size * 0.55
      player.held.y = player.y + player.size * 0.4
      player.held = null
    } else {
      const acorn = nearestAcorn(player, world, 'ground', false)
      if (acorn) {
        acorn.state = 'held'
        player.held = acorn
      }
    }
  }

  if (edges.b) {
    if (player.held) {
      const acorn = player.held
      acorn.state = 'buried'
      acorn.x = player.x + player.size / 2 + player.facing * player.size * 0.45
      acorn.y = groundYAt(world.terrain, acorn.x) + acorn.radius * 1.5
      player.held = null
    } else {
      const acorn = nearestAcorn(player, world, 'buried', true)
      if (acorn) {
        acorn.state = 'held'
        player.held = acorn
      }
    }
  }
}

/**
 * Makes dropped acorns fall to the ground.
 *
 * @param world - Acorn container and terrain.
 * @param playerSize - Current player size (scales gravity).
 * @param dt - Elapsed seconds.
 */
export function updateAcorns(world: World, playerSize: number, dt: number): void {
  for (const acorn of world.acorns) {
    if (acorn.state !== 'ground') {
      continue
    }
    const restY = groundYAt(world.terrain, acorn.x) - acorn.radius
    if (acorn.y < restY) {
      acorn.vy += ACORN_GRAVITY_IN_SIZES * playerSize * dt
      acorn.y = Math.min(restY, acorn.y + acorn.vy * dt)
    } else {
      acorn.y = restY
      acorn.vy = 0
    }
  }
}
