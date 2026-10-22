import type { TreeLobe, TreeSegment, TreeShape } from './types'

/** Number of leaf tones (dark to light) a tree's lobes pick from. */
export const OAK_TONE_COUNT = 4

let nextShapeId = 0

/** Largest tree bitmap, in pixels. */
const MAX_SPRITE_PIXELS = 8_000_000

/** Most tree sprites kept before the least recently used one is dropped. */
const SPRITE_CACHE_LIMIT = 80

/** Pre-rendered tree bitmap plus where it sits relative to the tree base. */
type TreeSprite = {
  canvas: HTMLCanvasElement
  offsetX: number
  offsetY: number
  width: number
  height: number
}

const spriteCache = new Map<string, TreeSprite>()

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
 */
export function generateOak(baseHeight: number, baseTrunkWidth: number): TreeShape {
  const stretch = randRange(1.5, 2)
  const height = baseHeight * stretch
  const trunkWidth = baseTrunkWidth * Math.sqrt(stretch)
  const segments: TreeSegment[] = []
  const lobes: TreeLobe[] = []
  const leafRadius = height * randRange(0.085, 0.11)

  const lean = randRange(-0.06, 0.06) * height
  const trunkTopY = -height * randRange(0.5, 0.62)
  const trunkTopX = lean
  const points: [number, number][] = [[0, 10]]
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
      widthAt(t) * randRange(0.4, 0.6),
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
        widthAt(t) * randRange(0.35, 0.5),
        0,
        leafRadius * 0.8,
      )
    }
  }

  addCluster(lobes, trunkTopX, trunkTopY - leafRadius * 0.6, leafRadius * 1.3)
  addCluster(lobes, trunkTopX + randRange(-0.3, 0.3) * leafRadius, trunkTopY + leafRadius * 0.3, leafRadius * 1.1)

  let halfWidth = trunkWidth
  let top = trunkTopY
  for (const lobe of lobes) {
    halfWidth = Math.max(halfWidth, Math.abs(lobe.x) + lobe.r)
    top = Math.min(top, lobe.y - lobe.r)
  }
  nextShapeId += 1
  return { id: nextShapeId, segments, lobes, halfWidth, top }
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
function drawLeaf(
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

/**
 * Draws a leafy clump with an irregular, organic outline: a lumpy base blob (stretched and rotated
 * at random), scattered leaves shaded lighter toward the upper left and darker toward the lower
 * right (hanging mostly downward), and a ring of leaves lying along the edge.
 *
 * @param ctx - 2D canvas context.
 * @param x - Center X.
 * @param y - Center Y.
 * @param r - Rough clump radius.
 * @param tones - Leaf colors from dark to light.
 * @param baseTone - Index of the base blob color.
 * @param rand - Deterministic random source.
 * @param detail - Leaf density from 0 (blob only) to 1 (full).
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
): void {
  const last = tones.length - 1
  const tone = (i: number): string => tones[Math.max(0, Math.min(last, Math.round(i)))] ?? '#2f7a3a'
  const leafLen = r * 0.27

  // Lumpy outline: random radii, a random stretch, and a random orientation.
  const corners = 9
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

  ctx.fillStyle = tone(baseTone)
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
  if (detail < 0.12) {
    return
  }

  // Scattered leaves inside the outline (random points in the fan of triangles around the center).
  const inner = Math.min(36, Math.round(((r * r) / (leafLen * leafLen)) * 0.9 * detail))
  for (let n = 0; n < inner; n += 1) {
    const p = at(Math.floor(rand() * corners))
    const q = at(Math.floor(rand() * corners) + 1)
    let u = rand()
    let v = rand()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }
    const lx = x + u * 0.9 * (p[0] - x) + v * 0.9 * (q[0] - x)
    const ly = y + u * 0.9 * (p[1] - y) + v * 0.9 * (q[1] - y)
    const light = (-(lx - x) - (ly - y)) / (r * 1.1)
    drawLeaf(
      ctx,
      lx,
      ly,
      leafLen * (0.8 + rand() * 0.5),
      Math.PI + (rand() - 0.5) * 1.5,
      tone(baseTone + light * 1.5 + (rand() - 0.5) * 1.4),
      detail >= 0.6,
    )
  }

  // Leaves lying along the outline, pointing along the edge, for a soft organic rim.
  const perEdge = Math.max(1, Math.round((Math.min(34, Math.max(4, ((Math.PI * 2 * r) / (leafLen * 0.8)) * (0.4 + 0.6 * detail))) / corners)))
  for (let i = 0; i < corners; i += 1) {
    const p = at(i)
    const q = at(i + 1)
    const tx = q[0] - p[0]
    const ty = q[1] - p[1]
    for (let m = 0; m < perEdge; m += 1) {
      const t = (m + rand() * 0.6) / perEdge
      const ex = x + (p[0] + tx * t - x) * 0.88
      const ey = y + (p[1] + ty * t - y) * 0.88
      const light = (-(ex - x) - (ey - y)) / (r * 1.1)
      drawLeaf(
        ctx,
        ex,
        ey,
        leafLen * (0.9 + rand() * 0.4),
        Math.atan2(tx, -ty) + (rand() - 0.5) * 0.5,
        tone(baseTone + light * 1.1 + (rand() - 0.5) * 1.2),
        detail >= 0.6,
      )
    }
  }
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
 */
export function drawOakVector(
  ctx: CanvasRenderingContext2D,
  shape: TreeShape,
  x: number,
  y: number,
  tones: string[],
  trunkColor: string,
  leafDetail = 1,
): void {
  ctx.save()
  ctx.translate(x, y)

  ctx.fillStyle = trunkColor
  for (const seg of shape.segments) {
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

  const rand = seededRandom(shape.id * 7919 + 13)
  shape.lobes.forEach((lobe) => {
    drawLeafyDisk(ctx, lobe.x, lobe.y, lobe.r, tones, lobe.tone, rand, leafDetail)
  })
  ctx.restore()
}

/**
 * Renders a tree once into an offscreen canvas.
 *
 * @param shape - Generated tree.
 * @param tones - Leaf fill colors.
 * @param trunkColor - Trunk and branch fill.
 * @param resolution - Bitmap pixels per CSS pixel.
 */
function buildSprite(
  shape: TreeShape,
  tones: string[],
  trunkColor: string,
  resolution: number,
): TreeSprite {
  let minY = 0
  for (const lobe of shape.lobes) {
    minY = Math.min(minY, lobe.y - lobe.r)
  }
  for (const seg of shape.segments) {
    minY = Math.min(minY, seg.y0 - seg.w0, seg.y1 - seg.w1)
  }
  const minX = -shape.halfWidth - 2
  const width = shape.halfWidth * 2 + 4
  const height = -minY + 14
  // Cap bitmap size so big trees on hi-dpi screens stay within a few megapixels.
  const scale = Math.min(resolution, Math.sqrt(MAX_SPRITE_PIXELS / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(scale, scale)
    drawOakVector(ctx, shape, -minX, -minY, tones, trunkColor)
  }
  return { canvas, offsetX: minX, offsetY: minY, width, height }
}

/**
 * Draws an oak from a cached bitmap (built on first use) with its base at (x, y).
 *
 * Distant layers can pass `detail` below 1 for a smaller, cheaper bitmap.
 *
 * @param ctx - 2D canvas context.
 * @param shape - Generated tree.
 * @param x - Base X.
 * @param y - Base Y.
 * @param tones - Leaf fill colors from dark to light (length `OAK_TONE_COUNT`).
 * @param trunkColor - Trunk and branch fill.
 * @param detail - Bitmap resolution multiplier relative to the screen (1 is full).
 */
export function drawOak(
  ctx: CanvasRenderingContext2D,
  shape: TreeShape,
  x: number,
  y: number,
  tones: string[],
  trunkColor: string,
  detail = 1,
): void {
  const resolution = ctx.getTransform().a * detail
  const key = `${shape.id}|${trunkColor}|${detail}|${resolution}`
  let sprite = spriteCache.get(key)
  if (sprite) {
    spriteCache.delete(key)
  } else {
    sprite = buildSprite(shape, tones, trunkColor, resolution)
    if (spriteCache.size >= SPRITE_CACHE_LIMIT) {
      const oldest = spriteCache.keys().next().value
      if (oldest !== undefined) {
        spriteCache.delete(oldest)
      }
    }
  }
  spriteCache.set(key, sprite)
  ctx.drawImage(sprite.canvas, x + sprite.offsetX, y + sprite.offsetY, sprite.width, sprite.height)
}
