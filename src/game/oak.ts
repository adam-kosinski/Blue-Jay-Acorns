import { fallTones, newLeafSeason, parseRgb, springTones } from './leafColors'
import { requestWork, workerUsable } from './vegClient'
import { enqueueJob } from './work'
import { BARE_STAGE, STAGE_LOOKS, type LeafAmounts } from './seasons'
import type { TreeLobe, TreeSegment, TreeShape } from './types'

/**
 * What a tree's leaves look like: `shapes` and `leaves` are the shares of its large leafy shapes and small leaves still there (both 0 is bare), `fall` the
 * share of those in their fall color (the rest are green). `haze` blends fall colors toward the haze for
 * distant trees.
 */
export type TreeLook = LeafAmounts & { haze?: { color: string; amount: number } }

/**
 * A color between two others.
 *
 * @param a - First color (`#rrggbb` or `rgb()`).
 * @param b - Second color.
 * @param t - 0 is the first, 1 the second.
 */
function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseRgb(a)
  const [br, bg, bb] = parseRgb(b)
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`
}

/** How some leaves of a clump differ from the green ones: which are missing and which are in fall color. */
export type LeafMix = LeafAmounts & { tonesB: string[]; seed: number; clump: number }

/**
 * A repeatable pseudo-random number in [0, 1) from two integers.
 *
 * @param a - First integer.
 * @param b - Second integer.
 */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

/** Number of leaf tones (dark to light) a tree's lobes pick from. */
export const OAK_TONE_COUNT = 4

let nextShapeId = 0

/** Largest tree bitmap, in pixels. */
const MAX_SPRITE_PIXELS = 4_500_000

/** Most tree sprites kept before the least recently used one is dropped. */
const SPRITE_CACHE_LIMIT = 80

/** Pre-rendered tree bitmap plus where it sits relative to the tree base. */
type TreeSprite = {
  canvas: HTMLCanvasElement | OffscreenCanvas | ImageBitmap
  offsetX: number
  offsetY: number
  width: number
  height: number
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
 * Adds a clump of overlapping leaf lobes around a point.
 *
 * @param lobes - Output list.
 * @param x - Cluster center X (relative to the tree base).
 * @param y - Cluster center Y (negative is up).
 * @param radius - Rough cluster radius.
 */
function addCluster(lobes: TreeLobe[], x: number, y: number, radius: number): void {
  const count = 4 + Math.floor(Math.random() * 4)
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * radius * 0.85
    lobes.push({
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist * 0.8,
      r: radius * randRange(0.45, 0.9),
      tone: Math.floor(Math.random() * OAK_TONE_COUNT),
    })
  }
}

/**
 * Grows a branch (two bending pieces, optional sub-branches) ending in leaf clusters.
 *
 * @param segments - Output branch pieces.
 * @param lobes - Output leaf lobes.
 * @param x - Start X.
 * @param y - Start Y.
 * @param angle - Direction in radians from straight up (positive leans right).
 * @param length - Branch length in pixels.
 * @param width - Start thickness.
 * @param depth - Recursion depth (0 is a main branch).
 * @param leafRadius - Cluster radius for this tree's scale.
 */
function growBranch(
  segments: TreeSegment[],
  lobes: TreeLobe[],
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
  leafRadius: number,
): void {
  const midX = x + Math.sin(angle) * length * 0.55
  const midY = y - Math.cos(angle) * length * 0.55
  const bent = angle * randRange(0.35, 0.8) + randRange(-0.25, 0.25)
  const endX = midX + Math.sin(bent) * length * 0.45
  const endY = midY - Math.cos(bent) * length * 0.45
  segments.push({ x0: x, y0: y, x1: midX, y1: midY, w0: width, w1: width * 0.75 })
  segments.push({ x0: midX, y0: midY, x1: endX, y1: endY, w0: width * 0.75, w1: width * 0.4 })

  addCluster(lobes, endX, endY, leafRadius * randRange(0.8, 1.3))
  if (depth < 2 && Math.random() < 0.75) {
    const sub = angle + (Math.random() < 0.5 ? -1 : 1) * randRange(0.5, 1)
    growBranch(segments, lobes, midX, midY, sub, length * randRange(0.4, 0.6), width * 0.55, depth + 1, leafRadius * 0.85)
  }
  if (depth === 0 && Math.random() < 0.4) {
    addCluster(lobes, midX, midY - leafRadius * 0.3, leafRadius * randRange(0.6, 0.9))
  }
}

/**
 * Adds thin branches growing off the thick ones into the leaf area: one toward each leaf clump that has no wood
 * near it, from the closest wood (below it for preference), most with a smaller sprig of their own. Later ones
 * can grow off earlier ones.
 *
 * @param segments - The branch pieces so far, the trunk's three first (added to).
 * @param lobes - The leaf clumps.
 * @param leafRadius - Cluster radius for this tree's scale.
 */
function addTwigs(segments: TreeSegment[], lobes: TreeLobe[], leafRadius: number): void {
  /** The point of the wood (from the upper trunk on) that a twig to (x, y) would best start from. */
  const nearestWood = (x: number, y: number): { x: number; y: number; w: number; distance: number } => {
    let best = { x: 0, y: 0, w: 0, distance: Infinity }
    let bestCost = Infinity
    for (const seg of segments.slice(2)) {
      const dx = seg.x1 - seg.x0
      const dy = seg.y1 - seg.y0
      const t = Math.max(0, Math.min(1, ((x - seg.x0) * dx + (y - seg.y0) * dy) / (dx * dx + dy * dy || 1)))
      const px = seg.x0 + dx * t
      const py = seg.y0 + dy * t
      const distance = Math.hypot(x - px, y - py)
      // Twigs rather reach up than hang down.
      const cost = py < y ? distance * 1.6 : distance
      if (cost < bestCost) {
        bestCost = cost
        best = { x: px, y: py, w: seg.w0 + (seg.w1 - seg.w0) * t, distance }
      }
    }
    return best
  }

  /** A twig of two pieces from one point to another, thinning to its tip; returns where it bends. */
  const twig = (x: number, y: number, endX: number, endY: number, width: number): { x: number; y: number } => {
    const dx = endX - x
    const dy = endY - y
    // A gentle bend, bowed to one side or the other.
    const bow = randRange(-0.14, 0.14)
    const midX = x + dx * 0.55 - dy * bow
    const midY = y + dy * 0.55 + dx * bow
    segments.push({ x0: x, y0: y, x1: midX, y1: midY, w0: width, w1: width * 0.65 })
    segments.push({ x0: midX, y0: midY, x1: endX, y1: endY, w0: width * 0.65, w1: Math.max(3, width * 0.35) })
    return { x: midX, y: midY }
  }

  // The clumps farthest from the thick wood come first, so long twigs reach out to the edge of the crown and
  // the nearer clumps then fill in off those and the branches.
  const outermost = lobes
    .map((lobe) => ({ lobe, distance: nearestWood(lobe.x, lobe.y).distance }))
    .sort((a, b) => b.distance - a.distance)
  for (const { lobe } of outermost) {
    const targetX = lobe.x + randRange(-0.35, 0.35) * lobe.r
    const targetY = lobe.y + randRange(-0.35, 0.35) * lobe.r
    const from = nearestWood(targetX, targetY)
    if (from.distance < lobe.r * 0.4) {
      continue
    }
    const reach = Math.min(1, (leafRadius * 2.2) / from.distance)
    const endX = from.x + (targetX - from.x) * reach
    const endY = from.y + (targetY - from.y) * reach
    const width = Math.max(8, Math.min(from.w * 0.8, leafRadius * randRange(0.2, 0.3)))
    const mid = twig(from.x, from.y, endX, endY, width)
    if (Math.random() < 0.8) {
      const angle = Math.atan2(endX - mid.x, mid.y - endY) + (Math.random() < 0.5 ? -1 : 1) * randRange(0.6, 1.1)
      const length = from.distance * reach * randRange(0.35, 0.55)
      twig(mid.x, mid.y, mid.x + Math.sin(angle) * length, mid.y - Math.cos(angle) * length, width * 0.6)
    }
  }
}

/**
 * Generates an asymmetric oak: a leaning tapered trunk, random branches, and many leaf clusters.
 *
 * Coordinates are relative to the tree base; negative y is up. The trunk starts slightly
 * below the base so it covers sloped ground.
 *
 * Each tree is 50-100% taller than `baseHeight`, with a proportionally thicker trunk. A
 * few trees keep low branches near the ground.
 *
 * @param baseHeight - Reference tree height in pixels (before the 1.5-2x stretch).
 * @param baseTrunkWidth - Reference trunk thickness at the base.
 * @param rootReach - For an old-growth tree: how far (at least) buttress roots spread out past the
 *   trunk's edge on each side; the trunk is then twice as wide and the branches 1.5 times as wide.
 * @param groundAt - For old growth: ground height relative to the tree base at a horizontal offset
 *   from it (negative is up), so the roots can follow the ground and sink into it.
 */
export function generateOak(
  baseHeight: number,
  baseTrunkWidth: number,
  rootReach = 0,
  groundAt: (dx: number) => number = () => 0,
): TreeShape {
  const oldGrowth = rootReach > 0
  const stretch = randRange(1.5, 2)
  const height = baseHeight * stretch
  // Trees differ a lot in girth, and their branches in thickness. An old-growth tree is exactly
  // twice the nominal trunk width and its branches 1.5x (scaled back from the doubled trunk's).
  const thickness = oldGrowth ? 2 : randRange(0.7, 1.45)
  const trunkWidth = baseTrunkWidth * Math.sqrt(stretch) * thickness
  const branchScale = oldGrowth ? 0.75 : randRange(0.7, 1.35)
  const segments: TreeSegment[] = []
  const lobes: TreeLobe[] = []
  const leafRadius = height * randRange(0.085, 0.11)

  const lean = randRange(-0.06, 0.06) * height
  const trunkTopY = -height * randRange(0.5, 0.62)
  const trunkTopX = lean
  // The trunk starts far below the base, so on a slope it never ends above the ground.
  const points: [number, number][] = [[0, trunkWidth * 1.5]]
  for (let i = 1; i <= 3; i += 1) {
    const t = i / 3
    points.push([trunkTopX * t + randRange(-0.015, 0.015) * height, trunkTopY * t])
  }
  const widthAt = (t: number): number => trunkWidth * (1 - 0.55 * t)
  for (let i = 0; i < 3; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    if (a && b) {
      segments.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], w0: widthAt(i / 3), w1: widthAt((i + 1) / 3) })
    }
  }

  // An old-growth trunk is not given separate root objects: the trunk itself widens toward the
  // ground (buttressed), by at least `rootReach` (a bird's size) on each side, and its bark ridges
  // spread out with it. It is continued below the base far enough to meet sloping ground.
  const flare = oldGrowth
    ? {
        height: trunkWidth * 1.5,
        left: rootReach * randRange(1, 1.3),
        right: rootReach * randRange(1, 1.3),
        depth: Math.max(trunkWidth * 1.5, groundAt(-trunkWidth / 2 - rootReach), groundAt(trunkWidth / 2 + rootReach)) + 30,
      }
    : undefined

  const bias = randRange(-0.25, 0.25)
  const branchCount = 6 + Math.floor(Math.random() * 3)
  for (let i = 0; i < branchCount; i += 1) {
    const t = 0.3 + (0.7 * (i + Math.random() * 0.6)) / branchCount
    const px = trunkTopX * t
    const py = trunkTopY * t
    const side = Math.random() < 0.5 + bias ? 1 : -1
    growBranch(
      segments,
      lobes,
      px,
      py,
      side * randRange(0.5, 1.35),
      height * randRange(0.14, 0.3) * (1.15 - 0.5 * t),
      widthAt(t) * randRange(0.3, 0.75) * branchScale,
      0,
      leafRadius,
    )
  }

  if (Math.random() < 0.18) {
    const lowCount = 1 + Math.floor(Math.random() * 1.4)
    for (let i = 0; i < lowCount; i += 1) {
      const t = randRange(0.06, 0.2)
      growBranch(
        segments,
        lobes,
        trunkTopX * t,
        trunkTopY * t,
        (Math.random() < 0.5 ? -1 : 1) * randRange(0.9, 1.4),
        height * randRange(0.1, 0.18),
        widthAt(t) * randRange(0.35, 0.5) * branchScale,
        0,
        leafRadius * 0.8,
      )
    }
  }

  addCluster(lobes, trunkTopX, trunkTopY - leafRadius * 0.6, leafRadius * 1.3)
  addCluster(lobes, trunkTopX + randRange(-0.3, 0.3) * leafRadius, trunkTopY + leafRadius * 0.3, leafRadius * 1.1)

  addTwigs(segments, lobes, leafRadius)

  let halfWidth = oldGrowth ? trunkWidth / 2 + rootReach * 1.7 : trunkWidth
  let top = trunkTopY
  for (const lobe of lobes) {
    halfWidth = Math.max(halfWidth, Math.abs(lobe.x) + lobe.r)
    top = Math.min(top, lobe.y - lobe.r)
  }
  nextShapeId += 1
  // Fall color: anywhere from red (0) to yellow (55 degrees), with its own saturation and its own start.
  const leaf = newLeafSeason()
  return { id: nextShapeId, segments, lobes, halfWidth, top, flare, leaf }
}

/**
 * Small deterministic random generator, so leaf detail stays the same whenever a tree is redrawn.
 *
 * @param seed - Integer seed.
 * @returns A function returning numbers in `[0, 1)`.
 */
export function seededRandom(seed: number): () => number {
  let a = seed | 0
  return (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Draws one pointed leaf with a faint midrib.
 *
 * @param ctx - 2D canvas context.
 * @param x - Center X.
 * @param y - Center Y.
 * @param length - Leaf length.
 * @param angle - Rotation in radians (0 points up).
 * @param color - Fill color.
 * @param midrib - Whether to draw the faint midrib.
 */
export function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  angle: number,
  color: string,
  midrib: boolean,
): void {
  const half = length / 2
  const width = length * 0.4
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, -half)
  ctx.bezierCurveTo(width, -half * 0.5, width, half * 0.4, 0, half)
  ctx.bezierCurveTo(-width, half * 0.4, -width, -half * 0.5, 0, -half)
  ctx.fill()
  if (midrib) {
    ctx.strokeStyle = 'rgba(0, 20, 0, 0.22)'
    ctx.lineWidth = Math.max(0.6, length * 0.04)
    ctx.beginPath()
    ctx.moveTo(0, -half * 0.8)
    ctx.lineTo(0, half * 0.8)
    ctx.stroke()
  }
  ctx.restore()
}

/** One small leaf waiting to be drawn. */
type PendingLeaf = { x: number; y: number; length: number; angle: number; color: string; midrib: boolean }

/**
 * A plant's small leaves, gathered while its clumps' large shapes are drawn (`drawLeafyDisk`) and drawn after
 * all of them (`drawLeafLayer`). Only the leaves that no later clump's shapes cover are kept, so none are
 * made for the hidden insides of a crown.
 */
export type LeafLayer = PendingLeaf[]

/**
 * Whether a point is inside a blob (its outline taken a little smaller than its corners).
 *
 * @param x - Point X.
 * @param y - Point Y.
 * @param blob - The blob's center and outline corners.
 */
function insideBlob(x: number, y: number, blob: { cx: number; cy: number; pts: [number, number][] }): boolean {
  // The point is moved outward from the center instead of every corner inward.
  const px = blob.cx + (x - blob.cx) / 0.92
  const py = blob.cy + (y - blob.cy) / 0.92
  let inside = false
  for (let i = 0, j = blob.pts.length - 1; i < blob.pts.length; j = i, i += 1) {
    const a = blob.pts[i]
    const b = blob.pts[j]
    if (a && b && a[1] > py !== b[1] > py && px < a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Draws a plant's small leaves, in steps. They go in a fixed order spread evenly over the plant: every other one
 * first (down to half), then every other one of the rest (down to a quarter), and so on.
 *
 * @param ctx - 2D canvas context.
 * @param layer - The leaves.
 * @param share - The share of them still there, 0-1.
 * @param sizes - How big, as a share of their full size, the first quarter of the leaves to come, the second
 *   quarter and the last half are (the new leaves of spring grow).
 */
export function* drawLeafLayer(
  ctx: CanvasRenderingContext2D,
  layer: LeafLayer,
  share: number,
  sizes: [number, number, number] = [1, 1, 1],
): Generator<void> {
  for (const [index, leaf] of layer.entries()) {
    // Each leaf of every four has its own rank: it is there while the share left is above it.
    const rank = [0.625, 0.125, 0.875, 0.375][index % 4] ?? 0
    if (rank < share) {
      drawLeaf(ctx, leaf.x, leaf.y, leaf.length * sizes[rank < 0.25 ? 0 : rank < 0.5 ? 1 : 2], leaf.angle, leaf.color, leaf.midrib)
    }
    if (index % 250 === 249) {
      yield
    }
  }
}

/**
 * Fills one lumpy blob (random radii, stretch, and orientation) and returns its outline corners.
 *
 * @param ctx - 2D canvas context.
 * @param x - Center X.
 * @param y - Center Y.
 * @param r - Rough radius.
 * @param color - Fill color.
 * @param rand - Deterministic random source.
 * @returns The outline corner points.
 */
function fillBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string | null,
  rand: () => number,
): [number, number][] {
  const corners = 8
  const spin = rand() * Math.PI * 2
  const stretch = 0.82 + rand() * 0.4
  const squash = 0.78 + rand() * 0.3
  const pts: [number, number][] = []
  for (let i = 0; i < corners; i += 1) {
    const a = spin + (i / corners) * Math.PI * 2
    const rad = r * (0.78 + rand() * 0.3)
    pts.push([x + Math.cos(a) * rad * stretch, y + Math.sin(a) * rad * squash])
  }
  const at = (i: number): [number, number] => pts[((i % corners) + corners) % corners] ?? [x, y]
  if (color === null) {
    return pts
  }
  ctx.fillStyle = color
  ctx.beginPath()
  const startA = at(corners - 1)
  const startB = at(0)
  ctx.moveTo((startA[0] + startB[0]) / 2, (startA[1] + startB[1]) / 2)
  for (let i = 0; i < corners; i += 1) {
    const p = at(i)
    const q = at(i + 1)
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
  }
  ctx.closePath()
  ctx.fill()
  return pts
}

/**
 * Draws a leafy clump with an organic, fluffy look: several lumpy sub-blobs leave natural gaps
 * between them. Its small leaves (scattered throughout, shaded lighter toward the upper left, hanging
 * mostly downward, a few straddling each outline so they poke partly outside) are not drawn here but
 * added to the plant's leaf layer, and the leaves of earlier clumps that this clump covers are taken out of it.
 *
 * @param ctx - 2D canvas context.
 * @param x - Center X.
 * @param y - Center Y.
 * @param r - Rough clump radius.
 * @param tones - Leaf colors from dark to light.
 * @param baseTone - Index of the base blob color.
 * @param rand - Deterministic random source.
 * @param detail - Leaf density from 0 (single plain blob) to 1 (full).
 * @param overlap - 0 for airy foliage with gaps (trees); toward 1 the sub-blobs pack tighter.
 * @param layer - The plant's small leaves so far (changed).
 * @param mix - Some shapes or leaves missing and some in a second set of tones (the same ones every time, so
 *   what is gone stays gone as more goes).
 */
export function drawLeafyDisk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  tones: string[],
  baseTone: number,
  rand: () => number,
  detail: number,
  overlap: number,
  layer: LeafLayer,
  mix?: LeafMix,
): void {
  const toneIn = (set: string[], i: number): string =>
    set[Math.max(0, Math.min(set.length - 1, Math.round(i)))] ?? '#2f7a3a'
  // How far into its fall color a piece (a leaf or a blob) is: the same for the whole plant to begin with,
  // so the first sign of the change is the greens turning a little toward the fall color all together;
  // then each lobe, and each piece within it, gets its own small offset, strongest in the middle of the
  // change, so a greener piece sometimes stands next to a fully colored one.
  const amountOf = (piece: number): number => {
    if (!mix || mix.fall <= 0) {
      return 0
    }
    const base = Math.max(0, (mix.fall - 0.1) * 1.25)
    const spread = 4 * mix.fall * (1 - mix.fall)
    const lobe = hash01(mix.seed, 5000) - 0.5
    const own = hash01(mix.seed + 7, piece) - 0.5
    return Math.max(0, Math.min(1, base + (lobe * 0.35 + own * 0.35) * spread))
  }
  const colorOf = (set: string[], shade: number, amount: number): string =>
    amount <= 0 ? toneIn(set, shade) : lerpColor(toneIn(set, shade), toneIn(mix?.tonesB ?? set, shade), amount)
  // Which large shape goes when is fixed, not random: the shapes are numbered through the clumps and ranked by
  // steps of the golden ratio, which spreads each step's losses evenly over the whole plant.
  const rank = (index: number): number => (index * 0.6180339887) % 1
  const blobColor = (j: number): string | null => {
    if (!mix) {
      return toneIn(tones, baseTone)
    }
    // A clump drawn as a single shape (far away, no small leaves) stands for both: it goes as a whole.
    const gone = detail < 0.12 ? rank(mix.clump + 1) >= (mix.shapes + mix.leaves) / 2 : rank(mix.clump * 5 + j) >= mix.shapes
    if (gone) {
      return null
    }
    return colorOf(tones, baseTone, amountOf(200 + j))
  }
  // Each small leaf has its own amount of fall color.
  let leafCount = 0
  const leafColor = (shade: number): string => {
    leafCount += 1
    return colorOf(tones, shade, amountOf(1000 + leafCount))
  }

  if (detail < 0.12) {
    fillBlob(ctx, x, y, r * 0.95, blobColor(0), rand)
    return
  }

  // Sub-blobs ringed around the center: gaps appear between them and often in the middle.
  const count = rand() < 0.4 ? 5 : 4
  const offset = rand() * Math.PI * 2
  const blobs: { cx: number; cy: number; pts: [number, number][] }[] = []
  for (let j = 0; j < count; j += 1) {
    const a = offset + (j / count) * Math.PI * 2 + (rand() - 0.5) * 0.6
    const dist = r * (0.5 + rand() * 0.18 - overlap * 0.2)
    const cx = x + Math.cos(a) * dist
    const cy = y + Math.sin(a) * dist
    blobs.push({ cx, cy, pts: fillBlob(ctx, cx, cy, r * (0.42 + rand() * 0.1 + overlap * 0.12), blobColor(j + 1), rand) })
  }

  const leafLen = r * 0.25
  const innerTotal = Math.min(70, Math.round(((r * r) / (leafLen * leafLen)) * 2.4 * detail))
  const perBlob = Math.max(1, Math.round(innerTotal / count))
  const edgeLeaves = Math.max(1, Math.round(1 + 2 * detail))

  // This clump's shapes lie over the leaves of the clumps before it: those they hide are dropped (whether or
  // not the shapes are still there now, so that the same leaves are there at every time of year).
  const reach = r * 1.5
  let kept = 0
  for (const leaf of layer) {
    const near = Math.abs(leaf.x - x) < reach && Math.abs(leaf.y - y) < reach
    if (!near || !blobs.some((blob) => insideBlob(leaf.x, leaf.y, blob))) {
      layer[kept] = leaf
      kept += 1
    }
  }
  layer.length = kept

  for (const blob of blobs) {
    const corners = blob.pts.length
    const at = (i: number): [number, number] =>
      blob.pts[((i % corners) + corners) % corners] ?? [blob.cx, blob.cy]

    // Leaves scattered throughout the blob, not only near its edge.
    for (let n = 0; n < perBlob; n += 1) {
      const p = at(Math.floor(rand() * corners))
      const q = at(Math.floor(rand() * corners) + 1)
      let u = rand()
      let v = rand()
      if (u + v > 1) {
        u = 1 - u
        v = 1 - v
      }
      const lx = blob.cx + u * (p[0] - blob.cx) + v * (q[0] - blob.cx)
      const ly = blob.cy + u * (p[1] - blob.cy) + v * (q[1] - blob.cy)
      const light = (-(lx - x) - (ly - y)) / (r * 1.1)
      const len = leafLen * (0.8 + rand() * 0.5)
      const angle = Math.PI + (rand() - 0.5) * 1.5
      const shade = baseTone + light * 1.5 + (rand() - 0.5) * 1.4
      layer.push({ x: lx, y: ly, length: len, angle, color: leafColor(shade), midrib: detail >= 0.6 })
    }

    // A few leaves centered on the outline, so they stick partly outside for a fluffy edge.
    for (let m = 0; m < edgeLeaves; m += 1) {
      const i = Math.floor(rand() * corners)
      const p = at(i)
      const q = at(i + 1)
      const t = rand()
      const ex = p[0] + (q[0] - p[0]) * t
      const ey = p[1] + (q[1] - p[1]) * t
      const light = (-(ex - x) - (ey - y)) / (r * 1.1)
      const len = leafLen * (0.9 + rand() * 0.4)
      const angle = Math.PI + (rand() - 0.5) * 2 + (ex - blob.cx > 0 ? 0.4 : -0.4)
      const shade = baseTone + light * 1.1 + (rand() - 0.5) * 1.2
      layer.push({ x: ex, y: ey, length: len, angle, color: leafColor(shade), midrib: detail >= 0.6 })
    }
  }
}

/**
 * Paints stylized oak bark along a trunk, branch or log, in the game's flat vector style (not a
 * photographic texture): long, flowing ridges that swell in the middle and taper at both ends, each
 * with a lit edge on one side and a shaded edge on the other, separated by dark, wandering furrows
 * that are also spindle-shaped (thin at the ends, widest in the middle) and break up here and there;
 * plus a few pale lichen flecks. All shapes are smooth curves, no straight blocks, and everything is
 * a translucent overlay, so it works on any bark colour and in hazy background layers.
 *
 * @param ctx - 2D canvas context.
 * @param point - Position at fraction `t` along the length and `f` across the width (-1 to 1).
 * @param steps - Number of cells along the length.
 * @param furrows - Number of furrows across the width.
 * @param unit - Line width scale (a fraction of the trunk's width).
 * @param rand - Seeded random generator.
 */
export function paintBark(
  ctx: CanvasRenderingContext2D,
  point: (t: number, f: number) => [number, number],
  steps: number,
  furrows: number,
  unit: number,
  rand: () => number,
): void {
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  // A smooth closed shape through the points (quadratic curves through their midpoints).
  const closedSmooth = (pts: [number, number][]): void => {
    const n = pts.length
    const last = pts[n - 1]
    const first = pts[0]
    if (!last || !first) {
      return
    }
    const start = mid(last, first)
    ctx.moveTo(start[0], start[1])
    for (let i = 0; i < n; i += 1) {
      const p = pts[i] ?? first
      const q = pts[(i + 1) % n] ?? first
      const m = mid(p, q)
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1])
    }
    ctx.closePath()
  }

  // Furrow centre lines across the width, wandering a little as they run along the length.
  const paths: number[][] = []
  for (let i = 0; i <= furrows; i += 1) {
    const base = -0.86 + (1.72 * i) / furrows + (rand() - 0.5) * 0.16
    const path: number[] = []
    let f = base
    for (let j = 0; j <= steps; j += 1) {
      f += (rand() - 0.5) * 0.09 + (base - f) * 0.18
      path.push(f)
    }
    paths.push(path)
  }

  // Ridges: a long spindle between each pair of neighbouring furrows (sometimes two shorter ones).
  const spindle = (
    from: number[],
    to: number[],
    j0: number,
    j1: number,
    inner0: number,
    inner1: number,
    fill: string,
  ): void => {
    const left: [number, number][] = []
    const right: [number, number][] = []
    for (let j = j0; j <= j1; j += 1) {
      const u = (j - j0) / Math.max(1, j1 - j0)
      const swell = Math.sin(Math.PI * u) ** 0.55
      const a = from[j] ?? 0
      const b = to[j] ?? 0
      const lo = a + (b - a) * (inner0 + (0.5 - inner0) * (1 - swell))
      const hi = a + (b - a) * (inner1 + (0.5 - inner1) * (1 - swell))
      left.push(point(j / steps, lo))
      right.push(point(j / steps, hi))
    }
    ctx.fillStyle = fill
    ctx.beginPath()
    closedSmooth([...left, ...right.reverse()])
    ctx.fill()
  }
  for (let i = 0; i < furrows; i += 1) {
    const from = paths[i]
    const to = paths[i + 1]
    if (!from || !to) {
      continue
    }
    // A few short, overlapping pieces per ridge (never one that runs the whole length), each
    // fading in and out: its width swells from nothing and shrinks back, and its strength varies.
    let j = Math.floor(rand() * steps * 0.35)
    while (j < steps - 2) {
      const length = Math.max(3, Math.round(steps * (0.28 + rand() * 0.3)))
      const j1 = Math.min(steps, j + length)
      if (j1 - j >= 3) {
        const strength = 0.45 + rand() * 0.55
        spindle(from, to, j, j1, 0.12, 0.88, rand() < 0.5 ? `rgba(255, 238, 215, ${0.055 * strength})` : `rgba(25, 14, 6, ${0.055 * strength})`)
        spindle(from, to, j, j1, 0.16, 0.42, `rgba(255, 238, 215, ${0.12 * strength})`)
        spindle(from, to, j, j1, 0.66, 0.88, `rgba(25, 14, 6, ${0.11 * strength})`)
      }
      j = j1 - Math.floor(length * 0.25) + Math.floor(rand() * steps * 0.15)
    }
  }

  // Furrows: dark spindles along the furrow lines, in broken pieces, widest in the middle.
  paths.forEach((path) => {
    let j = 0
    while (j < steps) {
      const length = 2 + Math.floor(rand() * 5)
      const j1 = Math.min(steps, j + length)
      if (j1 - j >= 2 && rand() > 0.3) {
        const left: [number, number][] = []
        const right: [number, number][] = []
        const width = unit * (0.7 + rand() * 1.1)
        for (let k = j; k <= j1; k += 1) {
          const u = (k - j) / Math.max(1, j1 - j)
          const half = width * Math.sin(Math.PI * u) ** 0.7 * 0.5
          const here = point(k / steps, path[k] ?? 0)
          const before = point(Math.max(0, k - 1) / steps, path[Math.max(0, k - 1)] ?? 0)
          const after = point(Math.min(steps, k + 1) / steps, path[Math.min(steps, k + 1)] ?? 0)
          const dx = after[0] - before[0]
          const dy = after[1] - before[1]
          const len = Math.hypot(dx, dy) || 1
          left.push([here[0] - (dy / len) * half, here[1] + (dx / len) * half])
          right.push([here[0] + (dy / len) * half, here[1] - (dx / len) * half])
        }
        ctx.fillStyle = `rgba(30, 16, 6, ${0.17 + rand() * 0.2})`
        ctx.beginPath()
        closedSmooth([...left, ...right.reverse()])
        ctx.fill()
      }
      j = j1 + Math.floor(rand() * 3)
    }
  })

  // Pale lichen flecks.
  const flecks = Math.round(furrows * steps * 0.04)
  for (let k = 0; k < flecks; k += 1) {
    const p = point(rand(), (rand() - 0.5) * 1.6)
    ctx.fillStyle = rand() < 0.7 ? 'rgba(205, 205, 185, 0.09)' : 'rgba(150, 165, 125, 0.09)'
    ctx.beginPath()
    ctx.ellipse(p[0], p[1], unit * (1 + rand() * 2.2), unit * (0.7 + rand() * 1.4), rand() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Extra half-width a flared trunk has at a height above the ground, on one side: a smooth concave
 * flare (steep near the ground, easing off up the trunk) with a second, tighter lobe at the very
 * base. Below the ground it keeps its ground-level width.
 *
 * @param flare - The tree's flare.
 * @param height - Height above the ground (negative below it).
 * @param side - -1 for the left side, 1 for the right.
 */
export function flareAt(flare: NonNullable<TreeShape['flare']>, height: number, side: number): number {
  const reach = side < 0 ? flare.left : flare.right
  const s = Math.max(0, height) / flare.height
  if (s >= 1) {
    return 0
  }
  return reach * (1 - s) ** 2.4 + reach * 0.28 * Math.max(0, 1 - 2.2 * s) ** 2
}

/**
 * The trunk's centre x and width at a y (negative is up) from its three segments.
 *
 * @param shape - Generated tree.
 * @param y - Height in tree space.
 */
function trunkAt(shape: TreeShape, y: number): { x: number; w: number } {
  const trunk = shape.segments.slice(0, 3)
  const first = trunk[0]
  if (!first) {
    return { x: 0, w: 0 }
  }
  const pts = [
    { x: first.x0, y: first.y0, w: first.w0 },
    ...trunk.map((seg) => ({ x: seg.x1, y: seg.y1, w: seg.w1 })),
  ]
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i]
    const b = pts[i + 1]
    if (a && b && y <= a.y && y >= b.y) {
      const k = (a.y - y) / (a.y - b.y || 1)
      return { x: a.x + (b.x - a.x) * k, w: a.w + (b.w - a.w) * k }
    }
  }
  return { x: first.x0, w: first.w0 }
}

/**
 * Draws a flared (buttressed) trunk base as one smooth shape that continues the trunk, widening
 * toward the ground and down below it, so there is no gap beneath it and no separate root pieces.
 *
 * @param ctx - 2D canvas context (tree space, fill already set to the trunk color).
 * @param shape - Generated tree with a flare.
 */
function drawFlare(ctx: CanvasRenderingContext2D, shape: TreeShape): void {
  const flare = shape.flare
  if (!flare) {
    return
  }
  const rows = 30
  const left: [number, number][] = []
  const right: [number, number][] = []
  // From below the ground up to the top of the flare (y is negative upward).
  for (let i = 0; i <= rows; i += 1) {
    const y = flare.depth - ((flare.depth + flare.height * 1.02) * i) / rows
    const { x, w } = trunkAt(shape, y)
    const h = -y
    left.push([x - w / 2 - flareAt(flare, h, -1), y])
    right.push([x + w / 2 + flareAt(flare, h, 1), y])
  }
  ctx.beginPath()
  left.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
  for (let i = right.length - 1; i >= 0; i -= 1) {
    const p = right[i]
    if (p) {
      ctx.lineTo(p[0], p[1])
    }
  }
  ctx.closePath()
  ctx.fill()
}

/**
 * Paints bark on a tree: ridged bark along the trunk (following its joints smoothly) and a few
 * furrows along each thick branch, starting outside the trunk so nothing crosses the junctions.
 *
 * @param ctx - 2D canvas context (tree space).
 * @param shape - Generated tree.
 */
function drawBark(ctx: CanvasRenderingContext2D, shape: TreeShape): void {
  const trunk = shape.segments.slice(0, 3)
  const first = trunk[0]
  if (!first) {
    return
  }
  const rand = seededRandom(shape.id * 104729 + 7)

  // Trunk points with the thickness and averaged normal at each joint.
  const joints = [
    { x: first.x0, y: first.y0, w: first.w0, nx: 0, ny: 0 },
    ...trunk.map((seg) => ({ x: seg.x1, y: seg.y1, w: seg.w1, nx: 0, ny: 0 })),
  ]
  const normals = trunk.map((seg) => {
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const len = Math.hypot(dx, dy) || 1
    return { nx: -dy / len, ny: dx / len }
  })
  joints.forEach((joint, i) => {
    const before = normals[i - 1] ?? normals[i]
    const after = normals[i] ?? normals[i - 1]
    if (before && after) {
      const mx = before.nx + after.nx
      const my = before.ny + after.ny
      const len = Math.hypot(mx, my) || 1
      joint.nx = mx / len
      joint.ny = my / len
    }
  })
  const trunkPoint = (t: number, f: number): [number, number] => {
    const u = Math.min(0.9999, Math.max(0, t)) * (joints.length - 1)
    const i = Math.floor(u)
    const k = u - i
    const a = joints[i]
    const b = joints[i + 1]
    if (!a || !b) {
      return [0, 0]
    }
    const x = a.x + (b.x - a.x) * k
    const y = a.y + (b.y - a.y) * k
    const nx = a.nx + (b.nx - a.nx) * k
    const ny = a.ny + (b.ny - a.ny) * k
    const w = a.w + (b.w - a.w) * k
    // On a flared trunk the bark ridges spread out with the widening, flowing into the buttress.
    const flare = shape.flare
    const extra = flare ? flareAt(flare, -y, f < 0 ? -1 : 1) : 0
    return [x + nx * f * (w * 0.5 + extra), y + ny * f * (w * 0.5 + extra)]
  }
  let trunkLength = 0
  for (const seg of trunk) {
    trunkLength += Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0)
  }
  const unit = Math.max(1.4, first.w0 * 0.018)
  paintBark(
    ctx,
    trunkPoint,
    Math.max(8, Math.round(trunkLength / (first.w0 * 0.3))),
    Math.max(3, Math.min(8, Math.round((first.w0 * 0.8) / 44))),
    unit,
    rand,
  )

  // Thick branches (and old-growth roots) get a few furrows of their own.
  for (const seg of shape.segments.slice(3)) {
    if (seg.w0 < 26) {
      continue
    }
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const branchPoint = (t: number, f: number): [number, number] => {
      const along = 0.25 + 0.7 * t
      const w = seg.w0 + (seg.w1 - seg.w0) * along
      return [seg.x0 + dx * along + nx * w * 0.5 * f, seg.y0 + dy * along + ny * w * 0.5 * f]
    }
    paintBark(
      ctx,
      branchPoint,
      Math.max(3, Math.round((len * 0.7) / Math.max(20, seg.w0 * 0.4))),
      Math.max(1, Math.min(4, Math.round((seg.w0 * 0.7) / 26))),
      Math.max(1.2, seg.w0 * 0.03),
      rand,
    )
  }
}

/**
 * Draws a generated oak with its base at (x, y), vector by vector, in steps: a generator that yields after
 * the trunk and then every few leaf lobes, so that a big tree can be drawn a little each frame.
 *
 * @param ctx - 2D canvas context.
 * @param shape - Generated tree.
 * @param x - Base X.
 * @param y - Base Y.
 * @param tones - Leaf fill colors from dark to light (length `OAK_TONE_COUNT`).
 * @param trunkColor - Trunk and branch fill.
 * @param leafDetail - Leaf density from 0 to 1.
 * @param crownOnly - Draw only the leaves.
 * @param look - How many leaves there are and how many of those are in fall color.
 */
export function* drawOakSteps(
  ctx: CanvasRenderingContext2D,
  shape: TreeShape,
  x: number,
  y: number,
  tones: string[],
  trunkColor: string,
  leafDetail = 1,
  crownOnly = false,
  look: TreeLook = { shapes: 1, leaves: 1, fall: 0 },
): Generator<void> {
  ctx.save()
  ctx.translate(x, y)

  ctx.fillStyle = trunkColor
  for (const seg of crownOnly ? [] : shape.segments) {
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    ctx.beginPath()
    ctx.moveTo(seg.x0 + (nx * seg.w0) / 2, seg.y0 + (ny * seg.w0) / 2)
    ctx.lineTo(seg.x1 + (nx * seg.w1) / 2, seg.y1 + (ny * seg.w1) / 2)
    ctx.lineTo(seg.x1 - (nx * seg.w1) / 2, seg.y1 - (ny * seg.w1) / 2)
    ctx.lineTo(seg.x0 - (nx * seg.w0) / 2, seg.y0 - (ny * seg.w0) / 2)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.arc(seg.x1, seg.y1, seg.w1 / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  if (!crownOnly) {
    drawFlare(ctx, shape)
    if (leafDetail >= 0.12) {
      drawBark(ctx, shape)
    }
  }
  yield
  if (look.shapes > 0 || look.leaves > 0) {
    const rand = seededRandom(shape.id * 7919 + 13)
    const leaves: LeafLayer = []
    // Spring's new leaves have their own light green, and are drawn as single leaves however far the tree is.
    const green = look.spring ? springTones(look.haze ?? null) : tones
    const detail = look.spring ? Math.max(leafDetail, 0.3) : leafDetail
    for (let index = 0; index < shape.lobes.length; index += 1) {
      const lobe = shape.lobes[index]
      if (!lobe) {
        continue
      }
      // Every lobe has the tree's fall color with its own small shift in hue.
      const mix: LeafMix | undefined =
        look.fall > 0 || look.shapes < 1 || look.leaves < 1
          ? {
              tonesB:
                look.fall > 0
                  ? fallTones(shape.leaf.hue, (seededRandom(shape.id * 31 + index)() - 0.5) * 18, look.haze ?? null, shape.leaf.sat)
                  : green,
              fall: look.fall,
              shapes: look.shapes,
              leaves: look.leaves,
              seed: shape.id * 131 + index,
              clump: index,
            }
          : undefined
      drawLeafyDisk(ctx, lobe.x, lobe.y, lobe.r, green, lobe.tone, rand, detail, 0, leaves, mix)
      yield
    }
    yield* drawLeafLayer(ctx, leaves, look.leaves, look.sizes)
  }
  ctx.restore()
}

/**
 * Draws a generated oak with its base at (x, y), vector by vector.
 *
 * @param ctx - 2D canvas context.
 * @param shape - Generated tree.
 * @param x - Base X.
 * @param y - Base Y.
 * @param tones - Leaf fill colors from dark to light (length `OAK_TONE_COUNT`).
 * @param trunkColor - Trunk and branch fill.
 * @param leafDetail - Leaf density from 0 to 1.
 * @param crownOnly - Draw only the leaves.
 * @param look - How many leaves there are and how many of those are in fall color.
 */
export function drawOakVector(
  ctx: CanvasRenderingContext2D,
  shape: TreeShape,
  x: number,
  y: number,
  tones: string[],
  trunkColor: string,
  leafDetail = 1,
  crownOnly = false,
  look: TreeLook = { shapes: 1, leaves: 1, fall: 0 },
): void {
  for (const step of drawOakSteps(ctx, shape, x, y, tones, trunkColor, leafDetail, crownOnly, look)) {
    void step
  }
}

/** The parts a foreground tree is drawn from: the trunk and branches, and its crown in each of the looks it holds (`STAGE_LOOKS`). */
export type OakPart = 'trunk' | `c${number}`

/**
 * The leaves a part is painted with.
 *
 * @param part - The part.
 */
function partLook(part: OakPart): TreeLook {
  const bare = { shapes: 0, leaves: 0, fall: 0 }
  return part === 'trunk' ? bare : { ...(STAGE_LOOKS[Number(part.slice(1))] ?? bare) }
}

/**
 * The part of a crown for one of the looks.
 *
 * @param stage - An index into `STAGE_LOOKS` (the bare look has no part).
 */
export function crownPart(stage: number): OakPart | null {
  return stage >= 0 && stage < STAGE_LOOKS.length && stage !== BARE_STAGE ? `c${stage}` : null
}

/**
 * Renders a tree part into an offscreen canvas in steps.
 *
 * @param shape - Generated tree.
 * @param tones - Leaf fill colors.
 * @param trunkColor - Trunk and branch fill.
 * @param resolution - Bitmap pixels per CSS pixel.
 * @param part - Which part.
 */
function* buildPartSteps(
  shape: TreeShape,
  tones: string[],
  trunkColor: string,
  resolution: number,
  part: OakPart,
): Generator<void, TreeSprite> {
  let minY = 0
  let maxY = 14
  for (const lobe of shape.lobes) {
    minY = Math.min(minY, lobe.y - lobe.r)
  }
  for (const seg of shape.segments) {
    minY = Math.min(minY, seg.y0 - seg.w0, seg.y1 - seg.w1)
    maxY = Math.max(maxY, seg.y0 + seg.w0, seg.y1 + seg.w1)
  }
  const minX = -shape.halfWidth - 2
  const width = shape.halfWidth * 2 + 4
  const height = -minY + maxY
  // Cap bitmap size so big trees on hi-dpi screens stay within a few megapixels.
  const scale = Math.min(resolution, Math.sqrt(MAX_SPRITE_PIXELS / (width * height)))
  // In the background worker there is no document: the bitmap is an offscreen canvas.
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d', WORKER_CONTEXT) as CanvasRenderingContext2D | null
  if (ctx) {
    ctx.scale(scale, scale)
    yield* drawOakSteps(ctx, shape, -minX, -minY, tones, trunkColor, 1, part !== 'trunk', partLook(part))
  }
  return { canvas, offsetX: minX, offsetY: minY, width, height }
}

const partCache = new Map<string, TreeSprite>()

/** For experiments: how many tree part bitmaps are kept and their megapixels. */
export function oakCacheReport(): { count: number; mp: number } {
  let pixels = 0
  for (const sprite of partCache.values()) {
    pixels += sprite.canvas.width * sprite.canvas.height
  }
  return { count: partCache.size, mp: Math.round(pixels / 1e5) / 10 }
}

/**
 * The key of a tree part's bitmap.
 *
 * @param shape - Tree.
 * @param trunkColor - Trunk color.
 * @param resolution - Bitmap pixels per CSS pixel.
 * @param part - Which part.
 */
export function oakPartKey(shape: TreeShape, trunkColor: string, resolution: number, part: OakPart): string {
  return `${shape.id}|${trunkColor}|${resolution}|${part}`
}

/**
 * Builds a tree part's bitmap in steps and stores it (nothing happens if it is already there).
 *
 * @param shape - Tree.
 * @param tones - Leaf fill colors.
 * @param trunkColor - Trunk color.
 * @param resolution - Bitmap pixels per CSS pixel.
 * @param part - Which part.
 */
export function* oakPartJob(
  shape: TreeShape,
  tones: string[],
  trunkColor: string,
  resolution: number,
  part: OakPart,
): Generator<void> {
  const key = oakPartKey(shape, trunkColor, resolution, part)
  if (partCache.has(key)) {
    return
  }
  const sprite = yield* buildPartSteps(shape, tones, trunkColor, resolution, part)
  storePart(key, sprite)
}

/**
 * Frees a part's memory.
 *
 * @param sprite - The bitmap.
 */
function releaseSprite(sprite: TreeSprite): void {
  if (typeof ImageBitmap !== 'undefined' && sprite.canvas instanceof ImageBitmap) {
    sprite.canvas.close()
  }
}

/**
 * Keeps a built part (the least recently stored one goes when there are too many).
 *
 * @param key - The part's key.
 * @param sprite - The bitmap.
 */
function storePart(key: string, sprite: TreeSprite): void {
  if (partCache.size >= SPRITE_CACHE_LIMIT) {
    const oldest = partCache.keys().next().value
    if (oldest !== undefined) {
      const old = partCache.get(oldest)
      if (old) {
        releaseSprite(old)
      }
      partCache.delete(oldest)
    }
  }
  partCache.set(key, sprite)
}

/** Parts that came from the background worker and are not in use yet (each is given to the graphics card in a frame of its own). */
const partArrivals: { key: string; sprite: TreeSprite }[] = []

/** In the background worker parts are painted by the processor, so the graphics card stays free for the game's frames. */
const WORKER_CONTEXT = typeof document === 'undefined' ? { willReadFrequently: true } : undefined

let partUploadCanvas: HTMLCanvasElement | null = null

/**
 * Makes the parts that arrived from the worker ready, a few milliseconds' worth a frame: the first draw of a
 * big bitmap has to hand it to the graphics card, which is done here, one at a time, before it can be used.
 *
 * @param budgetMs - Time to spend.
 */
export function settleOakArrivals(budgetMs: number): void {
  const start = performance.now()
  while (partArrivals.length > 0 && performance.now() - start < budgetMs) {
    const arrival = partArrivals.shift()
    if (!arrival) {
      break
    }
    if (partCache.has(arrival.key)) {
      releaseSprite(arrival.sprite)
      continue
    }
    // (Big enough for the browser to keep it on the graphics card, so the part really is uploaded now.)
    if (!partUploadCanvas) {
      partUploadCanvas = document.createElement('canvas')
      partUploadCanvas.width = 512
      partUploadCanvas.height = 512
    }
    partUploadCanvas.getContext('2d')?.drawImage(arrival.sprite.canvas, 0, 0, 1, 1)
    storePart(arrival.key, arrival.sprite)
  }
}

/**
 * Whether parts from the worker are waiting to be used.
 */
export function oakArrivalsPending(): boolean {
  return partArrivals.length > 0
}

/**
 * Builds a part completely, for the background worker, and hands it over as a bitmap.
 *
 * @param shape - Tree.
 * @param tones - Leaf fill colors.
 * @param trunkColor - Trunk color.
 * @param resolution - Bitmap pixels per CSS pixel.
 * @param part - Which part.
 */
export function buildOakPartSync(
  shape: TreeShape,
  tones: string[],
  trunkColor: string,
  resolution: number,
  part: OakPart,
): { bitmap: ImageBitmap; offsetX: number; offsetY: number; width: number; height: number } {
  const sprite = buildNow(shape, tones, trunkColor, resolution, part)
  return {
    bitmap: (sprite.canvas as OffscreenCanvas).transferToImageBitmap(),
    offsetX: sprite.offsetX,
    offsetY: sprite.offsetY,
    width: sprite.width,
    height: sprite.height,
  }
}

/**
 * Has a part built in the background (by the worker if there is one, else in slices on the main thread).
 *
 * @param shape - Tree.
 * @param tones - Leaf fill colors.
 * @param trunkColor - Trunk color.
 * @param resolution - Bitmap pixels per CSS pixel.
 * @param part - Which part.
 * @param priority - Lower is more urgent.
 */
export function queueOakPart(
  shape: TreeShape,
  tones: string[],
  trunkColor: string,
  resolution: number,
  part: OakPart,
  priority: number,
): void {
  const key = oakPartKey(shape, trunkColor, resolution, part)
  if (partCache.has(key)) {
    return
  }
  if (workerUsable()) {
    requestWork({
      key: `oak|${key}`,
      priority,
      payload: { type: 'oak', shape, tones, trunkColor, res: resolution, part },
      wanted: () => !partCache.has(key),
      onDone: (bitmap, meta) => {
        partArrivals.push({
          key,
          sprite: {
            canvas: bitmap,
            offsetX: meta['offsetX'] ?? 0,
            offsetY: meta['offsetY'] ?? 0,
            width: meta['width'] ?? 0,
            height: meta['height'] ?? 0,
          },
        })
      },
    })
  } else {
    enqueueJob(key, priority, oakPartJob(shape, tones, trunkColor, resolution, part))
  }
}

/**
 * A tree part's bitmap if it has been built.
 *
 * @param shape - Tree.
 * @param trunkColor - Trunk color.
 * @param resolution - Bitmap pixels per CSS pixel.
 * @param part - Which part.
 */
export function peekOakPart(shape: TreeShape, trunkColor: string, resolution: number, part: OakPart): TreeSprite | null {
  return partCache.get(oakPartKey(shape, trunkColor, resolution, part)) ?? null
}

/**
 * A tree part's bitmap, built now if need be (the summer parts are built before play starts).
 *
 * @param shape - Tree.
 * @param tones - Leaf fill colors.
 * @param trunkColor - Trunk color.
 * @param resolution - Bitmap pixels per CSS pixel.
 * @param part - Which part.
 */
export function getOakPart(shape: TreeShape, tones: string[], trunkColor: string, resolution: number, part: OakPart): TreeSprite {
  let sprite = peekOakPart(shape, trunkColor, resolution, part)
  if (!sprite) {
    for (const step of oakPartJob(shape, tones, trunkColor, resolution, part)) {
      void step
    }
    sprite = peekOakPart(shape, trunkColor, resolution, part)
  }
  return sprite ?? buildNow(shape, tones, trunkColor, resolution, part)
}

/**
 * Builds a part without storing it (a fallback if the cache dropped it at once).
 */
function buildNow(shape: TreeShape, tones: string[], trunkColor: string, resolution: number, part: OakPart): TreeSprite {
  const steps = buildPartSteps(shape, tones, trunkColor, resolution, part)
  let result = steps.next()
  while (!result.done) {
    result = steps.next()
  }
  return result.value
}

/**
 * Draws an oak from its prebuilt parts with its base at (x, y): the trunk, then the crown of the look it
 * holds, and while it passes to the next look (over a few seconds) the two faded against each other. A crown
 * that is not built yet is queued; until then the nearest one built stands in.
 *
 * @param ctx - 2D canvas context.
 * @param shape - Generated tree.
 * @param x - Base X.
 * @param y - Base Y.
 * @param tones - Leaf fill colors from dark to light (length `OAK_TONE_COUNT`).
 * @param trunkColor - Trunk and branch fill.
 * @param mix - Which look (`a`), which look it passes to (`b`) and how far (`w`).
 */
export function drawOak(
  ctx: CanvasRenderingContext2D,
  shape: TreeShape,
  x: number,
  y: number,
  tones: string[],
  trunkColor: string,
  mix: { a: number; b: number; w: number; soon?: boolean },
): void {
  const res = ctx.getTransform().a
  const trunk = getOakPart(shape, tones, trunkColor, res, 'trunk')
  ctx.drawImage(trunk.canvas, x + trunk.offsetX, y + trunk.offsetY, trunk.width, trunk.height)
  drawCrowns(ctx, shape, x, y, tones, trunkColor, res, mix)
}

/** A bitmap with a size (a canvas or an image bitmap). */
type Bitmap = CanvasImageSource & { width: number; height: number }

const fadeScratch = new WeakMap<object, HTMLCanvasElement>()

/**
 * Draws a cross-fade of two equally sized bitmaps without the picture going see-through in the middle:
 * the two are first added up (each at its own share) on a canvas of their own, and that is drawn opaque.
 * (Drawing the two one over the other with their shares as opacity would let the scene show through.)
 *
 * @param ctx - 2D canvas context.
 * @param owner - What the two bitmaps belong to (it keeps the working canvas).
 * @param from - The look that is passing.
 * @param to - The look that is coming.
 * @param share - How far the fade has come, 0-1.
 * @param dx - Where to draw (left).
 * @param dy - Where to draw (top).
 * @param dw - Drawn width.
 * @param dh - Drawn height.
 */
export function drawCrossfade(
  ctx: CanvasRenderingContext2D,
  owner: object,
  from: Bitmap,
  to: Bitmap,
  share: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  if (from.width !== to.width || from.height !== to.height) {
    ctx.globalAlpha = 1 - share
    ctx.drawImage(from, dx, dy, dw, dh)
    ctx.globalAlpha = share
    ctx.drawImage(to, dx, dy, dw, dh)
    ctx.globalAlpha = 1
    return
  }
  let scratch = fadeScratch.get(owner)
  if (!scratch) {
    scratch = document.createElement('canvas')
    fadeScratch.set(owner, scratch)
  }
  if (scratch.width !== from.width || scratch.height !== from.height) {
    scratch.width = from.width
    scratch.height = from.height
  }
  const sctx = scratch.getContext('2d')
  if (!sctx) {
    return
  }
  sctx.globalCompositeOperation = 'source-over'
  sctx.clearRect(0, 0, scratch.width, scratch.height)
  sctx.globalAlpha = 1 - share
  sctx.drawImage(from, 0, 0)
  sctx.globalCompositeOperation = 'lighter'
  sctx.globalAlpha = share
  sctx.drawImage(to, 0, 0)
  sctx.globalAlpha = 1
  sctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(scratch, dx, dy, dw, dh)
}

/**
 * Lets go of an owner's working canvas for cross-fades (when no fade is going on).
 *
 * @param owner - What the bitmaps belong to.
 */
export function endCrossfade(owner: object): void {
  const scratch = fadeScratch.get(owner)
  if (scratch) {
    scratch.width = 0
    scratch.height = 0
    fadeScratch.delete(owner)
  }
}

/**
 * Draws the crown part(s) of a tree for a look.
 *
 * @param ctx - 2D canvas context.
 * @param shape - Tree.
 * @param x - Base X.
 * @param y - Base Y.
 * @param tones - Leaf fill colors.
 * @param trunkColor - Trunk color (part of the cache key).
 * @param res - Bitmap pixels per CSS pixel.
 * @param mix - The look and the fade to the next.
 */
function drawCrowns(
  ctx: CanvasRenderingContext2D,
  shape: TreeShape,
  x: number,
  y: number,
  tones: string[],
  trunkColor: string,
  res: number,
  mix: { a: number; b: number; w: number; soon?: boolean },
): void {
  const stages: [number, number][] = mix.w > 0 && mix.a !== mix.b ? [[mix.a, 1 - mix.w], [mix.b, mix.w]] : [[mix.a, 1]]
  const shown: { sprite: TreeSprite; alpha: number }[] = []
  for (const [stage, alpha] of stages) {
    const part = crownPart(stage)
    if (!part || alpha <= 0) {
      continue
    }
    let sprite = peekOakPart(shape, trunkColor, res, part)
    if (!sprite) {
      queueOakPart(shape, tones, trunkColor, res, part, 1)
      // The nearest look that is built stands in for it.
      for (const other of [stage - 1, stage + 1, stage - 2, stage + 2, 0]) {
        // (A fall look only stands in for a fall look, a spring one for a spring one.)
        const alt = other < BARE_STAGE === stage < BARE_STAGE ? crownPart(other) : null
        sprite = alt ? peekOakPart(shape, trunkColor, res, alt) : null
        if (sprite) {
          break
        }
      }
      // With no spring look made yet the tree stays bare; in fall the green crown is made at once.
      if (!sprite && stage > BARE_STAGE) {
        continue
      }
      sprite = sprite ?? getOakPart(shape, tones, trunkColor, res, 'c0')
    }
    shown.push({ sprite, alpha })
  }
  const [first, second] = shown
  if (first && second) {
    drawCrossfade(ctx, shape, first.sprite.canvas, second.sprite.canvas, second.alpha, x + first.sprite.offsetX, y + first.sprite.offsetY, first.sprite.width, first.sprite.height)
  } else if (first) {
    ctx.globalAlpha = first.alpha
    ctx.drawImage(first.sprite.canvas, x + first.sprite.offsetX, y + first.sprite.offsetY, first.sprite.width, first.sprite.height)
    ctx.globalAlpha = 1
  }
  if (mix.w === 0) {
    endCrossfade(shape)
    // Holding a look: get the next one ready when its change is near, and let go of the ones that are over (memory).
    const next = mix.soon ? crownPart(mix.a + 1) : null
    if (next) {
      queueOakPart(shape, tones, trunkColor, res, next, 6)
    }
    // (In spring the looks follow each other closely, so the one after that is asked for too.)
    const after = mix.soon && mix.a >= BARE_STAGE ? crownPart(mix.a + 2) : null
    if (after) {
      queueOakPart(shape, tones, trunkColor, res, after, 7)
    }
    for (let old = 0; old < mix.a; old += 1) {
      const oldPart = crownPart(old)
      if (oldPart) {
        const oldKey = oakPartKey(shape, trunkColor, res, oldPart)
        const dropped = partCache.get(oldKey)
        if (dropped && peekOakPart(shape, trunkColor, res, crownPart(mix.a) ?? 'c0')) {
          releaseSprite(dropped)
          partCache.delete(oldKey)
        }
      }
    }
  }
}

/**
 * Draws just the leaves of an oak (from the prebuilt crowns), over whatever is already there, so that a
 * climbing squirrel can pass behind them.
 *
 * @param ctx - 2D canvas context.
 * @param shape - Generated tree.
 * @param x - Base X.
 * @param y - Base Y.
 * @param tones - Leaf fill colors from dark to light.
 * @param trunkColor - Trunk color (only part of the cache key).
 * @param mix - The look and the fade to the next.
 */
export function drawOakCrown(
  ctx: CanvasRenderingContext2D,
  shape: TreeShape,
  x: number,
  y: number,
  tones: string[],
  trunkColor: string,
  mix: { a: number; b: number; w: number; soon?: boolean },
): void {
  drawCrowns(ctx, shape, x, y, tones, trunkColor, ctx.getTransform().a, mix)
}
