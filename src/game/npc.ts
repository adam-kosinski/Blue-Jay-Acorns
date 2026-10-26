import {
  DIG_RESPONSE_IN_SIZES,
  HUNGER_THRESHOLD,
  NPC_BURIAL_SPAN_IN_SIZES,
  NPC_COUNT,
  NPC_NOTICE_PROBABILITY,
  NPC_IDLE_HUNGER,
  NPC_RETRIEVE_HUNGER,
  NPC_SPEED_SCALE,
  NPC_STARVING_HUNGER,
  NPC_PERCEIVE_AHEAD_IN_SIZES,
  NPC_PERCEIVE_BEHIND_IN_SIZES,
  NPC_WAIT_SECONDS,
} from './constants'
import { startBury, startDigAt, startPickup, updateAction } from './acorns'
import { updateHunger } from './hunger'
import { groundYAt } from './terrain'
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
const FLY_MIN_DISTANCE_IN_SIZES = 4

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
    bird.y = groundUnder(bird, world) - size
    bird.facing = randomDirection()
    bird.hunger = randRange(0.4, 1)
    npcs.push({
      bird,
      keys: { w: false, a: false, s: false, d: false },
      nosiness: Math.random(),
      state: bird.hunger > NPC_IDLE_HUNGER ? 'idle' : 'explore',
      decisionTimer: Math.random(),
      direction: bird.facing,
      targetAltitude: randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE),
      altitudeTimer: randRange(1, 3),
      target: null,
      targetX: 0,
      eatAttempted: false,
      waitTimer: 0,
      idleTargetX: null,
      idleFly: false,
      memory: [],
      digSpot: null,
      inView: new Set(),
      noticed: new Map(),
      sites: [],
      siteTarget: null,
      glide: null,
    })
  }
  return npcs
}

/**
 * Whether the bird can currently see a point on the ground (a free acorn or a burial spot).
 *
 * A bird sees acorns up to a third of a typical screen width in front of it and about one bird-width
 * behind it (and within the same distance above or below), all measured in player sizes so the range
 * never depends on the window size. "In front" follows the way the bird faces.
 *
 * @param bird - Looking bird (its facing sets "ahead").
 * @param acorn - Point to check (an acorn, or the spot of a burial).
 */
function inView(bird: Player, acorn: { x: number; y: number }): boolean {
  const forward = (acorn.x - (bird.x + bird.size / 2)) * bird.facing
  const dy = acorn.y - (bird.y + bird.size / 2)
  const ahead = NPC_PERCEIVE_AHEAD_IN_SIZES * bird.size
  const behind = NPC_PERCEIVE_BEHIND_IN_SIZES * bird.size
  return forward <= ahead && forward >= -behind && Math.abs(dy) <= ahead
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
 * Lets an NPC perceive a burial that just happened. If the spot is in view the NPC notices it (a
 * standing bird always does, a flying bird 75% of the time) and remembers it as another bird's
 * burial site; the fading line to it starts now.
 *
 * @param npc - Perceiving NPC.
 * @param world - Terrain and clock.
 * @param x - World x of the burial.
 * @param owner - The bird that buried the acorn.
 */
function perceiveBurial(npc: Npc, world: World, x: number, owner: Player): void {
  if (owner === npc.bird || !inView(npc.bird, { x, y: groundYAt(world.terrain, x) })) {
    return
  }
  if (npc.bird.state !== 'standing' && Math.random() >= NPC_NOTICE_PROBABILITY) {
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

/**
 * Switches to the explore state with a fresh direction and altitude.
 *
 * @param npc - NPC to update.
 */
function enterExplore(npc: Npc): void {
  npc.state = 'explore'
  npc.direction = directionToRemembered(npc) ?? randomDirection()
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
 * Switches to the find-burial-spot state and picks a distance up to two screens either way.
 *
 * @param npc - NPC to update.
 * @param world - Play space (clamps the destination).
 */
function enterFindBurialSpot(npc: Npc, world: World): void {
  const span = NPC_BURIAL_SPAN_IN_SIZES * npc.bird.size
  const cx = npc.bird.x + npc.bird.size / 2
  npc.state = 'findBurialSpot'
  npc.targetX = Math.max(
    npc.bird.size,
    Math.min(world.width - npc.bird.size, cx + randRange(-span, span)),
  )
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
  if (npc.bird.hunger < NPC_RETRIEVE_HUNGER && npc.memory.length > 0) {
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
      startDigAt(bird, npc.siteTarget.x)
    } else if (npc.target) {
      startPickup(bird, npc.target)
    }
  }
}

/**
 * Find burial spot: fly the chosen distance, land, then switch to bury.
 *
 * @param npc - Travelling NPC.
 * @param world - Play space.
 */
function runFindBurialSpot(npc: Npc, world: World): void {
  const { bird } = npc
  const dx = npc.targetX - (bird.x + bird.size / 2)
  const arrived = Math.abs(dx) <= ARRIVE_IN_SIZES * bird.size
  if (!arrived) {
    glideTo(npc, npc.targetX, world)
    return
  }
  steerHorizontal(npc, npc.targetX)
  npc.keys.w = false
  npc.keys.s = true
  if (bird.state === 'standing') {
    releaseKeys(npc.keys)
    npc.state = 'bury'
    npc.waitTimer = NPC_WAIT_SECONDS
  }
}

/**
 * Bury: always buries the held acorn in front of the bird (with the pecking animation), then
 * returns to exploring or idling.
 *
 * @param npc - Burying NPC.
 */
function runBury(npc: Npc): void {
  const { bird } = npc
  if (bird.action) {
    return
  }
  if (bird.held) {
    startBury(bird)
    // startBury sets the action, which the earlier check had narrowed away.
    const started = bird.action as PlayerAction | null
    if (started) {
      npc.memory.push(started.spotX)
    }
    return
  }
  enterExploreOrIdle(npc)
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
  if (npc.digSpot === null) {
    let nearest: number | null = null
    for (const spot of npc.memory) {
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
  const spot = npc.digSpot
  npc.memory.splice(npc.memory.indexOf(spot), 1)
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
 */
export function updateNpcs(world: World, dt: number): void {
  for (const event of world.burialEvents) {
    for (const npc of world.npcs) {
      perceiveBurial(npc, world, event.x, event.owner)
    }
  }
  world.burialEvents = []

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
    if (!waiting) {
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
          runFindBurialSpot(npc, world)
          break
        case 'bury':
          runBury(npc)
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
