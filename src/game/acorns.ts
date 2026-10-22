import {
  ACORN_DROP_CHANCE_PER_SECOND,
  ACORN_GRAVITY_IN_SIZES,
  ACORN_GROUP_MAX,
  ACORN_GROUP_MIN,
  ACORN_WORLD_CAP,
  BEAK_REACH_X,
  BURY_DURATION,
  PICKUP_DURATION,
  REACH_IN_SIZES,
  acornRadiusForPlayer,
} from './constants'
import { groundYAt } from './terrain'
import type { Acorn, KeyEdges, Player, World } from './types'

/**
 * Nearest acorn in `state` within horizontal reach of the bird's center, or null.
 *
 * @param player - Bird doing the reaching.
 * @param world - Acorn container.
 * @param state - Which acorns qualify.
 */
function nearestAcorn(player: Player, world: World, state: Acorn['state']): Acorn | null {
  const cx = player.x + player.size / 2
  const reach = REACH_IN_SIZES * player.size
  let best: Acorn | null = null
  let bestDist = reach
  for (const acorn of world.acorns) {
    if (acorn.state !== state) {
      continue
    }
    const dist = Math.abs(acorn.x - cx)
    if (dist <= bestDist) {
      best = acorn
      bestDist = dist
    }
  }
  return best
}

/**
 * Starts the pick-up animation for a ground acorn; the acorn jumps into the beak at the halfway point.
 *
 * @param player - Bird doing the pecking.
 * @param acorn - Ground acorn to pick up.
 */
export function startPickup(player: Player, acorn: Acorn): void {
  startReach(player, acorn, 'pickup', PICKUP_DURATION)
}

/**
 * Starts a pecking animation toward an acorn on or in the ground: the bird turns to it and shifts
 * sideways a little so the beak tip lands on it.
 *
 * @param player - Bird doing the pecking.
 * @param acorn - Target acorn.
 * @param kind - 'pickup' or 'dig'.
 * @param duration - Animation length in seconds.
 */
function startReach(player: Player, acorn: Acorn, kind: 'pickup' | 'dig', duration: number): void {
  player.facing = acorn.x >= player.x + player.size / 2 ? 1 : -1
  const tipX = player.x + player.size / 2 + player.facing * BEAK_REACH_X * (player.size / 100)
  const slide = Math.max(-0.5 * player.size, Math.min(0.8 * player.size, acorn.x - tipX))
  player.action = {
    kind,
    timer: 0,
    duration,
    acorn,
    spotX: acorn.x,
    transferred: false,
    slideTotal: slide,
    slideApplied: 0,
  }
}

/**
 * Starts the bury animation: the bird pecks the ground ahead of it and the acorn goes underground at
 * the halfway point.
 *
 * @param player - Bird holding an acorn.
 */
export function startBury(player: Player): void {
  const acorn = player.held
  if (!acorn) {
    return
  }
  player.action = {
    kind: 'bury',
    timer: 0,
    duration: BURY_DURATION,
    acorn,
    spotX: player.x + player.size / 2 + player.facing * BEAK_REACH_X * (player.size / 100),
    transferred: false,
    slideTotal: 0,
    slideApplied: 0,
  }
}

/**
 * Starts the dig-up animation for a buried acorn; it comes into the beak at the halfway point.
 *
 * @param player - Bird doing the digging.
 * @param acorn - Buried acorn to dig up.
 */
export function startDig(player: Player, acorn: Acorn): void {
  startReach(player, acorn, 'dig', BURY_DURATION)
}

/**
 * Advances a bird's pick-up, bury or dig-up animation and moves the acorn at the halfway point.
 *
 * If the acorn was taken meanwhile (another bird got it first), the action is cancelled.
 *
 * @param player - Bird whose action advances.
 * @param world - Terrain used to place a buried acorn.
 * @param dt - Elapsed seconds.
 */
export function updateAction(player: Player, world: World, dt: number): void {
  const action = player.action
  if (!action) {
    return
  }
  action.timer += dt
  // Shift sideways over the first part of the animation so the beak reaches the acorn.
  const slideP = Math.min(1, action.timer / (action.duration * 0.4))
  const slide = action.slideTotal * (1 - (1 - slideP) * (1 - slideP))
  player.x += slide - action.slideApplied
  player.hopStartX += slide - action.slideApplied
  action.slideApplied = slide
  if (!action.transferred && action.timer >= action.duration / 2) {
    action.transferred = true
    const acorn = action.acorn
    if (action.kind === 'bury') {
      if (player.held === acorn) {
        acorn.state = 'buried'
        acorn.x = action.spotX
        acorn.y = groundYAt(world.terrain, acorn.x) + acorn.radius * 1.5
        player.held = null
      }
    } else {
      const wanted = action.kind === 'pickup' ? 'ground' : 'buried'
      if (acorn.state === wanted && !player.held) {
        acorn.state = 'held'
        player.held = acorn
      } else {
        player.action = null
        return
      }
    }
  }
  if (action.timer >= action.duration) {
    player.action = null
  }
}

/**
 * Applies S (pick up / drop on the ground) and B (bury / dig up) presses for this frame.
 *
 * Both only act on a fresh press while standing and not already busy, so a held S that carried the
 * bird down to the ground does nothing. Pick-up, bury and dig-up play an animation first.
 *
 * @param player - Mutable player (holds at most one acorn).
 * @param edges - Fresh key presses since the last frame.
 * @param world - Acorn container and terrain.
 */
export function handleAcornActions(player: Player, edges: KeyEdges, world: World): void {
  if (player.state !== 'standing' || player.eatTimer > 0 || player.action) {
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
      const acorn = nearestAcorn(player, world, 'ground')
      if (acorn) {
        startPickup(player, acorn)
      }
    }
  }

  if (edges.b && !player.action) {
    if (player.held) {
      startBury(player)
    } else {
      const acorn = nearestAcorn(player, world, 'buried')
      if (acorn) {
        startDig(player, acorn)
      }
    }
  }
}

/**
 * Once per second, each oak has a small chance to drop a group of 3-10 acorns. They appear spread
 * through the tree's leaves (random points inside random leaf clusters) and fall under gravity.
 *
 * @param world - Trees, acorns, and terrain.
 * @param playerSize - Current player size (sets the acorn size).
 * @param dt - Elapsed seconds.
 */
export function updateTreeDrops(world: World, playerSize: number, dt: number): void {
  world.acornDropTimer += dt
  while (world.acornDropTimer >= 1) {
    world.acornDropTimer -= 1
    for (const tree of world.trees) {
      if (world.acorns.length >= ACORN_WORLD_CAP || Math.random() >= ACORN_DROP_CHANCE_PER_SECOND) {
        continue
      }
      const baseX = tree.x + tree.trunkWidth / 2
      const baseY = groundYAt(world.terrain, baseX)
      const radius = acornRadiusForPlayer(playerSize)
      const count = ACORN_GROUP_MIN + Math.floor(Math.random() * (ACORN_GROUP_MAX - ACORN_GROUP_MIN + 1))
      for (let i = 0; i < count; i += 1) {
        const lobe = tree.shape.lobes[Math.floor(Math.random() * tree.shape.lobes.length)]
        if (!lobe) {
          continue
        }
        const angle = Math.random() * Math.PI * 2
        const dist = Math.sqrt(Math.random()) * lobe.r * 0.8
        const x = baseX + lobe.x + Math.cos(angle) * dist
        world.acorns.push({
          x: Math.max(radius, Math.min(world.width - radius, x)),
          y: baseY + lobe.y + Math.sin(angle) * dist,
          radius,
          state: 'ground',
          vy: 0,
        })
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
