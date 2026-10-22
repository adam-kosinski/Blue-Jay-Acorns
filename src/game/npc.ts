import {
  HUNGER_THRESHOLD,
  NPC_BURIAL_SPAN_VIEWS,
  NPC_COUNT,
  NPC_GATHER_PROBABILITY,
  NPC_IDLE_HUNGER,
  NPC_SPEED_SCALE,
  NPC_VIEW_FRACTION,
  NPC_WAIT_SECONDS,
} from './constants'
import { startBury, startPickup, updateAction } from './acorns'
import { updateHunger } from './hunger'
import { createPlayer, groundUnder, updatePlayer } from './player'
import type { Acorn, KeyEdges, KeyState, Npc, Player, World } from './types'

/** Altitude band (player sizes above ground) NPCs wander through while exploring. */
const MIN_EXPLORE_ALTITUDE = 0.8
const MAX_EXPLORE_ALTITUDE = 4

/** Altitude (player sizes) NPCs cruise at on the way to a burial spot. */
const TRAVEL_ALTITUDE = 1.8

/** Horizontal gap (player sizes) at which an NPC counts as having reached its target. */
const ARRIVE_IN_SIZES = 0.5

/** Chance per second that an idle NPC wanders a short distance, and how often it flies it. */
const IDLE_WANDER_PROBABILITY = 0.3
const IDLE_FLY_PROBABILITY = 0.35

/** Horizontal gap (player sizes) at which a gathering NPC starts its descent. */
const LAND_DISTANCE_IN_SIZES = 2.5

const NO_EDGES: KeyEdges = { s: false, b: false, e: false }
const EAT_EDGES: KeyEdges = { s: false, b: false, e: true }

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
    })
  }
  return npcs
}

/**
 * Nearest free (on the ground) acorn within `range` of the bird's center, or null.
 *
 * @param bird - Looking bird.
 * @param world - Acorn container.
 * @param range - Viewing distance in pixels.
 */
function nearestFreeAcorn(bird: Player, world: World, range: number): Acorn | null {
  const cx = bird.x + bird.size / 2
  const cy = bird.y + bird.size / 2
  let best: Acorn | null = null
  let bestDist = range
  for (const acorn of world.acorns) {
    if (acorn.state !== 'ground') {
      continue
    }
    const dist = Math.hypot(acorn.x - cx, acorn.y - cy)
    if (dist <= bestDist) {
      best = acorn
      bestDist = dist
    }
  }
  return best
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
 * Switches to the explore state with a fresh direction and altitude.
 *
 * @param npc - NPC to update.
 */
function enterExplore(npc: Npc): void {
  npc.state = 'explore'
  npc.direction = randomDirection()
  npc.targetAltitude = randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE)
  npc.altitudeTimer = randRange(1, 3)
  npc.target = null
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
 * @param viewWidth - Window width in pixels.
 */
function enterFindBurialSpot(npc: Npc, world: World, viewWidth: number): void {
  const span = NPC_BURIAL_SPAN_VIEWS * viewWidth
  const cx = npc.bird.x + npc.bird.size / 2
  npc.state = 'findBurialSpot'
  npc.targetX = Math.max(
    npc.bird.size,
    Math.min(world.width - npc.bird.size, cx + randRange(-span, span)),
  )
}

/**
 * Once-per-second state decisions: idle -> explore when hunger has dropped below the idle level,
 * idle wandering, and explore -> gather (probabilistic).
 *
 * @param npc - NPC deciding.
 * @param world - Play space.
 * @param viewWidth - Window width in pixels.
 */
function decide(npc: Npc, world: World, viewWidth: number): void {
  if (npc.state === 'idle') {
    if (npc.bird.hunger < NPC_IDLE_HUNGER) {
      enterExplore(npc)
    } else if (npc.idleTargetX === null && Math.random() < IDLE_WANDER_PROBABILITY) {
      const size = npc.bird.size
      const cx = npc.bird.x + size / 2
      const trip = (Math.random() < 0.5 ? -1 : 1) * randRange(1.5, 5) * size
      npc.idleTargetX = Math.max(size, Math.min(world.width - size, cx + trip))
      npc.idleFly = Math.random() < IDLE_FLY_PROBABILITY
    }
    return
  }
  if (npc.state !== 'explore') {
    return
  }
  const acorn = nearestFreeAcorn(npc.bird, world, NPC_VIEW_FRACTION * viewWidth)
  if (acorn && Math.random() < NPC_GATHER_PROBABILITY) {
    npc.state = 'gather'
    npc.target = acorn
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
      steerHorizontal(npc, npc.idleTargetX)
      steerAltitude(npc, 1.2, world)
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
 * Gather: fly toward the target acorn, land near it, walk to it, pick it up, then eat or bury it.
 *
 * Retargets to another visible free acorn if the target was taken; explores if none remain.
 *
 * @param npc - Gathering NPC.
 * @param world - Play space.
 * @param viewWidth - Window width in pixels.
 */
function runGather(npc: Npc, world: World, viewWidth: number): void {
  const { bird } = npc
  if (bird.action) {
    return
  }
  if (bird.held) {
    // The pick-up animation finished: pause a moment, then eat or go bury it.
    npc.target = null
    npc.waitTimer = NPC_WAIT_SECONDS
    if (bird.hunger < HUNGER_THRESHOLD) {
      npc.state = 'eat'
      npc.eatAttempted = false
    } else {
      enterFindBurialSpot(npc, world, viewWidth)
    }
    return
  }
  if (!npc.target || npc.target.state !== 'ground') {
    npc.target = nearestFreeAcorn(bird, world, NPC_VIEW_FRACTION * viewWidth)
    if (!npc.target) {
      enterExploreOrIdle(npc)
      return
    }
  }
  const target = npc.target
  const dx = target.x - (bird.x + bird.size / 2)
  steerHorizontal(npc, target.x)
  npc.keys.w = false
  npc.keys.s = false

  if (bird.state === 'flying') {
    if (Math.abs(dx) < LAND_DISTANCE_IN_SIZES * bird.size) {
      npc.keys.s = true
    }
    return
  }

  if (Math.abs(dx) <= ARRIVE_IN_SIZES * bird.size) {
    releaseKeys(npc.keys)
    startPickup(bird, target)
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
  steerHorizontal(npc, npc.targetX)
  if (!arrived) {
    steerAltitude(npc, TRAVEL_ALTITUDE, world)
    return
  }
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
    return
  }
  enterExploreOrIdle(npc)
}

/**
 * Advances every NPC one frame: AI decisions, simulated keys, movement, and hunger.
 *
 * @param world - Play space.
 * @param viewWidth - Window width in pixels (sets viewing distance and trip length).
 * @param dt - Elapsed seconds.
 */
export function updateNpcs(world: World, viewWidth: number, dt: number): void {
  for (const npc of world.npcs) {
    const waiting = npc.waitTimer > 0
    if (waiting) {
      npc.waitTimer -= dt
    } else {
      npc.decisionTimer += dt
      while (npc.decisionTimer >= 1) {
        npc.decisionTimer -= 1
        decide(npc, world, viewWidth)
      }
    }

    releaseKeys(npc.keys)
    const wasEatAttempted = npc.eatAttempted
    if (!waiting) {
      switch (npc.state) {
        case 'idle':
          runIdle(npc, world)
          break
        case 'explore':
          runExplore(npc, world, dt)
          break
        case 'gather':
          runGather(npc, world, viewWidth)
          break
        case 'findBurialSpot':
          runFindBurialSpot(npc, world)
          break
        case 'bury':
          runBury(npc)
          break
        case 'eat':
          npc.eatAttempted = true
          break
        default:
          // follow and hide are not implemented yet.
          enterExplore(npc)
      }
    }

    updatePlayer(npc.bird, npc.keys, dt, world, NPC_SPEED_SCALE)
    updateAction(npc.bird, world, dt)
    const startEating = npc.state === 'eat' && !wasEatAttempted && !waiting
    updateHunger(npc.bird, startEating ? EAT_EDGES : NO_EDGES, world, dt)
    if (npc.state === 'eat' && wasEatAttempted && npc.bird.eatTimer === 0) {
      enterExploreOrIdle(npc)
    }
  }
}
