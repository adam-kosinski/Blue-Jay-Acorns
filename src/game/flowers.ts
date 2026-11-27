/**
 * Spring ephemerals: patches of small wildflowers that come up on the forest floor in spring (trout lilies,
 * trilliums, bluebells and anemones). A patch is of one kind; its plants fade in a few at a time, from the
 * middle outward, all fully there by the end of spring. Each patch is painted onto a bitmap of its own that is
 * repainted only about once a second while it grows.
 */

/** The kinds: trout lily, trillium, bluebell, anemone. */
export const FLOWER_KINDS = 4

/** How many differently shaped plants are painted of each kind. */
const VARIANTS = 3

/** The share of spring a plant takes to fade in. */
const FADE_SHARE = 0.22

/** How many times over spring a growing patch is repainted. */
const STEPS = 48

/** The box (px at scale 1, from the plant's foot) every plant is painted in. */
const BOX = { left: -34, top: -58, width: 68, height: 64 }

/** A plant of a patch: where its foot is, its shape, which way it faces, its size and when in spring it comes. */
type Plant = { x: number; y: number; variant: number; flip: 1 | -1; scale: number; appear: number }

/** A patch of one kind of flower, its plants from back to front, and the box around them. */
export type FlowerPatch = {
  kind: number
  x: number
  plants: Plant[]
  left: number
  top: number
  right: number
  bottom: number
  /** When its first plant comes (share of spring). */
  first: number
  /** Which part of a step it is repainted at (so that patches are not all repainted at once). */
  phase: number
}

/** How a patch's colors are changed (haze), with a name for the change (bitmaps are cached by it). */
export type FlowerTint = { key: string; color: (hex: string) => string }

/** Colors as they are. */
export const PLAIN_TINT: FlowerTint = { key: 'plain', color: (hex) => hex }

/**
 * Makes a patch.
 *
 * @param random - Random numbers in `[0, 1)`.
 * @param kind - Which kind of flower, 0 to `FLOWER_KINDS` - 1.
 * @param x - Its middle.
 * @param groundY - The Y of a plant's foot at an x, before the patch's own spread down the ground.
 * @param width - How wide it is.
 * @param spread - How far its plants lie up and down from there.
 * @param scale - Size of its plants.
 * @param count - How many plants.
 */
export function makeFlowerPatch(
  random: () => number,
  kind: number,
  x: number,
  groundY: (x: number) => number,
  width: number,
  spread: number,
  scale: number,
  count: number,
): FlowerPatch {
  const start = 0.1 + random() * 0.22
  const plants = Array.from({ length: count }, (): Plant => {
    // Thickest in the middle, thinning out toward the edges.
    const across = (random() + random() + random()) / 1.5 - 1
    const down = random() * 2 - 1
    const px = x + across * width * 0.5
    const out = Math.min(1, Math.hypot(across, down * 0.5))
    return {
      x: px,
      y: groundY(px) + down * spread * (1 - 0.5 * across * across),
      variant: Math.floor(random() * VARIANTS),
      flip: random() < 0.5 ? -1 : 1,
      scale: scale * (0.75 + random() * 0.45),
      appear: start + (1 - FADE_SHARE - start) * (0.55 * random() + 0.45 * out),
    }
  }).sort((p, q) => p.y - q.y)
  return {
    kind,
    x,
    plants,
    left: Math.min(...plants.map((p) => p.x + BOX.left * p.scale)),
    top: Math.min(...plants.map((p) => p.y + BOX.top * p.scale)),
    right: Math.max(...plants.map((p) => p.x - BOX.left * p.scale)),
    bottom: Math.max(...plants.map((p) => p.y + (BOX.top + BOX.height) * p.scale)),
    first: Math.min(...plants.map((p) => p.appear)),
    phase: random(),
  }
}

/**
 * A pointed leaf or petal from a point.
 *
 * @param ctx - 2D canvas context.
 * @param x - Where it starts.
 * @param y - Where it starts.
 * @param angle - Which way it points (radians).
 * @param length - Its length.
 * @param width - Its greatest width.
 * @param color - Fill color.
 * @param curl - How far its tip bends to one side.
 */
function blade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  color: string,
  curl = 0,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(length * 0.4, -width * 0.9 + curl * 0.4, length, curl)
  ctx.quadraticCurveTo(length * 0.5, width * 0.9 + curl * 0.4, 0, 0)
  ctx.fill()
  ctx.restore()
}

/**
 * A thin curved stalk.
 *
 * @param ctx - 2D canvas context.
 * @param points - Start, control point and end.
 * @param width - Its thickness.
 * @param color - Its color.
 */
function stalk(
  ctx: CanvasRenderingContext2D,
  points: [number, number, number, number, number, number],
  width: number,
  color: string,
): void {
  const [x0, y0, cx, cy, x1, y1] = points
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.quadraticCurveTo(cx, cy, x1, y1)
  ctx.stroke()
}

/**
 * A round dot.
 *
 * @param ctx - 2D canvas context.
 * @param x - Center x.
 * @param y - Center y.
 * @param radius - Radius.
 * @param color - Color.
 */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

/** Paints one plant with its foot at the origin, `tint` applied to every color. */
type Painter = (ctx: CanvasRenderingContext2D, random: () => number, tint: (hex: string) => string) => void

/** Trout lily: two long mottled leaves, and a nodding yellow flower with swept-back petals. */
const troutLily: Painter = (ctx, random, tint) => {
  for (const side of [-1, 1]) {
    const angle = -Math.PI / 2 + side * (0.85 + random() * 0.3)
    const length = 27 + random() * 6
    blade(ctx, side, 0, angle, length, 9, tint(side < 0 ? '#5c8748' : '#6c9852'), side * 3)
    // The mottling.
    for (let i = 0; i < 6; i += 1) {
      const t = 0.22 + random() * 0.55
      dot(ctx, side + Math.cos(angle) * length * t + (random() - 0.5) * 4, Math.sin(angle) * length * t + (random() - 0.5) * 3, 0.8 + random(), tint('#7d5f4c'))
    }
  }
  const lean = (random() - 0.5) * 8
  const hx = 7 + lean * 0.3
  const hy = -33 - random() * 6
  stalk(ctx, [0, 0, lean - 3, hy - 9, hx, hy], 1.6, tint('#7b7a3c'))
  // Back petals first, then the front ones: all curving out and up from the hanging head.
  for (const [turn, length, color] of [[-2.7, 12, '#dfae18'], [-0.5, 12, '#dfae18'], [2.75, 13, '#f6d21f'], [0.35, 13, '#f6d21f'], [1.2, 12, '#ffe044'], [2.0, 11, '#f6d21f']] as const) {
    blade(ctx, hx, hy + 1, turn + (random() - 0.5) * 0.3, length, 5.5, tint(color), turn > Math.PI / 2 || turn < -Math.PI / 2 ? 5 : -5)
  }
  for (const dx of [-2, 0, 2.4]) {
    stalk(ctx, [hx, hy + 2, hx + dx, hy + 6, hx + dx * 1.4, hy + 10], 0.8, tint('#c9a21c'))
    dot(ctx, hx + dx * 1.4, hy + 10, 1.1, tint('#8a4a1c'))
  }
}

/** Trillium: three broad leaves around the stem, and above them a white flower of three petals. */
const trillium: Painter = (ctx, random, tint) => {
  const height = 25 + random() * 7
  stalk(ctx, [0, 0, (random() - 0.5) * 4, -height * 0.5, 0, -height], 2, tint('#5b7d37'))
  blade(ctx, 0, -height, Math.PI - 0.05 + random() * 0.3, 22, 16, tint('#4f8a39'), -2)
  blade(ctx, 0, -height, 0.05 - random() * 0.3, 22, 16, tint('#56933d'), 2)
  blade(ctx, 0, -height, 1.25 + random() * 0.6, 15, 13, tint('#66a447'))
  const fy = -height - 10
  stalk(ctx, [0, -height, 1, -height - 6, 0, fy], 1.4, tint('#5b7d37'))
  const turn = (random() - 0.5) * 0.4
  for (const [angle, color] of [[-Math.PI / 2, '#eef2ee'], [Math.PI / 2 - 1.95, '#ffffff'], [Math.PI / 2 + 1.95, '#fbfdfb']] as const) {
    blade(ctx, 0, fy, angle + turn, 13.5, 11, tint(color))
  }
  dot(ctx, 0, fy, 2.2, tint('#f0cf3a'))
}

/** Bluebell: leafy stems, each ending in a hanging cluster of blue bells with pinkish buds. */
const bluebell: Painter = (ctx, random, tint) => {
  const stems = 2 + Math.floor(random() * 2)
  for (let s = 0; s < stems; s += 1) {
    const side = s === 0 ? -1 : s === 1 ? 1 : random() - 0.5
    const hx = side * (8 + random() * 9)
    const hy = -30 - random() * 15
    stalk(ctx, [0, 0, side * 2, hy * 0.85, hx, hy], 1.7, tint('#6d9446'))
    for (let i = 0; i < 3; i += 1) {
      const t = 0.12 + i * 0.22
      const out = (i % 2 === 0 ? 1 : -1) * (side < 0 ? -1 : 1)
      blade(ctx, hx * t * t, hy * (1.7 * t - 0.7 * t * t), -Math.PI / 2 + out * (0.9 + random() * 0.5), 16 - i * 2.5, 9 - i, tint(i % 2 === 0 ? '#6fa84a' : '#82b956'))
    }
    const bells = 4 + Math.floor(random() * 3)
    for (let b = 0; b < bells; b += 1) {
      const bx = hx + (random() - 0.5) * 13
      const by = hy + (random() - 0.2) * 9
      stalk(ctx, [hx, hy, bx, by - 3, bx, by], 0.8, tint('#6d9446'))
      const bud = b >= bells - 1
      const color = tint(bud ? '#b793d8' : b % 2 === 0 ? '#7f97e8' : '#9daef2')
      // A narrow tube widening into a bell.
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(bx - 1, by)
      ctx.quadraticCurveTo(bx - 1.2, by + 4, bx - 3.2, by + (bud ? 5 : 8))
      ctx.quadraticCurveTo(bx, by + (bud ? 6.5 : 10), bx + 3.2, by + (bud ? 5 : 8))
      ctx.quadraticCurveTo(bx + 1.2, by + 4, bx + 1, by)
      ctx.closePath()
      ctx.fill()
    }
  }
}

/** Anemone: a low tuft of small divided leaves, with little white or lilac five-petaled flowers above. */
const anemone: Painter = (ctx, random, tint) => {
  for (let i = 0; i < 9; i += 1) {
    const x = (random() - 0.5) * 24
    const y = -random() * 8
    for (const spread of [-0.7, 0, 0.7]) {
      blade(ctx, x, y, -Math.PI / 2 + spread + (random() - 0.5) * 0.6 + x * 0.03, 7 + random() * 3, 4.5, tint(i % 2 === 0 ? '#538c3a' : '#69a247'))
    }
  }
  const flowers = 3 + Math.floor(random() * 3)
  const lilac = random() < 0.5
  for (let f = 0; f < flowers; f += 1) {
    const x = (f / (flowers - 1) - 0.5) * 30 + (random() - 0.5) * 7
    const y = -11 - random() * 15
    stalk(ctx, [x * 0.4, 0, x * 0.6, y * 0.6, x, y], 0.9, tint('#6c8c45'))
    const color = tint(lilac && f % 2 === 0 ? '#cbbdf2' : '#f8f6ff')
    const turn = random() * 6.28
    for (let p = 0; p < 5; p += 1) {
      // (Seen at a slant: pressed down a little.)
      const angle = turn + (p * Math.PI * 2) / 5
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.ellipse(x + Math.cos(angle) * 3, y + Math.sin(angle) * 2.2, 3.2, 2.2, angle, 0, Math.PI * 2)
      ctx.fill()
    }
    dot(ctx, x, y, 1.4, tint('#e9c83a'))
  }
}

const PAINTERS: Painter[] = [troutLily, trillium, bluebell, anemone]

/** Painted plants, by kind, shape, resolution and tint. */
const plantSprites = new Map<string, HTMLCanvasElement>()

/**
 * A small deterministic random generator, so a shape is painted the same every time.
 *
 * @param seed - Integer seed.
 */
function steady(seed: number): () => number {
  let a = seed | 0
  return (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A plant's bitmap (the box `BOX` around its foot).
 *
 * @param kind - Kind of flower.
 * @param variant - Which shape.
 * @param res - Bitmap pixels per pixel at scale 1.
 * @param tint - Its colors' change.
 */
function plantSprite(kind: number, variant: number, res: number, tint: FlowerTint): HTMLCanvasElement {
  const key = `${kind}|${variant}|${res.toFixed(2)}|${tint.key}`
  let canvas = plantSprites.get(key)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(BOX.width * res))
    canvas.height = Math.max(1, Math.ceil(BOX.height * res))
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(res, res)
      ctx.translate(-BOX.left, -BOX.top)
      PAINTERS[kind]?.(ctx, steady(kind * 101 + variant * 13 + 5), tint.color)
    }
    plantSprites.set(key, canvas)
  }
  return canvas
}

/** Each patch's bitmap as last painted. */
const patchBitmaps = new WeakMap<FlowerPatch, { canvas: HTMLCanvasElement; key: string }>()

/**
 * Draws a patch as far as it has come up.
 *
 * @param ctx - 2D canvas context.
 * @param patch - The patch.
 * @param spring - How far into spring it is, 0-1.
 * @param res - Bitmap pixels per pixel of the patch's coordinates.
 * @param tint - Its colors' change.
 * @param offsetX - Added to the patch's coordinates.
 * @param offsetY - Added to the patch's coordinates.
 * @param snow - How much snow lies at a plant's foot, 0-1 (it hides the plant), if any can.
 */
export function drawFlowerPatch(
  ctx: CanvasRenderingContext2D,
  patch: FlowerPatch,
  spring: number,
  res: number,
  tint: FlowerTint,
  offsetX = 0,
  offsetY = 0,
  snow?: (x: number, y: number) => number,
): void {
  const now = Math.min(1, Math.floor(spring * STEPS + patch.phase) / STEPS)
  if (spring <= 0 || now <= patch.first) {
    return
  }
  const width = patch.right - patch.left
  const height = patch.bottom - patch.top
  const key = `${res.toFixed(2)}|${tint.key}|${now.toFixed(4)}`
  let bitmap = patchBitmaps.get(patch)
  if (!bitmap || bitmap.key !== key) {
    const canvas = bitmap?.canvas ?? document.createElement('canvas')
    // (Setting the size clears it.)
    canvas.width = Math.max(1, Math.ceil(width * res))
    canvas.height = Math.max(1, Math.ceil(height * res))
    const paint = canvas.getContext('2d')
    if (paint) {
      paint.scale(res, res)
      paint.translate(-patch.left, -patch.top)
      for (const plant of patch.plants) {
        const alpha = Math.min(1, (now - plant.appear) / FADE_SHARE) * (1 - (snow?.(plant.x, plant.y) ?? 0))
        if (alpha <= 0.01) {
          continue
        }
        // (Painted a little finer than shown at scale 1, for the bigger plants.)
        const sprite = plantSprite(patch.kind, plant.variant, res * Math.max(0.5, Math.ceil(plant.scale * 4) / 4), tint)
        paint.save()
        paint.globalAlpha = alpha
        paint.translate(plant.x, plant.y)
        paint.scale(plant.flip * plant.scale, plant.scale)
        paint.drawImage(sprite, BOX.left, BOX.top, BOX.width, BOX.height)
        paint.restore()
      }
    }
    bitmap = { canvas, key }
    patchBitmaps.set(patch, bitmap)
  }
  ctx.drawImage(bitmap.canvas, patch.left + offsetX, patch.top + offsetY, bitmap.canvas.width / res, bitmap.canvas.height / res)
}
