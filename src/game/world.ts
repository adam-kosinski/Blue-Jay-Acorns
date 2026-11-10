import {
  ACORN_COUNT,
  LEAF_COLORS,
  GROUND_COLOR,
  FOREST_HAZE_COLOR,
  OAK_TONES,
  OAK_TREE_COUNT,
  SCENERY_SCALE,
  TYPICAL_ASPECT_RATIO,
  WORLD_BOTTOM_EXTRA_FACTOR,
  WORLD_TOP_EXTRA_FACTOR,
  WORLD_WIDTH_MULTIPLIER,
  acornRadiusForPlayer,
  groundHeightForView,
  playerSizeForView,
  TRUNK_COLOR,
} from './constants'
import { createNpcs, createSquirrels } from './npc'
import { generateOak } from './oak'
import { buildFineNoise, buildTerrain, CREEK_DRIFT, groundYAt } from './terrain'
import type {
  Acorn,
  BackdropTree,
  Bush,
  BushLobe,
  Creek,
  FrontBush,
  Fern,
  FrontFern,
  FrontRock,
  GapRock,
  KickedLeaf,
  ForestLayer,
  LeafLitter,
  Log,
  OakTree,
  Rock,
  Terrain,
  World,
} from './types'

const BUSH_COLORS = ['#2f6b34', '#3a7d3d', '#2a5c2f', '#468a44']
const ROCK_COLORS: [string, string][] = [
  ['#7a7872', '#a5a29a'],
  ['#6b6a66', '#98958e'],
  ['#85807a', '#b0aca3'],
]

/** Bushes, logs, boulders and small-rock clusters per run. */
const BUSH_COUNT = 7
const LOG_COUNT = 5
const BOULDER_COUNT = 6
const ROCK_CLUSTER_COUNT = 11


/** Props in front of the foreground's surface line. */
const FRONT_ROCK_COUNT = 40
const FRONT_BUSH_COUNT = 3
const FRONT_FERN_CLUMPS = 6

/** Fern clumps in the foreground. */
const FERN_CLUMPS = 5

/** Rocks (on average) in each stretch of ground between two background layers. */
const GAP_ROCK_COUNT = 26

/** Rocks lining the foreground creek's banks. */
const BANK_ROCK_COUNT = 30

/** Extra bushes placed along the foreground creek's banks (so banks are very likely to have bushes). */
const BANK_BUSH_COUNT = 5

/** Parallax settings per background layer, farthest first (fog is the share blended toward the haze: atmospheric perspective) (spacing is the average gap between trunks in view heights; small so trunks and crowns fill sightlines). */
const FOREST_LAYERS: {
  parallax: number
  fog: number
  lift: number
  scale: number
  spacing: number
  /** Only exists around the creek, fading into the haze away from it. */
  local?: boolean
}[] = [
  // Three extra, much farther layers that exist only near the creek: the creek lets the player
  // see much deeper into the forest than anywhere else.
  { parallax: 0.045, fog: 0.48, lift: 0.4125, scale: 0.2, spacing: 0.08, local: true },
  { parallax: 0.065, fog: 0.46, lift: 0.375, scale: 0.25, spacing: 0.09, local: true },
  { parallax: 0.09, fog: 0.435, lift: 0.3375, scale: 0.3, spacing: 0.1, local: true },
  { parallax: 0.12, fog: 0.4, lift: 0.3, scale: 0.36, spacing: 0.11 },
  { parallax: 0.22, fog: 0.31, lift: 0.2475, scale: 0.42, spacing: 0.15 },
  { parallax: 0.35, fog: 0.225, lift: 0.195, scale: 0.5, spacing: 0.2 },
  { parallax: 0.5, fog: 0.14, lift: 0.15, scale: 0.58, spacing: 0.27 },
  { parallax: 0.68, fog: 0.06, lift: 0.105, scale: 0.66, spacing: 0.36 },
]

/** Atmospheric perspective of the farthest background layer: the backdrop behind every layer matches it. */
export const BACKDROP_FOG = FOREST_LAYERS[0]?.fog ?? 0.5

/** Water color before haze is mixed in. */
const WATER_COLOR = '#4f86ad'

/** Each background layer's creek is this fraction as wide as the layer in front of it. */
const CREEK_LAYER_SHRINK = 0.78

/** A keep-out span (the creek's water plus its banks) where no trees, bushes or logs spawn. */
type Span = { x: number; halfWidth: number }

/**
 * Whether an object centered at x with the given half extent overlaps the span.
 *
 * @param span - Keep-out span.
 * @param x - Center x.
 * @param half - Half extent of the object.
 */
function blocked(span: Span, x: number, half = 0): boolean {
  return Math.abs(x - span.x) < span.halfWidth + half
}

/**
 * The foreground creek's keep-out span for scenery: the water and the upper part of its banks.
 *
 * @param creek - Foreground creek.
 */
function creekKeepOut(creek: Creek): Span {
  return { x: creek.x, halfWidth: creek.halfWidth + creek.bank * 0.5 }
}

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
 * Picks a random element, falling back to `fallback` for empty arrays.
 *
 * @param items - Candidates.
 * @param fallback - Value used if `items` is empty.
 */
function pick<T>(items: T[], fallback: T): T {
  return items[Math.floor(Math.random() * items.length)] ?? fallback
}

/**
 * Builds oak trees spread across the world, each about one viewport tall.
 *
 * @param worldWidth - Full world width.
 * @param viewHeight - Window height used as the tree's total height.
 * @param keepOut - Creek span trunks stay out of.
 * @param terrain - Ground heights (the old-growth tree's roots follow them).
 */
function spawnOakTrees(worldWidth: number, viewHeight: number, keepOut: Span, terrain: Terrain): OakTree[] {
  const crownRadius = viewHeight * 0.32 * SCENERY_SCALE
  const trunkHeight = (viewHeight - viewHeight * 0.32) * SCENERY_SCALE
  const trunkWidth = Math.max(18, viewHeight * 0.055) * 1.3 * SCENERY_SCALE
  const trees: OakTree[] = []
  const margin = crownRadius + trunkWidth
  const usable = Math.max(trunkWidth, worldWidth - 2 * margin)
  const slot = usable / OAK_TREE_COUNT

  // One of the oaks is an old-growth tree: twice the trunk width, branches 1.5x as thick, and
  // buttress roots that spread at least a bird's size past the trunk on each side.
  const oldGrowthIndex = Math.floor(Math.random() * OAK_TREE_COUNT)
  for (let i = 0; i < OAK_TREE_COUNT; i += 1) {
    const old = i === oldGrowthIndex
    const width = old ? trunkWidth * 2 : trunkWidth
    const slotStart = margin + i * slot
    // Oaks stand well back from the creek: their acorns fall from all over the crown, so a trunk must
    // be about a crown's reach from the water or acorns would fall into it.
    const noOak = { x: keepOut.x, halfWidth: terrain.creek.halfWidth + crownRadius * 0.9 }
    let x = slotStart + randRange(slot * 0.12, slot * 0.88) - width / 2
    for (let attempt = 0; attempt < 40 && blocked(noOak, x + width / 2, width * 0.5); attempt += 1) {
      x = slotStart + randRange(slot * 0.12, slot * 0.88) - width / 2
    }
    if (blocked(noOak, x + width / 2, width * 0.5)) {
      // The whole slot is too close: stand at the edge of the clear zone on the slot's side.
      const side = x + width / 2 < noOak.x ? -1 : 1
      x = Math.max(margin, Math.min(worldWidth - margin - width, noOak.x + side * (noOak.halfWidth + width) - width / 2))
    }
    const baseX = x + width / 2
    const baseGround = groundYAt(terrain, baseX)
    trees.push({
      shape: generateOak(
        viewHeight * SCENERY_SCALE,
        trunkWidth,
        old ? playerSizeForView(viewHeight) * 1.1 : 0,
        (dx) => groundYAt(terrain, baseX + dx) - baseGround,
      ),
      x,
      trunkWidth: width,
      trunkHeight,
      crownRadius,
    })
  }

  return trees
}

/**
 * Leaves already kicked up into small piles all over the ground surface when the run starts (so a
 * pile of kicked leaves, and a hidden burial, look just like the land around them).
 *
 * @param terrain - Ground heights.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (sizes the leaves).
 */
function spawnKickedLeaves(terrain: Terrain, worldWidth: number, playerSize: number): KickedLeaf[] {
  const leaves: KickedLeaf[] = []
  const water = { x: terrain.creek.x, halfWidth: terrain.creek.halfWidth }
  for (let x = 0; x < worldWidth; x += 170) {
    const center = x + randRange(0, 170)
    const count = 5 + Math.floor(Math.random() * 5)
    for (let i = 0; i < count; i += 1) {
      const lx = center + randRange(-0.45, 0.45) * playerSize
      if (blocked(water, lx)) {
        continue
      }
      const rx = randRange(0.035, 0.08) * playerSize * 2
      const y = groundYAt(terrain, lx) - Math.random() * rx * 0.7
      leaves.push({
        x: lx,
        y,
        vx: 0,
        vy: 0,
        restX: lx,
        restY: y,
        rx,
        ry: rx * randRange(0.35, 0.55),
        angle: randRange(-Math.PI / 2, Math.PI / 2),
        color: pick(LEAF_COLORS, '#8a5a2b'),
        landed: true,
        fading: false,
        fade: 0,
      })
    }
  }
  return leaves
}

/**
 * Standard normal sample (Box-Muller).
 */
function randNormal(): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Scatters acorns in clusters around the oak trunks.
 *
 * @param worldWidth - Full world width.
 * @param terrain - Ground heights.
 * @param radius - Circle radius (diameter is 1/4 player height).
 * @param trees - Oaks the acorns fall around.
 * @param keepOut - Creek span acorns are not placed in.
 */
function spawnAcorns(
  worldWidth: number,
  terrain: Terrain,
  radius: number,
  trees: OakTree[],
  keepOut: Span,
): Acorn[] {
  const acorns: Acorn[] = []
  for (let i = 0; i < ACORN_COUNT; i += 1) {
    const tree = trees[i % trees.length]
    if (!tree) {
      break
    }
    const spread = tree.crownRadius * 0.45
    let x = tree.x + tree.trunkWidth / 2
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const offset = Math.max(-tree.crownRadius, Math.min(tree.crownRadius, randNormal() * spread))
      const candidate = Math.max(radius, Math.min(worldWidth - radius, tree.x + tree.trunkWidth / 2 + offset))
      if (!blocked(keepOut, candidate)) {
        x = candidate
        break
      }
    }
    acorns.push({
      x,
      y: groundYAt(terrain, x) - radius,
      radius,
      state: 'ground',
      hops: 0,
      conceal: 0,
      vy: 0,
    })
  }
  return acorns
}

/**
 * Mixes two `#rrggbb` colors.
 *
 * @param from - Base color.
 * @param to - Color blended in.
 * @param amount - 0 returns `from`, 1 returns `to`.
 */
export function mixColor(from: string, to: string, amount: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const parts = [0, 1, 2].map((i) =>
    Math.round(channel(from, i) * (1 - amount) + channel(to, i) * amount),
  )
  return `rgb(${parts.join(',')})`
}

/**
 * Scatters fallen leaves over the whole ground, from the surface down to the bottom of the world
 * (leaves are a little bigger the lower, i.e. nearer the viewer, they lie).
 *
 * @param terrain - Ground heights.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (scales leaf size).
 * @param bottom - Y of the bottom of the world.
 */
function spawnLeafLitter(
  terrain: Terrain,
  worldWidth: number,
  playerSize: number,
  bottom: number,
): LeafLitter[] {
  const water = { x: terrain.creek.x, halfWidth: terrain.creek.halfWidth }
  const leaves: LeafLitter[] = []
  const spacing = 5
  for (let x = 0; x < worldWidth; x += spacing) {
    const surfaceAtX = groundYAt(terrain, x)
    const depth = Math.max(0, bottom - surfaceAtX)
    // About 0.6 leaves per 5 px column for every half bird-width of depth (sparse enough not to draw the eye).
    const expected = (0.6 * (depth + 0.03 * playerSize)) / (0.5 * playerSize)
    const count = Math.floor(expected) + (Math.random() < expected - Math.floor(expected) ? 1 : 0)
    for (let i = 0; i < count; i += 1) {
      const lx = x + randRange(-spacing, spacing)
      if (blocked(water, lx)) {
        continue
      }
      const ground = groundYAt(terrain, lx)
      const y = ground - 0.03 * playerSize + Math.random() * (bottom - ground + 0.03 * playerSize)
      // Nothing under the creek: below the waterline across the whole creek bowl (the water, the
      // front stretch that widens toward the viewer, and the ground beneath the banks) stays bare.
      if (y > terrain.creek.waterY && Math.abs(lx - terrain.creek.x) < terrain.creek.halfWidth + terrain.creek.bank) {
        continue
      }
      const nearness = bottom > ground ? Math.min(1, (y - ground) / (bottom - ground)) : 0
      const rx = randRange(0.035, 0.075) * playerSize * (1 + 0.2 * nearness)
      leaves.push({
        x: lx,
        y,
        rx,
        ry: rx * randRange(0.35, 0.55),
        angle: randRange(-Math.PI / 2, Math.PI / 2),
        color: pick(LEAF_COLORS, '#8a5a2b'),
      })
    }
  }
  return leaves.sort((a, b) => a.x - b.x)
}

/** Chance a bush is kept when its random spot lands near an oak. */
const BUSH_NEAR_TREE_KEEP_PROBABILITY = 0.12

/**
 * Random bush x that is mostly rejected close to oaks.
 *
 * @param worldWidth - Full width of the area bushes spawn in.
 * @param playerSize - Player size (sets what counts as near).
 * @param treeXs - Oak base x positions.
 * @param keepOut - Creek span bushes stay out of.
 * @param extent - Half width of the bush (its lobes' reach), which must clear the keep-out span.
 */
function pickBushX(
  worldWidth: number,
  playerSize: number,
  treeXs: number[],
  keepOut: Span,
  extent: number,
): number {
  const nearRange = playerSize * 3
  let x = randRange(30, worldWidth - 30)
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const near = treeXs.some((treeX) => Math.abs(treeX - x) < nearRange)
    if (!blocked(keepOut, x, extent) && (!near || Math.random() < BUSH_NEAR_TREE_KEEP_PROBABILITY)) {
      break
    }
    x = randRange(30, worldWidth - 30)
  }
  if (blocked(keepOut, x, extent)) {
    // Every try landed on the water: put the bush on the nearer bank instead.
    x = keepOut.x + (x < keepOut.x ? -1 : 1) * (keepOut.halfWidth + extent)
  }
  return x
}

/**
 * Builds clusters of green lobes along the ground.
 *
 * @param count - Number of bushes.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (scales bushes).
 * @param treeXs - Oak base x positions; bushes rarely spawn close to these.
 * @param keepOut - Creek span bushes stay out of.
 * @param bank - Optional creek banks to crowd with `count` extra bushes.
 */
function spawnBushes(
  count: number,
  worldWidth: number,
  playerSize: number,
  treeXs: number[],
  keepOut: Span,
  bank?: { x: number; halfWidth: number; width: number; count: number },
): Bush[] {
  const bushes: Bush[] = []
  for (let i = 0; i < count + (bank?.count ?? 0); i += 1) {
    const lobeCount = 3 + Math.floor(Math.random() * 3)
    // Bushes are big and vary a lot in size.
    const scale = randRange(1.0, 2.2)
    const lobes: BushLobe[] = []
    for (let k = 0; k < lobeCount; k += 1) {
      const radius = randRange(0.22, 0.4) * playerSize * scale
      lobes.push({
        dx: (k - (lobeCount - 1) / 2) * radius * 0.9 + randRange(-4, 4),
        dy: -radius * randRange(0.55, 0.95),
        radius,
        color: pick(BUSH_COLORS, '#2f6b34'),
      })
    }
    // How far the bush's lobes reach sideways: its whole width must stay out of the water.
    const extent = Math.max(...lobes.map((lobe) => Math.abs(lobe.dx) + lobe.radius))
    // The first bushes are random; the extra ones crowd the creek's banks on both sides.
    const x =
      bank && i >= count
        ? bank.x +
          (Math.random() < 0.5 ? -1 : 1) *
            (bank.halfWidth +
              // Now and then a bush stands close enough to the water that its branches overhang it.
              (Math.random() < 0.3
                ? extent * randRange(0.2, 0.65)
                : extent + Math.random() * bank.width * 0.85))
        : pickBushX(worldWidth, playerSize, treeXs, keepOut, extent)
    bushes.push({ x, lobes })
  }
  return bushes
}

/**
 * Builds clumps of ferns (1-3 plants each), kept out of the creek.
 *
 * @param clumps - Number of clumps.
 * @param worldWidth - Width of the area they spawn in.
 * @param playerSize - Scenery size unit (scales the ferns).
 * @param keepOut - Creek span ferns stay out of.
 * @param skip - Optional filter rejecting positions (layers that only exist near the creek).
 */
function spawnFerns(
  clumps: number,
  worldWidth: number,
  playerSize: number,
  keepOut: Span,
  skip: (x: number) => boolean = () => false,
): Fern[] {
  const ferns: Fern[] = []
  for (let c = 0; c < clumps; c += 1) {
    const center = randRange(60, worldWidth - 60)
    const members = 1 + Math.floor(Math.random() * 3)
    for (let m = 0; m < members; m += 1) {
      const size = randRange(0.5, 0.95) * playerSize
      const x = center + randRange(-0.7, 0.7) * playerSize * (m === 0 ? 0 : 1)
      if (blocked(keepOut, x, size) || skip(x)) {
        continue
      }
      // Like a Christmas fern: a crown of long, narrow fronds arching outward, the outer ones
      // leaning low and longest, a few young short ones standing in the middle.
      const frondCount = 6 + Math.floor(Math.random() * 4)
      ferns.push({
        x,
        size,
        tone: Math.floor(Math.random() * 3),
        fronds: Array.from({ length: frondCount }, (_, i) => {
          const angle = (i / (frondCount - 1) - 0.5) * 1.9 + randRange(-0.1, 0.1)
          return {
            angle,
            length: Math.min(1.1, 0.62 + 0.38 * (Math.abs(angle) / 0.95) + randRange(0, 0.12)),
            bend: randRange(0.3, 0.9),
            // The fronds join under the ground, so each comes out at its own spot, wider for the outer ones.
            base: angle * 0.2 + randRange(-0.05, 0.05),
          }
        }),
      })
    }
  }
  return ferns
}

/**
 * Rocks and a few bushes standing in front of the foreground's surface line (nearer the viewer than
 * the foreground itself), kept clear of the creek where it widens toward the viewer.
 *
 * @param worldWidth - Full world width.
 * @param playerSize - Scenery size unit.
 * @param creek - Foreground creek.
 */
function spawnFrontProps(
  worldWidth: number,
  playerSize: number,
  creek: Creek,
  terrain: Terrain,
  bottom: number,
  trees: OakTree[],
): { rocks: FrontRock[]; bushes: FrontBush[]; ferns: FrontFern[] } {
  const keepOut = { x: creek.x, halfWidth: creek.frontHalfWidth + Math.abs(creek.frontOffset) + playerSize * 1.5 }
  // Anywhere down the dirt below the surface; the lower (nearer) one stands, the bigger it is. A
  // prop is placed low enough that most of it is below the surface line, so it rarely covers the
  // birds or acorns on the surface: if it would stick up too far, other depths are tried, and only
  // occasionally is it accepted anyway.
  const place = (x: number, height: number): { y: number; scale: number } | null => {
    // Never under an oak (its acorns fall there and must stay visible).
    if (trees.some((tree) => Math.abs(x - (tree.x + tree.trunkWidth / 2)) < tree.crownRadius * 0.65)) {
      return null
    }
    const ground = groundYAt(terrain, x)
    const room = Math.max(0, bottom - ground - 24)
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const depth = Math.random() ** 0.8
      const y = ground + 8 + depth * room
      const scale = 1 + 0.6 * depth
      if (y - ground >= 0.9 * height * scale || Math.random() < 0.02) {
        return { y, scale }
      }
    }
    return null
  }
  const rocks: FrontRock[] = []
  for (let i = 0; i < FRONT_ROCK_COUNT; i += 1) {
    const x = randRange(40, worldWidth - 40)
    const base = randRange(0.08, 0.26) * playerSize * 1.25
    const spot = place(x, base * 0.8)
    if (!spot) {
      continue
    }
    const rx = base * spot.scale
    if (!blocked(keepOut, x, rx)) {
      rocks.push({ rock: makeRock(x, rx, rx * randRange(0.55, 0.85), 0, Math.random() < 0.2), y: spot.y })
    }
  }
  const bushes: FrontBush[] = []
  for (const bush of spawnBushes(FRONT_BUSH_COUNT * 3, worldWidth, playerSize * 1.1, [], keepOut)) {
    const height = Math.max(...bush.lobes.map((lobe) => -lobe.dy + lobe.radius))
    const spot = place(bush.x, height)
    if (!spot || bushes.length >= FRONT_BUSH_COUNT) {
      continue
    }
    // Bushes are already big; nearness adds only a little.
    const nearer = 1 + (spot.scale - 1) * 0.4
    bushes.push({
      bush: { x: bush.x, lobes: bush.lobes.map((lobe) => ({ ...lobe, dx: lobe.dx * nearer, dy: lobe.dy * nearer, radius: lobe.radius * nearer })) },
      y: spot.y,
    })
  }
  const ferns: FrontFern[] = []
  for (const fern of spawnFerns(FRONT_FERN_CLUMPS * 2, worldWidth, playerSize, keepOut)) {
    const spot = place(fern.x, fern.size)
    if (spot && ferns.length < FRONT_FERN_CLUMPS * 2) {
      ferns.push({ fern: { ...fern, size: fern.size * spot.scale }, y: spot.y })
    }
  }
  return { rocks, bushes, ferns }
}

/**
 * Builds fallen logs tilted to follow the terrain slope.
 *
 * @param count - Number of logs.
 * @param terrain - Ground heights.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (scales logs).
 * @param keepOut - Creek span logs stay out of.
 */
function spawnLogs(
  count: number,
  terrain: Terrain,
  worldWidth: number,
  playerSize: number,
  keepOut: Span,
): Log[] {
  const logs: Log[] = []
  for (let i = 0; i < count; i += 1) {
    const length = randRange(1.3, 2.4) * playerSize
    let x = randRange(length, worldWidth - length)
    for (let attempt = 0; attempt < 20 && blocked(keepOut, x, length / 2); attempt += 1) {
      x = randRange(length, worldWidth - length)
    }
    const tilt = Math.atan2(
      groundYAt(terrain, x + length / 2) - groundYAt(terrain, x - length / 2),
      length,
    )
    logs.push({
      x,
      length,
      radius: randRange(0.16, 0.26) * playerSize,
      tilt,
      flip: Math.random() < 0.5 ? 1 : -1,
      moss: Math.random() < 0.4,
    })
  }
  return logs
}

/**
 * Builds one jittered half-ellipse rock.
 *
 * @param x - Center X.
 * @param rx - Half width.
 * @param ry - Height.
 * @param fog - How far the colors are blended toward the haze (background layers).
 * @param moss - Whether moss grows on top.
 */
function makeRock(x: number, rx: number, ry: number, fog = 0, moss = false): Rock {
  const [base, baseHighlight] = pick(ROCK_COLORS, ['#7a7872', '#a5a29a'])
  const litter = Array.from({ length: 4 }, () => {
    const leaf = pick(LEAF_COLORS, '#8a5a2b')
    return fog > 0 ? mixColor(leaf, FOREST_HAZE_COLOR, fog) : leaf
  })
  const color = fog > 0 ? mixColor(base, FOREST_HAZE_COLOR, fog) : base
  const highlight = fog > 0 ? mixColor(baseHighlight, FOREST_HAZE_COLOR, fog) : baseHighlight
  const jitter = Array.from({ length: 9 }, () => randRange(0.84, 1.08))
  return { x, rx, ry, jitter, color, highlight, litter, moss, fog }
}

/**
 * Rocks for the ground between a background layer and the next nearer one. They hug the creek's
 * banks (most sit right at the edge) but some lie farther out, with random sizes and a random
 * count, so the lining is irregular.
 *
 * @param fog - Haze blended into the rocks' colors.
 * @param span - Width of the layer (free rocks spread over it).
 * @param viewHeight - Window height.
 */
function spawnGapRocks(fog: number, span: number, viewHeight: number): GapRock[] {
  const count = Math.round(GAP_ROCK_COUNT * randRange(0.6, 1.3))
  const rocks: GapRock[] = Array.from({ length: count }, () => {
    const near = Math.random() < 0.65
    return {
      rock: makeRock(0, 1, 0.7, fog),
      s: Math.random(),
      side: Math.random() < 0.5 ? -1 : 1,
      size: randRange(0.05, 0.38),
      x: null,
      out: near ? Math.random() ** 2 * 0.6 : randRange(0.4, 5),
    }
  })
  // Free rocks lie anywhere on the ground between the layers, not just along the creek.
  const freeCount = Math.round((span / (viewHeight * 0.8)) * randRange(0.7, 1.3))
  for (let n = 0; n < freeCount; n += 1) {
    rocks.push({
      rock: makeRock(0, 1, 0.7, fog),
      s: Math.random(),
      side: 1,
      size: randRange(0.05, 0.35),
      x: Math.random() * span,
      out: 0,
    })
  }
  // Drawn in this order, so nearer rocks (larger s) must come after farther ones, never before.
  return rocks.sort((p, q) => p.s - q.s)
}

/**
 * Builds boulders plus clusters of 1-3 small rocks.
 *
 * @param boulders - Number of boulders.
 * @param clusters - Number of small-rock clusters.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (scales rocks).
 * @param creek - Creek: land rocks stay out of it, and extra rocks sit in the water.
 */
function spawnRocks(
  boulders: number,
  clusters: number,
  worldWidth: number,
  playerSize: number,
  creek: Creek,
): Rock[] {
  const rocks: Rock[] = []
  const water = { x: creek.x, halfWidth: creek.halfWidth + creek.bank * 0.3 }
  const landX = (): number => {
    let x = randRange(40, worldWidth - 40)
    for (let attempt = 0; attempt < 20 && blocked(water, x, playerSize * 0.7); attempt += 1) {
      x = randRange(40, worldWidth - 40)
    }
    return x
  }
  for (let i = 0; i < boulders; i += 1) {
    const rx = randRange(0.4, 0.7) * playerSize
    rocks.push(makeRock(landX(), rx, rx * randRange(0.6, 0.9), 0, Math.random() < 0.45))
  }
  // A group of exceptionally large boulders in one section of the map, well clear of the creek.
  let groupX = randRange(0.12, 0.88) * worldWidth
  for (let attempt = 0; attempt < 60 && blocked(water, groupX, playerSize * 6); attempt += 1) {
    groupX = randRange(0.12, 0.88) * worldWidth
  }
  const big: Rock[] = []
  for (let i = 0; i < 6; i += 1) {
    const rx = randRange(0.95, 1.9) * playerSize
    big.push(makeRock(groupX + (i - 2.5) * randRange(0.55, 0.95) * playerSize * 1.2, rx, rx * randRange(0.65, 0.85), 0, Math.random() < 0.8))
  }
  // Biggest first, so smaller ones in front overlap them.
  rocks.push(...big.sort((a, b) => b.rx - a.rx))
  // A lining of rocks along both banks, hugging the water's edge (most within a few inches of it).
  for (let i = 0; i < BANK_ROCK_COUNT; i += 1) {
    const side = Math.random() < 0.5 ? -1 : 1
    // Always on the shore: the rock's inner edge starts at the water's edge, never over the water.
    const rx = randRange(0.07, 0.3) * playerSize
    const x = creek.x + side * (creek.halfWidth + rx + Math.random() ** 2 * creek.bank * 0.45)
    rocks.push(makeRock(x, rx, rx * randRange(0.55, 0.85)))
  }
  for (let i = 0; i < clusters; i += 1) {
    const cx = landX()
    const n = 1 + Math.floor(Math.random() * 3)
    for (let k = 0; k < n; k += 1) {
      const rx = randRange(0.07, 0.15) * playerSize
      rocks.push(makeRock(cx + randRange(-0.3, 0.3) * playerSize, rx, rx * randRange(0.55, 0.85)))
    }
  }
  return rocks
}

/**
 * Builds the parallax forest layers, each lighter (hazier) the farther away it is.
 *
 * Each layer reuses the foreground oak design plus bush and log silhouettes along its base.
 *
 * @param worldWidth - Full world width.
 * @param viewWidth - Window width.
 * @param viewHeight - Window height.
 * @param creek - Foreground creek the background creeks follow.
 */
function spawnForest(
  worldWidth: number,
  viewWidth: number,
  viewHeight: number,
  creek: Creek,
): ForestLayer[] {
  // The creek flows back through the layers: each layer's creek is narrower than the one in front
  // of it and shifted by a gaussian offset (4 standard deviations = the front creek's width),
  // never by more than half that width. Positions are tracked as screen x with the camera centered
  // on the foreground creek, then converted into each layer's own x.
  // (the typical screen width is used for this alignment, whatever the window)
  const refWidth = viewHeight * TYPICAL_ASPECT_RATIO
  const refCamera = creek.x - refWidth / 2
  const creeks: Span[] = []
  let screenX = refWidth / 2
  let half = creek.halfWidth
  for (let i = FOREST_LAYERS.length - 1; i >= 0; i -= 1) {
    // Offsets are scaled by the foreground creek's width, not the (shrinking) layer's, so far
    // layers wiggle as much as near ones; the shared drift tilts the whole creek one way.
    const spread = creek.halfWidth
    const offset =
      creek.drift * spread * CREEK_DRIFT + Math.max(-spread, Math.min(spread, (randNormal() * spread) / 2))
    screenX += offset
    half *= CREEK_LAYER_SHRINK
    creeks[i] = { x: screenX + (FOREST_LAYERS[i]?.parallax ?? 0) * refCamera, halfWidth: half }
  }

  return FOREST_LAYERS.map((layer, index) => {
    const layerCreek = creeks[index] ?? { x: 0, halfWidth: 0 }
    const keepOut = { x: layerCreek.x, halfWidth: layerCreek.halfWidth * 1.8 }
    const layerKeepOut = { x: layerCreek.x, halfWidth: layerCreek.halfWidth }
    const span = worldWidth * layer.parallax + viewWidth
    const height = viewHeight * layer.scale * SCENERY_SCALE
    const trunkWidth = Math.max(18, viewHeight * 0.055) * 1.3 * layer.scale * SCENERY_SCALE
    const trees: BackdropTree[] = []
    // Layers that only exist near the creek fade out this far from it.
    const localRadius = layer.local ? viewHeight * 1.8 : null
    const outsideWindow = (px: number): boolean =>
      localRadius !== null && Math.abs(px - layerCreek.x) > localRadius
    let x = -viewHeight * 0.3 * SCENERY_SCALE
    while (x < span + viewHeight * 0.3 * SCENERY_SCALE) {
      if (!blocked(keepOut, x, trunkWidth) && !outsideWindow(x)) {
        const shape = generateOak(height * randRange(0.92, 1.08), trunkWidth)
        trees.push({ x, shape })
      }
      x += viewHeight * layer.spacing * randRange(0.6, 1.6)
    }
    const playerSize = playerSizeForView(viewHeight) * layer.scale * SCENERY_SCALE
    const logs: Log[] = []
    for (let i = 0; i < span / (viewHeight * 2.5); i += 1) {
      const length = randRange(1.3, 2.4) * playerSize
      const logX = randRange(0, span)
      if (blocked(keepOut, logX, length / 2) || outsideWindow(logX)) {
        continue
      }
      logs.push({
        x: logX,
        length,
        radius: randRange(0.16, 0.26) * playerSize,
        tilt: 0,
        flip: Math.random() < 0.5 ? 1 : -1,
        moss: Math.random() < 0.4,
      })
    }
    // Rocks on the layer's surface, plus a lining along the creek's edges.
    const rocks: Rock[] = []
    for (let i = 0; i < span / (viewHeight * 2); i += 1) {
      const rx = randRange(0.12, 0.4) * playerSize
      const rockX = randRange(0, span)
      if (!blocked(layerKeepOut, rockX, rx) && !outsideWindow(rockX)) {
        rocks.push(makeRock(rockX, rx, rx * randRange(0.6, 0.9), layer.fog, Math.random() < 0.3))
      }
    }
    for (let i = 0; i < 14; i += 1) {
      const side = Math.random() < 0.5 ? -1 : 1
      const rx = randRange(0.1, 0.3) * playerSize
      const rockX = layerCreek.x + side * (layerCreek.halfWidth + rx + Math.random() ** 2 * layerCreek.halfWidth * 0.7)
      rocks.push(makeRock(rockX, rx, rx * randRange(0.55, 0.85), layer.fog))
    }
    return {
      parallax: layer.parallax,
      span,
      lift: layer.lift,
      groundColor: mixColor(GROUND_COLOR, FOREST_HAZE_COLOR, layer.fog),
      trunkColor: mixColor(TRUNK_COLOR, FOREST_HAZE_COLOR, layer.fog),
      tones: OAK_TONES.map((tone) => mixColor(tone, FOREST_HAZE_COLOR, layer.fog)),
      waterColor: mixColor(WATER_COLOR, FOREST_HAZE_COLOR, layer.fog),
      scale: layer.scale,
      fog: layer.fog,
      edgeRocks: spawnGapRocks(layer.fog, span, viewHeight),
      ferns: spawnFerns(Math.max(1, Math.round(span / (viewHeight * 3.5))), span, playerSize, layerKeepOut, outsideWindow),
      leafColors: LEAF_COLORS.map((color) => mixColor(color, FOREST_HAZE_COLOR, layer.fog)),
      creek: layerCreek,
      trees,
      localRadius,
      bushes: spawnBushes(
        Math.ceil(span / (viewHeight * 1.7)),
        span,
        playerSize,
        trees.map((tree) => tree.x),
        { x: layerCreek.x, halfWidth: layerCreek.halfWidth },
        { x: layerCreek.x, halfWidth: layerCreek.halfWidth, width: layerCreek.halfWidth * (5 / 3), count: 3 },
      ).filter((bush) => !outsideWindow(bush.x)),
      logs,
      rocks,
      fine: buildFineNoise(span, viewHeight),
    }
  })
}

/**
 * Creates a new world sized from the current viewport, with terrain, trees, acorns, scenery, and NPC jays.
 *
 * @param viewWidth - Window width in CSS pixels.
 * @param viewHeight - Window height in CSS pixels.
 */
export function createWorld(viewWidth: number, viewHeight: number): World {
  const groundHeight = groundHeightForView(viewHeight)
  const bottomExtra = viewHeight * WORLD_BOTTOM_EXTRA_FACTOR
  const height = viewHeight + groundHeight + viewHeight * WORLD_TOP_EXTRA_FACTOR + bottomExtra
  // The world's width comes from the typical aspect ratio, never from the window's width.
  const width = viewHeight * TYPICAL_ASPECT_RATIO * WORLD_WIDTH_MULTIPLIER
  const groundY = height - groundHeight - bottomExtra
  const playerSize = playerSizeForView(viewHeight)
  const terrain = buildTerrain(width, groundY, viewHeight)

  const creekKeep = creekKeepOut(terrain.creek)
  const trees = spawnOakTrees(width, viewHeight, creekKeep, terrain)

  const front = spawnFrontProps(width, playerSize * SCENERY_SCALE, terrain.creek, terrain, height, trees)

  const world: World = {
    viewHeight,
    width,
    height,
    groundHeight,
    groundY,
    terrain,
    trees,
    acorns: spawnAcorns(width, terrain, acornRadiusForPlayer(playerSize), trees, creekKeep),
    leaves: spawnLeafLitter(terrain, width, playerSize * SCENERY_SCALE, height),
    bushes: spawnBushes(
      BUSH_COUNT,
      width,
      playerSize * SCENERY_SCALE,
      trees.map((tree) => tree.x + tree.trunkWidth / 2),
      { x: terrain.creek.x, halfWidth: terrain.creek.halfWidth },
      { x: terrain.creek.x, halfWidth: terrain.creek.halfWidth, width: terrain.creek.bank, count: BANK_BUSH_COUNT },
    ),
    logs: spawnLogs(LOG_COUNT, terrain, width, playerSize * SCENERY_SCALE, creekKeep),
    // Back to front: rocks standing higher up the slope (smaller ground y) are farther away and are
    // painted first, so a rock behind never covers one in front of it.
    rocks: spawnRocks(BOULDER_COUNT, ROCK_CLUSTER_COUNT, width, playerSize * SCENERY_SCALE, terrain.creek).sort(
      (p, q) => groundYAt(terrain, p.x) - groundYAt(terrain, q.x) || q.rx - p.rx,
    ),
    ferns: spawnFerns(FERN_CLUMPS, width, playerSize * SCENERY_SCALE, { x: terrain.creek.x, halfWidth: terrain.creek.halfWidth }),
    frontRocks: front.rocks,
    frontBushes: front.bushes,
    frontFerns: front.ferns,
    forest: spawnForest(width, Math.max(viewWidth, viewHeight * 3), viewHeight, terrain.creek),
    npcs: [],
    squirrels: [],
    acornDropTimer: 0,
    kickedLeaves: spawnKickedLeaves(terrain, width, playerSize),
    time: 0,
  }
  world.npcs = createNpcs(world, playerSize)
  world.squirrels = createSquirrels(world, playerSize)
  return world
}
