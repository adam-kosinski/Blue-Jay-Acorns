import {
  HOP_DURATION,
  CROWN_COLOR,
  EAT_DURATION,
  FOREST_HAZE_COLOR,
  GROUND_COLOR,
  HUNGER_THRESHOLD,
  NOTICE_LINE_FADE_SECONDS,
  OAK_TONES,
  PLAYER_COLOR,
  TRUNK_COLOR,
  TYPICAL_ASPECT_RATIO,
} from './constants'
import { drawLeafyDisk, drawOakCrown, drawOakVector, getOakSprite, paintBark, seededRandom, drawOak } from './oak'
import { burialQuality } from './burial'
import { BACKDROP_FOG, mixColor } from './world'
import { TERRAIN_STEP, creekWeight, groundYAt, hillBump, liftAt, lowPass } from './terrain'
import type {
  Acorn,
  Bush,
  Camera,
  ForestLayer,
  LeafLitter,
  Log,
  Npc,
  OakTree,
  Player,
  Fern,
  Rock,
  Terrain,
  World,
} from './types'

/** Backdrop gradient: leaf tones blended toward the haze by the farthest layer's atmospheric perspective. */
const BACKDROP_TOP = mixColor(OAK_TONES[1] ?? '#2a6e34', FOREST_HAZE_COLOR, BACKDROP_FOG)
const BACKDROP_BOTTOM = mixColor(OAK_TONES[3] ?? '#439150', FOREST_HAZE_COLOR, BACKDROP_FOG)

/**
 * Draws the hazy forest backdrop, scrolling world, entities, player, and a screen-space HUD.
 *
 * Ground acorns are drawn last so they sit in front of every other sprite; a held
 * acorn is drawn inside the bird sprite, behind its body.
 *
 * @param ctx - 2D canvas context.
 * @param viewWidth - Viewport width in CSS pixels.
 * @param viewHeight - Viewport height in CSS pixels.
 * @param world - Generated play space.
 * @param camera - Current view origin in world space.
 * @param player - Current player pose.
 * @param gameOver - True to cover the scene with the game-over screen.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  viewHeight: number,
  world: World,
  camera: Camera,
  player: Player,
  gameOver = false,
): void {
  // The backdrop is the colour of the tree leaves as the farthest layer's haze would show them,
  // darker leaves at the top fading to lighter ones lower down, so layers melt into it.
  const haze = ctx.createLinearGradient(0, 0, 0, viewHeight)
  haze.addColorStop(0, BACKDROP_TOP)
  haze.addColorStop(1, BACKDROP_BOTTOM)
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, viewWidth, viewHeight)

  drawForest(ctx, world.forest, world, camera, viewWidth, viewHeight)

  ctx.save()
  ctx.translate(-camera.x, -camera.y)

  // Trees, logs and rocks first, so the ground and leaf litter cover their bases.
  drawTrees(ctx, world.trees, world.terrain, camera.x, viewWidth)
  drawBuriedProps(ctx, world, camera.x, viewWidth)
  drawGround(ctx, world, camera.x, viewWidth)
  drawLeafLitter(ctx, world, camera, viewWidth, viewHeight)
  if (showBurialHeatmap) {
    drawBurialHeatmap(ctx, world, player, camera.x, viewWidth)
  }
  drawCreek(ctx, world, camera, viewWidth, viewHeight)
  drawMounds(ctx, world, camera.x, viewWidth)
  for (const npc of world.npcs) {
    const bx = npc.bird.x + npc.bird.size / 2
    if (bx > camera.x - npc.bird.size * 2 && bx < camera.x + viewWidth + npc.bird.size * 2) {
      drawBirdOnWater(ctx, npc.bird, world)
      drawNpcLabel(ctx, npc)
    }
  }
  for (const squirrel of world.squirrels) {
    const sx = squirrel.bird.x + squirrel.bird.size / 2
    if (!squirrel.bird.hidden && sx > camera.x - squirrel.bird.size * 2 && sx < camera.x + viewWidth + squirrel.bird.size * 2) {
      drawSquirrel(ctx, squirrel.bird)
      if (squirrel.bird.climbDir !== 0 && squirrel.home) {
        // The tree's leaves hang in front of a squirrel climbing its trunk.
        const reach = squirrel.bird.size * 1.2
        ctx.save()
        ctx.beginPath()
        ctx.rect(sx - reach, squirrel.bird.y - reach * 0.6, reach * 2, squirrel.bird.size + reach * 1.2)
        ctx.clip()
        drawOakCrown(ctx, squirrel.home.tree.shape, squirrel.home.trunkX, groundYAt(world.terrain, squirrel.home.trunkX), OAK_TONES, TRUNK_COLOR)
        ctx.restore()
      }
      drawNpcLabel(ctx, squirrel)
    }
  }
  drawBirdOnWater(ctx, player, world)
  // Ground acorns go just in front of the birds, but behind the props standing in the dirt, so they
  // never look like they sit on a bush.
  drawAcorns(ctx, world.acorns, camera.x, viewWidth)
  drawFrontProps(ctx, world, camera.x, viewWidth)
  drawNoticeLines(ctx, world)

  ctx.restore()

  drawMinimap(ctx, viewWidth, world, camera, viewHeight, player)
  drawHungerBar(ctx, viewWidth, viewHeight, player)

  drawControlsOverlay(ctx, viewHeight)

  if (gameOver) {
    if (gameOverSince === 0) {
      gameOverSince = performance.now()
    }
    drawGameOver(ctx, viewWidth, viewHeight, performance.now() - gameOverSince)
  } else {
    gameOverSince = 0
  }
}

/** When the game-over screen first appeared (ms timestamp), or 0 while the game is running. */
let gameOverSince = 0

/**
 * Draws the game-over screen: a vignette, a parchment card that eases in with the message,
 * a divider flanked by acorns, and a pulsing pointer to the Restart button.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 * @param elapsed - Milliseconds since the screen appeared (drives the fade-in).
 */
function drawGameOver(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  viewHeight: number,
  elapsed: number,
): void {
  const fade = Math.min(1, elapsed / 600)
  const ease = 1 - (1 - fade) * (1 - fade)

  const veil = ctx.createRadialGradient(
    viewWidth / 2,
    viewHeight / 2,
    viewHeight * 0.15,
    viewWidth / 2,
    viewHeight / 2,
    Math.max(viewWidth, viewHeight) * 0.7,
  )
  veil.addColorStop(0, `rgba(30, 18, 10, ${0.55 * ease})`)
  veil.addColorStop(1, `rgba(4, 6, 12, ${0.92 * ease})`)
  ctx.fillStyle = veil
  ctx.fillRect(0, 0, viewWidth, viewHeight)

  const cardW = Math.min(780, viewWidth * 0.84)
  const cardH = Math.min(280, viewHeight * 0.6)
  ctx.save()
  ctx.globalAlpha = ease
  ctx.translate(viewWidth / 2, viewHeight / 2)
  ctx.scale(0.92 + 0.08 * ease, 0.92 + 0.08 * ease)

  // Card: parchment with a double wooden border and a soft shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetY = 10
  ctx.fillStyle = '#f4ead2'
  ctx.beginPath()
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 22)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = '#6b3e1d'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.strokeStyle = 'rgba(107, 62, 29, 0.45)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(-cardW / 2 + 14, -cardH / 2 + 14, cardW - 28, cardH - 28, 14)
  ctx.stroke()

  // Title, sized to fit the card
  const title = 'You got a rumbly in your tumbly'
  let fontSize = Math.min(56, cardW * 0.075)
  ctx.font = `bold ${fontSize}px Georgia, serif`
  const maxTitleWidth = cardW - 80
  const measured = ctx.measureText(title).width
  if (measured > maxTitleWidth) {
    fontSize *= maxTitleWidth / measured
    ctx.font = `bold ${fontSize}px Georgia, serif`
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#4a2d14'
  ctx.fillText(title, 0, -cardH * 0.1)

  // Divider with an acorn at each end and one in the middle
  const dividerY = cardH * 0.06
  ctx.strokeStyle = 'rgba(107, 62, 29, 0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-cardW * 0.3, dividerY)
  ctx.lineTo(-24, dividerY)
  ctx.moveTo(24, dividerY)
  ctx.lineTo(cardW * 0.3, dividerY)
  ctx.stroke()
  drawAcornShape(ctx, 0, dividerY, 13, 0)
  drawAcornShape(ctx, -cardW * 0.3 - 16, dividerY, 9, -0.9)
  drawAcornShape(ctx, cardW * 0.3 + 16, dividerY, 9, 0.9)

  ctx.fillStyle = '#6b4a2b'
  ctx.font = 'italic 24px Georgia, serif'
  ctx.fillText('The jay went hungry. Click Restart to try again.', 0, cardH * 0.26)
  ctx.restore()

  // Pulsing pointer toward the Restart button
  const pulse = 0.6 + 0.4 * Math.sin(elapsed / 220)
  ctx.globalAlpha = ease * pulse
  ctx.fillStyle = '#f4ead2'
  ctx.font = 'bold 20px Georgia, serif'
  ctx.textAlign = 'right'
  ctx.fillText('Restart ↗', viewWidth - 24, 78)
  ctx.globalAlpha = 1
  ctx.textAlign = 'left'
}

/**
 * Draws the parallax forest silhouettes, farthest first, each filled solid down to the screen bottom.
 *
 * Each layer has its own rolling horizon (the terrain flattened and phase-shifted), and its trees,
 * bushes, and logs stand on it. With the camera pinned to the ground the base meets the ground line.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param layers - Forest layers, farthest first.
 * @param world - Play space (ground line and height).
 * @param camera - Current camera.
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 */
function drawForest(
  ctx: CanvasRenderingContext2D,
  layers: ForestLayer[],
  world: World,
  camera: Camera,
  viewWidth: number,
  viewHeight: number,
): void {
  const maxCamY = Math.max(0, world.height - viewHeight)
  const baseOf = (l: ForestLayer): number =>
    world.groundY - maxCamY * (1 - l.parallax) - camera.y * l.parallax - l.lift * viewHeight

  // Everything below the foreground's ground line (or the creek's water) is covered by it, and
  // everything below a nearer layer's lowest ground line is covered by that layer. The screen is cut
  // into slabs; working from the nearest layer back, find for each layer and slab the screen y below
  // which nothing of it can show, so it never draws those rows (the layers are full-width and would
  // otherwise overdraw heavily).
  const { creek } = world.terrain
  const slabs = Math.ceil(viewWidth / FOREST_SLAB)
  const cover = new Float32Array(slabs)
  for (let s = 0; s < slabs; s += 1) {
    let lowest = 0
    for (let x = camera.x + s * FOREST_SLAB; x <= camera.x + (s + 1) * FOREST_SLAB + world.terrain.step; x += world.terrain.step) {
      const surface = Math.abs(x - creek.x) < creek.halfWidth ? creek.waterY : groundYAt(world.terrain, x)
      lowest = Math.max(lowest, surface - camera.y)
    }
    cover[s] = Math.min(viewHeight, lowest)
  }
  const limits: Float32Array[] = []
  for (let k = layers.length - 1; k >= 0; k -= 1) {
    const l = layers[k]
    if (!l) {
      continue
    }
    limits[k] = Float32Array.from(cover)
    const lBase = baseOf(l)
    if (l.localRadius === null && lBase < viewHeight + 400) {
      const { columnGround } = forestStripFor(l, world)
      for (let s = 0; s < slabs; s += 1) {
        const x0 = camera.x * l.parallax + s * FOREST_SLAB
        let lowest = -1e9
        for (let c = Math.floor(x0 / GROUND_COLUMN); c <= Math.floor((x0 + FOREST_SLAB) / GROUND_COLUMN); c += 1) {
          lowest = Math.max(lowest, columnGround[Math.max(0, Math.min(columnGround.length - 1, c))] ?? -1e9)
        }
        cover[s] = Math.min(cover[s] ?? viewHeight, lBase + lowest)
      }
    }
  }

  for (const [index, layer] of layers.entries()) {
    const p = layer.parallax
    const base = baseOf(layer)
    if (base >= viewHeight + 400) {
      continue
    }
    const layerLimits = limits[index]
    if (!layerLimits) {
      continue
    }
    let limit = 0
    for (const value of layerLimits) {
      limit = Math.max(limit, value)
    }
    const strip = forestStripFor(layer, world)
    // The extra creek-only layers are transparent away from their creek: skip them when it is off screen.
    const creekScreenX = layer.creek.x - camera.x * p
    const hidden =
      layer.localRadius !== null &&
      (creekScreenX + layer.localRadius < 0 || creekScreenX - layer.localRadius > viewWidth)
    const stripHeight = strip.canvas.height / strip.resolution
    const topRow = Math.max(0, strip.originY - base)
    const below = base - strip.originY + stripHeight
    // Blits a strip bitmap in slabs, each cut at its own cull line (the +1 px overlap hides seams).
    const blit = (source: HTMLCanvasElement, fillBelow: boolean): void => {
      for (let s = 0; s < slabs; s += 1) {
        const slabLimit = layerLimits[s] ?? viewHeight
        const bottomRow = Math.min(stripHeight, slabLimit - base + strip.originY)
        const srcX = Math.max(0, (camera.x * p + s * FOREST_SLAB) * strip.resolution)
        const srcW = Math.min((FOREST_SLAB + 1) * strip.resolution, source.width - srcX)
        if (bottomRow > topRow && !hidden && srcW > 0) {
          ctx.drawImage(
            source,
            srcX,
            topRow * strip.resolution,
            srcW,
            (bottomRow - topRow) * strip.resolution,
            s * FOREST_SLAB,
            base - strip.originY + topRow,
            srcW / strip.resolution,
            bottomRow - topRow,
          )
        }
        if (fillBelow && below < slabLimit && layer.localRadius === null) {
          ctx.fillStyle = layer.groundColor
          ctx.fillRect(s * FOREST_SLAB, below - 1, FOREST_SLAB + 1, slabLimit - below + 1)
        }
      }
    }
    // The ground first; then the creek's water over it (below); then the props, so the water only
    // ever covers the ground and what lies behind it, never a bush or rock standing in front.
    blit(strip.canvas, true)
    // The creek flows on toward the viewer: a ribbon from this layer's waterline that widens into
    // the next nearer layer's creek (or the foreground creek), so the water stays continuous.
    const next = layers[index + 1]
    const top = base + strip.waterLine
    let bottom: number
    let bottomX: number
    let bottomHalf: number
    let bottomColor: string
    if (next) {
      const nextStrip = forestStripFor(next, world)
      const nextBase = world.groundY - maxCamY * (1 - next.parallax) - camera.y * next.parallax - next.lift * viewHeight
      bottom = nextBase + nextStrip.waterLine
      bottomX = next.creek.x - camera.x * next.parallax
      bottomHalf = next.creek.halfWidth
      bottomColor = next.waterColor
    } else {
      bottom = world.terrain.creek.waterY - camera.y
      bottomX = world.terrain.creek.x - camera.x
      bottomHalf = world.terrain.creek.halfWidth
      bottomColor = '#6aa3c4'
    }
    bottom = Math.max(bottom, top + 1)
    const topX = layer.creek.x - camera.x * p
    if (top < limit && bottom > 0) {
      const water = ctx.createLinearGradient(0, top, 0, bottom)
      water.addColorStop(0, layer.waterColor)
      water.addColorStop(1, bottomColor)
      ctx.fillStyle = water
      // Curved sides (vertical at both ends) let the creek wind smoothly from layer to layer.
      const mid = (top + bottom) / 2
      const topHalf = layer.creek.halfWidth
      ctx.beginPath()
      ctx.moveTo(topX - topHalf, top)
      if (index === 0) {
        // The farthest creek ends in a rounded head rather than a flat edge.
        ctx.quadraticCurveTo(topX, top - topHalf * 0.2, topX + topHalf, top)
      } else {
        ctx.lineTo(topX + topHalf, top)
      }
      // Two pixels past the end, so neighbouring ribbons overlap and no hairline shows between them.
      ctx.bezierCurveTo(topX + topHalf, mid, bottomX + bottomHalf, mid, bottomX + bottomHalf, bottom + 2)
      ctx.lineTo(bottomX - bottomHalf, bottom + 2)
      ctx.bezierCurveTo(bottomX - bottomHalf, mid, topX - topHalf, mid, topX - topHalf, top)
      ctx.closePath()
      ctx.fill()

      // Rocks on the ground between this layer and the next: thickest along the creek's banks
      // (placed from the ribbon's side so never in the water), plus free ones anywhere on the ground.
      const ownUnit = (world.viewHeight / 8) * 2 * layer.scale
      const nextUnit = (world.viewHeight / 8) * 2 * (next ? next.scale : 1)
      const nextParallax = next ? next.parallax : 1
      for (const edge of layer.edgeRocks) {
        const t = edge.s
        const u = 1 - t
        const unit = ownUnit + (nextUnit - ownUnit) * t
        const rx = edge.size * unit
        const py = u * u * u * top + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * bottom
        let px: number
        if (edge.x === null) {
          const x0 = topX + edge.side * topHalf
          const x3 = bottomX + edge.side * bottomHalf
          // Cubic Bezier through the same control points as the ribbon's side.
          const bank = u * u * u * x0 + 3 * u * u * t * x0 + 3 * u * t * t * x3 + t * t * t * x3
          px = bank + edge.side * (rx + edge.out * unit)
        } else {
          px = edge.x - camera.x * (p + (nextParallax - p) * t)
          // A free rock stays out of the water: skip it if the ribbon is under it.
          const xl = u * u * u * (topX - topHalf) + 3 * u * u * t * (topX - topHalf) + 3 * u * t * t * (bottomX - bottomHalf) + t * t * t * (bottomX - bottomHalf)
          const xr = u * u * u * (topX + topHalf) + 3 * u * u * t * (topX + topHalf) + 3 * u * t * t * (bottomX + bottomHalf) + t * t * t * (bottomX + bottomHalf)
          if (px > xl - rx && px < xr + rx) {
            continue
          }
        }
        if (px < -rx - 40 || px > viewWidth + rx + 40) {
          continue
        }
        edge.rock.rx = rx
        edge.rock.ry = rx * 0.7
        edge.rock.x = px
        drawRockSimple(ctx, edge.rock, py)
      }
    }
    blit(strip.props, false)
  }
}

/** Pre-rendered forest layer: horizon, trees, bushes and logs drawn once into a wide bitmap. */
type ForestStrip = {
  canvas: HTMLCanvasElement
  /** The layer's props (rocks, ferns, bushes) on their own bitmap, drawn after the creek's water. */
  props: HTMLCanvasElement
  /** Bitmap pixels per CSS pixel. */
  resolution: number
  /** Y of the layer's base line inside the bitmap. */
  originY: number
  /** Y of the layer's creek waterline relative to its base line (negative is up): where its water ribbon starts. */
  waterLine: number
  /** Lowest ground line of each `GROUND_COLUMN`-wide column relative to the base line: all below it is opaque. */
  columnGround: Float32Array
}

/** Narrowest variation (in a layer's own pixels) kept in a layer's shared base elevation. */
const LAYER_SMOOTH_WIDTH = 700

/** Width (in a layer's own x) of the columns whose lowest ground line is recorded for culling. */
const GROUND_COLUMN = 64

/** Width of the screen slabs the forest layers are blitted in, each with its own cull line. */
const FOREST_SLAB = 64

const forestStrips = new WeakMap<ForestLayer, ForestStrip>()

/**
 * Returns a layer's cached bitmap, building it on first use.
 *
 * The layer's horizon is the foreground terrain flattened with distance and phase-shifted,
 * so each layer's trees, bushes, and logs stand on rolling ground of their own.
 *
 * @param layer - Forest layer.
 * @param world - Play space (terrain source).
 */
function forestStripFor(layer: ForestLayer, world: World): ForestStrip {
  const cached = forestStrips.get(layer)
  if (cached) {
    return cached
  }
  // The layer's elevation is the foreground's coarse elevation and hill scaled horizontally by the
  // layer's parallax factor about the screen center (so features line up with the foreground's the
  // way perspective demands), plus the layer's own fine noise on top.
  const { creek } = layer
  const fgCreek = world.terrain.creek
  const p = layer.parallax
  // Perspective scaling: a feature is scaled by the same factor vertically as horizontally. The
  // shared elevation is squeezed horizontally by the parallax `p`, so its heights are scaled by `p`
  // too (not by something larger, which made far hills steep and inflated). Around the creek the
  // foreground terrain is copied at the creek's own scale (this layer's creek width over the
  // foreground's), both horizontally and vertically.
  const relief = p
  const creekScale = creek.halfWidth / fgCreek.halfWidth
  const refHalf = (world.viewHeight * TYPICAL_ASPECT_RATIO) / 2
  const hill = world.terrain.hill
  // Squeezing the foreground's elevation horizontally by `p` would make far layers' hills far
  // bumpier than the foreground's. So it is low-pass filtered first, with a Gaussian that grows as
  // 1/p, so that no variation narrower than about LAYER_SMOOTH_WIDTH (in the layer's own pixels)
  // survives: the base elevation then changes about as gently as the foreground's does.
  const shared = Float32Array.from(world.terrain.coarse, (lift, i) => lift + hillBump(i * TERRAIN_STEP, hill.x, hill.halfWidth, hill.height))
  const smoothed = lowPass(shared, LAYER_SMOOTH_WIDTH / (p * 2 * Math.PI) / TERRAIN_STEP)
  const baseOffset = (layerX: number): number => {
    const fgX = (layerX - (1 - p) * refHalf) / p
    return -(liftAt(smoothed, fgX) + liftAt(layer.fine, layerX)) * relief
  }
  // Near its creek every layer copies the foreground terrain around the creek (squeezed sideways
  // to the layer's creek width and scaled in height by the same factor), so each layer carves its
  // own channel with banks, a waterline and a dip that correlate from layer to layer. The channel is
  // only carved (it is not colored): the water is the ribbon `drawForest` paints over it.
  const squeeze = fgCreek.halfWidth / creek.halfWidth
  const nearRange = creek.halfWidth * (1 + fgCreek.bank / fgCreek.halfWidth)
  const offset = (layerX: number): number => {
    const own = baseOffset(layerX)
    const distance = Math.abs(layerX - creek.x)
    const weight = creekWeight(distance, nearRange, creek.halfWidth)
    if (weight === 0) {
      return own
    }
    const copied = (groundYAt(world.terrain, fgCreek.x + (layerX - creek.x) * squeeze) - world.groundY) * creekScale
    return own + (copied - own) * weight
  }
  const waterLine = (fgCreek.waterY - world.groundY) * creekScale
  const bedBottom = Math.max(0, (fgCreek.waterY + fgCreek.depth - world.groundY) * creekScale)

  let minGround = world.groundY
  for (const h of world.terrain.heights) {
    minGround = Math.min(minGround, h)
  }
  let treeHeight = 0
  for (const tree of layer.trees) {
    treeHeight = Math.max(treeHeight, -tree.shape.top)
  }
  // Rows higher than about a screen above the base are never visible, so skip them.
  treeHeight = Math.min(treeHeight, world.viewHeight * 1.1)
  const originY = Math.ceil(treeHeight + (world.groundY - minGround) * Math.max(relief, creekScale) + 20)
  const resolution = layer.parallax < 0.4 ? 0.5 : 0.75
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(layer.span * resolution)
  // Extra depth below the horizon so the layer's whole ground can carry leaf litter.
  const litterDepth = Math.round(world.viewHeight * 0.4)
  const bottomPad = 6 + Math.ceil(bedBottom) + litterDepth
  canvas.height = Math.ceil((originY + bottomPad) * resolution)
  const propsCanvas = document.createElement('canvas')
  propsCanvas.width = canvas.width
  propsCanvas.height = canvas.height
  const propsCtx = propsCanvas.getContext('2d')
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(resolution, resolution)
    // Everything stands first and the ground is painted over its base afterwards, so trunks, logs,
    // rocks and bushes sink into slopes instead of ending in flat, floating bases. A trunk reaches
    // down to the lowest ground under it so neither side of its base hangs in the air.
    for (const tree of layer.trees) {
      const trunkHalf = (tree.shape.segments[0]?.w0 ?? 40) / 2
      const lowest = Math.max(offset(tree.x - trunkHalf), offset(tree.x), offset(tree.x + trunkHalf))
      drawOakVector(ctx, tree.shape, tree.x, originY + lowest + 2, layer.tones, layer.trunkColor, 0.02 + layer.parallax * 0.4)
    }
    ctx.fillStyle = layer.trunkColor
    for (const log of layer.logs) {
      // The log lies along the horizon: tilted with its slope and resting on the ground at its
      // middle, so neither end hangs in the air.
      const half = log.length / 2
      const endL = offset(log.x - half)
      const endR = offset(log.x + half)
      const ground = Math.max(endL, offset(log.x - half / 2), offset(log.x), offset(log.x + half / 2), endR)
      ctx.save()
      ctx.translate(log.x, originY + ground - log.radius * 0.8)
      ctx.rotate(Math.atan2(endR - endL, log.length))
      drawFallenLog(ctx, log, layer.trunkColor, layer.fog)
      ctx.restore()
    }
    ctx.fillStyle = layer.groundColor
    ctx.beginPath()
    ctx.moveTo(0, originY + bottomPad)
    for (let x = 0; x <= layer.span + 8; x += 8) {
      ctx.lineTo(x, originY + offset(x))
    }
    ctx.lineTo(layer.span + 8, originY + bottomPad)
    ctx.closePath()
    ctx.fill()
    // Fallen-leaf litter over the whole ground, like the foreground's but with plain ellipses: leaves
    // scattered from the horizon down to the strip's bottom, scaled with the layer, batched by colour.
    const leafUnit = (world.viewHeight / 8) * 2 * layer.scale
    // Near the creek (within about a creek's width of its boundary) details stay above the level of
    // the creek's surface; farther away that limit eases down (over another creek's width) until
    // details can lie all the way down the layer's ground, like the foreground's.
    const bottomEdge = bottomPad - 2
    // On the side the creek comes from (where the next layer back has its creek) the rule reaches two
    // creek widths from the boundary, since the creek sweeps across that side as it comes forward; on
    // the other side it reaches one.
    const fartherLayer = world.forest[world.forest.indexOf(layer) - 1]
    const referenceCamera = fgCreek.x - refHalf
    const comesFrom = fartherLayer
      ? Math.sign(
          fartherLayer.creek.x - fartherLayer.parallax * referenceCamera - (creek.x - p * referenceCamera),
        )
      : 0
    const limitAt = (x: number): number => {
      const side = Math.sign(x - creek.x)
      const reach = (side !== 0 && side === comesFrom ? 5 : 3) * creek.halfWidth
      const t = Math.min(1, Math.max(0, (Math.abs(x - creek.x) - reach) / (2 * creek.halfWidth)))
      return waterLine + (bottomEdge - waterLine) * (t * t * (3 - 2 * t))
    }
    const depthAt = (x: number): number => Math.max(0, limitAt(x) - offset(x))
    let depthSum = 0
    let depthCount = 0
    for (let x = 0; x < layer.span; x += 64) {
      depthSum += depthAt(x)
      depthCount += 1
    }
    const perColumnAt = (x: number): number => (1.5 * (depthAt(x) + 0.1 * leafUnit)) / (0.45 * leafUnit)
    const averagePerColumn = (1.5 * (depthSum / Math.max(1, depthCount) + 0.1 * leafUnit)) / (0.45 * leafUnit)
    // Spread the columns out when the layer is small so one layer never holds more than ~9000 leaves.
    const columnStep = Math.max(7, (layer.span * averagePerColumn) / 9000)
    const batches: number[][] = layer.leafColors.map(() => [])
    for (let x = 0; x < layer.span; x += columnStep) {
      const perColumn = perColumnAt(x)
      const count = Math.floor(perColumn) + (Math.random() < perColumn - Math.floor(perColumn) ? 1 : 0)
      for (let i = 0; i < count; i += 1) {
        const lx = x + (Math.random() * 2 - 1) * columnStep
        if (Math.abs(lx - creek.x) < creek.halfWidth) {
          continue
        }
        const top = offset(lx) + 0.02 * leafUnit
        const lowest = limitAt(lx)
        if (lowest <= top) {
          continue
        }
        const y = top + Math.random() * (lowest - top)
        const nearness = Math.min(1, Math.max(0, (y - top) / Math.max(1, bottomEdge - top)))
        const rx = (0.035 + Math.random() * 0.045) * leafUnit * (1 + 0.5 * nearness)
        batches[Math.floor(Math.random() * batches.length)]?.push(lx, originY + y, rx, rx * (0.35 + Math.random() * 0.2), (Math.random() - 0.5) * Math.PI)
      }
    }
    batches.forEach((batch, colorIndex) => {
      ctx.fillStyle = layer.leafColors[colorIndex] ?? layer.groundColor
      ctx.beginPath()
      for (let i = 0; i < batch.length; i += 5) {
        const lx = batch[i] ?? 0
        const ly = batch[i + 1] ?? 0
        const rx = batch[i + 2] ?? 1
        const angle = batch[i + 4] ?? 0
        ctx.moveTo(lx + rx * Math.cos(angle), ly + rx * Math.sin(angle))
        ctx.ellipse(lx, ly, rx, batch[i + 3] ?? 1, angle, 0, Math.PI * 2)
      }
      ctx.fill()
    })
    // Rocks, ferns and bushes stand anywhere down the layer's ground (not just on its horizon), drawn
    // back to front after the ground and litter; bushes last of equals so they can overhang the creek.
    // How far a prop can drop is capped at the same limit as the litter: the creek's surface level
    // near the creek, easing to the full depth farther away.
    const dropOf = (x: number): number => {
      const v = Math.sin(x * 12.9898) * 43758.5453
      const drop = (v - Math.floor(v)) ** 1.5 * litterDepth * 0.8
      return Math.min(drop, depthAt(x))
    }
    // The props live on their own bitmap (painted after the creek's water in `drawForest`).
    const pc = propsCtx ?? ctx
    pc.scale(resolution, resolution)
    const props: { y: number; draw: (y: number) => void }[] = []
    for (const rock of layer.rocks) {
      props.push({ y: originY + offset(rock.x) + dropOf(rock.x), draw: (y) => paintRock(pc, rock, rock.x, y + rock.ry * 0.4) })
    }
    for (const fern of layer.ferns) {
      props.push({
        y: originY + offset(fern.x) + dropOf(fern.x + 1),
        draw: (y) => {
          pc.save()
          pc.translate(fern.x, y + 2)
          paintFern(pc, fern, layer.tones[1 + (fern.tone % 2)] ?? layer.groundColor, layer.tones[0] ?? layer.trunkColor)
          pc.restore()
        },
      })
    }
    for (const bush of layer.bushes) {
      props.push({
        y: originY + offset(bush.x) + dropOf(bush.x + 2) * 0.6,
        draw: (y) => {
          const rand = seededRandom(Math.floor(bush.x * 13))
          for (const lobe of bush.lobes) {
            drawLeafyDisk(pc, bush.x + lobe.dx, y + lobe.dy, lobe.radius, layer.tones, 1, rand, 0.3, 1)
          }
        },
      })
    }
    props.sort((p, q) => p.y - q.y)
    for (const prop of props) {
      prop.draw(prop.y)
    }
  }
  if (layer.localRadius !== null) {
    // Fade the layer out into the haze away from the creek.
    for (const c of [ctx, propsCtx]) {
      if (!c) {
        continue
      }
      c.globalCompositeOperation = 'destination-in'
      const mask = c.createLinearGradient(creek.x - layer.localRadius, 0, creek.x + layer.localRadius, 0)
      mask.addColorStop(0, 'rgba(0, 0, 0, 0)')
      mask.addColorStop(0.3, 'rgba(0, 0, 0, 1)')
      mask.addColorStop(0.7, 'rgba(0, 0, 0, 1)')
      mask.addColorStop(1, 'rgba(0, 0, 0, 0)')
      c.fillStyle = mask
      c.fillRect(0, 0, layer.span + 8, originY + bottomPad + 10)
      c.globalCompositeOperation = 'source-over'
    }
  }
  const columnGround = new Float32Array(Math.ceil(layer.span / GROUND_COLUMN) + 2).fill(-1e9)
  for (let x = 0; x <= layer.span + GROUND_COLUMN; x += 8) {
    const col = Math.floor(x / GROUND_COLUMN)
    columnGround[col] = Math.max(columnGround[col] ?? -1e9, offset(x))
  }
  // Rasterize the recorded drawing once (see `buildLeafTile`), so blitting the strip stays cheap.
  ctx?.getImageData(0, 0, 1, 1)
  propsCtx?.getImageData(0, 0, 1, 1)
  const strip = { canvas, props: propsCanvas, resolution, originY, waterLine, columnGround }
  forestStrips.set(layer, strip)
  return strip
}

/**
 * Draws the dirt ground as a polygon following the terrain.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawGround(
  ctx: CanvasRenderingContext2D,
  world: World,
  cameraX: number,
  viewWidth: number,
): void {
  const { terrain } = world
  const startX = Math.max(0, Math.floor((cameraX - 16) / terrain.step) * terrain.step)
  // Drawn a little past the world's edge (the ground just continues level), so rounding in the
  // view's size can never leave a sliver of backdrop showing at the rightmost edge.
  const endX = Math.min(world.width + 64, cameraX + viewWidth + 16 + terrain.step)
  // The creek bed can lie below the bottom of the world, so the dirt reaches a little lower.
  const bottom = world.height + world.terrain.creek.depth
  const dirt = ctx.createLinearGradient(0, world.groundY - world.groundHeight * 4, 0, bottom)
  dirt.addColorStop(0, GROUND_COLOR)
  dirt.addColorStop(1, '#4b2f1a')
  ctx.fillStyle = dirt
  ctx.beginPath()
  ctx.moveTo(startX, bottom)
  for (let x = startX; x <= endX; x += terrain.step) {
    ctx.lineTo(x, groundYAt(terrain, x))
  }
  ctx.lineTo(endX, bottom)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#5e3d22'
  ctx.lineWidth = 3
  ctx.beginPath()
  for (let x = startX; x <= endX; x += terrain.step) {
    const y = groundYAt(terrain, x)
    if (x === startX) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

/** Width of a cached leaf-litter tile, in world pixels. */
const LEAF_TILE_WIDTH = 1024

/** Most litter tiles kept per world (the rest are rebuilt when they come into view again). */
const LEAF_TILE_LIMIT = 9

type LeafTile = { canvas: HTMLCanvasElement; res: number }

/** Cached leaf-litter tiles per world, keyed by tile index; a Map keeps least-recently-used order. */
const leafTiles = new WeakMap<World, { top: number; tiles: Map<number, LeafTile> }>()

/**
 * The world's leaf-tile cache, created on first use.
 *
 * @param world - Play space.
 */
function leafTileEntry(world: World): { top: number; tiles: Map<number, LeafTile> } {
  let entry = leafTiles.get(world)
  if (!entry) {
    // The tiles start a little above the highest ground line (leaves can overlap the surface).
    let highest = world.groundY
    for (const h of world.terrain.heights) {
      highest = Math.min(highest, h)
    }
    entry = { top: highest - 60, tiles: new Map() }
    leafTiles.set(world, entry)
  }
  return entry
}

/**
 * Draws the leaf litter covering the whole ground. The thousands of leaves are painted once into
 * tile bitmaps (one path and fill per colour), so each frame only blits the visible rows of the
 * visible tiles instead of drawing leaves.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space (leaves, terrain, size).
 * @param camera - Current camera.
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 */
function drawLeafLitter(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  viewWidth: number,
  viewHeight: number,
): void {
  const { top, tiles } = leafTileEntry(world)
  const res = Math.max(0.1, Math.min(ctx.getTransform().a, 1))
  const height = world.height - top + 12
  const rowFrom = Math.max(camera.y, top)
  const rowTo = Math.min(camera.y + viewHeight, top + height)
  if (rowTo <= rowFrom) {
    return
  }
  const first = Math.max(0, Math.floor(camera.x / LEAF_TILE_WIDTH))
  const last = Math.floor((camera.x + viewWidth) / LEAF_TILE_WIDTH)
  for (let index = first; index <= last; index += 1) {
    let tile = tiles.get(index)
    if (tile && Math.abs(tile.res - res) / res > 0.25) {
      tile = undefined
    }
    if (tile) {
      tiles.delete(index)
    } else {
      tile = buildLeafTile(world.leaves, index, top, height, res)
      if (tiles.size >= LEAF_TILE_LIMIT) {
        const oldest = tiles.keys().next().value
        if (oldest !== undefined) {
          tiles.delete(oldest)
        }
      }
    }
    tiles.set(index, tile)
    ctx.drawImage(
      tile.canvas,
      0,
      (rowFrom - top) * tile.res,
      tile.canvas.width,
      (rowTo - rowFrom) * tile.res,
      index * LEAF_TILE_WIDTH,
      rowFrom,
      LEAF_TILE_WIDTH,
      rowTo - rowFrom,
    )
  }
}

/**
 * Paints one tile of leaf litter into a bitmap, batched by colour.
 *
 * @param leaves - All leaves, sorted by x.
 * @param index - Tile index (tile `i` covers x from `i * LEAF_TILE_WIDTH`).
 * @param top - World y of the tile's top edge.
 * @param height - Tile height in world pixels.
 * @param res - Bitmap pixels per world pixel.
 */
function buildLeafTile(leaves: LeafLitter[], index: number, top: number, height: number, res: number): LeafTile {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(LEAF_TILE_WIDTH * res)
  canvas.height = Math.ceil(height * res)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(res, res)
    ctx.translate(-index * LEAF_TILE_WIDTH, -top)
    // Leaves of the neighbouring tiles that overlap this one's edges are painted too.
    const left = index * LEAF_TILE_WIDTH - 40
    const right = (index + 1) * LEAF_TILE_WIDTH + 40
    let lo = 0
    let hi = leaves.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((leaves[mid]?.x ?? 0) < left) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    const byColor = new Map<string, LeafLitter[]>()
    for (let i = lo; i < leaves.length; i += 1) {
      const leaf = leaves[i]
      if (!leaf || leaf.x > right) {
        break
      }
      const group = byColor.get(leaf.color)
      if (group) {
        group.push(leaf)
      } else {
        byColor.set(leaf.color, [leaf])
      }
    }
    // Fixed colour order so overlapping leaves always stack the same way.
    for (const color of [...byColor.keys()].sort()) {
      ctx.fillStyle = color
      ctx.beginPath()
      for (const leaf of byColor.get(color) ?? []) {
        ctx.moveTo(leaf.x + leaf.rx * Math.cos(leaf.angle), leaf.y + leaf.rx * Math.sin(leaf.angle))
        ctx.ellipse(leaf.x, leaf.y, leaf.rx, leaf.ry, leaf.angle, 0, Math.PI * 2)
      }
      ctx.fill()
    }
  }
  // Force the recorded drawing to be rasterized now; otherwise some browsers replay the thousands of
  // recorded leaf shapes every time the tile is drawn.
  ctx?.getImageData(0, 0, 1, 1)
  return { canvas, res }
}

/** Debug: whether the foreground surface is colored by burial quality (see `drawBurialHeatmap`). */
let showBurialHeatmap = false

/**
 * Switches the burial-quality heatmap debug view on or off.
 *
 * @param on - Whether to show it.
 */
export function setBurialHeatmap(on: boolean): void {
  showBurialHeatmap = on
}

/**
 * Debug view: colors the foreground's surface by burial quality, as if the player were the bird
 * deciding where to bury (red = 0, yellow = 0.5, green = 1), so the effect of other birds and oaks
 * can be seen along the ground.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param player - The bird the quality is judged for.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawBurialHeatmap(
  ctx: CanvasRenderingContext2D,
  world: World,
  player: Player,
  cameraX: number,
  viewWidth: number,
): void {
  const birds = [player, ...[...world.npcs, ...world.squirrels].filter((npc) => !npc.bird.hidden).map((npc) => npc.bird)]
  const step = 16
  const start = Math.floor((cameraX - step) / step) * step
  for (let x = start; x < cameraX + viewWidth + step; x += step) {
    const quality = burialQuality(world, birds, player, x + step / 2)
    const y0 = groundYAt(world.terrain, x)
    const y1 = groundYAt(world.terrain, x + step)
    ctx.fillStyle = `hsla(${Math.round(quality * 120)}, 90%, 48%, 0.8)`
    ctx.beginPath()
    ctx.moveTo(x, y0 - 8)
    ctx.lineTo(x + step + 1, y1 - 8)
    ctx.lineTo(x + step + 1, y1 + 14)
    ctx.lineTo(x, y0 + 14)
    ctx.closePath()
    ctx.fill()
  }
}

/**
 * Draws the dirt mounds over buried acorns, and the leaves hopping birds kicked onto them. Every hop
 * near a mound flattens it a little and fades it toward the ground's color; after three hops it is
 * gone completely (the acorn is still buried there, and can still be dug up).
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Acorns, terrain and kicked leaves.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawMounds(
  ctx: CanvasRenderingContext2D,
  world: World,
  cameraX: number,
  viewWidth: number,
): void {
  for (const acorn of world.acorns) {
    if (acorn.state !== 'buried' || acorn.conceal > 0.985 || acorn.x < cameraX - 40 || acorn.x > cameraX + viewWidth + 40) {
      continue
    }
    const c = acorn.conceal
    // Dark brown (darker than the dirt) when fresh, easing to the ground's own color as it hides.
    ctx.fillStyle = c < 0.004 ? '#472b14' : mixColor('#472b14', GROUND_COLOR, c)
    ctx.beginPath()
    ctx.ellipse(
      acorn.x,
      groundYAt(world.terrain, acorn.x) + acorn.radius * 0.8 * c,
      acorn.radius * 1.8 * (1 - 0.2 * c),
      acorn.radius * 0.8 * (1 - c),
      0,
      Math.PI,
      0,
    )
    ctx.fill()
  }
  // Kicked leaves, in flight or lying on a mound.
  for (const leaf of world.kickedLeaves) {
    if (leaf.x < cameraX - 40 || leaf.x > cameraX + viewWidth + 40) {
      continue
    }
    // A disturbed leaf shrinks, sinks and fades into the ground's color.
    const f = leaf.fade
    ctx.fillStyle = f > 0.01 ? mixColor(leaf.color, GROUND_COLOR, f) : leaf.color
    ctx.beginPath()
    ctx.ellipse(
      leaf.x,
      leaf.y + f * leaf.ry * 1.6,
      leaf.rx * (1 - 0.6 * f),
      leaf.ry * (1 - 0.9 * f),
      leaf.angle + (leaf.landed ? 0 : leaf.vy * 0.003),
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}

/**
 * Draws oak trunks and crowns that overlap the current view.
 *
 * @param ctx - 2D canvas context in world space.
 * @param trees - Generated oaks.
 * @param terrain - Ground heights.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawTrees(
  ctx: CanvasRenderingContext2D,
  trees: OakTree[],
  terrain: Terrain,
  cameraX: number,
  viewWidth: number,
): void {
  const left = cameraX - 8
  const right = cameraX + viewWidth + 8
  for (const tree of trees) {
    const baseX = tree.x + tree.trunkWidth / 2
    if (baseX + tree.shape.halfWidth < left || baseX - tree.shape.halfWidth > right) {
      continue
    }
    drawOak(ctx, tree.shape, baseX, groundYAt(terrain, baseX), OAK_TONES, TRUNK_COLOR)
  }
}

/**
 that overlap the view, partly buried: logs rest on the average ground height
 * under them, rocks sit slightly sunk.
 *
 * Called before the ground so the ground (and leaf litter) covers their lower part.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawBuriedProps(
  ctx: CanvasRenderingContext2D,
  world: World,
  cameraX: number,
  viewWidth: number,
): void {
  const left = cameraX - 600
  const right = cameraX + viewWidth + 600
  // Ferns and bushes stand in the ground, behind the land: the ground polygon is painted over their
  // bases, so a bird on the surface never looks like it is standing on top of a bush.
  for (const fern of world.ferns) {
    if (fern.x > left && fern.x < right && !fernOverhangsWater(world, fern)) {
      drawFern(ctx, fern, groundYAt(world.terrain, fern.x) + 6)
    }
  }
  for (const bush of world.bushes) {
    if (bushOnScreen(bush, cameraX, viewWidth) && !overhangsWater(world, bush)) {
      drawBush(ctx, bush, groundYAt(world.terrain, bush.x) + 14)
    }
  }
  for (const rock of world.rocks) {
    if (rock.x > left && rock.x < right && !isCreekRock(world, rock)) {
      // A big rock sits on the lowest ground under it so no side hangs in the air.
      const reach = rock.rx * 0.7
      drawRock(
        ctx,
        rock,
        Math.max(
          groundYAt(world.terrain, rock.x - reach),
          groundYAt(world.terrain, rock.x),
          groundYAt(world.terrain, rock.x + reach),
        ),
      )
    }
  }
  for (const log of world.logs) {
    if (log.x > left && log.x < right) {
      // The lowest ground under the log, so no part of its underside hangs in the air.
      const under = Math.max(
        groundYAt(world.terrain, log.x - log.length / 2),
        groundYAt(world.terrain, log.x - log.length / 4),
        groundYAt(world.terrain, log.x),
        groundYAt(world.terrain, log.x + log.length / 4),
        groundYAt(world.terrain, log.x + log.length / 2),
      )
      drawLog(ctx, log, under)
    }
  }
}

/**
 * Whether a rock is a shore rock (on the creek's banks): those are drawn in front of the water
 * rather than behind the ground.
 *
 * @param world - Play space.
 * @param rock - Rock to test.
 */
function isCreekRock(world: World, rock: Rock): boolean {
  const { creek } = world.terrain
  return Math.abs(rock.x - creek.x) <= creek.halfWidth + creek.bank
}

/**
 * Draws the creek: opaque water filling the carved channel up to the waterline, with a
 * lighter surface line, then the shore rocks in front of the water. The channel itself is the lowered terrain.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawCreek(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  viewWidth: number,
  viewHeight: number,
): void {
  const cameraX = camera.x
  const { creek, step } = world.terrain
  const left = Math.max(creek.x - creek.halfWidth, cameraX - step)
  const right = Math.min(creek.x + creek.halfWidth, cameraX + viewWidth + step)
  if (Math.abs(creek.x - (cameraX + viewWidth / 2)) > viewWidth / 2 + creek.frontHalfWidth + creek.halfWidth + creek.bank) {
    return
  }
  const water = ctx.createLinearGradient(0, creek.waterY, 0, creek.waterY + creek.depth)
  water.addColorStop(0, '#6aa3c4')
  water.addColorStop(1, '#5f9bbd')
  ctx.fillStyle = water
  ctx.beginPath()
  ctx.moveTo(left, creek.waterY)
  ctx.lineTo(right, creek.waterY)
  for (let x = right; x >= left; x -= step) {
    ctx.lineTo(x, Math.max(creek.waterY, groundYAt(world.terrain, x)))
  }
  ctx.lineTo(left, Math.max(creek.waterY, groundYAt(world.terrain, left)))
  ctx.closePath()
  ctx.fill()

  // The creek flows on toward the viewer (an imaginary layer in front of the foreground): from the
  // water's edges it widens to the bottom of the screen, so the water's top is seen rather than
  // the cross section of the channel.
  const bottom = camera.y + viewHeight + 4
  if (bottom > creek.waterY) {
    const mid = (creek.waterY + bottom) / 2
    const frontX = creek.x + creek.frontOffset
    const front = ctx.createLinearGradient(0, creek.waterY, 0, bottom)
    front.addColorStop(0, '#6aa3c4')
    front.addColorStop(1, '#5f9bbd')
    ctx.fillStyle = front
    ctx.beginPath()
    ctx.moveTo(creek.x - creek.halfWidth, creek.waterY)
    ctx.lineTo(creek.x + creek.halfWidth, creek.waterY)
    ctx.bezierCurveTo(creek.x + creek.halfWidth, mid, frontX + creek.frontHalfWidth, mid, frontX + creek.frontHalfWidth, bottom)
    ctx.lineTo(frontX - creek.frontHalfWidth, bottom)
    ctx.bezierCurveTo(frontX - creek.frontHalfWidth, mid, creek.x - creek.halfWidth, mid, creek.x - creek.halfWidth, creek.waterY)
    ctx.closePath()
    ctx.fill()
  }

  // Shore rocks are always in front of the water. Clipping to the area above the terrain keeps
  // their sunken bases hidden in the ground instead of showing as slabs over the bank.
  const viewLeft = cameraX - 200
  const viewRight = cameraX + viewWidth + 200
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(viewLeft, camera.y - 400)
  for (let x = viewLeft; x <= viewRight; x += step) {
    ctx.lineTo(x, groundYAt(world.terrain, x))
  }
  ctx.lineTo(viewRight, camera.y - 400)
  ctx.closePath()
  ctx.clip()
  for (const rock of world.rocks) {
    if (isCreekRock(world, rock) && rock.x > viewLeft && rock.x < viewRight) {
      drawRock(ctx, rock, groundYAt(world.terrain, rock.x))
    }
  }
  ctx.restore()
}

/**
 * Draws the rocks and bushes standing in front of the foreground's surface line, on top of the
 * foreground layer (and its birds), like the rocks that sit between the background layers.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawFrontProps(
  ctx: CanvasRenderingContext2D,
  world: World,
  cameraX: number,
  viewWidth: number,
): void {
  const left = cameraX - 300
  const right = cameraX + viewWidth + 300
  // Back to front: the lower a prop stands, the nearer it is.
  const items: { y: number; draw: () => void }[] = []
  for (const front of world.frontRocks) {
    if (front.rock.x > left && front.rock.x < right) {
      items.push({ y: front.y, draw: () => drawRock(ctx, front.rock, front.y) })
    }
  }
  for (const front of world.frontBushes) {
    if (bushOnScreen(front.bush, cameraX, viewWidth)) {
      items.push({ y: front.y, draw: () => drawBush(ctx, front.bush, front.y) })
    }
  }
  for (const front of world.frontFerns) {
    if (front.fern.x > left && front.fern.x < right) {
      items.push({ y: front.y, draw: () => drawFern(ctx, front.fern, front.y) })
    }
  }
  // Bushes and ferns reaching over the creek are drawn in front of the water (not cut off by it) but
  // stand far enough down (their whole height below the surface line) that they never overlap what
  // is on the surface: the birds, acorns and kicked leaves.
  for (const bush of world.bushes) {
    if (overhangsWater(world, bush) && bushOnScreen(bush, cameraX, viewWidth)) {
      const y = groundYAt(world.terrain, bush.x) + bushHeight(bush) + 6
      items.push({ y, draw: () => drawBush(ctx, bush, y) })
    }
  }
  for (const fern of world.ferns) {
    if (fernOverhangsWater(world, fern) && fern.x > left && fern.x < right) {
      const y = groundYAt(world.terrain, fern.x) + fern.size * 1.05 + 6
      items.push({ y, draw: () => drawFern(ctx, fern, y) })
    }
  }
  items.sort((p, q) => p.y - q.y)
  for (const item of items) {
    item.draw()
  }
}

/**
 * Draws a bird; one floating on the creek is drawn in two passes, normally above the water's surface
 * and faded below it, so its sunken body looks submerged without any rectangle drawn over the scene.
 *
 * @param ctx - 2D canvas context in world space.
 * @param bird - Bird to draw.
 * @param world - Play space (the creek's surface).
 */
function drawBirdOnWater(ctx: CanvasRenderingContext2D, bird: Player, world: World): void {
  if (bird.invisible) {
    // Debug "turn invisible": drawn at half opacity.
    ctx.save()
    ctx.globalAlpha = 0.5
    drawBirdFloatingOrNot(ctx, bird, world)
    ctx.restore()
    return
  }
  drawBirdFloatingOrNot(ctx, bird, world)
}

/** Squirrel fur colors. */
const SQUIRREL_FUR = '#8c9096'
const SQUIRREL_FUR_DARK = '#686c73'
const SQUIRREL_FUR_LIGHT = '#c4c7cb'
const SQUIRREL_BELLY = '#dcdedf'

/**
 * Draws a squirrel: gray fur, a big bushy tail, a pale belly, small round ears. A standing one hops
 * with a little arch; while sniffing, digging or burying its nose goes to the ground; it sits up to
 * eat; and on its trunk it is turned to climb up or down, clinging to the trunk's side.
 *
 * @param ctx - 2D canvas context in world space.
 * @param bird - The squirrel's body.
 */
function drawSquirrel(ctx: CanvasRenderingContext2D, bird: Player): void {
  const u = bird.size / 100
  const cx = bird.x + bird.size / 2
  const cy = bird.y + bird.size / 2
  const climbing = bird.climbDir !== 0
  const hopping = !climbing && bird.hopT < HOP_DURATION
  const hopP = hopping ? bird.hopT / HOP_DURATION : 0
  const lift = hopping ? Math.sin(Math.PI * hopP) * 12 : 0
  const eating = bird.eatTimer > 0
  // How far the head is down (0 up, 1 nose on the ground).
  let dip = 0
  if (bird.sniff >= 0) {
    dip = 0.85 + 0.15 * Math.sin(bird.sniff * Math.PI * 8)
  } else if (bird.action) {
    const p = bird.action.timer / bird.action.duration
    dip = 0.75 + 0.25 * Math.sin(p * Math.PI * 7)
  }

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(u, u)
  if (climbing) {
    // Clinging to the trunk: head up (climbing up) or down, back away from the trunk.
    ctx.scale(bird.climbSide, 1)
    ctx.rotate(bird.climbDir > 0 ? -Math.PI / 2 : Math.PI / 2)
    ctx.scale(1, bird.climbDir > 0 ? 1 : -1)
    // The animation: legs alternate, body stretches a little.
    ctx.translate(0, 6)
  } else {
    ctx.scale(bird.facing, 1)
    ctx.translate(0, 10 - lift)
    if (eating) {
      // Sits up on its haunches to eat, tail curled behind.
      ctx.translate(-4, -2)
      ctx.rotate(-0.55)
    }
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const step = climbing ? Math.sin(bird.animTime * 14) : bird.walking ? Math.sin(bird.animTime * 14) : 0

  // Bushy tail: a big plume curling up behind and over the back, with fur strokes along it.
  ctx.fillStyle = SQUIRREL_FUR
  ctx.strokeStyle = SQUIRREL_FUR_DARK
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-20, 16)
  ctx.bezierCurveTo(-54, 20, -66, -14, -48, -38)
  ctx.bezierCurveTo(-40, -50, -22, -52, -16, -42)
  ctx.bezierCurveTo(-26, -34, -22, -14, -12, -2)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = SQUIRREL_FUR_LIGHT
  ctx.lineWidth = 1.6
  for (const [x0, y0, x1, y1] of [
    [-24, 10, -52, 2],
    [-26, 4, -56, -14],
    [-26, -6, -50, -30],
    [-24, -16, -40, -42],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo((x0 + x1) / 2 - 4, (y0 + y1) / 2 - 2, x1, y1)
    ctx.stroke()
  }

  // Hind leg and haunch.
  ctx.fillStyle = SQUIRREL_FUR_DARK
  ctx.beginPath()
  ctx.ellipse(-14, 22, 14, 13, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = SQUIRREL_FUR_DARK
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(-14, 28)
  ctx.lineTo(-14 + 6 * step, 38)
  ctx.lineTo(-4 + 6 * step, 40)
  ctx.stroke()

  // Body.
  ctx.fillStyle = SQUIRREL_FUR
  ctx.beginPath()
  ctx.ellipse(2, 16, 28, 16, -0.06, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = SQUIRREL_BELLY
  ctx.beginPath()
  ctx.ellipse(8, 25, 17, 7, 0, 0, Math.PI)
  ctx.fill()

  // Front leg.
  ctx.strokeStyle = SQUIRREL_FUR_DARK
  ctx.lineWidth = 4.5
  ctx.beginPath()
  ctx.moveTo(20, 24)
  ctx.lineTo(22 - 6 * step, 36)
  ctx.lineTo(28 - 6 * step, 39)
  ctx.stroke()

  // Head: dips toward the ground about the neck.
  ctx.save()
  ctx.translate(-2 * dip, 28 * dip)
  ctx.translate(40, 6)
  ctx.rotate(0.6 * dip)
  ctx.translate(-40, -6)
  // Far ear, head, near ear.
  ctx.fillStyle = SQUIRREL_FUR_DARK
  ctx.beginPath()
  ctx.ellipse(27, -8, 4, 7, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = SQUIRREL_FUR
  ctx.beginPath()
  ctx.ellipse(30, 4, 14, 12, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = SQUIRREL_BELLY
  ctx.beginPath()
  ctx.ellipse(38, 9, 8, 5.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = SQUIRREL_FUR_DARK
  ctx.beginPath()
  ctx.ellipse(21, -7, 4.2, 7.4, 0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3b2c2c'
  ctx.beginPath()
  ctx.arc(44.5, 7, 2.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#16181b'
  ctx.beginPath()
  ctx.arc(33, 1, 2.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(33.7, 0.4, 0.7, 0, Math.PI * 2)
  ctx.fill()
  if (bird.held) {
    // The acorn held in the mouth.
    drawAcornShape(ctx, 43, 12, (bird.held.radius / u) * (1 - (eating ? (1 - bird.eatTimer / EAT_DURATION) * 0.85 : 0)), -Math.PI / 2)
  }
  ctx.restore()
  ctx.restore()
}

/**
 * Draws a bird normally, or in the two clipped passes for a floating one (see `drawBirdOnWater`).
 *
 * @param ctx - 2D canvas context in world space.
 * @param bird - Bird to draw.
 * @param world - Play space.
 */
function drawBirdFloatingOrNot(ctx: CanvasRenderingContext2D, bird: Player, world: World): void {
  if (!bird.floating) {
    drawBird(ctx, bird)
    return
  }
  const surface = world.terrain.creek.waterY
  const left = bird.x - bird.size
  const width = bird.size * 3
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, surface - bird.size * 3, width, bird.size * 3)
  ctx.clip()
  drawBird(ctx, bird)
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, surface, width, bird.size * 2)
  ctx.clip()
  ctx.globalAlpha = 0.4
  drawBird(ctx, bird)
  ctx.restore()
}

const bushExtents = new WeakMap<Bush, number>()

/**
 * Whether any part of a bush can be on screen: tests its whole width (the reach of its lobes), not
 * just its center, so a wide bush never pops in at the screen edge.
 *
 * @param bush - Bush to test.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function bushOnScreen(bush: Bush, cameraX: number, viewWidth: number): boolean {
  const extent = bushExtent(bush)
  return bush.x + extent > cameraX && bush.x - extent < cameraX + viewWidth
}

/**
 * How far a bush's lobes reach sideways from its center (cached).
 *
 * @param bush - Bush to measure.
 */
function bushExtent(bush: Bush): number {
  let extent = bushExtents.get(bush)
  if (extent === undefined) {
    extent = 0
    for (const lobe of bush.lobes) {
      extent = Math.max(extent, Math.abs(lobe.dx) + lobe.radius)
    }
    extent += 8
    bushExtents.set(bush, extent)
  }
  return extent
}

/**
 * How tall a bush is above its base (the top of its highest lobe), cached.
 *
 * @param bush - Bush to measure.
 */
function bushHeight(bush: Bush): number {
  let height = bushHeights.get(bush)
  if (height === undefined) {
    height = 0
    for (const lobe of bush.lobes) {
      height = Math.max(height, -lobe.dy + lobe.radius)
    }
    bushHeights.set(bush, height)
  }
  return height
}

const bushHeights = new WeakMap<Bush, number>()

/**
 * Whether a bush reaches over the creek's water. Those are drawn after the water (in front of it,
 * not cut off by it) so their branches overhang it with a bushy underside, not a flat waterline.
 *
 * @param world - Play space.
 * @param bush - Bush to test.
 */
function overhangsWater(world: World, bush: Bush): boolean {
  const { creek } = world.terrain
  return Math.abs(bush.x - creek.x) < creek.halfWidth + bushExtent(bush)
}

/**
 * Whether a fern's fronds reach over the creek's water (drawn after the water like such bushes).
 *
 * @param world - Play space.
 * @param fern - Fern to test.
 */
function fernOverhangsWater(world: World, fern: Fern): boolean {
  const { creek } = world.terrain
  return Math.abs(fern.x - creek.x) < creek.halfWidth + fern.size * 1.25
}

/**
 * Draws a bush as overlapping green lobes with soft highlights.
 *
 * @param ctx - 2D canvas context in world space.
 * @param bush - Bush to draw.
 * @param groundY - Ground Y at the bush.
 */
function drawBush(ctx: CanvasRenderingContext2D, bush: Bush, groundY: number): void {
  const res = ctx.getTransform().a
  let sprite = bushSprites.get(bush)
  if (!sprite || Math.abs(sprite.res - res) / res > 0.2) {
    sprite = buildBushSprite(bush, res)
    bushSprites.set(bush, sprite)
  }
  ctx.drawImage(sprite.canvas, bush.x + sprite.offsetX, groundY + sprite.offsetY, sprite.width, sprite.height)
}

/** A bush drawn once into a bitmap, since its many leaves are expensive to draw every frame. */
type BushSprite = {
  canvas: HTMLCanvasElement
  res: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

const bushSprites = new WeakMap<Bush, BushSprite>()

/**
 * Renders a bush's lobes into a bitmap positioned relative to its base point.
 *
 * @param bush - Bush to render.
 * @param res - Bitmap pixels per world pixel (capped so a bush stays a few megapixels at most).
 */
function buildBushSprite(bush: Bush, res: number): BushSprite {
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0
  for (const lobe of bush.lobes) {
    minX = Math.min(minX, lobe.dx - lobe.radius)
    maxX = Math.max(maxX, lobe.dx + lobe.radius)
    minY = Math.min(minY, lobe.dy - lobe.radius)
    maxY = Math.max(maxY, lobe.dy + lobe.radius)
  }
  const pad = 6
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 2
  const scale = Math.min(res, Math.sqrt(3_000_000 / Math.max(1, width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(scale, scale)
    ctx.translate(-(minX - pad), -(minY - pad))
    const rand = seededRandom(Math.floor(bush.x * 13))
    for (const lobe of bush.lobes) {
      drawLeafyDisk(ctx, lobe.dx, lobe.dy, lobe.radius, shadeRamp(lobe.color), 2, rand, 0.9, 1)
    }
  }
  return { canvas, res, offsetX: minX - pad, offsetY: minY - pad, width, height }
}

/** Leaf colors for the foreground ferns: dark glossy greens. */
const FERN_TONES = ['#2f7a3a', '#3a8c40', '#27693a']

/**
 * Paints a fern with its base at the origin, after the Christmas fern: a crown of long, narrow
 * fronds that arch outward, each a short bare stalk, then a lance-shaped blade made of many short
 * pointed leaflets (pinnae) in alternating pairs angled toward the tip, longest near the lower
 * third and shrinking to the tip, along a darker midrib.
 *
 * @param ctx - 2D canvas context.
 * @param fern - Fern to paint.
 * @param leaf - Leaflet color.
 * @param stem - Stalk and midrib color.
 */
function paintFern(ctx: CanvasRenderingContext2D, fern: Fern, leaf: string, stem: string): void {
  ctx.lineCap = 'round'
  // Draw the outer (lower, leaning) fronds first so the central ones overlap them.
  const fronds = [...fern.fronds].sort((p, q) => Math.abs(q.angle) - Math.abs(p.angle))
  for (const frond of fronds) {
    // Every frond is painted from its own point on the ground (the crown is hidden below it).
    ctx.save()
    ctx.translate(frond.base * fern.size, fern.size * 0.1)
    const length = fern.size * frond.length
    const dirX = Math.sin(frond.angle)
    const dirY = -Math.cos(frond.angle)
    const side = frond.angle >= 0 ? 1 : -1
    const cx = dirX * length * 0.55
    const cy = dirY * length * 0.55
    const droop = length * 0.17 * frond.bend
    const ex = dirX * length + side * droop * 0.5
    const ey = dirY * length * 0.92 + droop * 0.45
    const at = (t: number): [number, number] => {
      const u = 1 - t
      return [2 * u * t * cx + t * t * ex, 2 * u * t * cy + t * t * ey]
    }
    const direction = (t: number): number => {
      const u = 1 - t
      return Math.atan2(2 * u * cy + 2 * t * (ey - cy), 2 * u * cx + 2 * t * (ex - cx))
    }
    // Stalk, then the midrib of the blade.
    ctx.strokeStyle = stem
    ctx.lineWidth = Math.max(1, fern.size * 0.028)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(cx, cy, ex, ey)
    ctx.stroke()
    // Leaflets: pointed, narrow, angled about 60 degrees toward the tip, alternating sides.
    const pairs = 15
    ctx.fillStyle = leaf
    ctx.beginPath()
    for (let i = 0; i < pairs; i += 1) {
      const t = 0.16 + (0.82 * i) / (pairs - 1)
      const along = (t - 0.16) / 0.82
      // Longest near the lower third, tapering to a short tip.
      const profile = along < 0.25 ? 0.65 + 1.4 * along : 1 - 0.78 * ((along - 0.25) / 0.75) ** 1.1
      const leaflet = length * 0.25 * profile
      const [px, py] = at(t)
      const heading = direction(t)
      for (const sgn of [-1, 1]) {
        // Alternate: the two sides sit at slightly different spots along the midrib.
        const [qx, qy] = at(Math.min(0.99, t + (sgn > 0 ? 0.012 : 0)))
        const angle = heading + sgn * 1.0
        const mx = qx + Math.cos(angle) * leaflet * 0.5
        const my = qy + Math.sin(angle) * leaflet * 0.5
        ctx.moveTo(mx + Math.cos(angle) * leaflet * 0.5, my + Math.sin(angle) * leaflet * 0.5)
        ctx.ellipse(mx, my, leaflet * 0.5, leaflet * 0.13, angle, 0, Math.PI * 2)
      }
      void px
      void py
    }
    ctx.fill()
    // Pointed tip of the blade.
    const [tx, ty] = at(1)
    const tip = direction(1)
    ctx.beginPath()
    ctx.ellipse(tx - Math.cos(tip) * length * 0.04, ty - Math.sin(tip) * length * 0.04, length * 0.06, length * 0.025, tip, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** A foreground fern drawn once into a bitmap. */
type FernSprite = { canvas: HTMLCanvasElement; res: number; offsetX: number; offsetY: number; width: number; height: number }

const fernSprites = new WeakMap<Fern, FernSprite>()

/**
 * Draws a foreground fern (from a cached bitmap) with its base at (fern.x, groundY).
 *
 * @param ctx - 2D canvas context in world space.
 * @param fern - Fern to draw.
 * @param groundY - Ground Y at the fern.
 */
function drawFern(ctx: CanvasRenderingContext2D, fern: Fern, groundY: number): void {
  const res = ctx.getTransform().a
  let sprite = fernSprites.get(fern)
  if (!sprite || Math.abs(sprite.res - res) / res > 0.2) {
    const reachX = fern.size * 1.25
    const width = reachX * 2 + 8
    const below = fern.size * 0.55
    const height = fern.size * 1.2 + below + 10
    const scale = Math.min(res, Math.sqrt(2_000_000 / (width * height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width * scale))
    canvas.height = Math.max(1, Math.ceil(height * scale))
    const sctx = canvas.getContext('2d')
    if (sctx) {
      sctx.scale(scale, scale)
      sctx.translate(width / 2, height - below - 4)
      paintFern(sctx, fern, FERN_TONES[fern.tone] ?? '#3f8f3b', '#2a5a2a')
    }
    sprite = { canvas, res, offsetX: -width / 2, offsetY: -(height - below - 4), width, height }
    fernSprites.set(fern, sprite)
  }
  ctx.drawImage(sprite.canvas, fern.x + sprite.offsetX, groundY + sprite.offsetY, sprite.width, sprite.height)
}

/**
 * Four tones of a `#rrggbb` color from dark to light.
 *
 * @param hex - Base color.
 */
function shadeRamp(hex: string): string[] {
  const channel = (i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return [0.62, 0.8, 1, 1.25].map((f) => {
    const parts = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(channel(i) * f))))
    return `rgb(${parts.join(',')})`
  })
}

/**
 * Draws a fallen log rotated to the ground slope, with end-grain rings.
 *
 * @param ctx - 2D canvas context in world space.
 * @param log - Log to draw.
 * @param groundY - Ground Y at the log center.
 */
function drawLog(ctx: CanvasRenderingContext2D, log: Log, groundY: number): void {
  ctx.save()
  // Sunk a little into the ground: the ground polygon is drawn over the lower part.
  ctx.translate(log.x, groundY - log.radius * 0.8)
  ctx.rotate(log.tilt)
  drawFallenLog(ctx, log, TRUNK_COLOR)
  ctx.restore()
}

/**
 * Draws a fallen tree trunk centered on the origin along x: flared and buttressed at the root end,
 * tapering to a narrow rounded tip at the other (no squared-off ends), with lengthwise bark lines,
 * a lit top edge and, on some, moss along the top. Details are translucent overlays so it works in
 * hazy background layers too.
 *
 * @param ctx - 2D canvas context (origin at the log's center, x along the log).
 * @param log - Log to draw (length, radius, which end is the root end, moss).
 * @param color - Bark color.
 */
function drawFallenLog(ctx: CanvasRenderingContext2D, log: Log, color: string, fog = 0): void {
  const { length: len, radius: r } = log
  const x0 = -len / 2
  // Half thickness at t along the log: a root flare near the butt, then a long taper.
  const half = (t: number): number => r * (1.05 + 0.55 * Math.max(0, 1 - t / 0.16) ** 2 - 0.68 * t)
  // The log lies on its underside: the bottom edge is a straight line (y = r) all along, so
  // tapering never leaves a gap between the narrow end and the ground; the top edge follows the taper.
  const bottom = r
  const topAt = (t: number): number => bottom - 2 * half(t)
  const midAt = (t: number): number => bottom - half(t)
  const steps = 16
  ctx.save()
  ctx.scale(log.flip, 1)
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    ctx.lineTo(x0 + t * len, topAt(t))
  }
  // Rounded tip.
  ctx.quadraticCurveTo(x0 + len + r * 0.3, midAt(1), x0 + len, bottom)
  ctx.lineTo(x0, bottom)
  // Rounded (not flat) root end.
  ctx.quadraticCurveTo(x0 - r * 0.45, midAt(0), x0, topAt(0))
  ctx.closePath()
  ctx.fill()
  ctx.save()
  ctx.clip()
  // Ridged bark along the log, like the trees' (clipped to the log's outline).
  paintBark(
    ctx,
    (t, f) => [x0 + (0.03 + 0.94 * t) * len, midAt(0.03 + 0.94 * t) + f * half(0.03 + 0.94 * t)],
    Math.max(6, Math.round(len / (r * 1.3))),
    Math.max(2, Math.min(5, Math.round((r * 2) / 30))),
    Math.max(1, r * 0.075),
    seededRandom(Math.floor(len * 13 + r * 7)),
  )
  ctx.fillStyle = 'rgba(255, 255, 255, 0.13)'
  ctx.beginPath()
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    ctx.lineTo(x0 + t * len, topAt(t))
  }
  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps
    ctx.lineTo(x0 + t * len, topAt(t) + half(t) * 0.38)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  if (log.moss) {
    // A soft cushion of moss along the upper side, thicker toward the root end, overhanging the outline.
    const spots: [number, number, number][] = []
    for (let i = 0; i < 70; i += 1) {
      const t = 0.03 + 0.8 * ((i * 0.6180339) % 1) ** 1.2
      const size = r * (0.09 + 0.1 * ((i * 0.7548776) % 1)) * (1.15 - t * 0.5)
      const lift = ((i * 0.5698403) % 1) * 0.45
      spots.push([x0 + t * len, topAt(t) + half(t) * lift * 1.1 + size * 0.2, size])
    }
    spots.sort((a, b) => a[1] - b[1])
    paintMoss(ctx, spots, fog)
  }
  ctx.restore()
}

/** Moss greens from shadow to highlight. */
const MOSS_TONES = ['#2e4a1f', '#4a7a2a', '#6f9f38', '#9bc75a']

/**
 * A color blended toward the haze (a no-op in the foreground).
 *
 * @param color - Base color.
 * @param fog - Share of haze, 0 for none.
 */
function hazy(color: string, fog: number): string {
  return fog > 0 ? mixColor(color, FOREST_HAZE_COLOR, fog) : color
}

/**
 * Paints moss from many small overlapping circles, in four batched passes (shadow, body, light on
 * every other one, highlight on a few, the lighter ones nudged up and left where the light comes
 * from), so it reads as one soft, lumpy cushion rather than separate balls.
 *
 * @param ctx - 2D canvas context.
 * @param spots - Circles as [x, y, radius].
 * @param fog - Haze blended into the colors.
 */
function paintMoss(ctx: CanvasRenderingContext2D, spots: [number, number, number][], fog: number): void {
  const noise = (seed: number, k: number): number => {
    const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
    return v - Math.floor(v)
  }
  // An irregular, slightly flattened blob: a few points at uneven radii joined by smooth curves.
  const blob = (x: number, y: number, r: number, seed: number): void => {
    const n = 7
    const pts: [number, number][] = []
    for (let k = 0; k < n; k += 1) {
      const angle = ((k + (noise(seed, k + 10) - 0.5) * 0.7) / n) * Math.PI * 2
      const radius = r * (0.6 + 0.6 * noise(seed, k))
      pts.push([x + Math.cos(angle) * radius * 1.3, y + Math.sin(angle) * radius * 0.85])
    }
    const first = pts[0] ?? [x, y]
    const last = pts[n - 1] ?? first
    ctx.moveTo((first[0] + last[0]) / 2, (first[1] + last[1]) / 2)
    for (let k = 0; k < n; k += 1) {
      const p = pts[k] ?? first
      const q = pts[(k + 1) % n] ?? first
      ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
    }
  }
  const pass = (tone: number, pick: (i: number) => boolean, dx: number, dy: number, scale: number): void => {
    ctx.fillStyle = hazy(MOSS_TONES[tone] ?? '#4a7a2a', fog)
    ctx.beginPath()
    spots.forEach(([x, y, r], i) => {
      if (pick(i)) {
        blob(x + dx * r, y + dy * r, r * scale, i + tone * 0.37)
      }
    })
    ctx.fill()
  }
  pass(0, () => true, 0, 0.3, 1.1)
  pass(1, () => true, 0, 0, 1)
  pass(2, (i) => i % 2 === 0, -0.22, -0.28, 0.7)
  pass(3, (i) => i % 5 === 0, -0.38, -0.42, 0.38)
  // A fuzz of fine tips standing up from the moss.
  ctx.strokeStyle = hazy(MOSS_TONES[3] ?? '#9bc75a', fog)
  ctx.lineCap = 'round'
  ctx.beginPath()
  spots.forEach(([x, y, r], i) => {
    if (i % 3 === 0) {
      const sx = x + (noise(i, 3) - 0.5) * r
      ctx.lineWidth = Math.max(1, r * 0.12)
      ctx.moveTo(sx, y - r * 0.2)
      ctx.lineTo(sx + (noise(i, 5) - 0.5) * r * 1.2, y - r * (0.7 + 0.5 * noise(i, 7)))
    }
  })
  ctx.stroke()
}

/**
 * Paints a boulder with its base at (cx, baseY): a blocky, irregular outline (a squared ellipse with
 * smooth bumps), light from the upper left (gradient and two flat planes), cracks, pale lichen
 * blotches and dark speckles, and for mossy rocks a thick blanket of moss clumps over the top and
 * upper left that overhangs the outline a little. A few fallen leaves lie over the base.
 *
 * @param ctx - 2D canvas context.
 * @param rock - Rock to paint (its own x is ignored).
 * @param cx - Center x.
 * @param baseY - Y of the rock's base line.
 */
function paintRock(ctx: CanvasRenderingContext2D, rock: Rock, cx: number, baseY: number): void {
  const { rx, ry, fog } = rock
  const rng = seededRandom(Math.floor(rock.jitter.reduce((a, b) => a + b, 0) * 10000))
  const phase = [rng() * 6.28, rng() * 6.28, rng() * 6.28] as const
  const points = 64
  const outline: [number, number][] = []
  // The top is a squared ellipse (blocky boulder); the underside is a shallow, rounded curve, so
  // the rock looks nestled into the ground and litter rather than sitting on a flat base.
  const edge = (theta: number, bump: number): [number, number] => {
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    if (s > 0) {
      return [cx + rx * bump * Math.sign(c) * Math.abs(c) ** 0.9, baseY + ry * 0.4 * bump * s]
    }
    return [
      cx + rx * bump * Math.sign(c) * Math.abs(c) ** 0.77,
      baseY + ry * bump * Math.sign(s) * Math.abs(s) ** 0.77,
    ]
  }
  for (let i = 0; i < points; i += 1) {
    const theta = Math.PI + (2 * Math.PI * i) / points
    const bump = 1 + 0.07 * Math.sin(3 * theta + phase[0]) + 0.05 * Math.sin(5 * theta + phase[1]) + 0.035 * Math.sin(9 * theta + phase[2])
    outline.push(edge(theta, bump))
  }
  const trace = (): void => {
    ctx.beginPath()
    outline.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
  }
  ctx.fillStyle = rock.color
  trace()
  ctx.fill()

  ctx.save()
  trace()
  ctx.clip()
  // Light from the upper left: bright top-left fading to a dark lower right.
  const shade = ctx.createLinearGradient(cx - rx, baseY - ry * 1.1, cx + rx * 0.9, baseY + ry * 0.5)
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.3)')
  shade.addColorStop(0.5, 'rgba(255, 255, 255, 0)')
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.4)')
  ctx.fillStyle = shade
  ctx.fillRect(cx - rx * 1.3, baseY - ry * 1.3, rx * 2.6, ry * 2.2)
  // Two flat planes: one in shadow on the right, one catching light on the upper left.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
  ctx.beginPath()
  ctx.moveTo(cx + rx * 0.2, baseY - ry * 1.2)
  ctx.lineTo(cx + rx * 0.6, baseY - ry * 0.3)
  ctx.lineTo(cx + rx * 0.4, baseY + ry * 0.6)
  ctx.lineTo(cx + rx * 1.3, baseY + ry * 0.6)
  ctx.lineTo(cx + rx * 1.3, baseY - ry * 1.2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.beginPath()
  ctx.moveTo(cx - rx * 1.3, baseY - ry * 1.2)
  ctx.lineTo(cx - rx * 0.1, baseY - ry * 1.2)
  ctx.lineTo(cx - rx * 0.5, baseY - ry * 0.4)
  ctx.lineTo(cx - rx * 1.3, baseY - ry * 0.1)
  ctx.closePath()
  ctx.fill()
  // Cracks climbing from the base.
  ctx.strokeStyle = 'rgba(15, 15, 15, 0.4)'
  ctx.lineWidth = Math.max(1, rx * 0.012)
  ctx.lineCap = 'round'
  for (let c = 0; c < 3; c += 1) {
    let x = cx + (rng() - 0.5) * rx * 1.3
    let y = baseY + ry * 0.3
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let step = 0; step < 5; step += 1) {
      x += (rng() - 0.5) * rx * 0.18
      y -= ry * (0.12 + rng() * 0.14)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // Pale lichen blotches.
  for (let k = 0; k < 7; k += 1) {
    ctx.fillStyle = k % 2 === 0 ? 'rgba(205, 200, 160, 0.3)' : 'rgba(120, 135, 95, 0.28)'
    ctx.beginPath()
    ctx.ellipse(
      cx + (rng() - 0.5) * rx * 1.5,
      baseY - ry * (0.1 + rng() * 0.8),
      rx * (0.04 + rng() * 0.09),
      rx * (0.03 + rng() * 0.06),
      rng() * 3,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  // Dark speckles.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
  ctx.beginPath()
  const speckles = Math.min(45, Math.round(rx / 2))
  for (let k = 0; k < speckles; k += 1) {
    const sx = cx + (rng() - 0.5) * rx * 1.8
    const sy = baseY - ry * rng() * 1.1
    const sr = 0.6 + rng() * Math.min(2, rx * 0.01)
    ctx.moveTo(sx + sr, sy)
    ctx.arc(sx, sy, sr, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.restore()

  if (rock.moss) {
    // A continuous blanket over the top and upper left (thick on top, thinning toward the sides and
    // reaching further down the left), then small lumps along and inside its lower edge and over
    // its outline, so it reads as soft cushioned moss rather than separate dots.
    const mossPhase = rng() * 6.28
    const thickness = (theta: number): number => {
      const top = 1 - Math.abs(theta - 1.5 * Math.PI) / (0.55 * Math.PI)
      return Math.max(0.08, (0.3 + 0.18 * Math.sin(2.7 * theta + mossPhase)) * Math.max(0.25, top) + 0.1 * Math.max(0, Math.cos(theta - 1.2 * Math.PI)))
    }
    const from = Math.PI * 1.04
    const to = Math.PI * 1.97
    const steps = 36
    const toward = (theta: number, d: number): [number, number] => {
      const [ex, ey] = edge(theta, 1)
      return [ex + (cx - ex) * d, ey + (baseY + ry * 0.1 - ey) * d]
    }
    ctx.fillStyle = hazy(MOSS_TONES[1] ?? '#4a7a2a', fog)
    ctx.beginPath()
    for (let i = 0; i <= steps; i += 1) {
      const theta = from + ((to - from) * i) / steps
      const [x, y] = edge(theta, 1)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    for (let i = steps; i >= 0; i -= 1) {
      const theta = from + ((to - from) * i) / steps
      const [x, y] = toward(theta, thickness(theta))
      ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
    const count = Math.round(rx * 1.1 + 60)
    const spots: [number, number, number][] = []
    for (let k = 0; k < count; k += 1) {
      const theta = from + (to - from) * rng() ** 1.1
      const [x, y] = toward(theta, thickness(theta) * (0.25 + 1.0 * rng()))
      spots.push([x, y, rx * (0.025 + rng() * 0.04)])
    }
    spots.sort((p, q) => p[1] - q[1])
    paintMoss(ctx, spots, fog)
  }

  if (rock.rx >= 7) {
    // A few fallen leaves over the base, as if the rock were settled into the litter.
    rock.litter.forEach((color, k) => {
      const spread = ((rock.jitter[k] ?? 1) - 0.96) / 0.12
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.ellipse(cx + spread * rx * 0.9, baseY + ry * (0.14 + 0.1 * Math.abs(spread)), rx * 0.2, rx * 0.08, spread * 0.8, 0, Math.PI * 2)
      ctx.fill()
    })
  }
}

type RockSprite = { canvas: HTMLCanvasElement; res: number; offsetX: number; offsetY: number; width: number; height: number }

const rockSprites = new WeakMap<Rock, RockSprite>()

/**
 * Draws a rock from a cached bitmap of its detailed painting, with its base at `groundY` plus a
 * little sink (the ground polygon drawn afterwards hides the lowest part).
 *
 * @param ctx - 2D canvas context in world space.
 * @param rock - Rock to draw.
 * @param groundY - Ground Y at the rock.
 */
function drawRock(ctx: CanvasRenderingContext2D, rock: Rock, groundY: number): void {
  const res = ctx.getTransform().a
  let sprite = rockSprites.get(rock)
  if (!sprite || Math.abs(sprite.res - res) / res > 0.2) {
    const pad = rock.rx * 0.2 + 8
    const width = rock.rx * 2.5 + pad * 2
    const above = rock.ry * 1.5 + pad
    const height = above + rock.ry * 0.55 + pad
    const scale = Math.min(res, Math.sqrt(4_000_000 / (width * height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width * scale))
    canvas.height = Math.max(1, Math.ceil(height * scale))
    const sctx = canvas.getContext('2d')
    if (sctx) {
      sctx.scale(scale, scale)
      sctx.translate(width / 2, above)
      paintRock(sctx, rock, 0, 0)
    }
    sprite = { canvas, res, offsetX: -width / 2, offsetY: -above, width, height }
    rockSprites.set(rock, sprite)
  }
  ctx.drawImage(sprite.canvas, rock.x + sprite.offsetX, groundY + rock.ry * 0.4 + sprite.offsetY, sprite.width, sprite.height)
}

/**
 * Draws a rock as a jittered half-ellipse polygon with a highlight (cheap version, redrawn every
 * frame for the small hazy rocks between background layers).
 *
 * @param ctx - 2D canvas context in world space.
 * @param rock - Rock to draw.
 * @param groundY - Ground Y at the rock.
 */
function drawRockSimple(ctx: CanvasRenderingContext2D, rock: Rock, groundY: number): void {
  const n = rock.jitter.length
  const baseY = groundY + rock.ry * 0.4
  ctx.fillStyle = rock.color
  ctx.beginPath()
  // The outline runs a little past the horizontal at both ends, so the bottom is subtly rounded.
  const sweep = Math.PI + 0.7
  rock.jitter.forEach((j, i) => {
    const angle = Math.PI - 0.35 + (sweep * i) / (n - 1)
    const px = rock.x + Math.cos(angle) * rock.rx * j
    const py = baseY + Math.sin(angle) * rock.ry * j
    if (i === 0) {
      ctx.moveTo(px, py)
    } else {
      ctx.lineTo(px, py)
    }
  })
  ctx.closePath()
  ctx.fill()
  if (rock.moss) {
    // Moss in soft patches on the upper side of the rock, clipped to its outline.
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(92, 140, 56, 0.78)'
    ctx.beginPath()
    for (const [a, f, s] of [[0.2, 0.86, 0.3], [0.38, 0.9, 0.36], [0.55, 0.88, 0.28], [0.74, 0.84, 0.24]] as const) {
      const angle = Math.PI + Math.PI * a
      const mx = rock.x + Math.cos(angle) * rock.rx * f
      const my = baseY + Math.sin(angle) * rock.ry * f
      ctx.moveTo(mx + rock.rx * s, my)
      ctx.ellipse(mx, my, rock.rx * s, rock.ry * s * 0.8, angle * 0.3, 0, Math.PI * 2)
    }
    ctx.fill()
    ctx.restore()
  }
  ctx.fillStyle = rock.highlight
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.ellipse(rock.x - rock.rx * 0.28, baseY - rock.ry * 0.55, rock.rx * 0.3, rock.ry * 0.2, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  // A few fallen leaves over the base, as if the rock were settled into the litter.
  if (rock.rx < 7) {
    return
  }
  rock.litter.forEach((color, k) => {
    const spread = ((rock.jitter[k] ?? 1) - 0.96) / 0.12
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(
      rock.x + spread * rock.rx * 0.9,
      baseY + rock.ry * 0.05,
      rock.rx * 0.2,
      rock.rx * 0.08,
      spread * 0.8,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  })
}

/**
 * Draws one acorn: a tan pointed nut with a highlight, a dark textured cap, and a small stem.
 *
 * Sized so the nut and cap fit roughly within `radius` of the center.
 *
 * @param ctx - 2D canvas context.
 * @param x - Center X.
 * @param y - Center Y.
 * @param radius - Overall radius.
 * @param angle - Rotation in radians (0 stands upright, cap on top).
 */
function drawAcornShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  angle = 0,
): void {
  const r = radius
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)

  // Nut
  const nut = ctx.createLinearGradient(-0.8 * r, 0, 0.8 * r, 0)
  nut.addColorStop(0, '#b87a35')
  nut.addColorStop(0.45, '#dba656')
  nut.addColorStop(1, '#94601f')
  ctx.fillStyle = nut
  ctx.beginPath()
  ctx.moveTo(-0.78 * r, -0.15 * r)
  ctx.bezierCurveTo(-0.88 * r, 0.45 * r, -0.35 * r, 0.92 * r, 0, r)
  ctx.bezierCurveTo(0.35 * r, 0.92 * r, 0.88 * r, 0.45 * r, 0.78 * r, -0.15 * r)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 238, 195, 0.45)'
  ctx.beginPath()
  ctx.ellipse(-0.3 * r, 0.3 * r, 0.09 * r, 0.3 * r, 0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#5a3817'
  ctx.beginPath()
  ctx.arc(0, 0.96 * r, 0.06 * r, 0, Math.PI * 2)
  ctx.fill()

  // Cap with a scaly texture
  const capPath = (): void => {
    ctx.beginPath()
    ctx.moveTo(-0.94 * r, 0.05 * r)
    ctx.bezierCurveTo(-1.02 * r, -0.55 * r, -0.55 * r, -0.95 * r, 0, -0.95 * r)
    ctx.bezierCurveTo(0.55 * r, -0.95 * r, 1.02 * r, -0.55 * r, 0.94 * r, 0.05 * r)
    ctx.quadraticCurveTo(0.5 * r, 0.22 * r, 0, 0.08 * r)
    ctx.quadraticCurveTo(-0.5 * r, 0.22 * r, -0.94 * r, 0.05 * r)
    ctx.closePath()
  }
  capPath()
  ctx.fillStyle = '#7a5530'
  ctx.fill()
  ctx.save()
  capPath()
  ctx.clip()
  ctx.fillStyle = '#4a3119'
  for (let row = 0; row < 5; row += 1) {
    for (let col = -4; col <= 4; col += 1) {
      ctx.beginPath()
      ctx.arc(col * 0.26 * r + (row % 2) * 0.13 * r, -0.8 * r + row * 0.22 * r, 0.05 * r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.fillStyle = 'rgba(255, 220, 170, 0.22)'
  ctx.beginPath()
  ctx.ellipse(-0.35 * r, -0.55 * r, 0.3 * r, 0.14 * r, -0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Stem
  ctx.fillStyle = '#4a3320'
  ctx.beginPath()
  ctx.roundRect(-0.07 * r, -1.2 * r, 0.14 * r, 0.3 * r, 0.05 * r)
  ctx.fill()
  ctx.restore()
}

/**
 * Draws acorns lying on the ground, in front of everything else.
 *
 * @param ctx - 2D canvas context in world space.
 * @param acorns - Generated acorns.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawAcorns(
  ctx: CanvasRenderingContext2D,
  acorns: Acorn[],
  cameraX: number,
  viewWidth: number,
): void {
  const left = cameraX - 16
  const right = cameraX + viewWidth + 16
  for (const acorn of acorns) {
    if (acorn.state !== 'ground') {
      continue
    }
    if (acorn.x + acorn.radius < left || acorn.x - acorn.radius > right) {
      continue
    }
    // Lying acorns rest at a varied angle, derived from position so it stays stable.
    const lean = (((acorn.x * 0.137) % 1) + 1) % 1
    // Resting acorns settle slightly into the ground with a soft contact shadow; falling ones do not.
    const resting = acorn.vy === 0
    if (resting) {
      ctx.fillStyle = 'rgba(30, 15, 5, 0.35)'
      ctx.beginPath()
      ctx.ellipse(acorn.x, acorn.y + acorn.radius * 0.8, acorn.radius * 1.05, acorn.radius * 0.3, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    drawAcornShape(ctx, acorn.x, acorn.y + (resting ? acorn.radius * 0.2 : 0), acorn.radius, (lean < 0.5 ? 1 : -1) * (0.9 + lean * 0.6))
  }
}

/**
 * Vertical body offset in sprite units: a hop while walking, a wingbeat lift while flying.
 *
 * @param player - Bird pose.
 */
function bodyBob(player: Player): number {
  if (player.state === 'flying') {
    return Math.sin(player.animTime * 16) * 2.5
  }
  const hop = hopProgress(player)
  const lift = hop >= 0 ? -Math.sin(Math.PI * hop) * 8 : 0
  return lift + actionDip(player) * 12
}

/**
 * Progress through the current hop from 0 to 1, or -1 when the bird is not hopping.
 *
 * @param player - Bird pose.
 */
function hopProgress(player: Player): number {
  return player.state === 'standing' && player.hopT < HOP_DURATION ? player.hopT / HOP_DURATION : -1
}

/**
 * How far the bird is bent toward the ground for a pick-up, bury or dig-up animation (0 to 1):
 * one dip for a pick-up, three pecks for burying and digging up.
 *
 * @param player - Bird pose.
 */
function actionDip(player: Player): number {
  const action = player.action
  if (!action) {
    return 0
  }
  const p = Math.min(1, action.timer / action.duration)
  return action.kind === 'pickup' ? Math.sin(Math.PI * p) : Math.abs(Math.sin(Math.PI * 3 * p))
}

/** Pre-rendered bird pose: the canvas and where the bird's center sits inside it. */
type BirdSprite = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  centerY: number
}

const birdSprites = new Map<string, BirdSprite>()

/** Most bird poses kept before the least recently used one is dropped. */
const BIRD_SPRITE_LIMIT = 300

/** Wing-beat and walk-cycle phases quantized for caching. */
const FLY_PHASES = 24
const HOP_PHASES = 16
const ACTION_PHASES = 30
const EAT_PHASES = 20

/**
 * Draws the jay from a cached bitmap of its current pose (built on first use).
 *
 * Poses are quantized (24 wing phases, 16 walk phases, 20 eating phases), drawn once with the
 * vector code in `drawBirdVector`, then blitted, flipped for facing. This keeps many jays in view
 * cheap.
 *
 * @param ctx - 2D canvas context in world space.
 * @param player - Bird pose and animation clock.
 */
function birdSpriteFor(player: Player, dpr: number): BirdSprite {
  const size = player.size
  const flying = player.state === 'flying'
  const eating = player.eatTimer > 0
  const eatQ = eating ? Math.min(EAT_PHASES - 1, Math.floor((1 - player.eatTimer / EAT_DURATION) * EAT_PHASES)) : -1
  const turn = Math.PI * 2
  let phase = 0
  let animTime = 0
  let mode = 's'
  const hop = hopProgress(player)
  if (flying) {
    mode = 'f'
    phase = Math.floor((((player.animTime * 16) % turn) / turn) * FLY_PHASES)
    animTime = ((phase + 0.5) / FLY_PHASES) * (turn / 16)
  } else if (hop >= 0) {
    mode = 'h'
    phase = Math.min(HOP_PHASES - 1, Math.floor(hop * HOP_PHASES))
  }
  const actionQ = player.action
    ? Math.min(ACTION_PHASES - 1, Math.floor((player.action.timer / player.action.duration) * ACTION_PHASES))
    : -1
  const key = [
    Math.round(size),
    Math.round(dpr * 100),
    mode,
    phase,
    player.held ? Math.round(player.held.radius) : 0,
    eatQ,
    player.action ? player.action.kind : '',
    actionQ,
    player.floating ? 'w' : '',
  ].join('|')

  let sprite = birdSprites.get(key)
  if (sprite) {
    birdSprites.delete(key)
  } else {
    const width = size * 1.7
    const height = size * 1.6
    const centerY = size * 0.9
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * dpr)
    canvas.height = Math.ceil(height * dpr)
    const sctx = canvas.getContext('2d')
    if (sctx) {
      sctx.scale(dpr, dpr)
      const pose: Player = {
        ...player,
        x: width / 2 - size / 2,
        y: centerY - size / 2,
        facing: 1,
        animTime,
        eatTimer: eatQ >= 0 ? (1 - (eatQ + 0.5) / EAT_PHASES) * EAT_DURATION : 0,
        hopT: mode === 'h' ? ((phase + 0.5) / HOP_PHASES) * HOP_DURATION : HOP_DURATION,
        action: player.action
          ? { ...player.action, timer: ((actionQ + 0.5) / ACTION_PHASES) * player.action.duration }
          : null,
      }
      drawBirdVector(sctx, pose)
    }
    sprite = { canvas, width, height, centerY }
    if (birdSprites.size >= BIRD_SPRITE_LIMIT) {
      const oldest = birdSprites.keys().next().value
      if (oldest !== undefined) {
        birdSprites.delete(oldest)
      }
    }
  }
  birdSprites.set(key, sprite)
  return sprite
}

/**
 * Draws the jay from its cached pose bitmap, flipped for facing.
 *
 * @param ctx - 2D canvas context in world space.
 * @param player - Bird pose and animation clock.
 */
function drawBird(ctx: CanvasRenderingContext2D, player: Player): void {
  const size = player.size
  const sprite = birdSpriteFor(player, ctx.getTransform().a)
  ctx.save()
  ctx.translate(player.x + size / 2, player.y + size / 2)
  ctx.scale(player.facing, 1)
  ctx.drawImage(sprite.canvas, -sprite.width / 2, -sprite.centerY, sprite.width, sprite.height)
  ctx.restore()
}

/**
 * Draws a cartoon blue jay inside the player's square, with walk and fly animations.
 * Modeled on real jays: blue crest, pale face with a dark eye mask and necklace,
 * barred blue wings and tail with white bars and tips.
 *
 * Sprite space is a 100x100 box centered on the player, +x toward the beak.
 *
 * @param ctx - 2D canvas context in world space.
 * @param player - Bird pose and animation clock.
 */
function drawBirdVector(ctx: CanvasRenderingContext2D, player: Player): void {
  const u = player.size / 100
  const flying = player.state === 'flying'
  const t = player.animTime
  const eating = player.eatTimer > 0
  const eatProgress = eating ? 1 - player.eatTimer / EAT_DURATION : 0
  // Beak gap: open around the held acorn, chomping while eating.
  const dip = actionDip(player)
  const hopping = hopProgress(player)
  const beakGap = !player.held ? dip * 6 : eating ? 2 + Math.abs(Math.sin(eatProgress * Math.PI * 5)) * 7 : 8.5

  ctx.save()
  ctx.translate(player.x + player.size / 2, player.y + player.size / 2 + bodyBob(player) * u)
  ctx.scale(player.facing * u, u)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Legs
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineWidth = 4
  if (player.floating) {
    // Floating on the creek: the legs are under water, out of sight.
  } else if (flying) {
    // Legs tucked back in flight
    for (const dx of [-6, 4]) {
      ctx.beginPath()
      ctx.moveTo(dx, 24)
      ctx.lineTo(dx - 8, 34)
      ctx.stroke()
    }
  } else {
    // Standing legs with the feet visible. In a hop they swing about the hip: pushing back as the
    // bird launches, straight at the top, reaching forward as it lands.
    const swing = hopping >= 0 ? 0.2 * Math.cos(Math.PI * hopping) : 0
    for (const hipX of [-6, 6]) {
      ctx.save()
      ctx.translate(hipX, 24)
      ctx.rotate(swing)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, 23)
      ctx.lineTo(7, 23)
      ctx.stroke()
      ctx.restore()
    }
  }

  // Posture: upright when standing, a slight incline in flight (wings hinge on this axis)
  ctx.save()
  ctx.translate(0, 6)
  const bodyTilt = (flying ? -0.04 : -0.3) + dip * 0.6
  ctx.rotate(bodyTilt)
  ctx.translate(0, -6)
  // The head keeps one world tilt in every pose; only the body tilt changes (pivot at the neck).
  const headTurn = -0.04 - bodyTilt + dip * 0.6
  const tiltHead = (): void => {
    // While pecking the neck stretches forward and down so the beak reaches the ground.
    ctx.translate(16 + dip * 10, -8 + dip * 18)
    ctx.rotate(headTurn)
    ctx.translate(-16, 8)
  }
  if (eating) {
    ctx.rotate(Math.sin(eatProgress * Math.PI * 5) * 0.06)
  }

  // Held acorn: behind the body, gripped between the mandibles (shrinks as it is eaten)
  if (player.held) {
    ctx.save()
    tiltHead()
    drawAcornShape(ctx, 50, -10, (player.held.radius / u) * (1 - eatProgress * 0.85), -Math.PI / 2)
    ctx.restore()
  }

  // Far wing (flight only): behind the body, slightly out of phase and darker
  if (flying) {
    drawFlightWing(ctx, t + 0.04, true)
  }

  drawTail(ctx, flying)
  drawBody(ctx, !flying)

  // Head: blue crown over a pale face (clipped to a round head)
  ctx.save()
  tiltHead()
  // Subtle crest, drawn under the head in the crown color: its front edge leaves the head contour
  // tangentially and tapers back to a tip; the back edge is almost straight.
  ctx.fillStyle = PLAYER_COLOR
  ctx.beginPath()
  ctx.moveTo(33.4, -28.7)
  ctx.bezierCurveTo(29.5, -33, 16, -37.5, 5, -36)
  ctx.quadraticCurveTo(6.5, -29.5, 11, -21)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(25, 60, 120, 0.3)'
  ctx.lineWidth = 1
  for (const [x0, y0, x1, y1] of [
    [26, -31, 12, -35],
    [22, -30, 9, -33],
  ] as [number, number, number, number][]) {
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
  ctx.save()
  ctx.beginPath()
  ctx.arc(24, -14, 17.5, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = PLAYER_COLOR
  ctx.fillRect(0, -40, 60, 60)
  ctx.fillStyle = '#eef2f5'
  ctx.beginPath()
  ctx.moveTo(50, -20)
  ctx.bezierCurveTo(38, -22, 28, -23, 17, -15)
  ctx.lineTo(10, 14)
  ctx.lineTo(50, 14)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.restore()

  // Black necklace: a tapered brush shape from behind the eye, down the neck, under the throat
  // The necklace decorates the body: clip it to the body, head and crest silhouette.
  ctx.save()
  ctx.beginPath()
  traceBodyOutline(ctx)
  ctx.save()
  tiltHead()
  ctx.moveTo(41.5, -14)
  ctx.arc(24, -14, 17.5, 0, Math.PI * 2, true)
  ctx.moveTo(33.4, -28.7)
  ctx.bezierCurveTo(29.5, -33, 16, -37.5, 5, -36)
  ctx.quadraticCurveTo(6.5, -29.5, 11, -21)
  ctx.closePath()
  ctx.restore()
  ctx.clip()
  ctx.save()
  tiltHead()
  // The top of the band fades into the blue crest instead of ending abruptly.
  const necklaceFill = ctx.createLinearGradient(7, -30, 36, 10)
  necklaceFill.addColorStop(0, 'rgba(24, 38, 58, 0)')
  necklaceFill.addColorStop(0.22, '#18263a')
  necklaceFill.addColorStop(0.74, '#18263a')
  necklaceFill.addColorStop(1, 'rgba(24, 38, 58, 0)')
  ctx.fillStyle = necklaceFill
  // The band starts at the crest tip, flush with the crest's back edge, then runs behind the eye.
  fillTaperedCurve(ctx, [
    [
      [8, -29],
      [9.5, -26],
      [11.5, -23],
      [14, -20],
    ],
    [
      [14, -20],
      [20, -12],
      [10, -4],
      [24, 3],
    ],
    [
      [24, 3],
      [26, 8],
      [30, 11],
      [36, 9],
    ],
  ])
  ctx.restore()
  ctx.restore()
  ctx.strokeStyle = '#18263a'

  ctx.save()
  tiltHead()
  // Thin dark line through the eye, then a plain dark bead eye with a highlight
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(39, -15)
  ctx.quadraticCurveTo(33, -17, 20, -16)
  ctx.stroke()
  ctx.fillStyle = '#111820'
  ctx.beginPath()
  ctx.arc(31, -17, 4.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(32.4, -18.4, 1.4, 0, Math.PI * 2)
  ctx.fill()

  // Beak: upper and lower mandibles with a gap when open
  ctx.fillStyle = '#262a30'
  ctx.beginPath()
  ctx.moveTo(38, -18)
  ctx.lineTo(51, -10 - beakGap)
  ctx.lineTo(38, -11)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(38, -9)
  ctx.lineTo(50, -10 + beakGap)
  ctx.lineTo(38, -4)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Near wing: folded along the body on the ground, spread and flapping in the air
  if (flying) {
    drawFlightWing(ctx, t, false)
  } else {
    drawFoldedWing(ctx)
  }

  ctx.restore()

  // Dirt flicked up while burying or digging
  if (dip > 0.4 && player.action && player.action.kind !== 'pickup') {
    ctx.fillStyle = '#6b4a2b'
    for (let k = 0; k < 5; k += 1) {
      ctx.beginPath()
      ctx.arc(60 + k * 4, 46 - dip * 14 * (0.3 + k * 0.18) + (k % 2) * 3, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/**
 * Fills a brush-stroke shape along joined cubic curves: thick at the start, thinner through the
 * middle, and thickening again at the end.
 *
 * @param ctx - 2D canvas context in sprite space.
 * @param curves - Control points (P0..P3) of each curve; each starts where the previous one ends.
 */
function fillTaperedCurve(ctx: CanvasRenderingContext2D, curves: [number, number][][]): void {
  const samples: { x: number; y: number }[] = []
  for (const curve of curves) {
    const [p0, p1, p2, p3] = curve
    if (!p0 || !p1 || !p2 || !p3) {
      return
    }
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12
      const u = 1 - t
      samples.push({
        x: u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        y: u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      })
    }
  }
  const left: [number, number][] = []
  const right: [number, number][] = []
  const along: number[] = [0]
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]
    const b = samples[i]
    along.push((along[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0))
  }
  const total = along[along.length - 1] || 1
  samples.forEach((p, i) => {
    const prev = samples[Math.max(0, i - 1)] ?? p
    const next = samples[Math.min(samples.length - 1, i + 1)] ?? p
    const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1
    const nx = -(next.y - prev.y) / len
    const ny = (next.x - prev.x) / len
    const t = (along[i] ?? 0) / total
    // Fades in about halfway up the crest, fattest just below the crest behind the eye, thin
    // through the neck, thick again at the throat, then tapering and fading out toward the throat edge.
    const fadeIn = 0.3 + 0.7 * Math.min(1, t / 0.08)
    const behindHead = 6.5 * Math.exp(-(((t - 0.2) / 0.11) ** 2))
    const throat = 3.6 * Math.exp(-(((t - 0.74) / 0.13) ** 2))
    const endTaper = t > 0.85 ? 1 - 0.7 * ((t - 0.85) / 0.15) : 1
    const half = ((1.2 + behindHead + throat) * fadeIn * endTaper) / 2
    left.push([p.x + nx * half, p.y + ny * half])
    right.push([p.x - nx * half, p.y - ny * half])
  })
  ctx.beginPath()
  left.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  for (let i = right.length - 1; i >= 0; i -= 1) {
    const point = right[i]
    if (point) {
      ctx.lineTo(point[0], point[1])
    }
  }
  ctx.closePath()
  ctx.fill()
}

/**
 * Adds the body silhouette (counterclockwise) to the current path; callers begin the path.
 *
 * @param ctx - 2D canvas context in sprite space.
 */
function traceBodyOutline(ctx: CanvasRenderingContext2D): void {
  ctx.moveTo(12, -24)
  ctx.bezierCurveTo(2, -17, -16, -14, -30, -3)
  ctx.bezierCurveTo(-33, 2, -30, 9, -24, 12)
  ctx.bezierCurveTo(-14, 26, 12, 28, 26, 16)
  ctx.bezierCurveTo(34, 10, 38, -2, 34, -12)
  ctx.bezierCurveTo(30, -20, 20, -26, 12, -24)
  ctx.closePath()
}

/**
 * Draws the organic body: pale underparts (throat, breast, belly) with a blue back.
 *
 * @param ctx - 2D canvas context in sprite space.
 * @param speckled - Whether to add white speckles on the back (standing pose).
 */
function drawBody(ctx: CanvasRenderingContext2D, speckled: boolean): void {
  ctx.fillStyle = '#e6ecf0'
  ctx.beginPath()
  traceBodyOutline(ctx)
  ctx.fill()

  ctx.fillStyle = PLAYER_COLOR
  ctx.beginPath()
  ctx.moveTo(12, -24)
  ctx.bezierCurveTo(2, -17, -16, -14, -30, -3)
  ctx.bezierCurveTo(-33, 2, -30, 9, -24, 12)
  ctx.bezierCurveTo(-10, 10, 6, 4, 14, -10)
  ctx.bezierCurveTo(16, -16, 15, -21, 12, -24)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = 'rgba(160, 200, 240, 0.55)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(6, -18)
  ctx.bezierCurveTo(-4, -14, -14, -11, -24, -3)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(120, 140, 165, 0.35)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(-14, 19)
  ctx.bezierCurveTo(-4, 24, 8, 25, 18, 19)
  ctx.stroke()

  if (speckled) {
    ctx.fillStyle = '#f4f7fa'
    for (const [x, y] of [
      [-17, -8],
      [-23, -3],
      [-15, -3],
    ] as [number, number][]) {
      ctx.beginPath()
      ctx.arc(x, y, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/**
 * Draws the long barred tail with a white tip, fanned slightly in flight.
 *
 * @param ctx - 2D canvas context in sprite space.
 * @param flying - Whether the tail fans out.
 */
function drawTail(ctx: CanvasRenderingContext2D, flying: boolean): void {
  const spread = flying ? 2.5 : 0
  const topAt = (x: number): number => -1 + ((-24 - x) / 40) * (-2 - spread)
  const bottomAt = (x: number): number => 9 + ((-24 - x) / 40) * (-1 + spread)

  ctx.fillStyle = '#3f95cf'
  ctx.beginPath()
  ctx.moveTo(-24, -1)
  ctx.lineTo(-64, -3 - spread)
  ctx.quadraticCurveTo(-69, 3, -64, 8 + spread)
  ctx.lineTo(-24, 9)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#17294a'
  ctx.lineWidth = 2.2
  for (const x of [-33, -41, -49]) {
    ctx.beginPath()
    ctx.moveTo(x, topAt(x))
    ctx.lineTo(x, bottomAt(x))
    ctx.stroke()
  }

  // Thin white lining on the outer feathers: along the lower and upper edges, not around the tip
  ctx.strokeStyle = '#f1f4f7'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(-52, bottomAt(-52))
  ctx.lineTo(-64, 8 + spread)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-59, topAt(-59))
  ctx.lineTo(-64, -3 - spread)
  ctx.stroke()
}

/** Feather tips along the trailing edge of a wing in wing space (root centered on the origin, tip up). */
const WING_TIPS: [number, number][] = [
  [7, -68],
  [0, -62],
  [-8, -54],
  [-15, -45],
  [-21, -36],
  [-26, -27],
  [-30, -18],
  [-32, -9],
  [-32, 1],
]

/**
 * Traces the wing outline: a nearly flat leading edge, a pointed tip, and a curved trailing edge of
 * scalloped feather tips, with a broad root along the body.
 *
 * @param ctx - 2D canvas context (wing space, root centered on the origin, tip pointing up).
 */
function traceWing(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.moveTo(14, 3)
  ctx.quadraticCurveTo(4, -32, 11, -66)
  let prev: [number, number] = [11, -66]
  for (const tip of WING_TIPS) {
    ctx.quadraticCurveTo((prev[0] + tip[0]) / 2 + 3.5, (prev[1] + tip[1]) / 2, tip[0], tip[1])
    prev = tip
  }
  ctx.closePath()
}

/**
 * Leading and trailing edge x of the wing at a given y (wing space).
 *
 * @param y - Wing-space y (0 at the root, about -66 at the tip).
 */
function wingEdgesAt(y: number): [number, number] {
  let leading = 14
  let bestGap = Infinity
  for (let i = 0; i <= 50; i += 1) {
    const t = i / 50
    const u = 1 - t
    const gap = Math.abs(u * u * 3 + 2 * u * t * -32 + t * t * -66 - y)
    if (gap < bestGap) {
      bestGap = gap
      leading = u * u * 14 + 2 * u * t * 4 + t * t * 11
    }
  }
  const tips = [...WING_TIPS].reverse()
  let trailing = tips[0]?.[0] ?? -32
  for (let i = 1; i < tips.length; i += 1) {
    const a = tips[i - 1]
    const b = tips[i]
    if (a && b && y <= a[1] && y >= b[1]) {
      trailing = a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1)
      break
    }
  }
  return [leading, trailing]
}

/**
 * Traces a wing bar running spanwise at a fraction of the chord measured from the leading edge.
 *
 * @param ctx - 2D canvas context (wing space).
 * @param frac - 0 is the leading edge, 1 the trailing edge.
 * @param fromY - Span start (near the root).
 * @param toY - Span end (more negative, toward the tip).
 */
function traceWingBar(ctx: CanvasRenderingContext2D, frac: number, fromY: number, toY: number): void {
  ctx.beginPath()
  for (let i = 0; i <= 8; i += 1) {
    const y = fromY + ((toY - fromY) * i) / 8
    const [leading, trailing] = wingEdgesAt(y)
    const x = leading + (trailing - leading) * frac
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
}

/**
 * Traces a smooth line parallel to the trailing edge, shifted by (dx, dy) toward the leading edge.
 *
 * @param ctx - 2D canvas context (wing space).
 * @param dx - Horizontal offset from the trailing tips.
 * @param dy - Vertical offset from the trailing tips.
 */
function traceTrailingOffset(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
  const pts = WING_TIPS.slice(2).map(([x, y]): [number, number] => [x + dx, y + dy])
  const first = pts[0]
  if (!first) {
    return
  }
  ctx.beginPath()
  ctx.moveTo(first[0], first[1])
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1]
    const cur = pts[i]
    if (prev && cur) {
      ctx.quadraticCurveTo(prev[0], prev[1], (prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2)
    }
  }
  const last = pts[pts.length - 1]
  if (last) {
    ctx.lineTo(last[0], last[1])
  }
}

/**
 * Draws the top of the wing: blue with feather lines, teal inner highlights, and white wing bars.
 *
 * Both white bars follow the trailing edge, so they run roughly parallel on an extended wing: the
 * middle bar (coverts) shows in every pose; the second is the white fringe of the trailing
 * secondaries, drawn only on a spread wing.
 *
 * @param ctx - 2D canvas context (wing space, root centered on the origin, tip pointing up).
 * @param spread - True for a spread wing (adds the trailing-edge white bar).
 * @param far - True for the far-side wing (drawn darker).
 */
function drawWingUpper(ctx: CanvasRenderingContext2D, spread: boolean, far: boolean): void {
  const fill = ctx.createLinearGradient(0, -8, 0, -66)
  fill.addColorStop(0, far ? '#2f64a8' : '#4079bd')
  fill.addColorStop(0.55, far ? '#27559a' : '#3469ae')
  fill.addColorStop(1, far ? '#17366a' : '#1f4278')
  traceWing(ctx)
  ctx.fillStyle = fill
  ctx.fill()

  ctx.save()
  traceWing(ctx)
  ctx.clip()

  // Teal on the half toward the tail: from just ahead of the white bar out to the trailing edge
  ctx.fillStyle = far ? '#2f86b8' : '#3fa3d6'
  traceWingBar(ctx, 0.17, 4, -52)
  ctx.lineTo(-60, -52)
  ctx.lineTo(-60, 4)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#17294a'
  for (const y of [-6, -12, -18, -24, -30, -36, -42]) {
    ctx.fillRect(-34, y, 36, 1.5)
  }

  // Feather lines running from the inner wing out to each trailing tip
  ctx.strokeStyle = 'rgba(10, 30, 70, 0.4)'
  ctx.lineWidth = 1
  for (const tip of WING_TIPS) {
    ctx.beginPath()
    ctx.moveTo(4, tip[1] * 0.5 - 6)
    ctx.quadraticCurveTo(-4, tip[1] * 0.75, tip[0] * 0.9, tip[1] * 0.95)
    ctx.stroke()
  }

  // Middle wing bar across the coverts, a black bar between, and the trailing-edge fringe
  ctx.strokeStyle = '#17294a'
  ctx.lineWidth = 2.4
  traceWingBar(ctx, 0.26, 4, -34)
  ctx.stroke()
  ctx.strokeStyle = '#f4f7fa'
  ctx.lineWidth = 3.6
  traceWingBar(ctx, 0.19, 4, -34)
  ctx.stroke()
  if (spread) {
    ctx.lineWidth = 4
    traceWingBar(ctx, 0.97, 4, -36)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draws the underside of the wing: a dull, darker blue-grey with long pale feather streaks and a
 * blacker patch along the leading edge.
 *
 * @param ctx - 2D canvas context (wing space, root centered on the origin, tip pointing up).
 * @param far - True for the far-side wing (drawn slightly darker).
 */
function drawWingUnderside(ctx: CanvasRenderingContext2D, far: boolean): void {
  const fill = ctx.createLinearGradient(0, -4, 0, -66)
  fill.addColorStop(0, far ? '#5a789f' : '#6f8cb3')
  fill.addColorStop(1, far ? '#35517a' : '#42608a')
  traceWing(ctx)
  ctx.fillStyle = fill
  ctx.fill()

  ctx.save()
  traceWing(ctx)
  ctx.clip()

  // Blacker patch along the leading edge
  ctx.strokeStyle = '#1c2740'
  ctx.lineWidth = 15
  ctx.beginPath()
  ctx.moveTo(14, 3)
  ctx.quadraticCurveTo(4, -32, 11, -66)
  ctx.stroke()

  // Long feather streaks fanning from the root to each trailing tip
  for (const tip of WING_TIPS) {
    ctx.strokeStyle = 'rgba(16, 30, 56, 0.4)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(8, 2)
    ctx.lineTo(tip[0] + 2, tip[1] + 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(200, 212, 230, 0.5)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(8, 4)
    ctx.lineTo(tip[0] + 5, tip[1] + 5)
    ctx.stroke()
  }

  // Pale trailing edge
  ctx.strokeStyle = 'rgba(205, 215, 230, 0.8)'
  ctx.lineWidth = 3
  traceTrailingOffset(ctx, 0, 0)
  ctx.stroke()
  ctx.restore()
}

/**
 * Draws the folded wing (perched) in body space, modeled on a real jay: the mantle between the neck
 * and the wing stays plain, the wing's top edge is flush with the back, the feathers run toward the
 * tail past the rump, a zigzag white bar crosses the front of the wing leaning toward the head,
 * a scale pattern of dark feather edges sits behind the bar, and teal fills the tail side of the
 * wing from just ahead of the bar.
 *
 * @param ctx - 2D canvas context in sprite space (body frame, head toward +x).
 */
function drawFoldedWing(ctx: CanvasRenderingContext2D): void {
  const scallops: [number, number][] = [
    [-50, 11],
    [-42, 12],
    [-34, 12],
    [-26, 11],
  ]
  const trace = (): void => {
    ctx.beginPath()
    ctx.moveTo(1.2, -18.5)
    ctx.bezierCurveTo(-8.4, -14.5, -20.2, -10.7, -30, -3)
    ctx.bezierCurveTo(-38, 2, -48, 5, -57, 8)
    let prev: [number, number] = [-57, 8]
    for (const p of scallops) {
      ctx.quadraticCurveTo((prev[0] + p[0]) / 2 - 1, (prev[1] + p[1]) / 2 + 3, p[0], p[1])
      prev = p
    }
    ctx.bezierCurveTo(-14, 10, 0, 3, 9, -8)
    ctx.bezierCurveTo(10, -12, 6, -16, 1.2, -18.5)
    ctx.closePath()
  }

  trace()
  ctx.fillStyle = '#3669ad'
  ctx.fill()

  ctx.save()
  trace()
  ctx.clip()

  // Bar direction (leaning toward the head, about 20 degrees below horizontal in the world) and
  // the direction toward the tail across it, in body space.
  const bar = { x: -6, y: -8 }
  const ux = 0.8
  const uy = 0.6
  const vx = -0.6
  const vy = 0.8

  // Teal on the tail side of the bar, starting just ahead of it
  ctx.fillStyle = '#3fa3d6'
  ctx.beginPath()
  ctx.moveTo(bar.x + ux * 70 - vx * 2, bar.y + uy * 70 - vy * 2)
  ctx.lineTo(bar.x - ux * 70 - vx * 2, bar.y - uy * 70 - vy * 2)
  ctx.lineTo(bar.x - ux * 70 + vx * 110, bar.y - uy * 70 + vy * 110)
  ctx.lineTo(bar.x + ux * 70 + vx * 110, bar.y + uy * 70 + vy * 110)
  ctx.closePath()
  ctx.fill()

  // Feather lines running toward the tail
  ctx.strokeStyle = 'rgba(10, 30, 70, 0.35)'
  ctx.lineWidth = 1
  for (const [x, y] of scallops) {
    ctx.beginPath()
    ctx.moveTo(-8, y - 18)
    ctx.lineTo(x, y - 1)
    ctx.stroke()
  }

  // Fine barring on the long feathers near the tail end
  ctx.strokeStyle = 'rgba(15, 30, 70, 0.5)'
  ctx.lineWidth = 1
  for (let x = -30; x > -54; x -= 4) {
    const top = -3 + (-30 - x) * -0.32
    ctx.beginPath()
    ctx.moveTo(x, top + 4)
    ctx.lineTo(x - 1, top + 9)
    ctx.stroke()
  }

  // Scale pattern of dark feather edges on the coverts behind the bar, in rows parallel to it
  ctx.fillStyle = 'rgba(14, 34, 84, 0.75)'
  for (let row = 0; row < 4; row += 1) {
    for (let col = -3; col <= 3; col += 1) {
      const cx = bar.x + vx * (4.5 + row * 3.6) + ux * (col * 4.6 + (row % 2) * 2.3)
      const cy = bar.y + vy * (4.5 + row * 3.6) + uy * (col * 4.6 + (row % 2) * 2.3)
      ctx.beginPath()
      ctx.ellipse(cx, cy, 2.1, 1.1, Math.atan2(uy, ux), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // White zigzag wing bar
  ctx.strokeStyle = '#f4f7fa'
  ctx.lineWidth = 3
  ctx.beginPath()
  for (let i = 0; i <= 4; i += 1) {
    const along = -9 + i * 4.5
    const zig = i % 2 === 0 ? -1.6 : 1.6
    const x = bar.x + ux * along + vx * zig
    const y = bar.y + uy * along + vy * zig
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * Draws a spread wing with a fixed root: the wing hinges on the edge attached to the body and its
 * span swings up and down, foreshortened as in a side view. A raised wing shows its dull underside;
 * a lowered wing shows its blue upper side. The far wing shows the opposite face.
 *
 * @param ctx - 2D canvas context in sprite space.
 * @param t - Animation clock in seconds.
 * @param far - True for the wing on the far side (drawn darker, behind the body).
 */
function drawFlightWing(ctx: CanvasRenderingContext2D, t: number, far: boolean): void {
  const phase = t * 16
  // Span scale: positive raised (up to full length), negative lowered.
  const lift = 0.2 + 0.85 * Math.sin(phase)
  // The tip trails back against the direction of travel of the stroke.
  const sweep = 0.22 + 0.2 * -Math.cos(phase)
  const showUnder = far ? lift < 0 : lift >= 0

  ctx.save()
  // The hinge axis runs along the back (nape to rump); the wing root is centered on the pivot.
  ctx.translate(far ? -11 : -9, far ? -12 : -13)
  ctx.rotate(-0.4)
  ctx.transform(1, 0, sweep, lift, 0, 0)
  ctx.translate(9, 0)
  if (showUnder) {
    drawWingUnderside(ctx, far)
  } else {
    drawWingUpper(ctx, true, far)
  }
  ctx.restore()
}

/**
 * Draws a screen-space overview of the whole world: trees, acorns, the camera view, and the bird.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param viewWidth - Viewport width.
 * @param world - Play space.
 * @param camera - Current camera.
 * @param viewHeight - Viewport height.
 * @param player - Bird.
 */
function drawMinimap(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  world: World,
  camera: Camera,
  viewHeight: number,
  player: Player,
): void {
  const mapW = Math.min(360, viewWidth * 0.4)
  const scale = mapW / world.width
  const mapH = Math.max(36, world.height * scale)
  const mx = (viewWidth - mapW) / 2
  const my = 12
  if (!(mapW >= 1) || !(mapH >= 1)) {
    return
  }

  // The terrain, trees and props never change, so they are drawn once into a bitmap.
  const res = Math.max(0.1, ctx.getTransform().a)
  let cache = minimapCache.get(world)
  if (!cache || Math.abs(cache.mapW - mapW) > 0.5 || Math.abs(cache.res - res) > 0.05) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(mapW * res))
    canvas.height = Math.max(1, Math.ceil(mapH * res))
    const sctx = canvas.getContext('2d')
    if (sctx) {
      sctx.scale(res, res)
      drawMinimapStatic(sctx, world, mapW, mapH, scale)
    }
    cache = { canvas, mapW, res }
    minimapCache.set(world, cache)
  }

  ctx.save()
  ctx.translate(mx, my)
  ctx.drawImage(cache.canvas, 0, 0, mapW, mapH)

  ctx.fillStyle = '#9a9ea4'
  for (const squirrel of world.squirrels) {
    if (!squirrel.bird.hidden) {
      ctx.beginPath()
      ctx.arc((squirrel.bird.x + squirrel.bird.size / 2) * scale, (squirrel.bird.y + squirrel.bird.size / 2) * scale, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.fillStyle = '#e08a1e'
  for (const npc of world.npcs) {
    ctx.beginPath()
    ctx.arc((npc.bird.x + npc.bird.size / 2) * scale, (npc.bird.y + npc.bird.size / 2) * scale, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.strokeStyle = '#1b2838'
  ctx.lineWidth = 1
  ctx.strokeRect(camera.x * scale, camera.y * scale, viewWidth * scale, viewHeight * scale)

  ctx.fillStyle = '#1565c0'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc((player.x + player.size / 2) * scale, (player.y + player.size / 2) * scale, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Pre-rendered static part of the minimap (terrain, creek, props, trees, frame), per world. */
const minimapCache = new WeakMap<World, { canvas: HTMLCanvasElement; mapW: number; res: number }>()

/**
 * Draws the minimap's unchanging layers: terrain, creek, low-detail props, trees and the frame.
 *
 * @param ctx - Context of the cached bitmap (origin at its top-left).
 * @param world - Play space.
 * @param mapW - Minimap width.
 * @param mapH - Minimap height.
 * @param scale - Minimap pixels per world pixel.
 */
function drawMinimapStatic(
  ctx: CanvasRenderingContext2D,
  world: World,
  mapW: number,
  mapH: number,
  scale: number,
): void {
  ctx.fillStyle = 'rgba(157, 191, 156, 0.9)'
  ctx.fillRect(0, 0, mapW, mapH)
  ctx.fillStyle = '#6b4a2b'
  ctx.beginPath()
  ctx.moveTo(0, mapH)
  for (let px = 0; px <= mapW; px += 2) {
    ctx.lineTo(px, groundYAt(world.terrain, px / scale) * scale)
  }
  ctx.lineTo(mapW, mapH)
  ctx.closePath()
  ctx.fill()

  const { creek } = world.terrain
  ctx.fillStyle = '#5b93b8'
  ctx.fillRect(
    (creek.x - creek.halfWidth) * scale,
    creek.waterY * scale,
    Math.max(2, creek.halfWidth * 2 * scale),
    Math.max(1, (world.groundY + world.groundHeight - creek.waterY) * scale),
  )

  // Low-detail ground props: rocks, logs and bushes as tiny shapes sitting on the ground line.
  for (const rock of world.rocks) {
    const ground = groundYAt(world.terrain, rock.x) * scale
    ctx.fillStyle = '#8a8780'
    ctx.beginPath()
    ctx.ellipse(rock.x * scale, ground, Math.max(1, rock.rx * scale), Math.max(1, rock.ry * scale), 0, Math.PI, 0)
    ctx.fill()
  }
  ctx.fillStyle = '#4a2d14'
  for (const log of world.logs) {
    const ground = groundYAt(world.terrain, log.x) * scale
    ctx.fillRect((log.x - log.length / 2) * scale, ground - Math.max(1.5, log.radius * 2 * scale), Math.max(2, log.length * scale), Math.max(1.5, log.radius * 2 * scale))
  }
  ctx.fillStyle = '#3f7d3f'
  for (const bush of world.bushes) {
    const ground = groundYAt(world.terrain, bush.x) * scale
    let span = 0
    let height = 0
    for (const lobe of bush.lobes) {
      span = Math.max(span, Math.abs(lobe.dx) + lobe.radius)
      height = Math.max(height, -lobe.dy + lobe.radius)
    }
    ctx.beginPath()
    ctx.ellipse(bush.x * scale, ground, Math.max(1.5, span * scale), Math.max(1.5, height * scale), 0, Math.PI, 0)
    ctx.fill()
  }

  for (const tree of world.trees) {
    const cx = (tree.x + tree.trunkWidth / 2) * scale
    const treeGround = groundYAt(world.terrain, tree.x + tree.trunkWidth / 2)
    // Same silhouette as the real oak: tapered trunk and branches under a crown of leaf lobes.
    ctx.fillStyle = TRUNK_COLOR
    for (const seg of tree.shape.segments) {
      const dx = seg.x1 - seg.x0
      const dy = seg.y1 - seg.y0
      const len = Math.hypot(dx, dy) || 1
      const nx = (-dy / len) * 0.5
      const ny = (dx / len) * 0.5
      const w0 = Math.max(1, seg.w0 * scale)
      const w1 = Math.max(1, seg.w1 * scale)
      ctx.beginPath()
      ctx.moveTo(cx + seg.x0 * scale + nx * w0, treeGround * scale + seg.y0 * scale + ny * w0)
      ctx.lineTo(cx + seg.x1 * scale + nx * w1, treeGround * scale + seg.y1 * scale + ny * w1)
      ctx.lineTo(cx + seg.x1 * scale - nx * w1, treeGround * scale + seg.y1 * scale - ny * w1)
      ctx.lineTo(cx + seg.x0 * scale - nx * w0, treeGround * scale + seg.y0 * scale - ny * w0)
      ctx.closePath()
      ctx.fill()
    }
    ctx.fillStyle = CROWN_COLOR
    ctx.beginPath()
    for (const lobe of tree.shape.lobes) {
      const r = Math.max(0.8, lobe.r * scale)
      const lx = cx + lobe.x * scale
      ctx.moveTo(lx + r, (treeGround + lobe.y) * scale)
      ctx.arc(lx, (treeGround + lobe.y) * scale, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  ctx.strokeStyle = '#1f3d52'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, mapW, mapH)
}

/**
 * Draws a dashed white line from each NPC's eye to every burial site it recently noticed, with a
 * little padding at both ends, fading out over `NOTICE_LINE_FADE_SECONDS`. The line is redrawn from
 * the bird's current position every frame, so it stays connected as the bird moves.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - NPCs, their sites, terrain, and the game clock.
 */
function drawNoticeLines(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.save()
  ctx.setLineDash([10, 8])
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (const npc of [...world.npcs, ...world.squirrels]) {
    const bird = npc.bird
    if (bird.hidden) {
      continue
    }
    const u = bird.size / 100
    // The line leaves from the NPC's eye (a standing bird holds its head higher than a flying one).
    const standing = bird.state === 'standing'
    const squirrel = npc.home !== null
    const eyeX = bird.x + bird.size / 2 + bird.facing * (squirrel ? 33 : standing ? 26 : 31) * u
    const eyeY = bird.y + bird.size / 2 + (squirrel ? 11 : standing ? -29 : -17) * u
    for (const site of npc.sites) {
      const fade = 1 - (world.time - site.noticedAt) / NOTICE_LINE_FADE_SECONDS
      if (fade <= 0) {
        continue
      }
      const toX = site.x
      const toY = groundYAt(world.terrain, site.x)
      const dx = toX - eyeX
      const dy = toY - eyeY
      const length = Math.hypot(dx, dy)
      // Padding at both ends so the line neither touches the bird nor reaches the burial spot.
      const padStart = bird.size * 0.2
      const padEnd = bird.size * 0.25
      if (length <= padStart + padEnd) {
        continue
      }
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * fade})`
      ctx.beginPath()
      ctx.moveTo(eyeX + (dx / length) * padStart, eyeY + (dy / length) * padStart)
      ctx.lineTo(toX - (dx / length) * padEnd, toY - (dy / length) * padEnd)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Pre-rendered NPC label text, keyed by its content. */
const labelSprites = new Map<string, { canvas: HTMLCanvasElement; width: number; height: number }>()

/**
 * Draws a debug label above an NPC from a cached bitmap, since text is expensive to render every
 * frame: its state, then hunger, nosiness and secrecy as white bars filled to their value (0-1) with
 * the number overlaid, and, for a few seconds after it starts burying, the burial quality it chose.
 *
 * @param ctx - 2D canvas context in world space.
 * @param npc - NPC to annotate.
 */
function drawNpcLabel(ctx: CanvasRenderingContext2D, npc: Npc): void {
  const dpr = ctx.getTransform().a
  const bars: [string, number][] = [['hunger', npc.bird.hunger]]
  if (npc.nosiness !== null) {
    bars.push(['nosy', npc.nosiness])
  }
  bars.push(['secrecy', npc.secrecy])
  const showQuality = npc.buryQualityTimer > 0
  const key = [npc.state, ...bars.map(([, v]) => v.toFixed(2)), showQuality ? npc.buryQuality.toFixed(2) : '', Math.round(dpr * 100)].join('|')
  let label = labelSprites.get(key)
  if (!label) {
    const width = 130
    const barW = 100
    const barH = 12
    const height = 18 + bars.length * (barH + 3) + (showQuality ? 15 : 0)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * dpr)
    canvas.height = Math.ceil(height * dpr)
    const lctx = canvas.getContext('2d')
    if (lctx) {
      lctx.scale(dpr, dpr)
      lctx.textAlign = 'center'
      lctx.lineJoin = 'round'
      const text = (line: string, y: number, font: string): void => {
        lctx.font = font
        lctx.lineWidth = 3
        lctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
        lctx.fillStyle = '#1b2838'
        lctx.strokeText(line, width / 2, y)
        lctx.fillText(line, width / 2, y)
      }
      text(npc.state, 12, '12px Georgia, serif')
      bars.forEach(([name, value], i) => {
        const x = (width - barW) / 2
        const y = 18 + i * (barH + 3)
        lctx.fillStyle = 'rgba(27, 40, 56, 0.55)'
        lctx.fillRect(x, y, barW, barH)
        lctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        lctx.fillRect(x, y, barW * Math.max(0, Math.min(1, value)), barH)
        lctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
        lctx.lineWidth = 1
        lctx.strokeRect(x + 0.5, y + 0.5, barW - 1, barH - 1)
        text(`${name} ${value.toFixed(2)}`, y + barH - 2.5, 'bold 10px Georgia, serif')
      })
      if (showQuality) {
        text(`burial quality ${npc.buryQuality.toFixed(2)}`, height - 3, '12px Georgia, serif')
      }
    }
    label = { canvas, width, height }
    if (labelSprites.size >= 120) {
      const oldest = labelSprites.keys().next().value
      if (oldest !== undefined) {
        labelSprites.delete(oldest)
      }
    }
    labelSprites.set(key, label)
  }
  const x = npc.bird.x + npc.bird.size / 2
  const y = npc.bird.y - npc.bird.size * 0.1
  // The label's bottom sits just above the bird's head.
  ctx.drawImage(label.canvas, x - label.width / 2, y + 8 - label.height, label.width, label.height)
}

/** Hunger level at or below which the bar flashes red. */
const STARVING_LEVEL = 0.2

/**
 * Draws the controls cheat sheet as a square overlay in the bottom left corner.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param viewHeight - Viewport height.
 */
function drawControlsOverlay(ctx: CanvasRenderingContext2D, viewHeight: number): void {
  const side = 196
  const x = 16
  const y = viewHeight - side - 16
  ctx.fillStyle = 'rgba(27, 40, 56, 0.72)'
  ctx.beginPath()
  ctx.roundRect(x, y, side, side, 10)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f4efe4'
  ctx.font = 'bold 17px Georgia, serif'
  ctx.fillText('Controls', x + 14, y + 28)
  const rows: [string, string][] = [
    ['WASD', 'move'],
    ['S (tap)', 'pick up'],
    ['Q', 'drop'],
    ['Shift', 'bury / dig up'],
    ['E', 'eat when hungry'],
  ]
  ctx.font = '15px Georgia, serif'
  rows.forEach(([key, action], index) => {
    const rowY = y + 58 + index * 28
    ctx.fillStyle = '#f2c230'
    ctx.fillText(key, x + 14, rowY)
    ctx.fillStyle = '#f4efe4'
    ctx.fillText(action, x + 84, rowY)
  })
}

/**
 * Draws the hunger bar large at the bottom center: green when fed, yellow below the threshold
 * marker, and flashing red when very low.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 * @param player - Bird (hunger level and held acorn).
 */
function drawHungerBar(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  viewHeight: number,
  player: Player,
): void {
  const w = Math.min(520, viewWidth * 0.55)
  const h = 32
  const x = (viewWidth - w) / 2
  const y = viewHeight - 52
  const hungry = player.hunger < HUNGER_THRESHOLD
  const starving = player.hunger <= STARVING_LEVEL
  const flashOn = starving && Math.floor(performance.now() / 300) % 2 === 0

  ctx.fillStyle = 'rgba(27, 40, 56, 0.7)'
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8)
  ctx.fillStyle = starving ? (flashOn ? '#ff3b30' : '#8f1d17') : hungry ? '#f2c230' : '#5cb85c'
  ctx.fillRect(x, y, w * player.hunger, h)
  if (starving) {
    ctx.strokeStyle = flashOn ? '#ff3b30' : '#8f1d17'
    ctx.lineWidth = 3
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8)
  }

  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x + w * HUNGER_THRESHOLD, y - 8)
  ctx.lineTo(x + w * HUNGER_THRESHOLD, y + h + 8)
  ctx.stroke()

  ctx.fillStyle = starving ? (flashOn ? '#ff3b30' : '#f4efe4') : '#f4efe4'
  ctx.font = 'bold 18px Georgia, serif'
  ctx.textAlign = 'center'
  const label = starving
    ? 'Starving!'
    : hungry && player.held
      ? 'Hungry - press E to eat'
      : hungry
        ? 'Hungry - find an acorn'
        : 'Hunger'
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(27, 40, 56, 0.85)'
  ctx.strokeText(label, viewWidth / 2, y - 14)
  ctx.fillText(label, viewWidth / 2, y - 14)
  ctx.textAlign = 'left'
}

/**
 * Pre-builds the expensive cached bitmaps (forest layers, the oaks, and the common jay poses) in
 * small steps so none of it has to happen mid-game as the camera moves. Run one `next()` per frame.
 *
 * @param world - Generated play space.
 * @param player - The main bird (template for the jay poses).
 * @param dpr - Device pixel ratio the game renders at.
 */
export function* warmUpScene(world: World, player: Player, dpr: number): Generator<void> {
  for (const layer of world.forest) {
    forestStripFor(layer, world)
    yield
  }
  for (const tree of world.trees) {
    getOakSprite(tree.shape, OAK_TONES, TRUNK_COLOR, dpr)
    yield
  }
  // Leaf-litter tiles for the whole ground, one per step (at the usual resolution of 1 px per world px).
  const { top, tiles } = leafTileEntry(world)
  const tileHeight = world.height - top + 12
  for (let index = 0; index * LEAF_TILE_WIDTH < world.width; index += 1) {
    tiles.set(index, buildLeafTile(world.leaves, index, top, tileHeight, 1))
    yield
  }

  const acorn = {
    x: 0,
    y: 0,
    radius: world.acorns[0]?.radius ?? player.size / 8,
    state: 'held' as const,
    vy: 0,
    hops: 0,
    conceal: 0,
  }
  let built = 0
  const build = (pose: Partial<Player>): boolean => {
    birdSpriteFor({ ...player, action: null, eatTimer: 0, hopT: HOP_DURATION, ...pose }, dpr)
    built += 1
    return built % 6 === 0
  }
  for (const held of [null, acorn]) {
    for (let i = 0; i < FLY_PHASES; i += 1) {
      const animTime = ((i + 0.5) / FLY_PHASES) * ((Math.PI * 2) / 16)
      if (build({ state: 'flying', animTime, held })) {
        yield
      }
    }
    for (let i = 0; i < HOP_PHASES; i += 1) {
      if (build({ state: 'standing', hopT: ((i + 0.5) / HOP_PHASES) * HOP_DURATION, held })) {
        yield
      }
    }
    build({ state: 'standing', held })
    yield
  }
}
