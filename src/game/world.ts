import {
  ACORN_COUNT,
  GROUND_COLOR,
  FOREST_HAZE_COLOR,
  OAK_TONES,
  OAK_TREE_COUNT,
  SCENERY_SCALE,
  WORLD_TOP_EXTRA_FACTOR,
  WORLD_WIDTH_MULTIPLIER,
  acornRadiusForPlayer,
  groundHeightForView,
  playerSizeForView,
  TRUNK_COLOR,
} from './constants'
import { createNpcs } from './npc'
import { generateOak } from './oak'
import { buildTerrain, groundYAt } from './terrain'
import type {
  Acorn,
  BackdropTree,
  Bush,
  BushLobe,
  ForestLayer,
  LeafLitter,
  Log,
  OakTree,
  Rock,
  Terrain,
  World,
} from './types'

const LEAF_COLORS = ['#8a5a2b', '#a8691f', '#c47f2a', '#b5651d', '#9c7a2e', '#7a4a22', '#c9962f', '#6e4320']
const BUSH_COLORS = ['#2f6b34', '#3a7d3d', '#2a5c2f', '#468a44']
const ROCK_COLORS: [string, string][] = [
  ['#7a7872', '#a5a29a'],
  ['#6b6a66', '#98958e'],
  ['#85807a', '#b0aca3'],
]

/** Bushes, logs, boulders and small-rock clusters per run. */
const BUSH_COUNT = 14
const LOG_COUNT = 5
const BOULDER_COUNT = 6
const ROCK_CLUSTER_COUNT = 11

/** Parallax settings per background layer, farthest first (spacing is the average gap between trunks in view heights; small so trunks and crowns fill sightlines). */
const FOREST_LAYERS = [
  { parallax: 0.12, fog: 0.8, lift: 0.4, scale: 0.9, spacing: 0.11 },
  { parallax: 0.22, fog: 0.62, lift: 0.33, scale: 0.93, spacing: 0.15 },
  { parallax: 0.35, fog: 0.45, lift: 0.26, scale: 0.95, spacing: 0.2 },
  { parallax: 0.5, fog: 0.28, lift: 0.2, scale: 0.97, spacing: 0.27 },
  { parallax: 0.68, fog: 0.12, lift: 0.14, scale: 1, spacing: 0.36 },
]

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
 */
function spawnOakTrees(worldWidth: number, viewHeight: number): OakTree[] {
  const crownRadius = viewHeight * 0.32 * SCENERY_SCALE
  const trunkHeight = (viewHeight - viewHeight * 0.32) * SCENERY_SCALE
  const trunkWidth = Math.max(18, viewHeight * 0.055) * 1.3 * SCENERY_SCALE
  const trees: OakTree[] = []
  const margin = crownRadius + trunkWidth
  const usable = Math.max(trunkWidth, worldWidth - 2 * margin)
  const slot = usable / OAK_TREE_COUNT

  for (let i = 0; i < OAK_TREE_COUNT; i += 1) {
    const slotStart = margin + i * slot
    const jitter = randRange(slot * 0.12, slot * 0.88)
    trees.push({
      shape: generateOak(viewHeight * SCENERY_SCALE, trunkWidth),
      x: slotStart + jitter - trunkWidth / 2,
      trunkWidth,
      trunkHeight,
      crownRadius,
    })
  }

  return trees
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
 */
function spawnAcorns(
  worldWidth: number,
  terrain: Terrain,
  radius: number,
  trees: OakTree[],
): Acorn[] {
  const acorns: Acorn[] = []
  for (let i = 0; i < ACORN_COUNT; i += 1) {
    const tree = trees[i % trees.length]
    if (!tree) {
      break
    }
    const spread = tree.crownRadius * 0.45
    const offset = Math.max(-tree.crownRadius, Math.min(tree.crownRadius, randNormal() * spread))
    const x = Math.max(radius, Math.min(worldWidth - radius, tree.x + tree.trunkWidth / 2 + offset))
    acorns.push({
      x,
      y: groundYAt(terrain, x) - radius,
      radius,
      state: 'ground',
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
function mixColor(from: string, to: string, amount: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const parts = [0, 1, 2].map((i) =>
    Math.round(channel(from, i) * (1 - amount) + channel(to, i) * amount),
  )
  return `rgb(${parts.join(',')})`
}

/**
 * Scatters fallen leaves on and slightly below the ground surface.
 *
 * @param terrain - Ground heights.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (scales leaf size).
 */
function spawnLeafLitter(terrain: Terrain, worldWidth: number, playerSize: number): LeafLitter[] {
  const leaves: LeafLitter[] = []
  const spacing = 5
  for (let x = 0; x < worldWidth; x += spacing) {
    const count = 1 + Math.floor(Math.random() * 2)
    for (let i = 0; i < count; i += 1) {
      const lx = x + randRange(-spacing, spacing)
      const rx = randRange(0.035, 0.08) * playerSize
      leaves.push({
        x: lx,
        y: groundYAt(terrain, lx) + randRange(-0.03, 0.5) * playerSize,
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
 */
function pickBushX(worldWidth: number, playerSize: number, treeXs: number[]): number {
  const nearRange = playerSize * 3
  let x = randRange(30, worldWidth - 30)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const near = treeXs.some((treeX) => Math.abs(treeX - x) < nearRange)
    if (!near || Math.random() < BUSH_NEAR_TREE_KEEP_PROBABILITY) {
      break
    }
    x = randRange(30, worldWidth - 30)
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
 */
function spawnBushes(
  count: number,
  worldWidth: number,
  playerSize: number,
  treeXs: number[],
): Bush[] {
  const bushes: Bush[] = []
  for (let i = 0; i < count; i += 1) {
    const lobeCount = 3 + Math.floor(Math.random() * 3)
    const scale = randRange(0.7, 1.3)
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
    bushes.push({ x: pickBushX(worldWidth, playerSize, treeXs), lobes })
  }
  return bushes
}

/**
 * Builds fallen logs tilted to follow the terrain slope.
 *
 * @param count - Number of logs.
 * @param terrain - Ground heights.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (scales logs).
 */
function spawnLogs(count: number, terrain: Terrain, worldWidth: number, playerSize: number): Log[] {
  const logs: Log[] = []
  for (let i = 0; i < count; i += 1) {
    const length = randRange(1.3, 2.4) * playerSize
    const x = randRange(length, worldWidth - length)
    const tilt = Math.atan2(
      groundYAt(terrain, x + length / 2) - groundYAt(terrain, x - length / 2),
      length,
    )
    logs.push({ x, length, radius: randRange(0.16, 0.26) * playerSize, tilt })
  }
  return logs
}

/**
 * Builds one jittered half-ellipse rock.
 *
 * @param x - Center X.
 * @param rx - Half width.
 * @param ry - Height.
 */
function makeRock(x: number, rx: number, ry: number): Rock {
  const [color, highlight] = pick(ROCK_COLORS, ['#7a7872', '#a5a29a'])
  const jitter = Array.from({ length: 9 }, () => randRange(0.84, 1.08))
  return { x, rx, ry, jitter, color, highlight }
}

/**
 * Builds boulders plus clusters of 1-3 small rocks.
 *
 * @param boulders - Number of boulders.
 * @param clusters - Number of small-rock clusters.
 * @param worldWidth - Full world width.
 * @param playerSize - Player size (scales rocks).
 */
function spawnRocks(
  boulders: number,
  clusters: number,
  worldWidth: number,
  playerSize: number,
): Rock[] {
  const rocks: Rock[] = []
  for (let i = 0; i < boulders; i += 1) {
    const rx = randRange(0.4, 0.7) * playerSize
    rocks.push(makeRock(randRange(40, worldWidth - 40), rx, rx * randRange(0.6, 0.9)))
  }
  for (let i = 0; i < clusters; i += 1) {
    const cx = randRange(40, worldWidth - 40)
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
 */
function spawnForest(worldWidth: number, viewWidth: number, viewHeight: number): ForestLayer[] {
  return FOREST_LAYERS.map((layer) => {
    const span = worldWidth * layer.parallax + viewWidth
    const height = viewHeight * layer.scale * SCENERY_SCALE
    const trunkWidth = Math.max(18, viewHeight * 0.055) * 1.3 * layer.scale * SCENERY_SCALE
    const trees: BackdropTree[] = []
    let x = -viewHeight * 0.3 * SCENERY_SCALE
    while (x < span + viewHeight * 0.3 * SCENERY_SCALE) {
      const shape = generateOak(height * randRange(0.92, 1.08), trunkWidth)
      trees.push({ x, shape })
      x += viewHeight * layer.spacing * randRange(0.6, 1.6)
    }
    const playerSize = playerSizeForView(viewHeight) * layer.scale * SCENERY_SCALE
    const logs: Log[] = []
    for (let i = 0; i < span / (viewHeight * 2.5); i += 1) {
      logs.push({
        x: randRange(0, span),
        length: randRange(1.3, 2.4) * playerSize,
        radius: randRange(0.16, 0.26) * playerSize,
        tilt: 0,
      })
    }
    return {
      parallax: layer.parallax,
      span,
      lift: layer.lift,
      groundColor: mixColor(GROUND_COLOR, FOREST_HAZE_COLOR, layer.fog),
      trunkColor: mixColor(TRUNK_COLOR, FOREST_HAZE_COLOR, layer.fog),
      tones: OAK_TONES.map((tone) => mixColor(tone, FOREST_HAZE_COLOR, layer.fog)),
      trees,
      bushes: spawnBushes(
        Math.ceil(span / (viewHeight * 0.8)),
        span,
        playerSize,
        trees.map((tree) => tree.x),
      ),
      logs,
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
  const height = viewHeight + groundHeight + viewHeight * WORLD_TOP_EXTRA_FACTOR
  const width = viewWidth * WORLD_WIDTH_MULTIPLIER
  const groundY = height - groundHeight
  const playerSize = playerSizeForView(viewHeight)
  const terrain = buildTerrain(width, groundY, viewHeight)

  const trees = spawnOakTrees(width, viewHeight)

  const world: World = {
    viewHeight,
    width,
    height,
    groundHeight,
    groundY,
    terrain,
    trees,
    acorns: spawnAcorns(width, terrain, acornRadiusForPlayer(playerSize), trees),
    leaves: spawnLeafLitter(terrain, width, playerSize * SCENERY_SCALE),
    bushes: spawnBushes(
      BUSH_COUNT,
      width,
      playerSize * SCENERY_SCALE,
      trees.map((tree) => tree.x + tree.trunkWidth / 2),
    ),
    logs: spawnLogs(LOG_COUNT, terrain, width, playerSize * SCENERY_SCALE),
    rocks: spawnRocks(BOULDER_COUNT, ROCK_CLUSTER_COUNT, width, playerSize * SCENERY_SCALE),
    forest: spawnForest(width, viewWidth, viewHeight),
    npcs: [],
    acornDropTimer: 0,
  }
  world.npcs = createNpcs(world, playerSize)
  return world
}
