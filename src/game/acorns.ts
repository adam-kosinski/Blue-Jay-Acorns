import {
  ACORN_DROP_CHANCE_PER_SECOND,
  ACORN_GRAVITY_IN_SIZES,
  ACORN_GROUP_MAX,
  ACORN_GROUP_MIN,
  ACORN_SPREAD_FACTOR,
  ACORN_WORLD_CAP,
  NPC_COUNT,
  BURIAL_CONCEAL_CURVE,
  BURIAL_HOP_RANGE_IN_SIZES,
  BURIAL_HOPS_TO_HIDE,
  BURY_DURATION,
  DIG_RESPONSE_IN_SIZES,
  KICKED_LEAVES_LIMIT,
  KICKED_LEAF_DENSITY_PER_SIZE,
  LEAF_COLORS,
  PICKUP_DURATION,
  REACH_IN_SIZES,
  acornRadiusForPlayer,
} from './constants'
import { groundYAt, inWater } from './terrain'
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
  startReach(player, acorn.x, 'pickup', PICKUP_DURATION, acorn)
}

/**
 * Starts a pecking animation toward a place on or in the ground: the bird turns to it and shifts
 * sideways a little so the beak tip lands on it.
 *
 * @param player - Bird doing the pecking.
 * @param x - World x the beak should land on.
 * @param kind - 'pickup' or 'dig'.
 * @param duration - Animation length in seconds.
 * @param acorn - The acorn being picked up, or null for a dig.
 */
function startReach(
  player: Player,
  x: number,
  kind: 'pickup' | 'dig',
  duration: number,
  acorn: Acorn | null,
  avoidOwn = false,
): void {
  if (player.floating) {
    return
  }
  player.facing = x >= player.x + player.size / 2 ? 1 : -1
  const tipX = player.x + player.size / 2 + player.facing * player.reach * (player.size / 100)
  const slide = Math.max(-0.5 * player.size, Math.min(0.8 * player.size, x - tipX))
  player.action = {
    kind,
    timer: 0,
    duration,
    acorn,
    spotX: x,
    transferred: false,
    slideTotal: slide,
    slideApplied: 0,
    avoidOwn,
  }
}

/**
 * Starts the bury animation: the bird pecks the ground ahead of it and the acorn goes underground at
 * the halfway point.
 *
 * Nothing happens when the beak tip is over the creek's water: nothing is buried in the water.
 *
 * @param player - Bird holding an acorn.
 * @param world - Terrain (the water).
 */
export function startBury(player: Player, world: World): void {
  const acorn = player.held
  if (!acorn || player.floating || inWater(world.terrain, beakTipX(player))) {
    return
  }
  player.action = {
    kind: 'bury',
    timer: 0,
    duration: BURY_DURATION,
    acorn,
    spotX: beakTipX(player),
    transferred: false,
    slideTotal: 0,
    slideApplied: 0,
    avoidOwn: false,
  }
}

/**
 * World x of the bird's beak tip when it pecks the ground: ahead of its centre, the way it faces.
 * Burying and digging both act exactly here.
 *
 * @param player - The bird.
 */
export function beakTipX(player: Player): number {
  return player.x + player.size / 2 + player.facing * player.reach * (player.size / 100)
}

/**
 * The buried acorn closest to `x` within dig range, and whether one of the digger's own acorns was in
 * range but skipped (when `avoidOwn`).
 *
 * @param world - Acorn container.
 * @param digger - Bird digging.
 * @param x - World x the beak is on.
 * @param avoidOwn - Skip the digger's own acorns.
 */
function closestBuried(
  world: World,
  digger: Player,
  x: number,
  avoidOwn: boolean,
): { nearest: Acorn | null; ownInRange: boolean } {
  const range = DIG_RESPONSE_IN_SIZES * digger.size
  let nearest: Acorn | null = null
  let nearestDist = range
  let ownInRange = false
  for (const candidate of world.acorns) {
    const dist = Math.abs(candidate.x - x)
    if (candidate.state !== 'buried' || dist > range) {
      continue
    }
    if (avoidOwn && candidate.owner === digger) {
      ownInRange = true
      continue
    }
    if (dist <= nearestDist) {
      nearest = candidate
      nearestDist = dist
    }
  }
  return { nearest, ownInRange }
}

/**
 * Starts a dig animation at the beak tip. The buried acorn closest to the beak tip (within
 * `DIG_RESPONSE_IN_SIZES`) is the target: if it is not exactly under the beak, the bird shuffles
 * sideways during the first part of the animation so that its beak lands on it, and it comes up into
 * the beak at the halfway point. If none is in range, the bird digs where it stands and nothing
 * comes up.
 *
 * @param player - Bird doing the digging.
 * @param world - Acorn container.
 * @param avoidOwn - True to never bring up one of the digger's own acorns (what NPCs do unless they are
 *   retrieving): the closest other acorn in range, or nothing, responds. The player does not avoid them.
 */
export function startDig(player: Player, world: World, avoidOwn = false): void {
  if (player.floating) {
    return
  }
  const tip = beakTipX(player)
  const { nearest } = closestBuried(world, player, tip, avoidOwn)
  const spotX = nearest ? nearest.x : tip
  player.action = {
    kind: 'dig',
    timer: 0,
    duration: BURY_DURATION,
    acorn: null,
    spotX,
    transferred: false,
    slideTotal: spotX - tip,
    slideApplied: 0,
    avoidOwn,
  }
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
  action.slideApplied = slide
  if (!action.transferred && action.timer >= action.duration / 2) {
    action.transferred = true
    const acorn = action.acorn
    if (action.kind === 'dig') {
      // The buried acorn closest to the beak (now on the target the bird shuffled to) responds.
      const range = DIG_RESPONSE_IN_SIZES * player.size
      const { nearest, ownInRange } = closestBuried(world, player, action.spotX, action.avoidOwn)
      if (nearest && !player.held) {
        nearest.state = 'held'
        player.held = nearest
        if (nearest.owner === player) {
          // It got one of its own acorns back: that burial is gone from its memory (and only that one).
          forgetBurial(player, nearest.x)
        } else if (!player.dugSites.some((spot) => Math.abs(spot - action.spotX) <= range)) {
          // Another bird's acorn came up here: it counts as one of that bird's sites until it comes up empty.
          player.dugSites.push(action.spotX)
        }
      } else {
        // Nothing responded, so no acorn lies within dig range of here: forget any burial remembered
        // here (it was taken) and let NPCs forget other birds' sites in range of it.
        if (!nearest) {
          if (!ownInRange) {
            // Nothing at all within dig range: any burial remembered here was taken.
            player.burials = player.burials.filter((spot) => Math.abs(spot - action.spotX) > range)
          }
          player.dugSites = player.dugSites.filter((spot) => Math.abs(spot - action.spotX) > range)
          player.digFailX = action.spotX
        }
        player.action = null
        return
      }
    } else if (!acorn) {
      player.action = null
      return
    } else if (action.kind === 'bury') {
      if (player.held === acorn) {
        acorn.state = 'buried'
        acorn.owner = player
        player.burials.push(action.spotX)
        acorn.hops = 0
        acorn.conceal = 0
        acorn.x = action.spotX
        acorn.y = groundYAt(world.terrain, acorn.x) + acorn.radius * 1.5
        player.held = null
      }
    } else {
      if (acorn.state === 'ground' && !player.held) {
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
 * Applies S (pick up), Q (drop) and left Shift (bury / dig up) presses for this frame.
 *
 * Both only act on a fresh press while standing and not already busy. Pick-up, bury and dig-up play an animation first.
 *
 * @param player - Mutable player (holds at most one acorn).
 * @param edges - Fresh key presses since the last frame.
 * @param world - Acorn container and terrain.
 */
export function handleAcornActions(player: Player, edges: KeyEdges, world: World): void {
  if (player.state !== 'standing' || player.floating || player.eatTimer > 0 || player.action) {
    return
  }

  if (edges.drop && player.held) {
    player.held.state = 'ground'
    player.held.vy = 0
    player.held.x = player.x + player.size / 2 + player.facing * player.size * 0.55
    player.held.y = player.y + player.size * 0.4
    player.held = null
  }

  if (edges.pickup && !player.held) {
    const acorn = nearestAcorn(player, world, 'ground')
    if (acorn) {
      startPickup(player, acorn)
    }
  }

  if (edges.bury && !player.action) {
    if (player.held) {
      startBury(player, world)
    } else {
      // Dig where the beak is: the closest buried acorn in range of the beak tip comes up.
      startDig(player, world)
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
 * @param rateMultiplier - Scales the drop chance (the debug deficit / default / surplus setting).
 */
export function updateTreeDrops(
  world: World,
  playerSize: number,
  dt: number,
  rateMultiplier = 1,
): void {
  world.acornDropTimer += dt
  // The squirrels eat too: each needs as many acorns per second as a bird (twice the bar, drained half
  // as fast, an acorn filling half as much of it), so the supply grows with the number of mouths.
  const hungry = (1 + NPC_COUNT + world.squirrels.length) / (1 + NPC_COUNT)
  while (world.acornDropTimer >= 1) {
    world.acornDropTimer -= 1
    // Buried acorns do not count toward the cap: the ones nobody retrieves must not stop the supply.
    let loose = world.acorns.filter((acorn) => acorn.state !== 'buried').length
    for (const tree of world.trees) {
      if (
        loose >= ACORN_WORLD_CAP * hungry ||
        Math.random() >= ACORN_DROP_CHANCE_PER_SECOND * hungry * rateMultiplier
      ) {
        continue
      }
      const baseX = tree.x + tree.trunkWidth / 2
      const baseY = groundYAt(world.terrain, baseX)
      const radius = acornRadiusForPlayer(playerSize)
      const count = ACORN_GROUP_MIN + Math.floor(Math.random() * (ACORN_GROUP_MAX - ACORN_GROUP_MIN + 1))
      loose += count
      for (let i = 0; i < count; i += 1) {
        const lobe = tree.shape.lobes[Math.floor(Math.random() * tree.shape.lobes.length)]
        if (!lobe) {
          continue
        }
        const angle = Math.random() * Math.PI * 2
        const dist = Math.sqrt(Math.random()) * lobe.r * 0.8
        // Acorns land only in the middle of the crown's width (`ACORN_SPREAD_FACTOR`).
        let x = baseX + (lobe.x + Math.cos(angle) * dist) * ACORN_SPREAD_FACTOR
        const { creek } = world.terrain
        if (Math.abs(x - creek.x) < creek.halfWidth) {
          // Acorns that would fall into the creek are washed to the nearest bank.
          x = creek.x + (x < creek.x ? -1 : 1) * (creek.halfWidth + radius * 2)
        }
        world.acorns.push({
          x: Math.max(radius, Math.min(world.width - radius, x)),
          y: baseY + lobe.y + Math.sin(angle) * dist,
          radius,
          state: 'ground',
          hops: 0,
          conceal: 0,
          vy: 0,
        })
      }
    }
  }
}

/**
 * Removes the one remembered burial at `x` (a bird knows exactly where each of its acorns went).
 *
 * @param bird - Bird whose memory is edited.
 * @param x - World x of the burial (the acorn's x).
 */
export function forgetBurial(bird: Player, x: number): void {
  const index = bird.burials.findIndex((spot) => Math.abs(spot - x) < 0.5)
  if (index >= 0) {
    bird.burials.splice(index, 1)
  }
}

const lastHops = new WeakMap<Player, number>()

/**
 * Notices birds that started a hop on the ground. Every hop kicks up leaves that land around the
 * bird, replacing the kicked leaves already lying nearby (those shrink, sink and fade into the
 * ground) at the same density as anywhere else. Hops near a buried acorn also count toward hiding it
 * (see `updateAcorns`), without any extra leaves.
 *
 * @param world - Acorns, terrain and the leaves kicked so far.
 * @param birds - Every bird (the player and the NPCs).
 */
export function trackHops(world: World, birds: Player[]): void {
  for (const bird of birds) {
    const before = lastHops.get(bird) ?? bird.hops
    lastHops.set(bird, bird.hops)
    if (bird.hops <= before || bird.state !== 'standing' || bird.floating) {
      continue
    }
    const cx = bird.x + bird.size / 2
    const range = BURIAL_HOP_RANGE_IN_SIZES * bird.size
    // Kicked leaves lying nearby are disturbed (they shrink, sink and fade away) and replaced by new
    // ones, so the stretch around the hop keeps the density kicked leaves have everywhere: it never
    // piles up, and a burial site gets no extra leaves.
    const window = range * 1.2
    let alive = 0
    for (const leaf of world.kickedLeaves) {
      if (Math.abs(leaf.x - cx) >= window || leaf.fading) {
        continue
      }
      if (leaf.landed) {
        leaf.fading = true
      } else {
        alive += 1
      }
    }
    const target = Math.round((KICKED_LEAF_DENSITY_PER_SIZE * 2 * window) / bird.size)
    for (let k = alive; k < target; k += 1) {
      kickLeaf(world, bird, cx + (Math.random() - 0.5) * 2 * window, bird.size * 0.08)
    }
    // A hop near a buried acorn counts toward hiding it (its mound shrinks and fades; no extra leaves).
    for (const acorn of world.acorns) {
      if (acorn.state === 'buried' && Math.abs(acorn.x - cx) <= range) {
        acorn.hops = Math.min(BURIAL_HOPS_TO_HIDE, acorn.hops + 1)
      }
    }
  }
}

/**
 * Throws one leaf from a bird's feet so that it lands at `restX` on the ground (a little above it,
 * by up to `lift`, so it can lie on a mound).
 *
 * @param world - Where the leaf is kept.
 * @param bird - The hopping bird.
 * @param restX - World x where it comes to rest.
 * @param lift - How far above the ground surface it may come to rest.
 */
function kickLeaf(world: World, bird: Player, restX: number, lift: number): void {
  const flight = 0.35 + Math.random() * 0.2
  const gravity = ACORN_GRAVITY_IN_SIZES * bird.size
  const x0 = bird.x + bird.size / 2 + bird.facing * bird.size * 0.25
  const y0 = groundYAt(world.terrain, x0) - bird.size * 0.1
  const restY = groundYAt(world.terrain, restX) - Math.random() * lift * 0.45
  const rx = (0.035 + Math.random() * 0.045) * bird.size * 2
  world.kickedLeaves.push({
    x: x0,
    y: y0,
    vx: (restX - x0) / flight,
    vy: (restY - y0 - 0.5 * gravity * flight * flight) / flight,
    restX,
    restY,
    rx,
    ry: rx * (0.35 + Math.random() * 0.2),
    angle: (Math.random() - 0.5) * Math.PI,
    color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)] ?? '#8a5a2b',
    landed: false,
    fading: false,
    fade: 0,
  })
  while (world.kickedLeaves.length > KICKED_LEAVES_LIMIT) {
    world.kickedLeaves.shift()
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
  // Burial mounds fade smoothly toward the concealment their hops have earned.
  for (const acorn of world.acorns) {
    if (acorn.state === 'buried') {
      // Not linear in the hops: early hops do little, the last ones the most.
      const target = (acorn.hops / BURIAL_HOPS_TO_HIDE) ** BURIAL_CONCEAL_CURVE
      acorn.conceal += (target - acorn.conceal) * Math.min(1, dt * 2.5)
    }
  }
  // Kicked leaves fly to their resting place and stay there until a hop nearby disturbs them: then
  // they shrink, sink and fade into the ground over about a second, and are removed.
  let faded = false
  for (const leaf of world.kickedLeaves) {
    if (leaf.fading) {
      leaf.fade = Math.min(1, leaf.fade + dt * 0.9)
      faded = faded || leaf.fade >= 1
    }
    if (leaf.landed) {
      continue
    }
    leaf.vy += ACORN_GRAVITY_IN_SIZES * playerSize * dt
    leaf.x += leaf.vx * dt
    leaf.y += leaf.vy * dt
    if (leaf.vy > 0 && leaf.y >= leaf.restY) {
      leaf.x = leaf.restX
      leaf.y = leaf.restY
      leaf.landed = true
      if (inWater(world.terrain, leaf.restX)) {
        // A leaf that falls in the creek does not stay: it fades away right away.
        leaf.fading = true
      }
    }
  }
  if (faded) {
    world.kickedLeaves = world.kickedLeaves.filter((leaf) => leaf.fade < 1)
  }
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
