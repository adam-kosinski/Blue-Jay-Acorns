import {
  HOP_DURATION,
  SQUIRREL_CLIMB_SPEED_IN_SIZES,
  SQUIRREL_SNIFF_EVERY_HOPS_MAX,
  SQUIRREL_SNIFF_MIN_CHANCE,
  SQUIRREL_SNIFF_EVERY_HOPS_MIN,
  SQUIRREL_SNIFF_NOTICE_FACTOR,
  SQUIRREL_SNIFF_RADIUS_IN_SIZES,
  SQUIRREL_SNIFF_SECONDS,
} from './constants'
import { beakTipX } from './acorns'
import { groundYAt } from './terrain'
import { burialSiteVisibility } from './vision'
import type { Npc, World } from './types'

/**
 * Whether a world x lies in the squirrel's home stretch of ground (always true for a jay).
 *
 * @param npc - The animal.
 * @param x - World x.
 */
export function inHome(npc: Npc, x: number): boolean {
  return !npc.home || (x >= npc.home.left && x <= npc.home.right)
}

/**
 * Random whole number from `min` to `max` inclusive.
 *
 * @param min - Smallest value.
 * @param max - Largest value.
 */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * A fresh number of hops after which the squirrel sniffs next.
 */
export function nextSniffHops(): number {
  return randInt(SQUIRREL_SNIFF_EVERY_HOPS_MIN, SQUIRREL_SNIFF_EVERY_HOPS_MAX)
}

/**
 * How high up the trunk (pixels) a squirrel must climb to be out of sight: all the way up out of the
 * play area (its body entirely above the top edge of the world).
 *
 * @param npc - A squirrel.
 * @param world - Terrain.
 */
function hideHeight(npc: Npc, world: World): number {
  const home = npc.home
  return home ? groundYAt(world.terrain, home.trunkX) : 0
}

/**
 * World x of the squirrel's centre while it clings to its home trunk.
 *
 * @param npc - A squirrel.
 */
function trunkClimbX(npc: Npc): number {
  const home = npc.home
  return home ? home.trunkX + npc.bird.climbSide * home.tree.trunkWidth * 0.4 : npc.bird.x + npc.bird.size / 2
}

/**
 * Puts a squirrel on its trunk at its current height, clinging to the trunk's side.
 *
 * @param npc - A squirrel.
 * @param world - Terrain.
 */
function placeOnTrunk(npc: Npc, world: World): void {
  const bird = npc.bird
  const cx = trunkClimbX(npc)
  bird.x = cx - bird.size / 2
  bird.y = groundYAt(world.terrain, cx) - bird.size - bird.climbH
  bird.state = 'standing'
  bird.facing = bird.climbSide
}

/**
 * Starts a squirrel climbing up its trunk (from where it stands at the trunk's foot) to hide in the tree.
 *
 * @param npc - A squirrel at its trunk.
 */
export function startClimbUp(npc: Npc): void {
  const bird = npc.bird
  const home = npc.home
  if (!home) {
    return
  }
  bird.climbSide = bird.x + bird.size / 2 >= home.trunkX ? 1 : -1
  bird.climbH = 0
  bird.climbDir = 1
  bird.hidden = false
  npc.treePhase = 'up'
}

/**
 * Starts a squirrel climbing down from the tree (or turns round, if it was still on its way up).
 *
 * @param npc - A squirrel in its tree.
 */
export function startClimbDown(npc: Npc): void {
  const bird = npc.bird
  if (npc.treePhase === 'ground' || npc.treePhase === 'down') {
    return
  }
  bird.hidden = false
  bird.climbDir = -1
  npc.treePhase = 'down'
}

/**
 * Hides a squirrel high up in its tree right now (used when one starts the game resting).
 *
 * @param npc - A squirrel.
 * @param world - Terrain.
 */
export function placeHidden(npc: Npc, world: World): void {
  const bird = npc.bird
  bird.climbSide = Math.random() < 0.5 ? -1 : 1
  bird.climbH = hideHeight(npc, world)
  bird.climbDir = 0
  bird.hidden = true
  npc.treePhase = 'hidden'
  placeOnTrunk(npc, world)
}

/**
 * Moves a squirrel that is on its trunk: climbing up until it is out of sight, or down until it
 * reaches the ground and steps off the trunk.
 *
 * @param npc - A squirrel whose phase is not 'ground'.
 * @param world - Terrain.
 * @param dt - Elapsed seconds.
 */
export function updateTreePhase(npc: Npc, world: World, dt: number): void {
  const bird = npc.bird
  const home = npc.home
  if (!home || npc.treePhase === 'ground' || npc.treePhase === 'hidden') {
    return
  }
  const step = SQUIRREL_CLIMB_SPEED_IN_SIZES * bird.size * dt
  if (npc.treePhase === 'up') {
    bird.climbH += step
    const top = hideHeight(npc, world)
    if (bird.climbH >= top) {
      bird.climbH = top
      bird.hidden = true
      bird.climbDir = 0
      npc.treePhase = 'hidden'
    }
  } else {
    bird.climbH -= step
    if (bird.climbH <= 0) {
      // Back on the ground: step off the trunk, away from it.
      bird.climbH = 0
      bird.climbDir = 0
      npc.treePhase = 'ground'
      bird.x = home.trunkX + bird.climbSide * (home.tree.trunkWidth * 0.5 + bird.size * 0.5) - bird.size / 2
      bird.y = groundYAt(world.terrain, bird.x + bird.size / 2) - bird.size
      bird.facing = bird.climbSide
      bird.hopT = HOP_DURATION
      return
    }
  }
  placeOnTrunk(npc, world)
}

/**
 * Keeps a squirrel on the ground moving the way it is heading, turning round at the edges of its home
 * stretch.
 *
 * @param npc - A squirrel on the ground.
 */
export function squirrelWalk(npc: Npc): void {
  const home = npc.home
  if (!home) {
    return
  }
  const cx = npc.bird.x + npc.bird.size / 2
  if (cx <= home.left) {
    npc.direction = 1
  } else if (cx >= home.right) {
    npc.direction = -1
  }
  npc.keys.a = npc.direction === -1
  npc.keys.d = npc.direction === 1
}

/**
 * Starts a sniff: the squirrel stops and puts its nose to the ground. Every buried acorn of another
 * animal within a squirrel width of its nose gets one roll to be noticed, at twice the usual chance
 * (the usual chance falls with the hops that disguised it, but never below `SQUIRREL_SNIFF_MIN_CHANCE`).
 *
 * @param npc - A squirrel standing still.
 * @param world - Acorns and the clock.
 */
function startSniff(npc: Npc, world: World): void {
  const bird = npc.bird
  const nose = beakTipX(bird)
  const range = SQUIRREL_SNIFF_RADIUS_IN_SIZES * bird.size
  npc.sniffTimer = SQUIRREL_SNIFF_SECONDS
  bird.sniff = 0
  for (const acorn of world.acorns) {
    if (acorn.state !== 'buried' || acorn.owner === bird || Math.abs(acorn.x - nose) > range) {
      continue
    }
    if (bird.burials.some((spot) => Math.abs(spot - acorn.x) < 1)) {
      continue
    }
    if (npc.sites.some((site) => Math.abs(site.x - acorn.x) <= 0.25 * bird.size)) {
      continue
    }
    const chance = Math.max(SQUIRREL_SNIFF_MIN_CHANCE, Math.min(1, SQUIRREL_SNIFF_NOTICE_FACTOR * burialSiteVisibility(acorn.hops)))
    if (Math.random() < chance) {
      npc.sites.push({ x: acorn.x, owner: acorn.owner ?? bird, noticedAt: world.time })
    }
  }
}

/**
 * Explore for a squirrel: hop around its home stretch and, after every couple of hops, stop to sniff.
 *
 * @param npc - A squirrel on the ground.
 * @param world - Acorns and the clock.
 * @param dt - Elapsed seconds.
 */
export function runSquirrelExplore(npc: Npc, world: World, dt: number): void {
  const bird = npc.bird
  if (npc.sniffTimer > 0) {
    // Sniffing: standing still, nose down.
    npc.sniffTimer = Math.max(0, npc.sniffTimer - dt)
    bird.sniff = 1 - npc.sniffTimer / SQUIRREL_SNIFF_SECONDS
    if (npc.sniffTimer === 0) {
      bird.sniff = -1
      npc.sniffHopsAt = bird.hops
      npc.sniffHopsLeft = nextSniffHops()
    }
    return
  }
  if (returnHome(npc)) {
    // Out of its home stretch: no exploring (and no sniffing) until it is back.
    return
  }
  // Hop on the same way; the hop that makes it 2 or 3 still travels as usual, and once it has
  // landed the squirrel stops and sniffs.
  squirrelWalk(npc)
  if (bird.hops - npc.sniffHopsAt >= npc.sniffHopsLeft) {
    if (bird.hopT >= HOP_DURATION - dt * 1.5) {
      // About to land: let go of the key, so no further hop starts.
      npc.keys.a = false
      npc.keys.d = false
    }
    if (bird.hopT >= HOP_DURATION && !bird.action) {
      startSniff(npc, world)
    }
  }
}

/**
 * Idle for a squirrel: go to the foot of its home trunk and climb up out of sight; once up there it
 * just stays.
 *
 * @param npc - A squirrel on the ground in its idle state.
 */
export function runSquirrelIdle(npc: Npc): void {
  const home = npc.home
  const bird = npc.bird
  if (!home || npc.treePhase !== 'ground') {
    return
  }
  const cx = bird.x + bird.size / 2
  const dx = home.trunkX - cx
  // Walk up to the trunk's side, then start climbing.
  if (Math.abs(dx) > home.tree.trunkWidth * 0.5 + bird.size * 0.3) {
    npc.keys.a = dx < 0
    npc.keys.d = dx > 0
    return
  }
  if (bird.hopT >= HOP_DURATION) {
    startClimbUp(npc)
  }
}

/**
 * A squirrel outside its home stretch (it went out after an acorn or a burial site it saw) walks back
 * toward it; it does not explore or look for a burial spot out there.
 *
 * @param npc - A squirrel on the ground.
 * @returns True while it is outside and the keys were set to walk back.
 */
export function returnHome(npc: Npc): boolean {
  const home = npc.home
  if (!home) {
    return false
  }
  const slack = 0.3 * npc.bird.size
  const cx = npc.bird.x + npc.bird.size / 2
  if (cx < home.left - slack) {
    npc.direction = 1
    npc.keys.a = false
    npc.keys.d = true
    return true
  }
  if (cx > home.right + slack) {
    npc.direction = -1
    npc.keys.a = true
    npc.keys.d = false
    return true
  }
  return false
}

/**
 * Whether a squirrel is outside its home stretch (by more than 0.3 of its size).
 *
 * @param npc - A squirrel.
 */
export function isOutsideHome(npc: Npc): boolean {
  const home = npc.home
  if (!home) {
    return false
  }
  const slack = 0.3 * npc.bird.size
  const cx = npc.bird.x + npc.bird.size / 2
  return cx < home.left - slack || cx > home.right + slack
}
