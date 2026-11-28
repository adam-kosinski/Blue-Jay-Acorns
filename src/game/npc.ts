import {
  BURIAL_HOPS_TO_HIDE,
  BURIAL_QUALITY_DISPLAY_SECONDS,
  NPC_AVOID_JAY_TURN_PROBABILITY_PER_SECOND,
  FOLLOW_COOLDOWN_SECONDS,
  FOLLOW_DISTANCE_MAX_IN_SIZES,
  FOLLOW_DISTANCE_MIN_IN_SIZES,
  HOP_DURATION,
  MOVE_SPEED_IN_SIZES,
  VERTICAL_SPEED_IN_SIZES,
  PATIENCE_INTERVAL_SECONDS,
  PATIENCE_WINDOW_IN_SIZES,
  HUNGER_THRESHOLD,
  NPC_COUNT,
  NPC_NOTICE_PROBABILITY,
  SQUIRREL_HOP_PAUSE_MAX_SECONDS,
  SQUIRREL_HOP_PAUSE_MIN_SECONDS,
  SQUIRREL_HUNGER_SCALE,
  SQUIRREL_IDLE_ENTER_HUNGER,
  SQUIRREL_IDLE_LEAVE_HUNGER,
  SQUIRREL_NOSE_REACH_X,
  NPC_MIN_SECRECY,
  SQUIRREL_SECRECY,
  SQUIRREL_SIZE_FRACTION,
  SQUIRREL_HOME_WIDTH_IN_SIZES,
  SQUIRREL_SPEED_SCALE,
  NPC_PERCEIVE_AHEAD_IN_SIZES,
  NPC_PERCEIVE_BEHIND_IN_SIZES,
  NPC_IDLE_HUNGER,
  NPC_RETRIEVE_HUNGER,
  NPC_SPEED_SCALE,
  NPC_STARVING_HUNGER,
  NPC_WAIT_SECONDS,
  WALK_SPEED_FACTOR,
} from './constants'
import {
  inHome,
  isOutsideHome,
  returnHome,
  nextSniffHops,
  placeHidden,
  runSquirrelExplore,
  runSquirrelIdle,
  squirrelWalk,
  startClimbDown,
  updateTreePhase,
} from './squirrel'
import { forgetBurial, startBury, startDig, startPickup, trackHops, updateAction } from './acorns'
import { BURIAL_QUALITY_RANGE_IN_SIZES, burialQuality, digRange, standingFacings } from './burial'
import { burialSiteVisibility, inView } from './vision'
import { updateHunger } from './hunger'
import { groundYAt, inWater, nearCreek } from './terrain'
import { createPlayer, groundUnder, updatePlayer } from './player'
import type { Acorn, BurialSite, KeyEdges, KeyState, Npc, Player, PlayerAction, World } from './types'

/** Altitude band (player sizes above ground) NPCs wander through while exploring. */
const MIN_EXPLORE_ALTITUDE = 0.8
const MAX_EXPLORE_ALTITUDE = 4

/** Lowest altitude (player sizes) a bird cruises at when it must fly to a ground target. */
const MIN_CRUISE_ALTITUDE = 1

/** Steepest glide into a ground target (altitude per horizontal distance); the climb/descend speed is half the flying speed. */
const GLIDE_SLOPE = 0.45

/** Ground targets nearer than this (player sizes) are reached by hopping, not flying: a flight needs room to climb and to come down diagonally. */
const FLY_MIN_DISTANCE_IN_SIZES = 4.5

/** Steepest line a bird can fly with both axes at full speed (vertical speed over sideways speed). */
const FLIGHT_MAX_SLOPE = VERTICAL_SPEED_IN_SIZES / MOVE_SPEED_IN_SIZES

/**
 * How far (player sizes) a flying bird may be off its glide line before it corrects: about a frame of
 * movement, so the keys switch every few frames and the path looks like a smooth line, not a staircase.
 */
const GLIDE_TOLERANCE = 0.0225

/** How close (player sizes) a flying bird gets to its target before it lands on it. */
const LAND_IN_SIZES = 0.225

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
 * The hunger level above which the animal is full enough to start idling.
 *
 * @param npc - The animal.
 */
function idleEnterHunger(npc: Npc): number {
  return npc.home ? SQUIRREL_IDLE_ENTER_HUNGER : NPC_IDLE_HUNGER
}

/**
 * The hunger level below which an idling animal gets up (a squirrel's is lower than its enter level).
 *
 * @param npc - The animal.
 */
function idleLeaveHunger(npc: Npc): number {
  return npc.home ? SQUIRREL_IDLE_LEAVE_HUNGER : NPC_IDLE_HUNGER
}

/**
 * A fresh NPC with default AI state around a body.
 *
 * @param bird - The body.
 * @param secrecy - Personality 0-1: how thoroughly it hides what it buries.
 */
function newNpc(bird: Player, secrecy: number): Npc {
  return {
      bird,
      keys: { w: false, a: false, s: false, d: false },
      nosiness: Math.random(),
      secrecy,
      coverHops: 0,
      coverDir: 1,
      searchDir: 1,
      spotX: null,
      searchTimer: 0,
      turnTimer: 0,
      buryQuality: 0,
      buryQualityTimer: 0,
      state: bird.hunger > NPC_IDLE_HUNGER ? 'idle' : 'explore',
    home: null,
    treePhase: 'ground',
    sniffTimer: 0,
    sniffHopsLeft: nextSniffHops(),
    sniffHopsAt: 0,
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
      blocked: [],
      goalKey: '',
      goalTime: 0,
      reachX: null,
      reachDir: 1,
      inView: new Set(),
      knownCount: 0,
      noticed: new Map(),
      seenActions: new WeakSet(),
      scaleX: 1,
      scaleY: 1,
      followTarget: null,
      followLo: 0,
      followHi: 0,
      followStill: 0,
      followNextRoll: 0,
      followBlock: [],
      followSeenSites: new Set(),
      followDistance: FOLLOW_DISTANCE_MIN_IN_SIZES,
      followEligible: false,
      seenBirds: new Set(),
      missedActions: new WeakSet(),
      sites: [],
      siteTarget: null,
      glide: null,
  }
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
    npcs.push(newNpc(bird, randRange(NPC_MIN_SECRECY, 1)))
  }
  return npcs
}

/**
 * Spawns one squirrel per oak: each lives in its tree and stays on the ground near its trunk (a stretch
 * `SQUIRREL_HOME_WIDTH_IN_SIZES` wide). About half start resting out of sight in the tree, the others foraging on the ground.
 *
 * @param world - Play space (trees and terrain are used).
 * @param playerSize - Player square size (a squirrel is a little smaller).
 */
export function createSquirrels(world: World, playerSize: number): Npc[] {
  const size = playerSize * SQUIRREL_SIZE_FRACTION
  return world.trees.map((tree) => {
    const bird = createPlayer(world, size)
    bird.species = 'squirrel'
    bird.reach = SQUIRREL_NOSE_REACH_X
    bird.hungerScale = SQUIRREL_HUNGER_SCALE
    bird.hunger = randRange(0.7, 0.9)
    const trunkX = tree.x + tree.trunkWidth / 2
    const reach = (SQUIRREL_HOME_WIDTH_IN_SIZES * playerSize) / 2
    const npc = newNpc(bird, SQUIRREL_SECRECY)
    npc.nosiness = null
    npc.state = bird.hunger > SQUIRREL_IDLE_ENTER_HUNGER ? 'idle' : 'explore'
    // The home stretch stops short of the creek (a squirrel cannot swim: it would float and be pushed
    // out again and again).
    const creek = world.terrain.creek
    const shore = creek.halfWidth + size
    let left = Math.max(size, trunkX - reach)
    let right = Math.min(world.width - size, trunkX + reach)
    if (trunkX > creek.x) {
      left = Math.max(left, creek.x + shore)
    } else {
      right = Math.min(right, creek.x - shore)
    }
    npc.home = { tree, trunkX, left, right }
    if (npc.state === 'idle') {
      placeHidden(npc, world)
    } else {
      bird.x = randRange(npc.home.left, npc.home.right) - size / 2
      bird.y = groundUnder(bird, world) - size
      bird.facing = randomDirection()
      npc.direction = bird.facing
    }
    return npc
  })
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
    // (One lost in the creek is forgotten at once, wherever the bird is.)
    if (acorn.state === 'sinking' || (!current.has(acorn) && inView(npc.bird, spot))) {
      npc.noticed.delete(acorn)
    }
  }
  npc.inView = current
  perceiveBuried(npc, world)
}

/**
 * Chance to notice other birds' burial sites. When a buried acorn that is not this bird's own newly
 * comes into view it may be noticed, with a probability that falls with the hops that disguised it
 * (`burialSiteVisibility`: 1 when fresh, steeply at first, 0 when fully hidden) times, while flying,
 * `NPC_NOTICE_PROBABILITY`. A bird that lands with a site in view rolls once more, without
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
    const visibility = burialSiteVisibility(acorn.hops)
    let noticed = false
    if (!npc.viewedBuried.has(acorn)) {
      // Newly in view.
      noticed = Math.random() < visibility * (standing ? 1 : NPC_NOTICE_PROBABILITY)
      if (standing) {
        npc.landedRolled.add(acorn)
      }
    } else if (landed && !npc.landedRolled.has(acorn)) {
      noticed = Math.random() < visibility
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
    if (acorn.state !== 'ground' || !npc.inView.has(acorn) || !canGoTo(npc, acorn.x)) {
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
 * @param ignoreSites - Sites not to consider (a follower ignores the ones it already knew about).
 */
function pickTarget(
  npc: Npc,
  world: World,
  ignoreSites?: ReadonlySet<BurialSite>,
): { acorn: Acorn | null; site: BurialSite | null } {
  const cx = npc.bird.x + npc.bird.size / 2
  const cy = npc.bird.y + npc.bird.size / 2
  const acorn = nearestNoticedAcorn(npc)
  const acornDist = acorn ? Math.hypot(acorn.x - cx, acorn.y - cy) : Infinity
  let site: BurialSite | null = null
  let siteDist = Infinity
  for (const candidate of npc.sites) {
    const y = groundYAt(world.terrain, candidate.x)
    if (ignoreSites?.has(candidate) || !canGoTo(npc, candidate.x) || !inView(npc.bird, { x: candidate.x, y })) {
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
    // Saw another bird dig up one of its own acorns: it knows exactly which burial that was, so the
    // burial is forgotten and the spot is not noted as another bird's site (nothing is left there).
    forgetBurial(npc.bird, dug.x)
    npc.seenActions.add(action)
    return
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
    npc.sites.push({ x, owner, noticedAt: world.time, fromDig: action.kind === 'dig' })
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

/** Horizontal gap (player sizes) within which a bird walking up to a beak target counts as there, and the gap below which it slows down to creep onto the spot. */
const BEAK_ARRIVE_IN_SIZES = 0.02
const BEAK_CREEP_IN_SIZES = 0.15

/**
 * Moves the NPC so that its beak tip is exactly on a ground spot, facing the way it came (so a bury or
 * dig action will act on exactly that spot). Far targets are flown to and landed at; the last stretch is
 * hopped with the keys, stopping at once when the key is released, and a bird that ends up facing
 * the wrong way turns with a one-frame key tap. The way to face is fixed when the target is first
 * chosen (toward it), so the bird does not dither.
 *
 * @param npc - Moving NPC.
 * @param targetX - World x the beak tip should be on.
 * @param world - Play space.
 * @returns True once the beak is on the spot, the bird is standing, still, and facing the right way.
 */
function moveBeakTo(npc: Npc, targetX: number, world: World): boolean {
  const { bird } = npc
  const cx = bird.x + bird.size / 2
  const offset = bird.reach * (bird.size / 100)
  if (npc.reachX === null || Math.abs(npc.reachX - targetX) > 1) {
    npc.reachX = targetX
    npc.reachDir = targetX >= cx ? 1 : -1
    // The bird needs a dry place to stand (over the water it floats and cannot bury or dig): when the
    // usual way (facing the spot as it arrives) would put it over the creek, it stands on the other
    // side of the spot and faces the other way.
    const facings = standingFacings(world, bird, targetX)
    if (facings.length > 0 && !facings.includes(npc.reachDir)) {
      npc.reachDir = facings[0] as 1 | -1
    }
  }
  const dir = npc.reachDir
  // Where the bird's centre must be for its beak to be on the target.
  const centerTarget = targetX - dir * offset
  const dx = centerTarget - cx
  if (bird.state === 'flying' || Math.abs(dx) > FLY_MIN_DISTANCE_IN_SIZES * bird.size) {
    glideTo(npc, centerTarget, world)
    return false
  }
  // The last stretch is walked at a speed proportional to what is left (never more than one frame's
  // step), so the bird comes to rest exactly on the spot without overshooting; correcting a small miss at
  // full speed would swing it past the spot and turn it left and right every frame, over and over.
  const gap = Math.abs(dx)
  if (gap > BEAK_ARRIVE_IN_SIZES * bird.size) {
    npc.keys.a = dx < 0
    npc.keys.d = dx > 0
    npc.scaleX = Math.min(1, gap / (BEAK_CREEP_IN_SIZES * bird.size))
    return false
  }
  if (bird.facing !== dir) {
    // On the spot but facing the wrong way: a key tap that does not move the bird turns it.
    if (dir === 1) {
      npc.keys.d = true
    } else {
      npc.keys.a = true
    }
    npc.scaleX = 0
    return false
  }
  return bird.hopT >= HOP_DURATION
}

/**
 * Keeps a bird on dry land from walking into the creek: if this frame's walking would carry it over the water,
 * it stays where it is (facing that way). Without this, a bird heading for something at or beyond the water
 * steps in, is made to hop straight out again (a floating bird can only do that), steps back in, and so
 * flickers between standing and floating, turning back and forth. (Flying over the water is not affected.)
 *
 * @param npc - The NPC, its keys set for this frame.
 * @param world - Play space.
 * @param dt - Elapsed seconds.
 * @param speedScale - How fast it moves compared with the player.
 */
function stayOutOfWater(npc: Npc, world: World, dt: number, speedScale: number): void {
  const { bird, keys } = npc
  if (bird.state !== 'standing' || bird.floating || keys.w || keys.a === keys.d) {
    return
  }
  const dir = keys.d ? 1 : -1
  const cx = bird.x + bird.size / 2
  // (A hop is quickest at its start: 1.4 times the average walking speed.)
  const step = MOVE_SPEED_IN_SIZES * WALK_SPEED_FACTOR * 1.4 * speedScale * npc.scaleX * bird.size * dt
  if (inWater(world.terrain, cx + dir * (step + 1))) {
    keys.a = false
    keys.d = false
    bird.facing = dir
    // A stroll that way is called off, and wandering turns back.
    if (npc.state === 'idle') {
      npc.idleTargetX = null
    } else if (npc.state === 'explore' || npc.state === 'findBurialSpot') {
      npc.direction = dir === 1 ? -1 : 1
      npc.searchDir = npc.direction
    }
  }
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
    if (!inHome(npc, x)) {
      return
    }
    if (nearestX === null || Math.abs(x - cx) < Math.abs(nearestX - cx)) {
      nearestX = x
    }
  }
  for (const spot of npc.noticed.values()) {
    if (canGoTo(npc, spot.x)) {
      consider(spot.x)
    }
  }
  for (const site of npc.sites) {
    if (canGoTo(npc, site.x)) {
      consider(site.x)
    }
  }
  if (nearestX === null) {
    return null
  }
  return nearestX >= cx ? 1 : -1
}

/** The world, refreshed every update (so goal checks need no extra parameter). */
let activeWorld: World | null = null

/** Seconds an NPC works on one goal before it gives up on it, and how long it then ignores that place. */
const GOAL_GIVE_UP_SECONDS = 40
const GOAL_BLOCKED_SECONDS = 90

/**
 * Whether an NPC may pick a place (world x) as the goal for something that needs its beak there (an
 * acorn to pick up, a site to dig, a spot to bury at): it must be dry land with somewhere dry to stand
 * to reach it, and not a place the NPC recently gave up on. Goals failing this are never chosen, so an
 * NPC does not set out for something it cannot do.
 *
 * @param npc - The NPC choosing.
 * @param x - World x of the goal.
 */
function canGoTo(npc: Npc, x: number): boolean {
  const world = activeWorld
  if (!world) {
    return true
  }
  if (inWater(world.terrain, x) || standingFacings(world, npc.bird, x).length === 0) {
    return false
  }
  // A bird that cannot fly (a squirrel) cannot get across the creek: anything on the other side is out.
  if (npc.home && (x - world.terrain.creek.x) * (npc.bird.x + npc.bird.size / 2 - world.terrain.creek.x) < 0) {
    return false
  }
  return !npc.blocked.some((block) => block.until > world.time && Math.abs(block.x - x) <= npc.bird.size * 0.25)
}

/**
 * Gives up on a goal that has been pursued for too long without success (whatever stopped it): the
 * place is ignored for a while and the NPC goes back to exploring (or idling) or looks for another spot.
 * A change of goal restarts the clock.
 *
 * @param npc - The NPC.
 * @param world - Play space.
 * @param dt - Elapsed seconds.
 */
function watchGoal(npc: Npc, world: World, dt: number): void {
  let goal: number | null = null
  if (npc.state === 'gather') {
    goal = npc.siteTarget?.x ?? npc.target?.x ?? null
  } else if (npc.state === 'retrieve') {
    goal = npc.digSpot
  } else if (npc.state === 'findBurialSpot') {
    goal = npc.spotX
  }
  const key = goal === null ? '' : `${npc.state}:${Math.round(goal)}`
  if (key !== npc.goalKey) {
    npc.goalKey = key
    npc.goalTime = 0
    return
  }
  if (goal === null) {
    return
  }
  npc.goalTime += dt
  if (npc.goalTime < GOAL_GIVE_UP_SECONDS) {
    return
  }
  npc.blocked.push({ x: goal, until: world.time + GOAL_BLOCKED_SECONDS })
  npc.goalKey = ''
  npc.goalTime = 0
  npc.reachX = null
  npc.glide = null
  npc.target = null
  npc.siteTarget = null
  npc.digSpot = null
  if (npc.state === 'findBurialSpot') {
    npc.spotX = null
    npc.searchTimer = 0
  } else {
    enterExploreOrIdle(npc)
  }
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
  if (npc.home) {
    // A squirrel resting in its tree climbs down first, and starts counting hops to its next sniff.
    startClimbDown(npc)
    npc.sniffHopsAt = npc.bird.hops
    npc.sniffHopsLeft = nextSniffHops()
  }
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
  if (npc.bird.hunger > idleEnterHunger(npc)) {
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
  const birds = [...world.npcs, ...world.squirrels].filter((npc) => !npc.bird.hidden).map((npc) => npc.bird)
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
    if (npc.bird.hunger < idleLeaveHunger(npc)) {
      enterExplore(npc)
    } else if (npc.idleTargetX === null && Math.random() < IDLE_WANDER_PROBABILITY) {
      const size = npc.bird.size
      const cx = npc.bird.x + size / 2
      const trip = (Math.random() < 0.5 ? -1 : 1) * randRange(1.5, 5) * size
      const target = Math.max(size, Math.min(world.width - size, cx + trip))
      // Not a trip into the creek.
      npc.idleTargetX = inWater(world.terrain, target) ? null : target
      npc.idleFly = Math.abs(trip) >= FLY_MIN_DISTANCE_IN_SIZES * size && Math.random() < IDLE_FLY_PROBABILITY
    }
    return
  }
  if (npc.state === 'follow') {
    decideFollow(npc, world)
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
  if (npc.bird.hunger < NPC_RETRIEVE_HUNGER && npc.bird.burials.some((spot) => canGoTo(npc, spot))) {
    npc.state = 'retrieve'
    npc.digSpot = null
    return
  }
  // Nothing in view, but it remembers an acorn or burial site it noticed: that is a known destination,
  // so it heads that way (turning round if it has to) until the spot comes back into view.
  const heading = directionToRemembered(npc)
  if (heading !== null) {
    npc.direction = heading
  }
}

/**
 * The birds a jay may follow: the player (unless invisible in debug mode) and the other jays.
 *
 * @param world - Play space.
 */
function followCandidates(world: World): Player[] {
  const jays = world.npcs.filter((other) => !other.bird.hidden).map((other) => other.bird)
  return activePlayer && !activePlayer.invisible ? [activePlayer, ...jays] : jays
}

/**
 * Whether a bird is a jay in the follow state.
 *
 * @param world - Play space.
 * @param bird - Bird to check.
 */
function isFollowing(world: World, bird: Player): boolean {
  return world.npcs.some((other) => other.bird === bird && other.state === 'follow')
}

/**
 * Whether some jay is following this bird.
 *
 * @param world - Play space.
 * @param bird - Bird to check.
 */
function isBeingFollowed(world: World, bird: Player): boolean {
  return world.npcs.some((other) => other.state === 'follow' && other.followTarget === bird)
}

/**
 * Whether this bird may be followed now: not itself in the follow state, and not on this NPC's cooldown.
 *
 * @param npc - The would-be follower.
 * @param world - Play space.
 * @param other - Bird to follow.
 */
function mayFollow(npc: Npc, world: World, other: Player): boolean {
  return (
    other !== npc.bird &&
    !isFollowing(world, other) &&
    !npc.followBlock.some((block) => block.bird === other && block.until > world.time)
  )
}

/**
 * Nosy jays: updates which other birds are in this jay's perception region, and when one has just
 * entered it while the jay is idle (or exploring with nowhere to go), rolls to start following it:
 * `0.5 x nosiness`, or `nosiness` when that bird is carrying an acorn. A bird that is being followed
 * does not start following anyone itself.
 *
 * @param npc - The jay.
 * @param world - Play space.
 */
function considerFollow(npc: Npc, world: World): void {
  const bird = npc.bird
  if (npc.home || npc.nosiness === null) {
    return
  }
  const visible = new Set<Player>()
  for (const other of followCandidates(world)) {
    if (other !== bird && inView(bird, { x: other.x + other.size / 2, y: other.y + other.size / 2 })) {
      visible.add(other)
    }
  }
  // Eligible when idle or exploring, not starving, and it remembers no free acorn (it may remember other
  // birds' burial sites), and not busy.
  const eligible =
    (npc.state === 'idle' || npc.state === 'explore') &&
    npc.noticed.size === 0 &&
    bird.hunger >= NPC_RETRIEVE_HUNGER &&
    !bird.floating &&
    !bird.action &&
    !bird.held &&
    bird.eatTimer === 0 &&
    !isBeingFollowed(world, bird)
  // On becoming eligible it rolls for every bird already in view; after that, for each bird that enters
  // its view. One roll per bird, one at a time, birds carrying an acorn first; the first success starts the
  // following and stops the rolls (it is possible that none succeeds).
  const justEligible = eligible && !npc.followEligible
  npc.followEligible = eligible
  if (eligible) {
    const rolls = [...visible].filter((other) => (justEligible || !npc.seenBirds.has(other)) && mayFollow(npc, world, other))
    rolls.sort((p, q) => Number(q.held !== null) - Number(p.held !== null))
    for (const other of rolls) {
      if (Math.random() < npc.nosiness * (other.held ? 1 : 0.5)) {
        enterFollow(npc, other, world)
        break
      }
    }
  }
  npc.seenBirds = visible
}

/**
 * The remembered burial sites of other birds that are in this NPC's view right now.
 *
 * @param npc - The NPC.
 * @param world - Terrain for the ground height at a site.
 */
function visibleSites(npc: Npc, world: World): Set<BurialSite> {
  const seen = new Set<BurialSite>()
  for (const site of npc.sites) {
    // (A spot noted from seeing a dig-up is only a guess; seeing one never makes a follower leave.)
    if (!site.fromDig && canGoTo(npc, site.x) && inView(npc.bird, { x: site.x, y: groundYAt(world.terrain, site.x) })) {
      seen.add(site)
    }
  }
  return seen
}

/**
 * Starts following a bird.
 *
 * @param npc - The jay.
 * @param other - Bird to follow.
 * @param world - Play space.
 */
function enterFollow(npc: Npc, other: Player, world: World): void {
  npc.state = 'follow'
  npc.followSeenSites = visibleSites(npc, world)
  npc.followDistance = randRange(FOLLOW_DISTANCE_MIN_IN_SIZES, FOLLOW_DISTANCE_MAX_IN_SIZES)
  setFollowTarget(npc, other)
  npc.target = null
  npc.siteTarget = null
  npc.idleTargetX = null
  npc.glide = null
  npc.targetAltitude = randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE)
  npc.altitudeTimer = randRange(1, 3)
}

/**
 * Points a follower at a bird and restarts its patience clock.
 *
 * @param npc - The follower.
 * @param other - Bird to follow.
 */
function setFollowTarget(npc: Npc, other: Player): void {
  const x = other.x + other.size / 2
  npc.followTarget = other
  npc.followLo = x
  npc.followHi = x
  npc.followStill = 0
  npc.followNextRoll = PATIENCE_INTERVAL_SECONDS
}

/**
 * Stops following (the bird keeps its distance from that one for a while) and goes back to idling or
 * exploring according to hunger.
 *
 * @param npc - The follower.
 * @param world - Play space.
 */
function leaveFollow(npc: Npc, world: World): void {
  if (npc.followTarget) {
    npc.followBlock.push({ bird: npc.followTarget, until: world.time + FOLLOW_COOLDOWN_SECONDS })
  }
  npc.followTarget = null
  npc.glide = null
  enterExploreOrIdle(npc)
}

/**
 * Once-per-second follow decisions. The bird stops following when the followed bird is more than half a
 * screen away (back to idle or explore by hunger), when it is hungry enough to go and dig up an acorn of
 * its own, or when an acorn or another bird's burial site comes into view (it goes to gather it); and
 * it switches to a bird carrying an acorn when it is following one that is not.
 *
 * @param npc - The follower.
 * @param world - Play space.
 */
function decideFollow(npc: Npc, world: World): void {
  const target = npc.followTarget
  const range = BURIAL_QUALITY_RANGE_IN_SIZES * npc.bird.size
  if (!target || Math.abs(target.x + target.size / 2 - (npc.bird.x + npc.bird.size / 2)) > range) {
    leaveFollow(npc, world)
    return
  }
  // Noticing a free acorn ends the following (a burial site does too: see `runFollow`).
  if (applyPick(npc, pickTarget(npc, world, new Set(npc.sites)))) {
    npc.followTarget = null
    npc.glide = null
    npc.state = 'gather'
    return
  }
  // Too hungry to tag along: go and dig up one of its own acorns if it remembers any, otherwise explore.
  if (npc.bird.hunger < NPC_RETRIEVE_HUNGER) {
    if (npc.bird.burials.some((spot) => canGoTo(npc, spot))) {
      npc.followTarget = null
      npc.glide = null
      npc.state = 'retrieve'
      npc.digSpot = null
    } else {
      leaveFollow(npc, world)
    }
    return
  }
  if (!target.held) {
    for (const other of npc.seenBirds) {
      if (other.held && mayFollow(npc, world, other)) {
        setFollowTarget(npc, other)
        return
      }
    }
  }
}

/**
 * Follow: stay within a bird width of the followed bird, facing it. Fly along when it flies (changing
 * altitude now and then while moving sideways, hovering otherwise), land when it lands (flying to it
 * first if it is far, which is quicker than hopping). Loses interest with probability 1 - nosiness every
 * patience interval while the followed bird stays inside a one-bird-wide window.
 *
 * @param npc - Following NPC.
 * @param world - Play space.
 * @param dt - Elapsed seconds.
 */
function runFollow(npc: Npc, world: World, dt: number): void {
  const { bird } = npc
  const target = npc.followTarget
  if (!target) {
    enterExploreOrIdle(npc)
    return
  }
  // Noticing a burial site, a new one or one it knew that comes back into view, sends it to dig there.
  const sites = visibleSites(npc, world)
  let noticed: BurialSite | null = null
  for (const site of sites) {
    if (!npc.followSeenSites.has(site) && (noticed === null || Math.abs(site.x - bird.x) < Math.abs(noticed.x - bird.x))) {
      noticed = site
    }
  }
  npc.followSeenSites = sites
  if (noticed) {
    npc.followTarget = null
    npc.glide = null
    applyPick(npc, { acorn: null, site: noticed })
    npc.state = 'gather'
    return
  }
  const size = bird.size
  const cx = bird.x + size / 2
  const tx = target.x + target.size / 2
  // Patience: a roll for every interval the followed bird has stayed inside the window.
  const lo = Math.min(npc.followLo, tx)
  const hi = Math.max(npc.followHi, tx)
  if (hi - lo > PATIENCE_WINDOW_IN_SIZES * size) {
    npc.followLo = tx
    npc.followHi = tx
    npc.followStill = 0
    npc.followNextRoll = PATIENCE_INTERVAL_SECONDS
  } else {
    npc.followLo = lo
    npc.followHi = hi
    npc.followStill += dt
    if (npc.followStill >= npc.followNextRoll) {
      npc.followNextRoll += PATIENCE_INTERVAL_SECONDS
      if (Math.random() < 1 - (npc.nosiness ?? 0)) {
        leaveFollow(npc, world)
        return
      }
    }
  }
  const dx = tx - cx
  const near = Math.abs(dx) <= npc.followDistance * size
  const toward: 1 | -1 = dx >= 0 ? 1 : -1
  if (target.state === 'flying') {
    // Fly along (taking off first).
    npc.keys.w = bird.state === 'standing'
    if (!near) {
      npc.keys.a = toward === -1
      npc.keys.d = toward === 1
      if (bird.state === 'flying') {
        npc.altitudeTimer -= dt
        if (npc.altitudeTimer <= 0) {
          npc.altitudeTimer = randRange(1, 3)
          npc.targetAltitude = randRange(MIN_EXPLORE_ALTITUDE, MAX_EXPLORE_ALTITUDE)
        }
        steerAltitude(npc, npc.targetAltitude, world)
      }
    }
  } else if (!near) {
    // Land beside it: far away is flown to (and landed at), near is hopped to.
    let point = tx + (cx >= tx ? 1 : -1) * size * npc.followDistance * 0.8
    if (inWater(world.terrain, point)) {
      // Not onto the water: on the bank on this side of it.
      const { creek } = world.terrain
      point = creek.x + (cx >= creek.x ? 1 : -1) * (creek.halfWidth + size * 0.5)
    }
    if (bird.state === 'flying' || Math.abs(dx) > FLY_MIN_DISTANCE_IN_SIZES * size) {
      glideTo(npc, point, world)
    } else {
      npc.keys.a = toward === -1
      npc.keys.d = toward === 1
    }
  } else if (bird.state === 'flying') {
    npc.keys.s = true
  }
  // Facing it: a one-frame tap turns a bird that is near but looking away.
  // (Not when it is nearly on top of the bird, where "toward" flips with every tiny shift and the tap
  // would turn it left and right again and again.)
  if (near && Math.abs(dx) > 0.3 * size && bird.facing !== toward && (bird.state === 'flying' || bird.hopT >= HOP_DURATION)) {
    if (toward === 1) {
      npc.keys.d = true
    } else {
      npc.keys.a = true
    }
  }
}

/**
 * Whether a squirrel stands still for a moment after each hop right now: while it explores with nothing
 * to head for or looks for a spot to bury, but not on the way to a chosen burial spot, back to its home
 * stretch, or to an acorn or burial site it has seen or remembers.
 *
 * @param npc - The animal.
 */
function squirrelRests(npc: Npc): boolean {
  if (!npc.home || isOutsideHome(npc)) {
    return false
  }
  if (npc.state === 'explore') {
    return directionToRemembered(npc) === null
  }
  if (npc.state === 'findBurialSpot') {
    return npc.spotX === null
  }
  return false
}

/**
 * Flies to a ground target x on a diagonal path, never dropping straight down onto it (unless it
 * starts right above it). Normally the bird climbs diagonally until it meets the descent diagonal onto
 * the target (it need not reach any particular cruising height: it starts the glide down as soon as it
 * reaches the diagonal), flies level at a cruising height of about a bird size if the distance leaves
 * room for that, and then comes down the diagonal so that it touches down on the target itself. A bird
 * that starts higher than the diagonal (it is above the target, close to it or high up) keeps its
 * height until the diagonal reaches it if the target is far; if the target is too close for that, it
 * flies in a straight line to the target, across and down (straight down if it is right above it). A
 * bird already on the ground with a near target just hops.
 *
 * @param npc - Travelling NPC.
 * @param targetX - World x of the ground target.
 * @param world - Play space.
 */
function glideTo(npc: Npc, targetX: number, world: World): void {
  const { bird } = npc
  const dx = targetX - (bird.x + bird.size / 2)
  const distance = Math.abs(dx) / bird.size
  // Heights are measured above the target's ground level, so a sloping hillside does not fool the glide:
  // `rel` is how much lower the target's ground is than the ground under the bird.
  const rel = (groundYAt(world.terrain, targetX) - groundUnder(bird, world)) / bird.size
  const altitude = altitudeOf(bird, world)
  const height = Math.max(0, altitude + rel)
  if (!npc.glide || Math.abs(npc.glide.targetX - targetX) > 1) {
    npc.glide = {
      targetX,
      startAltitude: height,
      startDistance: Math.max(distance, 0.001),
      cruise: Math.max(height, MIN_CRUISE_ALTITUDE),
      // Above the gentlest descent diagonal onto the target: the only way down is a steeper straight line.
      straight: height > GLIDE_SLOPE * distance + 0.05,
    }
  }
  const { startAltitude, startDistance, cruise, straight } = npc.glide
  const reach = LAND_IN_SIZES * bird.size
  let wanted: number
  if (straight) {
    // The straight line from where the approach began down to the target.
    wanted = (startAltitude * distance) / startDistance
  } else {
    const travelled = Math.max(0, startDistance - distance)
    // The lowest of the climb diagonal (a little ahead of the bird so that it lifts off at once), the
    // cruising height and the descent diagonal.
    wanted = Math.min(startAltitude + GLIDE_SLOPE * travelled + 0.3, cruise, GLIDE_SLOPE * distance)
  }
  if (straight && height > 0.02) {
    // A straight line to the target, steeper than the gentle diagonal: aim at the target every frame and
    // fly sideways and down at once, each at the fraction of its speed that makes the path a straight
    // line (a bird cannot descend faster than half its sideways speed along a line this steep without
    // the slower axis being throttled), instead of alternating between moving across and dropping.
    const slope = height / Math.max(distance, 0.001)
    const landAt = Math.max(0.02, LAND_IN_SIZES * 0.5 * Math.min(1, FLIGHT_MAX_SLOPE / slope))
    if (distance <= landAt) {
      npc.keys.a = false
      npc.keys.d = false
      npc.keys.w = false
      npc.keys.s = true
      return
    }
    npc.keys.a = dx < 0
    npc.keys.d = dx > 0
    npc.keys.w = false
    npc.keys.s = true
    npc.scaleX = slope > FLIGHT_MAX_SLOPE ? FLIGHT_MAX_SLOPE / slope : 1
    npc.scaleY = slope > FLIGHT_MAX_SLOPE ? 1 : slope / FLIGHT_MAX_SLOPE
    return
  }
  // Over the target: land.
  if (distance <= LAND_IN_SIZES) {
    npc.keys.a = false
    npc.keys.d = false
    npc.keys.w = false
    npc.keys.s = true
    return
  }
  // Along the line: the bird only moves across while it is not above the line, so a line steeper than
  // the bird can descend becomes a steeper straight run instead of a drop at the end.
  // (Not while the bird is already down at the ground: the target's ground may fall away faster than the
  // line, and standing still there would wait for a descent that cannot happen.)
  const aboveLine = straight && height > wanted + GLIDE_TOLERANCE && altitude > 0.1
  npc.keys.a = dx < -reach && !aboveLine
  npc.keys.d = dx > reach && !aboveLine
  const target = Math.max(0, wanted - rel)
  npc.keys.w = altitude < target - GLIDE_TOLERANCE
  npc.keys.s = altitude > target + GLIDE_TOLERANCE
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
  if (npc.siteTarget) {
    // Another bird's site: put the beak on it and dig, never bringing up one of its own acorns.
    if (moveBeakTo(npc, npc.siteTarget.x, world)) {
      releaseKeys(npc.keys)
      npc.reachX = null
      startDig(bird, world, true)
    }
    return
  }
  const targetX = npc.target?.x ?? bird.x
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
    if (npc.target) {
      startPickup(bird, npc.target)
    }
  }
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
    if (returnHome(npc)) {
      // A squirrel only buries in its home stretch: walk back to it first.
      return
    }
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
        // The burial point (where the beak will be) is somewhere in the bird's perception region.
        const x = cx + bird.facing * f * bird.size
        if (x > bird.size && x < world.width - bird.size && inHome(npc, x) &&
          canGoTo(npc, x) && burialQuality(world, birds, bird, x, siteXs(npc), !npc.home) > npc.secrecy) {
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
      if (npc.home) {
        squirrelWalk(npc)
      } else {
        runExplore(npc, world, dt)
      }
      npc.searchDir = npc.direction
      return
    }
  }
  // Put the beak tip exactly on the chosen spot, then judge it once more (the birds around may have
  // moved) and bury there, or take off and keep looking the same way.
  if (!moveBeakTo(npc, npc.spotX, world)) {
    return
  }
  releaseKeys(npc.keys)
  npc.reachX = null
  // (The beak is within a few pixels of the chosen spot; judging the chosen spot itself keeps this check
  // consistent with the one that picked it.)
  const quality = burialQuality(world, allBirds(world), bird, npc.spotX, siteXs(npc), !npc.home)
  if (quality > npc.secrecy) {
    npc.buryQuality = quality
    npc.buryQualityTimer = BURIAL_QUALITY_DISPLAY_SECONDS
    npc.state = 'bury'
    npc.waitTimer = NPC_WAIT_SECONDS
  } else {
    npc.spotX = null
    npc.searchTimer = 0
    npc.glide = null
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
    startBury(bird, world)
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
  if (bird.action || (npc.home && bird.hopRest > 0)) {
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
      if (!canGoTo(npc, spot)) {
        continue
      }
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
  // Put the beak on the remembered spot and dig there (the closest buried acorn in range of the beak
  // comes up, possibly one of its own: it is retrieving).
  if (!moveBeakTo(npc, npc.digSpot, world)) {
    return
  }
  npc.digSpot = null
  npc.reachX = null
  releaseKeys(npc.keys)
  startDig(bird, world, false)
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
  activeWorld = world
  const animals = [...world.npcs, ...world.squirrels]
  for (const npc of animals) {
    npc.buryQualityTimer = Math.max(0, npc.buryQualityTimer - dt)
  }
  // Hops near burial sites (by any bird) kick leaves onto them and hide them.
  trackHops(world, [player, ...animals.filter((npc) => !npc.bird.hidden).map((npc) => npc.bird)])
  // A bury or dig-up can be noticed from the moment the head reaches the ground (burying) or the
  // acorn enters the beak (digging, only if one came up) until the animation ends; one roll per observer.
  const actors = [
    ...(player.invisible ? [] : [player]),
    ...animals.filter((npc) => !npc.bird.hidden).map((npc) => npc.bird),
  ]
  for (const npc of animals) {
    if (npc.bird.hidden) {
      continue
    }
    for (const actor of actors) {
      const action = actor.action
      if (actor !== npc.bird && action && action.kind !== 'pickup' && action.transferred) {
        perceiveDigging(npc, world, action, actor)
      }
    }
  }

  for (const npc of animals) {
    const { bird } = npc
    if (npc.home && npc.treePhase !== 'ground') {
      // A squirrel on its trunk: only waiting to be hungry (idle), climbing, or hidden.
      if (npc.state === 'idle' && bird.hunger < idleLeaveHunger(npc)) {
        enterExplore(npc)
      }
      updateTreePhase(npc, world, dt)
      updateHunger(bird, NO_EDGES, world, dt)
      continue
    }
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
      } else if (npc.state === 'explore' || npc.state === 'idle' || npc.state === 'follow') {
        npc.followTarget = null
        enterFindBurialSpot(npc, world)
      }
    }

    if (npc.home && npc.sniffTimer > 0 && npc.state !== 'explore') {
      // A sniff cut short (it saw an acorn, say): the nose comes up at once.
      npc.sniffTimer = 0
      bird.sniff = -1
    }
    updatePerception(npc, world)
    considerFollow(npc, world)
    dropOwnBurialsFromSites(npc)
    // Having just noticed something it decides at once what to do about it (the once-per-second
    // decision would let it wander off before it looked).
    const known = npc.sites.length + npc.noticed.size
    if (known > npc.knownCount || (known > 0 && npc.state === 'explore')) {
      // (Also every frame while exploring toward something it remembers: at a once-a-second check a fast
      // bird overshoots a remembered spot between checks, finds it behind it (out of view), turns
      // around, overshoots again and goes back and forth.)
      npc.decisionTimer = Math.max(npc.decisionTimer, 1)
    }
    npc.knownCount = known

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
        if (npc.home && npc.sniffTimer > 0) {
          // Let a squirrel finish sniffing first.
          break
        }
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

    watchGoal(npc, world, dt)
    releaseKeys(npc.keys)
    npc.scaleX = 1
    npc.scaleY = 1
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
          if (npc.home) {
            runSquirrelIdle(npc)
          } else {
            runIdle(npc, world)
          }
          break
        case 'explore':
          if (npc.home) {
            runSquirrelExplore(npc, world, dt)
          } else {
            runExplore(npc, world, dt)
          }
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
        case 'follow':
          runFollow(npc, world, dt)
          break
        case 'eat':
          if (!npc.eatAttempted) {
            npc.eatAttempted = true
            startEating = true
          }
          break
        default:
          break
      }
    }

    if (npc.home) {
      // Squirrels never fly.
      npc.keys.w = false
      npc.keys.s = false
    }
    // Squirrels stand still for a moment after every hop while they wander or search, never on the way to
    // somewhere (done in the hop physics, where the landing is).
    const rests = squirrelRests(npc)
    if (!rests) {
      bird.hopRest = 0
    }
    // (A floating bird is on its way out and is left to it.)
    stayOutOfWater(npc, world, dt, npc.home ? SQUIRREL_SPEED_SCALE : NPC_SPEED_SCALE)
    updatePlayer(
      bird,
      npc.keys,
      dt,
      world,
      npc.home ? SQUIRREL_SPEED_SCALE : NPC_SPEED_SCALE,
      rests ? SQUIRREL_HOP_PAUSE_MAX_SECONDS : 0,
      rests ? SQUIRREL_HOP_PAUSE_MIN_SECONDS : 0,
      npc.scaleX,
      npc.scaleY,
    )
    updateAction(bird, world, dt)
    // (a burial that just finished may sit on a site noted before)
    dropOwnBurialsFromSites(npc)
    if (bird.digFailX !== null) {
      // A dig that comes up empty removes the other-bird burial sites within range of it.
      const failX = bird.digFailX
      const range = digRange(world, bird)
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
