import {
  BEAK_REACH_X,
  BURIAL_HOPS_TO_HIDE,
  BURIAL_SITE_NOTICE_FACTOR,
  BURIAL_QUALITY_DISPLAY_SECONDS,
  NPC_AVOID_JAY_TURN_PROBABILITY_PER_SECOND,
  DIG_RESPONSE_IN_SIZES,
  HOP_DURATION,
  HUNGER_THRESHOLD,
  NPC_COUNT,
  NPC_NOTICE_PROBABILITY,
  NPC_PERCEIVE_AHEAD_IN_SIZES,
  NPC_PERCEIVE_BEHIND_IN_SIZES,
  NPC_IDLE_HUNGER,
  NPC_RETRIEVE_HUNGER,
  NPC_SPEED_SCALE,
  NPC_STARVING_HUNGER,
  NPC_WAIT_SECONDS,
} from './constants'
import { forgetBurial, startBury, startDigAt, startPickup, trackHops, updateAction } from './acorns'
import { BURIAL_QUALITY_RANGE_IN_SIZES, burialQuality } from './burial'
import { inView } from './vision'
import { updateHunger } from './hunger'
import { groundYAt, nearCreek } from './terrain'
import { createPlayer, groundUnder, updatePlayer } from './player'
import type { Acorn, BurialSite, KeyEdges, KeyState, Npc, Player, PlayerAction, World } from './types'

/** Altitude band (player sizes above ground) NPCs wander through while exploring. */
const MIN_EXPLORE_ALTITUDE = 0.8
const MAX_EXPLORE_ALTITUDE = 4

/** Lowest altitude (player sizes) a bird cruises at when it must fly to a ground target. */
const MIN_CRUISE_ALTITUDE = 1

/** Steepest glide into a ground target (altitude per horizontal distance); the climb/descend speed is half the flying speed. */
const GLIDE_SLOPE = 0.45

/** Ground targets nearer than this (player sizes) are reached by hopping, not flying. */
const FLY_MIN_DISTANCE_IN_SIZES = 2

/** Horizontal gap (player sizes) at which an NPC counts as having reached its target. */
const ARRIVE_IN_SIZES = 0.5

/** Chance per second that an idle NPC wanders a short distance, and how often it flies it. */
const IDLE_WANDER_PROBABILITY = 0.3
const IDLE_FLY_PROBABILITY = 0.35

const NO_EDGES: KeyEdges = { pickup: false, drop: false, bury: false, e: false }
const EAT_EDGES: KeyEdges = { pickup: false, drop: false, bury: false, e: true }

/**
 * Random number in `[min, max)`.
 *
 * @param min - Inclusive lower bound.
 * @param max - Exclusive upper bound.
 */
function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Random flight direction.
 */
function randomDirection(): 1 | -1 {
  return Math.random() < 0.5 ? -1 : 1
}

/**
 * Spawns the NPC blue jays standing at random spots in the explore state.
 *
 * @param world - Play space (npcs list is ignored; the caller assigns the result).
 * @param size - Player square size.
 */
export function createNpcs(world: World, size: number): Npc[] {
  const npcs: Npc[] = []
  for (let i = 0; i < NPC_COUNT; i += 1) {
    const bird = createPlayer(world, size)
    bird.x = randRange(0, world.width - size)
    while (nearCreek(world.terrain.creek, bird.x + size / 2, size)) {
      bird.x = randRange(0, world.width - size)
    }
    bird.y = groundUnder(bird, world) - size
    bird.facing = randomDirection()
    bird.hunger = randRange(0.4, 1)
    npcs.push({
      bird,
      keys: { w: false, a: false, s: false, d: false },
      nosiness: Math.random(),
      secrecy: Math.random(),
      coverHops: 0,
      coverDir: 1,
      searchDir: 1,
      spotX: null,
      searchTimer: 0,
      turnTimer: 0,
      buryQuality: 0,
      buryQualityTimer: 0,
      state: bird.hunger > NPC_IDLE_HUNGER ? 'idle' : 'explore',
      decisionTimer: Math.random(),
      direction: bird.facing,
      targetAltitude: randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE),
      altitudeTimer: randRange(1, 3),
      target: null,
      targetX: 0,
      eatAttempted: false,
      viewedBuried: new Set(),
      landedRolled: new Set(),
      wasStanding: true,
      waitTimer: 0,
      idleTargetX: null,
      idleFly: false,
      digSpot: null,
      inView: new Set(),
      noticed: new Map(),
      seenActions: new WeakSet(),
      missedActions: new WeakSet(),
      sites: [],
      siteTarget: null,
      glide: null,
    })
  }
  return npcs
}

/**
 * World x of every burial site of another bird that the NPC remembers.
 *
 * @param npc - The NPC.
 */
function siteXs(npc: Npc): number[] {
  return npc.sites.map((site) => site.x)
}

/**
 * Whether x is exactly where the NPC remembers burying one of its own acorns. A spot is either one of
 * its own burials (`bird.burials`, retrieved when hungry) or another bird's site (`sites`, treated like a
 * free acorn), never both. (A spot merely near one of its own burials can still be another bird's site.)
 *
 * @param npc - The NPC.
 * @param x - World x of the spot.
 */
function isOwnBurial(npc: Npc, x: number): boolean {
  return npc.bird.burials.some((spot) => Math.abs(spot - x) < 1)
}

/**
 * Keeps own burials and other birds' sites mutually exclusive: a spot the bird buried at (also if it
 * noted it as someone else's before) is only ever one of its own.
 *
 * @param npc - The NPC.
 */
function dropOwnBurialsFromSites(npc: Npc): void {
  if (npc.sites.some((site) => isOwnBurial(npc, site.x))) {
    npc.sites = npc.sites.filter((site) => !isOwnBurial(npc, site.x))
  }
}

/**
 * Updates what the NPC notices. While standing, every free acorn in view is noticed. While flying,
 * each free acorn that newly enters view gets one roll (`NPC_NOTICE_PROBABILITY`), unless it was
 * already noticed: a noticed acorn is remembered with the spot where it was last seen (even out of
 * view) and never rolls again. When that spot comes back into view and the acorn is no longer there
 * (taken, or not free any more), it is forgotten at once; the bird does not have to land.
 *
 * @param npc - NPC whose perception updates.
 * @param world - Acorn container.
 */
function updatePerception(npc: Npc, world: World): void {
  const standing = npc.bird.state === 'standing'
  const current = new Set<Acorn>()
  for (const acorn of world.acorns) {
    if (acorn.state === 'ground' && inView(npc.bird, acorn)) {
      current.add(acorn)
      // A standing bird always sees what is in view (so on landing every acorn in view counts as
      // seen); a flying bird rolls once when an acorn newly comes into view.
      if (
        standing ||
        npc.noticed.has(acorn) ||
        (!npc.inView.has(acorn) && Math.random() < NPC_NOTICE_PROBABILITY)
      ) {
        npc.noticed.set(acorn, { x: acorn.x, y: acorn.y })
      }
    }
  }
  // A remembered acorn stays remembered while its spot is out of view. Once the spot is back in
  // view without the acorn being seen there, it is cleared immediately.
  for (const [acorn, spot] of npc.noticed) {
    if (!current.has(acorn) && inView(npc.bird, spot)) {
      npc.noticed.delete(acorn)
    }
  }
  npc.inView = current
  perceiveBuried(npc, world)
}

/**
 * Chance to notice other birds' burial sites. When a buried acorn that is not this bird's own newly
 * comes into view it may be noticed, with a probability equal to how visible its mound still is
 * (1 minus its concealment: never if fully buried), times `BURIAL_SITE_NOTICE_FACTOR` (one half) and,
 * while flying, `NPC_NOTICE_PROBABILITY`. A bird that lands with a site in view rolls once more, without
 * that flight penalty. A noticed site joins the list of other birds' burial sites (`sites`), which
 * are treated differently from the bird's own burials; the bird's own are never rolled for. A site
 * the bird already remembers is not rolled for again.
 *
 * @param npc - NPC whose perception updates.
 * @param world - Acorns, terrain and the game clock.
 */
function perceiveBuried(npc: Npc, world: World): void {
  const standing = npc.bird.state === 'standing'
  const landed = standing && !npc.wasStanding
  const current = new Set<Acorn>()
  for (const acorn of world.acorns) {
    if (acorn.state !== 'buried' || acorn.owner === npc.bird) {
      continue
    }
    if (!inView(npc.bird, { x: acorn.x, y: groundYAt(world.terrain, acorn.x) })) {
      continue
    }
    if (isOwnBurial(npc, acorn.x)) {
      // The bird remembers burying here itself (another bird may have moved the acorn since): that spot
      // belongs on its own list, never on the list of other birds' sites.
      continue
    }
    current.add(acorn)
    if (npc.sites.some((site) => Math.abs(site.x - acorn.x) <= 0.25 * npc.bird.size)) {
      continue
    }
    const visibility = 1 - acorn.conceal
    let noticed = false
    if (!npc.viewedBuried.has(acorn)) {
      // Newly in view.
      noticed = Math.random() < visibility * BURIAL_SITE_NOTICE_FACTOR * (standing ? 1 : NPC_NOTICE_PROBABILITY)
      if (standing) {
        npc.landedRolled.add(acorn)
      }
    } else if (landed && !npc.landedRolled.has(acorn)) {
      noticed = Math.random() < visibility * BURIAL_SITE_NOTICE_FACTOR
      npc.landedRolled.add(acorn)
    }
    if (noticed) {
      npc.sites.push({ x: acorn.x, owner: acorn.owner ?? npc.bird, noticedAt: world.time })
    }
  }
  for (const acorn of npc.landedRolled) {
    if (!current.has(acorn)) {
      npc.landedRolled.delete(acorn)
    }
  }
  npc.viewedBuried = current
  npc.wasStanding = standing
}

/**
 * Nearest noticed acorn that is still free and currently in view, or null.
 *
 * @param npc - Looking NPC.
 */
function nearestNoticedAcorn(npc: Npc): Acorn | null {
  const cx = npc.bird.x + npc.bird.size / 2
  const cy = npc.bird.y + npc.bird.size / 2
  let best: Acorn | null = null
  let bestDist = Infinity
  for (const acorn of npc.noticed.keys()) {
    if (acorn.state !== 'ground' || !npc.inView.has(acorn)) {
      continue
    }
    const dist = Math.hypot(acorn.x - cx, acorn.y - cy)
    if (dist < bestDist) {
      best = acorn
      bestDist = dist
    }
  }
  return best
}

/**
 * What an NPC will go for next: the nearest of the free acorns it has noticed and the burial sites
 * of other birds it remembers (sites count only while in view, like free acorns).
 *
 * @param npc - Looking NPC.
 * @param world - Terrain for the ground height at a site.
 */
function pickTarget(npc: Npc, world: World): { acorn: Acorn | null; site: BurialSite | null } {
  const cx = npc.bird.x + npc.bird.size / 2
  const cy = npc.bird.y + npc.bird.size / 2
  const acorn = nearestNoticedAcorn(npc)
  const acornDist = acorn ? Math.hypot(acorn.x - cx, acorn.y - cy) : Infinity
  let site: BurialSite | null = null
  let siteDist = Infinity
  for (const candidate of npc.sites) {
    const y = groundYAt(world.terrain, candidate.x)
    if (!inView(npc.bird, { x: candidate.x, y })) {
      continue
    }
    const dist = Math.hypot(candidate.x - cx, y - cy)
    if (dist < siteDist) {
      site = candidate
      siteDist = dist
    }
  }
  return acornDist <= siteDist ? { acorn, site: null } : { acorn: null, site }
}

/**
 * Sets the NPC's gather target from a pick.
 *
 * @param npc - Gathering NPC.
 * @param pick - Result of `pickTarget`.
 * @returns True when there was something to go for.
 */
function applyPick(npc: Npc, pick: { acorn: Acorn | null; site: BurialSite | null }): boolean {
  npc.target = pick.acorn
  npc.siteTarget = pick.site
  return pick.acorn !== null || pick.site !== null
}

/**
 * Lets an NPC watch another bird's bury or dig-up in progress. From the halfway point of the action
 * (head on the ground / acorn in the beak; a failed dig never gets there), once the
 * spot is in view the NPC gets its single chance to notice it (a standing bird always does, a
 * flying bird 75% of the time; a failed roll is not repeated for the same action, but the bird
 * notices it anyway as soon as it is standing with the spot in view). A noticed spot
 * is remembered as another bird's burial site, and the fading line to it starts then. A dig-up
 * marks a spot too: the buried acorns of one bird are often near each other, so it is worth a try
 * (the site is dropped when this NPC's own dig there comes up empty).
 *
 * @param npc - Perceiving NPC.
 * @param world - Terrain and clock.
 * @param action - The other bird's bury or dig action.
 * @param owner - The bird performing it.
 */
function perceiveDigging(npc: Npc, world: World, action: PlayerAction, owner: Player): void {
  const x = action.spotX
  const dug = owner.held
  if (action.kind === 'dig' && dug && dug.owner === npc.bird && inView(npc.bird, { x: dug.x, y: groundYAt(world.terrain, dug.x) })) {
    // Saw another bird dig up one of its own acorns: it knows exactly which burial that was.
    forgetBurial(npc.bird, dug.x)
  }
  if (npc.seenActions.has(action) || !inView(npc.bird, { x, y: groundYAt(world.terrain, x) })) {
    return
  }
  if (npc.bird.state !== 'standing') {
    // A flying bird rolls once per action; if it misses, it still notices once it stands.
    if (npc.missedActions.has(action)) {
      return
    }
    if (Math.random() >= NPC_NOTICE_PROBABILITY) {
      npc.missedActions.add(action)
      return
    }
  }
  npc.seenActions.add(action)
  if (isOwnBurial(npc, x)) {
    return
  }
  const known = npc.sites.find((site) => Math.abs(site.x - x) <= 0.25 * npc.bird.size)
  if (known) {
    known.noticedAt = world.time
  } else {
    npc.sites.push({ x, owner, noticedAt: world.time })
  }
}

/**
 * Altitude of the bird's feet above the local ground, in player sizes.
 *
 * @param bird - Bird to measure.
 * @param world - Play space.
 */
function altitudeOf(bird: Player, world: World): number {
  return (groundUnder(bird, world) - (bird.y + bird.size)) / bird.size
}

/**
 * Sets the simulated W/S keys to climb or descend toward an altitude.
 *
 * @param npc - NPC whose keys are set.
 * @param altitude - Desired altitude in player sizes.
 * @param world - Play space.
 */
function steerAltitude(npc: Npc, altitude: number, world: World): void {
  const current = altitudeOf(npc.bird, world)
  npc.keys.w = current < altitude - 0.15
  npc.keys.s = current > altitude + 0.15
}

/**
 * Sets the simulated A/D keys to move toward a world x (none when close enough).
 *
 * @param npc - NPC whose keys are set.
 * @param x - Target world x.
 */
function steerHorizontal(npc: Npc, x: number): void {
  const dx = x - (npc.bird.x + npc.bird.size / 2)
  const arrive = ARRIVE_IN_SIZES * npc.bird.size
  npc.keys.a = dx < -arrive
  npc.keys.d = dx > arrive
}

/**
 * Releases all simulated keys.
 *
 * @param keys - Key state to clear.
 */
function releaseKeys(keys: KeyState): void {
  keys.w = false
  keys.a = false
  keys.s = false
  keys.d = false
}

/**
 * Direction toward the nearest remembered free acorn or other-bird burial site, or null when the NPC
 * remembers none. Used to pick the initial explore direction.
 *
 * @param npc - Exploring NPC.
 */
function directionToRemembered(npc: Npc): 1 | -1 | null {
  const cx = npc.bird.x + npc.bird.size / 2
  let nearestX: number | null = null
  const consider = (x: number): void => {
    if (nearestX === null || Math.abs(x - cx) < Math.abs(nearestX - cx)) {
      nearestX = x
    }
  }
  for (const spot of npc.noticed.values()) {
    consider(spot.x)
  }
  for (const site of npc.sites) {
    consider(site.x)
  }
  if (nearestX === null) {
    return null
  }
  return nearestX >= cx ? 1 : -1
}

/** The world's oaks, refreshed every update (so `enterExplore` can head for the nearest one). */
let activeTrees: World['trees'] = []

/**
 * Direction to the nearest foreground oak, or null if there is none.
 *
 * @param npc - NPC looking for a tree.
 */
function directionToNearestOak(npc: Npc): 1 | -1 | null {
  const cx = npc.bird.x + npc.bird.size / 2
  let nearest: number | null = null
  for (const tree of activeTrees) {
    const x = tree.x + tree.trunkWidth / 2
    if (nearest === null || Math.abs(x - cx) < Math.abs(nearest - cx)) {
      nearest = x
    }
  }
  if (nearest === null) {
    return null
  }
  return nearest >= cx ? 1 : -1
}

/**
 * Switches to the explore state with a fresh direction and altitude.
 *
 * @param npc - NPC to update.
 */
function enterExplore(npc: Npc): void {
  npc.state = 'explore'
  // Toward a remembered acorn or burial site; with none, toward the nearest foreground oak (where
  // acorns fall), not a random direction.
  npc.direction = directionToRemembered(npc) ?? directionToNearestOak(npc) ?? randomDirection()
  // While it waits, the bird looks away from its travel direction first and then toward it.
  npc.bird.facing = npc.direction === 1 ? -1 : 1
  npc.targetAltitude = randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE)
  npc.altitudeTimer = randRange(1, 3)
  npc.target = null
  npc.siteTarget = null
  npc.glide = null
  npc.waitTimer = NPC_WAIT_SECONDS
}

/**
 * Returns to wandering after a task: idles when well fed, otherwise explores.
 *
 * @param npc - NPC to update.
 */
function enterExploreOrIdle(npc: Npc): void {
  if (npc.bird.hunger > NPC_IDLE_HUNGER) {
    npc.state = 'idle'
    npc.target = null
    npc.siteTarget = null
    npc.glide = null
    npc.idleTargetX = null
  } else {
    enterExplore(npc)
  }
}

/**
 * Switches to the find-burial-spot state: the bird picks a random direction and keeps flying that
 * way until it finds a spot whose burial quality is above its secrecy (see `runFindBurialSpot`).
 *
 * @param npc - NPC to update.
 * @param _world - Play space.
 */
function enterFindBurialSpot(npc: Npc, _world: World): void {
  npc.state = 'findBurialSpot'
  npc.searchDir = randomDirection()
  npc.direction = npc.searchDir
  npc.spotX = null
  npc.searchTimer = 0
  npc.glide = null
  npc.targetAltitude = randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE)
  npc.altitudeTimer = randRange(1, 3)
}

/** The player, refreshed every update (burial quality counts every bird, the player included). */
let activePlayer: Player | null = null

/**
 * Every bird in the world.
 *
 * @param world - Play space.
 */
function allBirds(world: World): Player[] {
  const birds = world.npcs.map((npc) => npc.bird)
  // An invisible player (debug) does not exist as far as the NPCs are concerned.
  return activePlayer && !activePlayer.invisible ? [activePlayer, ...birds] : birds
}

/**
 * Once-per-second state decisions: idle -> explore when hunger has dropped below the idle level,
 * idle wandering, and explore -> gather (for a noticed acorn) or retrieve (very hungry, none in view).
 *
 * @param npc - NPC deciding.
 * @param world - Play space.
 */
function decide(npc: Npc, world: World): void {
  if (npc.state === 'idle') {
    if (npc.bird.hunger < NPC_IDLE_HUNGER) {
      enterExplore(npc)
    } else if (npc.idleTargetX === null && Math.random() < IDLE_WANDER_PROBABILITY) {
      const size = npc.bird.size
      const cx = npc.bird.x + size / 2
      const trip = (Math.random() < 0.5 ? -1 : 1) * randRange(1.5, 5) * size
      npc.idleTargetX = Math.max(size, Math.min(world.width - size, cx + trip))
      npc.idleFly = Math.abs(trip) >= FLY_MIN_DISTANCE_IN_SIZES * size && Math.random() < IDLE_FLY_PROBABILITY
    }
    return
  }
  if (npc.state !== 'explore') {
    return
  }
  // An acorn (or another bird's burial site) the bird has noticed always comes first, even when it
  // is starving.
  if (applyPick(npc, pickTarget(npc, world))) {
    npc.state = 'gather'
    return
  }
  // Very hungry and nothing in view: go and dig up an acorn this bird remembers burying.
  if (npc.bird.hunger < NPC_RETRIEVE_HUNGER && npc.bird.burials.length > 0) {
    npc.state = 'retrieve'
    npc.digSpot = null
  }
}

/**
 * Moves toward a ground target x along a straight line: the bird starts a trip at its current altitude
 * (taking off only to the lowest cruising height when the target is far) and descends steadily so
 * that it arrives at ground level, never climbing more than necessary. A bird already on the ground
 * with a near target just hops.
 *
 * @param npc - Travelling NPC.
 * @param targetX - World x of the ground target.
 * @param world - Play space.
 */
function glideTo(npc: Npc, targetX: number, world: World): void {
  const { bird } = npc
  const distance = Math.abs(targetX - (bird.x + bird.size / 2)) / bird.size
  const altitude = altitudeOf(bird, world)
  if (!npc.glide || Math.abs(npc.glide.targetX - targetX) > 1) {
    npc.glide = {
      targetX,
      startAltitude: Math.max(altitude, distance > FLY_MIN_DISTANCE_IN_SIZES ? MIN_CRUISE_ALTITUDE : 0),
      startDistance: Math.max(distance, 0.001),
    }
  }
  const { startAltitude, startDistance } = npc.glide
  // Follow the direct line from the start of the trip when it is shallow enough; otherwise stay level
  // until the steepest glide cone is reached and then follow that.
  const desired =
    startAltitude / startDistance <= GLIDE_SLOPE
      ? (startAltitude * distance) / startDistance
      : Math.min(startAltitude, GLIDE_SLOPE * distance)
  steerHorizontal(npc, targetX)
  // Once over the target (horizontally), just land.
  if (desired < 0.1 || distance <= ARRIVE_IN_SIZES) {
    npc.keys.w = false
    npc.keys.s = true
  } else {
    steerAltitude(npc, desired, world)
  }
}

/**
 * Idle: stand still (landing if airborne), occasionally walking or flying a short distance.
 *
 * @param npc - Idle NPC.
 * @param world - Play space.
 */
function runIdle(npc: Npc, world: World): void {
  const { bird } = npc
  if (npc.idleTargetX === null) {
    npc.keys.s = bird.state === 'flying'
    return
  }
  const dx = npc.idleTargetX - (bird.x + bird.size / 2)
  const arrived = Math.abs(dx) <= ARRIVE_IN_SIZES * bird.size
  if (npc.idleFly) {
    if (!arrived) {
      glideTo(npc, npc.idleTargetX, world)
    } else if (bird.state === 'flying') {
      npc.keys.s = true
    } else {
      npc.idleTargetX = null
    }
    return
  }
  if (arrived) {
    npc.idleTargetX = null
  } else {
    steerHorizontal(npc, npc.idleTargetX)
  }
}

/**
 * Explore: fly in a random direction, wandering in altitude, bouncing off the world edges.
 *
 * @param npc - Exploring NPC.
 * @param world - Play space.
 * @param dt - Elapsed seconds.
 */
function runExplore(npc: Npc, world: World, dt: number): void {
  const { bird } = npc
  npc.altitudeTimer -= dt
  if (npc.altitudeTimer <= 0) {
    npc.altitudeTimer = randRange(1, 3)
    npc.targetAltitude = randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE)
  }
  if (bird.x <= 0) {
    npc.direction = 1
  } else if (bird.x >= world.width - bird.size) {
    npc.direction = -1
  }
  npc.keys.a = npc.direction === -1
  npc.keys.d = npc.direction === 1
  steerAltitude(npc, npc.targetAltitude, world)
}

/**
 * Gather: fly toward the target acorn (or another bird's burial site), land near it, hop to it, pick
 * it up (or dig for it), then eat or bury it.
 *
 * Retargets to another visible free acorn if the target was taken; explores if none remain.
 *
 * @param npc - Gathering NPC.
 * @param world - Play space.
 */
function runGather(npc: Npc, world: World): void {
  const { bird } = npc
  if (bird.action) {
    return
  }
  if (bird.held) {
    // The pick-up or dig animation finished with an acorn: pause a moment, then eat or go bury it.
    // A burial site that was dug at stays remembered (there may be more buried nearby).
    npc.target = null
    npc.siteTarget = null
    npc.waitTimer = NPC_WAIT_SECONDS
    if (bird.hunger < HUNGER_THRESHOLD) {
      npc.state = 'eat'
      npc.eatAttempted = false
    } else {
      enterFindBurialSpot(npc, world)
    }
    return
  }
  // A site is dropped from memory when a dig there comes up empty (see updateNpcs); acorns can be taken.
  if (npc.siteTarget && !npc.sites.includes(npc.siteTarget)) {
    npc.siteTarget = null
  }
  if (!npc.siteTarget && (!npc.target || npc.target.state !== 'ground')) {
    if (!applyPick(npc, pickTarget(npc, world))) {
      enterExploreOrIdle(npc)
      return
    }
  }
  const targetX = npc.siteTarget ? npc.siteTarget.x : (npc.target?.x ?? bird.x)
  const dx = targetX - (bird.x + bird.size / 2)

  if (bird.state === 'flying' || Math.abs(dx) > FLY_MIN_DISTANCE_IN_SIZES * bird.size) {
    // Fly to it (taking off only if farther than a couple of bird widths); nearer targets are hopped to.
    glideTo(npc, targetX, world)
    return
  }
  steerHorizontal(npc, targetX)
  npc.keys.w = false
  npc.keys.s = false

  if (Math.abs(dx) <= ARRIVE_IN_SIZES * bird.size) {
    releaseKeys(npc.keys)
    if (npc.siteTarget) {
      startDigAt(bird, npc.siteTarget.x, true)
    } else if (npc.target) {
      startPickup(bird, npc.target)
    }
  }
}

/**
 * Judges the spot where the bird's beak would bury, and starts burying there when its burial quality is
 * above the bird's secrecy.
 *
 * @param npc - NPC standing on the ground.
 * @param world - Play space.
 * @returns True when it will bury here.
 */
function buryHereIfGood(npc: Npc, world: World): boolean {
  const { bird } = npc
  const buryX = bird.x + bird.size / 2 + bird.facing * BEAK_REACH_X * (bird.size / 100)
  const quality = burialQuality(world, allBirds(world), bird, buryX, siteXs(npc))
  if (quality <= npc.secrecy) {
    return false
  }
  releaseKeys(npc.keys)
  npc.buryQuality = quality
  npc.buryQualityTimer = BURIAL_QUALITY_DISPLAY_SECONDS
  npc.state = 'bury'
  npc.waitTimer = NPC_WAIT_SECONDS
  return true
}

/**
 * Find burial spot: judge every spot the bird can see (its perception region, every quarter second) and keep
 * flying in the chosen direction until a spot's burial quality is above this bird's secrecy; then
 * glide down and land there. Once landed, the quality is checked again (the birds around may have
 * moved): if it is still above its secrecy the bird buries there, otherwise it takes off and keeps
 * looking.
 *
 * @param npc - NPC looking for a spot.
 * @param world - Play space.
 * @param dt - Elapsed seconds.
 */
function runFindBurialSpot(npc: Npc, world: World, dt: number): void {
  const { bird } = npc
  const cx = bird.x + bird.size / 2
  if (npc.spotX === null) {
    npc.searchTimer -= dt
    if (npc.searchTimer <= 0) {
      npc.searchTimer = 0.25
      // Every spot the bird can see is fair game (its perception region: far ahead, a little behind,
      // along the way it faces), the nearest acceptable one first; the spot under it is not special.
      const birds = allBirds(world)
      const ahead = NPC_PERCEIVE_AHEAD_IN_SIZES
      const behind = NPC_PERCEIVE_BEHIND_IN_SIZES
      const offsets: number[] = []
      for (let f = -behind; f <= ahead + 1e-9; f += 0.25) {
        offsets.push(f)
      }
      offsets.sort((p, q) => Math.abs(p) - Math.abs(q))
      for (const f of offsets) {
        const x = cx + bird.facing * f * bird.size
        if (x > bird.size && x < world.width - bird.size && burialQuality(world, birds, bird, x, siteXs(npc)) > npc.secrecy) {
          npc.spotX = x
          npc.glide = null
          break
        }
      }
    }
    if (npc.spotX === null) {
      // Nothing suitable yet. Flying alongside another jay does not help, so once a second, if one is
      // flying ahead in the same direction, there is a chance to turn around and fly the other way.
      npc.turnTimer += dt
      while (npc.turnTimer >= 1) {
        npc.turnTimer -= 1
        const range = BURIAL_QUALITY_RANGE_IN_SIZES * bird.size
        const jayAhead = allBirds(world).some(
          (other) =>
            other !== bird &&
            other.state === 'flying' &&
            other.facing === npc.searchDir &&
            (other.x + other.size / 2 - cx) * npc.searchDir > 0 &&
            (other.x + other.size / 2 - cx) * npc.searchDir <= range,
        )
        if (jayAhead && Math.random() < NPC_AVOID_JAY_TURN_PROBABILITY_PER_SECOND) {
          npc.searchDir = npc.searchDir === 1 ? -1 : 1
        }
      }
      // Keep flying the same way (bouncing off the world's edges).
      npc.direction = npc.searchDir
      runExplore(npc, world, dt)
      npc.searchDir = npc.direction
      return
    }
  }
  const dx = npc.spotX - cx
  const arrived = Math.abs(dx) <= ARRIVE_IN_SIZES * bird.size
  if (!arrived) {
    glideTo(npc, npc.spotX, world)
    return
  }
  steerHorizontal(npc, npc.spotX)
  npc.keys.w = false
  npc.keys.s = true
  if (bird.state === 'standing') {
    releaseKeys(npc.keys)
    // Landed: judge the spot again, where the beak will bury.
    if (!buryHereIfGood(npc, world)) {
      // Not good enough after all: take off and keep looking the same way.
      npc.spotX = null
      npc.searchTimer = 0
      npc.glide = null
    }
  }
}

/**
 * Bury: always buries the held acorn in front of the bird (with the pecking animation), then
 * returns to exploring or idling.
 *
 * @param npc - Burying NPC.
 * @param world - Play space (for choosing a new spot if the burial cannot start).
 */
function runBury(npc: Npc, world: World): void {
  const { bird } = npc
  if (bird.action) {
    return
  }
  if (bird.held) {
    startBury(bird)
    // startBury sets the action, which the earlier check had narrowed away.
    const started = bird.action as PlayerAction | null
    if (!started) {
      // The burial could not start (for example the bird ended up over the creek): pick a new spot.
      enterFindBurialSpot(npc, world)
    }
    return
  }
  // Buried: now cover it up. The bird hops over the site as many times as its secrecy, rounded up to
  // the next tenth, out of the ten it takes to hide it completely (at least one), which fades the
  // mound a little more with each hop (see `trackHops`).
  npc.state = 'cover'
  npc.coverHops = Math.max(1, Math.ceil(npc.secrecy * BURIAL_HOPS_TO_HIDE))
  npc.coverDir = bird.facing
}

/**
 * Cover: hop over the fresh burial site, back and forth (the first hop toward it, the next away
 * from it, and so on, so every hop starts beside it), then go back to exploring or idling. The
 * direction key is held through each hop and let go just before landing, so exactly one hop is made
 * (a key still held on landing would start another).
 *
 * @param npc - NPC covering a burial.
 * @param dt - Elapsed seconds.
 */
function runCover(npc: Npc, dt: number): void {
  const { bird } = npc
  if (bird.action) {
    return
  }
  if (bird.hopT < HOP_DURATION) {
    // Mid-hop: keep moving the way the hop started, until the last frame of it.
    if (bird.hopT + dt * 1.5 < HOP_DURATION) {
      if (bird.facing === 1) {
        npc.keys.d = true
      } else {
        npc.keys.a = true
      }
    }
    return
  }
  if (npc.coverHops <= 0) {
    enterExploreOrIdle(npc)
    return
  }
  // Start the next hop toward / away from the site.
  if (npc.coverDir === 1) {
    npc.keys.d = true
  } else {
    npc.keys.a = true
  }
  npc.coverHops -= 1
  npc.coverDir = npc.coverDir === 1 ? -1 : 1
}

/**
 * Retrieve: visit the nearest remembered burial spot and dig there (a free acorn noticed on the way
 * takes priority: the bird switches to gathering it instead). The spot is
 * forgotten on arrival whether or not an acorn is still there (another bird may have taken it), and
 * the next nearest spot is tried until an acorn is found or the memory is empty.
 *
 * @param npc - Retrieving NPC.
 * @param world - Play space (buried acorns).
 */
function runRetrieve(npc: Npc, world: World): void {
  const { bird } = npc
  if (bird.action) {
    return
  }
  if (bird.held) {
    // Dug one up: pause, then eat it.
    npc.digSpot = null
    npc.waitTimer = NPC_WAIT_SECONDS
    npc.state = 'eat'
    npc.eatAttempted = false
    return
  }
  // A free acorn that comes into view beats the trip: go and gather it (it will be eaten, since the
  // bird is hungry). The remembered spot stays in memory because it was not visited.
  if (applyPick(npc, pickTarget(npc, world))) {
    npc.state = 'gather'
    npc.digSpot = null
    return
  }
  const cx = bird.x + bird.size / 2
  if (npc.digSpot !== null && !bird.burials.includes(npc.digSpot)) {
    // Forgotten on the way (it saw another bird dig there).
    npc.digSpot = null
  }
  if (npc.digSpot === null) {
    let nearest: number | null = null
    for (const spot of npc.bird.burials) {
      if (nearest === null || Math.abs(spot - cx) < Math.abs(nearest - cx)) {
        nearest = spot
      }
    }
    if (nearest === null) {
      enterExploreOrIdle(npc)
      return
    }
    npc.digSpot = nearest
  }
  const dx = npc.digSpot - cx
  const far = Math.abs(dx) > FLY_MIN_DISTANCE_IN_SIZES * bird.size
  if (far || bird.state === 'flying') {
    // Fly straight to the spot, descending along the way, and land at it.
    glideTo(npc, npc.digSpot, world)
    return
  }
  if (Math.abs(dx) > ARRIVE_IN_SIZES * bird.size) {
    steerHorizontal(npc, npc.digSpot)
    return
  }

  // Arrived: forget this spot and dig there. The dig is tied to the place, not to the remembered
  // acorn: whichever buried acorn is nearest the beak (within range) responds, if any.
  // The dig itself updates the memory: the spot is forgotten when the acorn comes up (or nothing does).
  const spot = npc.digSpot
  npc.digSpot = null
  releaseKeys(npc.keys)
  startDigAt(bird, spot)
}

/**
 * Advances every NPC one frame: AI decisions, simulated keys, movement, and hunger.
 *
 * A bird holding an acorn while hungry enough to eat it (below `HUNGER_THRESHOLD`) always eats it,
 * whatever state it was in. One that holds an acorn it cannot eat goes to bury it rather than
 * exploring or idling with it in its beak.
 *
 * @param world - Play space.
 * @param dt - Elapsed seconds.
 * @param player - The human-controlled bird, which NPCs can watch too.
 */
export function updateNpcs(world: World, dt: number, player: Player): void {
  activeTrees = world.trees
  activePlayer = player
  for (const npc of world.npcs) {
    npc.buryQualityTimer = Math.max(0, npc.buryQualityTimer - dt)
  }
  // Hops near burial sites (by any bird) kick leaves onto them and hide them.
  trackHops(world, [player, ...world.npcs.map((npc) => npc.bird)])
  // A bury or dig-up can be noticed from the moment the head reaches the ground (burying) or the
  // acorn enters the beak (digging, only if one came up) until the animation ends; one roll per observer.
  const actors = [...(player.invisible ? [] : [player]), ...world.npcs.map((npc) => npc.bird)]
  for (const npc of world.npcs) {
    for (const actor of actors) {
      const action = actor.action
      if (actor !== npc.bird && action && action.kind !== 'pickup' && action.transferred) {
        perceiveDigging(npc, world, action, actor)
      }
    }
  }

  for (const npc of world.npcs) {
    const { bird } = npc
    if (bird.held && !bird.action && bird.eatTimer === 0 && npc.state !== 'eat') {
      // On the way to bury an acorn (or burying it) a bird only eats it when starving.
      const burying = npc.state === 'findBurialSpot' || npc.state === 'bury'
      if (bird.hunger < (burying ? NPC_STARVING_HUNGER : HUNGER_THRESHOLD)) {
        npc.state = 'eat'
        npc.eatAttempted = false
        npc.target = null
        npc.siteTarget = null
        npc.digSpot = null
        npc.idleTargetX = null
      } else if (npc.state === 'explore' || npc.state === 'idle') {
        enterFindBurialSpot(npc, world)
      }
    }

    updatePerception(npc, world)
    dropOwnBurialsFromSites(npc)

    let waiting = npc.waitTimer > 0
    if (waiting) {
      npc.waitTimer -= dt
      if (npc.state === 'explore') {
        // Look both ways before setting off: the second half of the pause faces the travel direction.
        bird.facing = npc.waitTimer > NPC_WAIT_SECONDS / 2 ? (npc.direction === 1 ? -1 : 1) : npc.direction
      }
    } else {
      npc.decisionTimer += dt
      while (npc.decisionTimer >= 1) {
        npc.decisionTimer -= 1
        decide(npc, world)
      }
      // A decision can start a pause (entering explore); then the bird must not move this frame.
      waiting = npc.waitTimer > 0
    }

    // A trip's straight-line glide starts fresh from the ground each time.
    if (bird.state === 'standing') {
      npc.glide = null
    }

    releaseKeys(npc.keys)
    let startEating = false
    if (bird.floating && !bird.action && npc.state !== 'eat') {
      // A bird floating on the creek can do nothing but hop out toward the nearest bank.
      if (bird.x + bird.size / 2 >= world.terrain.creek.x) {
        npc.keys.d = true
      } else {
        npc.keys.a = true
      }
    } else if (!waiting) {
      switch (npc.state) {
        case 'idle':
          runIdle(npc, world)
          break
        case 'explore':
          runExplore(npc, world, dt)
          break
        case 'gather':
          runGather(npc, world)
          break
        case 'findBurialSpot':
          runFindBurialSpot(npc, world, dt)
          break
        case 'bury':
          runBury(npc, world)
          break
        case 'cover':
          runCover(npc, dt)
          break
        case 'retrieve':
          runRetrieve(npc, world)
          break
        case 'eat':
          if (!npc.eatAttempted) {
            npc.eatAttempted = true
            startEating = true
          }
          break
        default:
          // follow and hide are not implemented yet.
          enterExplore(npc)
      }
    }

    updatePlayer(bird, npc.keys, dt, world, NPC_SPEED_SCALE)
    updateAction(bird, world, dt)
    // (a burial that just finished may sit on a site noted before)
    dropOwnBurialsFromSites(npc)
    if (bird.digFailX !== null) {
      // A dig that comes up empty removes the other-bird burial sites within range of it.
      const failX = bird.digFailX
      const range = DIG_RESPONSE_IN_SIZES * bird.size
      npc.sites = npc.sites.filter((site) => Math.abs(site.x - failX) > range)
      bird.digFailX = null
    }
    updateHunger(bird, startEating ? EAT_EDGES : NO_EDGES, world, dt)
    if (!waiting && npc.state === 'eat' && !startEating && npc.eatAttempted && bird.eatTimer === 0) {
      // Finished eating (or could not start): bury a leftover acorn, otherwise carry on.
      if (bird.held) {
        enterFindBurialSpot(npc, world)
      } else {
        enterExploreOrIdle(npc)
      }
    }
  }
}
