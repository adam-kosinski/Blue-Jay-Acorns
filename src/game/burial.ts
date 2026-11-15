import {
  ACORN_SPREAD_FACTOR,
  BURIAL_QUALITY_BIRD_PENALTY,
  BURIAL_QUALITY_OAK_PENALTY,
  BURIAL_QUALITY_OTHER_SITE_PENALTY,
  BURIAL_QUALITY_OWN_SITE_PENALTY,
  BURIAL_QUALITY_UNSEEN_PENALTY,
  DIG_RESPONSE_IN_SIZES,
  TYPICAL_VIEW_WIDTH_IN_SIZES,
} from './constants'
import { groundYAt, inWater } from './terrain'
import { inView } from './vision'
import type { OakTree, Player, World } from './types'

/** How far (in player sizes) a bird can judge burial spots and is a risk to them: half a typical screen width. */
export const BURIAL_QUALITY_RANGE_IN_SIZES = TYPICAL_VIEW_WIDTH_IN_SIZES / 2

const treeReaches = new WeakMap<OakTree, number>()

/**
 * The farthest an acorn can fall from an oak's trunk center: the reach of its leaf clusters.
 *
 * @param tree - Oak.
 */
export function acornReach(tree: OakTree): number {
  let reach = treeReaches.get(tree)
  if (reach === undefined) {
    reach = 0
    for (const lobe of tree.shape.lobes) {
      reach = Math.max(reach, Math.abs(lobe.x) + lobe.r * 0.8)
    }
    reach = Math.max(reach * ACORN_SPREAD_FACTOR, 1)
    treeReaches.set(tree, reach)
  }
  return reach
}

/**
 * The facings (1 right, -1 left) a bird can stand with to bury an acorn exactly at `x` (where its beak
 * tip lands): the spot itself must not be in the creek's water, and the place the bird has to stand
 * (its centre, one beak reach behind the spot) must not be either, since a bird over the water floats
 * and cannot bury. Empty when there is no way to bury there.
 *
 * @param world - Terrain.
 * @param burier - The bird that would bury (its size and beak reach set where it stands).
 * @param x - World x of the burial point.
 */
export function buryingFacings(world: World, burier: Player, x: number): (1 | -1)[] {
  return inWater(world.terrain, x) ? [] : standingFacings(world, burier, x)
}

/**
 * The facings (1 right, -1 left) a bird can stand with so that its beak tip lands on `x` while the bird
 * itself (its centre, one beak reach behind the spot) is on dry ground: a bird over the water floats and
 * can neither bury nor dig. Used for digging too.
 *
 * @param world - Terrain.
 * @param bird - The bird (its size and beak reach set where it stands).
 * @param x - World x the beak tip should land on.
 */
export function standingFacings(world: World, bird: Player, x: number): (1 | -1)[] {
  const offset = bird.reach * (bird.size / 100)
  const facings: (1 | -1)[] = []
  for (const facing of [1, -1] as const) {
    if (!inWater(world.terrain, x - facing * offset)) {
      facings.push(facing)
    }
  }
  return facings
}

/**
 * How good a spot is for `burier` to bury an acorn, from 0 (terrible) to 1 (ideal). Starting at 1:
 * every other bird (the player included) within half a screen width of the spot, wherever the burier
 * is, lowers it by 0.8 if that bird can see the spot (its view reaches farther ahead than behind) and
 * by 0.4 if it cannot; an oak lowers it by up to 0.5
 * (at its trunk's center, easing off linearly to 0 at the farthest an acorn can fall); a place the burier remembers burying an acorn at lowers it by 0.2, easing to 0 two dig tolerances away; a spot
 * where no standing position allows burying (in the creek, or where the bird could only stand in the
 * water) scores 0; nothing goes below 0.
 *
 * @param world - Trees and terrain.
 * @param birds - Every bird (the player and the NPCs).
 * @param burier - The bird looking to bury.
 * @param x - World x of the spot.
 * @param sites - World x of every burial site of another bird the burier remembers (the player's `dugSites` by default).
 * @param useOaks - False to ignore how near an oak the spot is (squirrels do).
 */
export function burialQuality(
  world: World,
  birds: Player[],
  burier: Player,
  x: number,
  sites: readonly number[] = burier.dugSites,
  useOaks = true,
): number {
  const size = burier.size
  const range = BURIAL_QUALITY_RANGE_IN_SIZES * size
  if (buryingFacings(world, burier, x).length === 0) {
    return 0
  }
  let q = 1
  for (const bird of birds) {
    if (bird === burier) {
      continue
    }
    const bx = bird.x + bird.size / 2
    // Every bird within half a screen of the spot counts, wherever the burier is.
    if (Math.abs(bx - x) < range) {
      // Worse if that bird can see the spot, less bad if it is near but cannot see it.
      q -= inView(bird, { x, y: groundYAt(world.terrain, x) })
        ? BURIAL_QUALITY_BIRD_PENALTY
        : BURIAL_QUALITY_UNSEEN_PENALTY
    }
  }
  for (const tree of useOaks ? world.trees : []) {
    const reach = acornReach(tree)
    const distance = Math.abs(x - (tree.x + tree.trunkWidth / 2))
    if (distance < reach) {
      q -= BURIAL_QUALITY_OAK_PENALTY * (1 - distance / reach)
    }
  }
  // Near a place the burier remembers burying an acorn: the full penalty at the place itself, easing
  // linearly to nothing two dig tolerances away (the farthest apart two spots can be and both be
  // dug from one standing place).
  const tolerance = DIG_RESPONSE_IN_SIZES * size
  let own = 0
  for (const spot of burier.burials) {
    own = Math.max(own, BURIAL_QUALITY_OWN_SITE_PENALTY * (1 - Math.abs(spot - x) / (2 * tolerance)))
  }
  // Burying within dig range of a site of another bird is very bad: its owner may come to dig there
  // and would find the new acorn.
  const nearOther = sites.some((spot) => Math.abs(spot - x) <= tolerance)
  return Math.max(0, q - own - (nearOther ? BURIAL_QUALITY_OTHER_SITE_PENALTY : 0))
}
