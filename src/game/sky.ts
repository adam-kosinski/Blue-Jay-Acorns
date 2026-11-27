/**
 * The sky behind the forest: blue above, ending in the ragged, blurred top of the far trees (the backdrop's own
 * color below it stands for them). The treeline's shape comes from Perlin noise. It is painted once, small, into
 * a bitmap that is stretched over the screen, which also softens it.
 */
import type { World } from './types'

/** The sky's color high up and down by the treeline. */
const SKY_HIGH = [158, 207, 247] as const
const SKY_LOW = [206, 233, 252] as const

/** Where the treeline's middle is on screen (share of the view's height) with the view at the bottom of the world. */
const LINE_HEIGHT = 0.19

/** How much the treeline moves with the camera, sideways and up and down (it is very far away). */
const PARALLAX_X = 0.06
const PARALLAX_Y = 0.12

/** The swells of the treeline: wavelength and height (px), from the broad ones to single crowns. */
const SWELLS: [number, number][] = [
  [520, 120],
  [160, 62],
  [52, 30],
]

/** The size and strength (px) of the finer raggedness of the crowns' edge, and half the width of its blur. */
const FRINGE_SIZE = 30
const FRINGE = 34
const BLUR = 24

/** How far above and below the line's middle the bitmap reaches (all sky above it, all trees below). */
const REACH = 170

/** Bitmap pixels per screen pixel. */
const RES = 0.25

type Treeline = { canvas: HTMLCanvasElement; width: number; noise: (x: number, y: number) => number }

const treelines = new WeakMap<World, Treeline>()

/**
 * Two-dimensional Perlin noise, about -0.7 to 0.7.
 *
 * @returns The noise function, with gradients of its own.
 */
function perlin(): (x: number, y: number) => number {
  const order = Array.from({ length: 256 }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const held = order[i] ?? 0
    order[i] = order[j] ?? 0
    order[j] = held
  }
  /** The dot product of a lattice point's gradient with the way from it. */
  const slope = (ix: number, iy: number, dx: number, dy: number): number => {
    const turn = ((order[((order[ix & 255] ?? 0) + iy) & 255] ?? 0) / 256) * Math.PI * 2
    return Math.cos(turn) * dx + Math.sin(turn) * dy
  }
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t
  return (x, y) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const dx = x - ix
    const dy = y - iy
    const across = fade(dx)
    return mix(
      mix(slope(ix, iy, dx, dy), slope(ix + 1, iy, dx - 1, dy), across),
      mix(slope(ix, iy + 1, dx, dy - 1), slope(ix + 1, iy + 1, dx - 1, dy - 1), across),
      fade(dy),
    )
  }
}

/**
 * Paints the sky's lower edge: opaque sky above the treeline, nothing below it.
 *
 * @param width - How much of the line is needed (screen px).
 * @param noise - The noise that shapes it.
 */
function paintTreeline(width: number, noise: (x: number, y: number) => number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * RES) + 2
  canvas.height = Math.ceil(REACH * 2 * RES)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return canvas
  }
  const image = ctx.createImageData(canvas.width, canvas.height)
  for (let column = 0; column < canvas.width; column += 1) {
    const x = column / RES
    // How high the trees stand here (px above the line's middle).
    let crest = 0
    for (const [index, [length, height]] of SWELLS.entries()) {
      crest += noise(x / length, index * 7.3 + 0.5) * height
    }
    for (let row = 0; row < canvas.height; row += 1) {
      const y = row / RES - REACH
      const ragged = noise(x / FRINGE_SIZE + 31.7, y / FRINGE_SIZE + 11.1) * FRINGE
      // How far above the trees this point is.
      const above = -crest - y + ragged
      const t = Math.max(0, Math.min(1, (above + BLUR) / (2 * BLUR)))
      // (The top rows are always all sky, so the bitmap joins the sky filled in above it.)
      const alpha = row < 2 ? 1 : t * t * (3 - 2 * t)
      const at = (row * canvas.width + column) * 4
      // Paler toward the trees.
      const down = row / Math.max(1, canvas.height - 1)
      for (const channel of [0, 1, 2] as const) {
        image.data[at + channel] = Math.round(SKY_HIGH[channel] + (SKY_LOW[channel] - SKY_HIGH[channel]) * down)
      }
      image.data[at + 3] = Math.round(alpha * 255)
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/**
 * Draws the sky over the backdrop, down to the treeline.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param cameraY - View top edge.
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  world: World,
  cameraX: number,
  cameraY: number,
  viewWidth: number,
  viewHeight: number,
): void {
  // Wide enough for the view anywhere along the world.
  const needed = viewWidth + world.width * PARALLAX_X
  let line = treelines.get(world)
  if (!line || line.width < needed) {
    const noise = line?.noise ?? perlin()
    line = { canvas: paintTreeline(needed, noise), width: needed, noise }
    treelines.set(world, line)
  }
  const lowest = Math.max(0, world.height - world.viewHeight)
  const middle = viewHeight * LINE_HEIGHT + (lowest - cameraY) * PARALLAX_Y
  const top = Math.round(middle - REACH)
  if (top > 0) {
    ctx.fillStyle = `rgb(${SKY_HIGH.join(',')})`
    ctx.fillRect(0, 0, viewWidth, top)
  }
  const shift = Math.max(0, cameraX * PARALLAX_X)
  const { canvas } = line
  ctx.drawImage(
    canvas,
    shift * RES,
    0,
    Math.min(viewWidth * RES, canvas.width - shift * RES),
    canvas.height,
    0,
    top,
    viewWidth,
    canvas.height / RES,
  )
}
