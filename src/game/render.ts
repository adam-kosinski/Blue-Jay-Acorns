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
import { oakArrivalsPending, oakCacheReport, drawLeafyDisk, drawOakCrown, drawOakSteps, getOakPart, paintBark, seededRandom, drawOak, drawCrossfade, endCrossfade, settleOakArrivals } from './oak'
import { enqueueJob, pendingJobs, runWork } from './work'
import { holdAheadWork, pendingRequests, registerLayer, requestImage, requestWork, workerUsable } from './vegClient'
import { burialQuality } from './burial'
import { drawSnowfall } from './snowfall'
import { SNOW_BOTTOM, SNOW_CELL_DEPTH, SNOW_CELL_X, SNOW_TOP, blobStretch, snowAt, snowBlob, snowCapLayers, snowCapSize, snowCover, snowThickness } from './snow'
import {
  BUILD_HOLD_END,
  SAMPLE_COUNT,
  SEGMENT_SECONDS,
  buildHoldAt,
  leafStageMix,
  STAGE_LOOKS,
  leafLook,
  sampleAt,
  sampleIndexAt,
  sampleTime,
  transitionProgress,
  winterTintAt,
} from './seasons'
import { fallTones, mixHex, parseRgb, winterGreen } from './leafColors'
import { BACKDROP_FOG, mixColor } from './world'
import { CREEK_FRONT_DROP_IN_VIEWS, CREEK_FRONT_PARALLAX, TERRAIN_STEP, creekWeight, groundYAt, hillBump, liftAt, lowPass } from './terrain'
import type {
  Acorn,
  Bush,
  BushLobe,
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

/** The backdrop's top and bottom colors as [r, g, b] each. */
type BackdropLook = { top: [number, number, number]; bottom: [number, number, number] }

/**
 * Reads a `#rrggbb` or `rgb(r,g,b)` color.
 *
 * @param color - The color.
 */
function rgbOf(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
  }
  const parts = color.replace(/[^\d.,]/g, '').split(',').map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** How much farther back than the farthest layer the winter and spring backdrop looks: one more step of atmospheric perspective. */
const BACKDROP_WINTER_FOG = BACKDROP_FOG + 0.015

const BACKDROP_GREEN: BackdropLook = { top: rgbOf(BACKDROP_TOP), bottom: rgbOf(BACKDROP_BOTTOM) }
const BACKDROP_FALL: BackdropLook = {
  top: rgbOf(fallTones(30, 0, { color: FOREST_HAZE_COLOR, amount: BACKDROP_FOG })[1] ?? '#c0702a'),
  bottom: rgbOf(fallTones(30, 0, { color: FOREST_HAZE_COLOR, amount: BACKDROP_FOG })[3] ?? '#d88a3a'),
}
/** The tree trunks' color with one more level of atmospheric perspective past the farthest layer. */
/** The atmosphere's color in winter: a light blue (the haze of the farther layers and the backdrop). */
const WINTER_HAZE_COLOR = '#8dbdf0'

/** How far a layer's colors go toward the winter haze at full winter, per unit of the layer's fog (its distance haze). */
const WINTER_HAZE_STRENGTH = 1

/**
 * How far a layer's own colors have gone toward the light blue winter haze: the farther (foggier) the
 * layer, the more, like the summer haze that is already part of its colors.
 *
 * @param layer - Forest layer.
 * @param winter - How far the air is in its winter look, 0-1.
 */
function winterAmount(layer: ForestLayer, winter: number): number {
  return Math.min(0.95, layer.fog * WINTER_HAZE_STRENGTH) * winter
}

/**
 * A color of a layer as it is with the winter haze.
 *
 * @param color - The layer's (summer-hazed) color.
 * @param layer - Forest layer.
 * @param winter - How far the air is in its winter look, 0-1.
 */
function winterHazed(color: string, layer: ForestLayer, winter: number): string {
  return winter > 0 ? mixHex(color, WINTER_HAZE_COLOR, winterAmount(layer, winter)) : color
}

/**
 * A copy of a layer whose colors have the winter haze (for drawing its vegetation).
 *
 * @param layer - Forest layer.
 * @param winter - How far the air is in its winter look, 0-1.
 */
function winterLayer(layer: ForestLayer, winter: number): ForestLayer {
  if (winter <= 0) {
    return layer
  }
  const tint = (color: string): string => winterHazed(color, layer, winter)
  return {
    ...layer,
    groundColor: tint(layer.groundColor),
    trunkColor: tint(layer.trunkColor),
    tones: layer.tones.map(tint),
    leafColors: layer.leafColors.map(tint),
    rocks: layer.rocks.map((rock) => ({ ...rock, color: tint(rock.color), highlight: tint(rock.highlight), litter: rock.litter.map(tint) })),
  }
}

// The farthest trunks' color (the trunk color with the layer's haze, then its winter haze) taken one more step
// of atmospheric perspective back: so the far background is a little hazier than the farthest layer's trunks.
const BACKDROP_WINTER_COLOR = rgbOf(
  mixHex(
    mixHex(TRUNK_COLOR, FOREST_HAZE_COLOR, BACKDROP_WINTER_FOG),
    WINTER_HAZE_COLOR,
    Math.min(0.95, BACKDROP_WINTER_FOG * WINTER_HAZE_STRENGTH),
  ),
)
const BACKDROP_WINTER: BackdropLook = { top: BACKDROP_WINTER_COLOR, bottom: BACKDROP_WINTER_COLOR }
const BACKDROP_SPRING: BackdropLook = {
  top: BACKDROP_WINTER_COLOR,
  bottom: rgbOf(mixHex('#9fd88a', FOREST_HAZE_COLOR, BACKDROP_FOG)),
}

/** The backdrop's looks along the timeline: green in summer, orange in fall, the far trunk color in winter, that with light green below in spring. */
const BACKDROP_KEYS: [number, BackdropLook][] = [
  [0.5, BACKDROP_GREEN],
  [2.5, BACKDROP_FALL],
  [4, BACKDROP_WINTER],
  [7.5, BACKDROP_SPRING],
]

/**
 * The backdrop gradient's colors at a time (blended between the looks above).
 *
 * @param time - Seconds along the timeline.
 */
function backdropColors(time: number): [string, string] {
  const u = time / SEGMENT_SECONDS
  let from = BACKDROP_KEYS[0] as [number, BackdropLook]
  let to = from
  for (const key of BACKDROP_KEYS) {
    if (u >= key[0]) {
      from = key
      to = key
    } else {
      to = key
      break
    }
  }
  const k = to[0] > from[0] ? Math.max(0, Math.min(1, (u - from[0]) / (to[0] - from[0]))) : 0
  const mix = (a: [number, number, number], b: [number, number, number]): string =>
    `rgb(${[0, 1, 2].map((i) => Math.round((a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * k)).join(',')})`
  return [mix(from[1].top, to[1].top), mix(from[1].bottom, to[1].bottom)]
}

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
  // The next seasons' images are prepared a little each frame while the game is played.
  // (More when the frame is cheap, less when it is not.)
  seasonNow = world.season.time
  runWork(lastSceneMs < 6 ? 4 : 1.5)
  const sceneStart = performance.now()
  settleArrivals(3)
  settleOakArrivals(3)
  settleProps(2)
  planVegetation(world, camera.x, viewWidth)
  const haze = ctx.createLinearGradient(0, 0, 0, viewHeight)
  const [backdropTop, backdropBottom] = backdropColors(world.season.time)
  haze.addColorStop(0, backdropTop)
  haze.addColorStop(1, backdropBottom)
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, viewWidth, viewHeight)

  drawForest(ctx, world.forest, world, camera, viewWidth, viewHeight)

  ctx.save()
  ctx.translate(-camera.x, -camera.y)

  // Trees, logs and rocks first, so the ground and leaf litter cover their bases.
  drawTrees(ctx, world.trees, world.terrain, camera.x, viewWidth, world.season.time)
  drawBuriedProps(ctx, world, camera.x, viewWidth)
  drawGround(ctx, world, camera.x, viewWidth)
  // (The litter is not drawn at all once the snow has faded it away: see `drawLeafLitter`.)
  drawLeafLitter(ctx, world, camera, viewWidth, viewHeight)
  drawSnow(ctx, world, camera.x, viewWidth)
  if (showBurialHeatmap) {
    drawBurialHeatmap(ctx, world, player, camera.x, viewWidth)
  }
  drawCreek(ctx, world, camera, viewWidth, viewHeight)
  drawMounds(ctx, world, camera.x, viewWidth)
  for (const npc of world.npcs) {
    const bx = npc.bird.x + npc.bird.size / 2
    if (bx > camera.x - npc.bird.size * 2 && bx < camera.x + viewWidth + npc.bird.size * 2) {
      drawBirdOnWater(ctx, npc.bird, world)
      if (showMinimap) {
        drawNpcLabel(ctx, npc)
      }
    }
  }
  for (const squirrel of world.squirrels) {
    const sx = squirrel.bird.x + squirrel.bird.size / 2
    if (!squirrel.bird.hidden && sx > camera.x - squirrel.bird.size * 2 && sx < camera.x + viewWidth + squirrel.bird.size * 2) {
      if (squirrel.bird.climbDir !== 0 && squirrel.home) {
        // The tree's leaves hang in front of a squirrel climbing its trunk.
        drawClimbingSquirrel(ctx, squirrel, world)
      } else {
        drawSquirrel(ctx, squirrel.bird)
      }
      if (showMinimap) {
        drawNpcLabel(ctx, squirrel)
      }
    }
  }
  drawBirdOnWater(ctx, player, world)
  // Ground acorns go just in front of the birds, but behind the props standing in the dirt, so they
  // never look like they sit on a bush.
  drawAcorns(ctx, world.acorns, camera.x, viewWidth)
  drawFrontProps(ctx, world, camera.x, viewWidth)
  drawNoticeLines(ctx, world, player)
  if (showMinimap) {
    drawFollowArrows(ctx, world)
  }

  ctx.restore()

  // Falling snow, in front of the scene (screen space; the background layers have none).
  drawSnowfall(ctx, world.season.time, camera.x, camera.y, viewWidth, viewHeight)

  if (showMinimap) {
    drawMinimap(ctx, viewWidth, world, camera, viewHeight, player)
  }
  drawHungerBar(ctx, viewWidth, viewHeight, player)

  drawControlsOverlay(ctx, viewHeight)
  lastSceneMs = performance.now() - sceneStart

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
  // The far layers' bitmaps are drawn smaller than they show: smooth (blurry) rather than blocky when blown up.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const maxCamY = Math.max(0, world.height - viewHeight)
  const winter = winterTintAt(world.season.time)
  const snow = snowThickness(world.season.time) * snowCover(world.season.time)
  const snowedIn = snowThickness(world.season.time) >= 0.999 && snowCover(world.season.time) >= 0.999 && winter >= 0.999
  let stripsMade = 0
  tintBuildsLeft = 1
  patchBuildsLeft = 1
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
    const blit = (
      source: HTMLCanvasElement,
      fillBelow: boolean,
      alpha = 1,
      groundColor = layer.groundColor,
      image = true,
      dst: CanvasRenderingContext2D = ctx,
    ): void => {
      dst.globalAlpha = alpha
      for (let s = 0; s < slabs; s += 1) {
        const slabLimit = layerLimits[s] ?? viewHeight
        const bottomRow = Math.min(stripHeight, slabLimit - base + strip.originY)
        const srcX = Math.max(0, (camera.x * p + s * FOREST_SLAB) * strip.resolution)
        const srcW = Math.min((FOREST_SLAB + 1) * strip.resolution, source.width - srcX)
        if (image && bottomRow > topRow && !hidden && srcW > 0) {
          dst.drawImage(
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
          dst.fillStyle = groundColor
          dst.fillRect(s * FOREST_SLAB, below - 1, FOREST_SLAB + 1, slabLimit - below + 1)
        }
      }
      dst.globalAlpha = 1
    }
    // The ground first; then the creek's water over it (below); then the props, so the water only
    // ever covers the ground and what lies behind it, never a bush or rock standing in front.
    if (!hidden) {
      drawVegetation(ctx, layer, strip, world, base, camera.x, viewWidth, limit, 'back')
    }
    // Once the snow is complete (and the haze, and nothing is melting) the ground is one flat color: its shape in
    // that color is drawn alone.
    if (snowedIn && !hidden && !strip.frozenCanvas && stripsMade < 2) {
      strip.frozenColor = winterHazed(mixHex(layer.groundColor, SNOW_TOP, 0.92), layer, 1)
      strip.frozenCanvas = makeMask(strip, strip.frozenColor, 0.75, 1)
      stripsMade += 1
    }
    const thickness = snowThickness(world.season.time)
    const cover = snowCover(world.season.time)
    // While the snow and the haze lie evenly over the ground, the tinted ground is kept as a bitmap of its own.
    const evenTint =
      !snowedIn && !hidden && (snow > 0 || winter > 0) && (snow <= 0 || cover >= 0.999)
        ? tintedStrip(strip, snow > 0 ? thickness * 0.92 : 0, winter > 0 ? winterAmount(layer, winter) : 0)
        : null
    if (snowedIn && strip.frozenCanvas && strip.frozenColor) {
      dropTintedStrip(strip)
      blit(strip.canvas, true, 1, strip.frozenColor, false)
      if (!hidden) {
        // (in one piece: see below)
        ctx.save()
        ctx.beginPath()
        let deepest = topRow
        for (let sl = 0; sl < slabs; sl += 1) {
          const bottomRow = Math.min(stripHeight, (layerLimits[sl] ?? viewHeight) - base + strip.originY)
          if (bottomRow > topRow) {
            ctx.rect(sl * FOREST_SLAB, base - strip.originY + topRow, FOREST_SLAB, bottomRow - topRow)
            deepest = Math.max(deepest, bottomRow)
          }
        }
        ctx.clip()
        const maskRes = (strip.frozenCanvas.width / strip.canvas.width) * strip.resolution
        const srcX = Math.max(0, camera.x * p * maskRes)
        const srcW = Math.min(viewWidth * maskRes, strip.frozenCanvas.width - srcX)
        if (srcW > 0 && deepest > topRow) {
          ctx.drawImage(strip.frozenCanvas, srcX, topRow * maskRes, srcW, (deepest - topRow) * maskRes, 0, base - strip.originY + topRow, srcW / maskRes, deepest - topRow)
        }
        ctx.restore()
      }
    } else if (evenTint) {
      blit(strip.canvas, true, 1, snow > 0 ? mixColor(layer.groundColor, SNOW_TOP, snow * 0.92) : layer.groundColor, false)
      blit(evenTint, false)
    } else if ((snow > 0 || winter > 0) && !hidden) {
      // While the snow and the haze come in, and while the snow melts, the ground bitmap is drawn onto a
      // scratch canvas and tinted there (the tint only goes onto the pixels the ground painted, edge pixels
      // included, in the same share as the rest: tinted by a mask drawn over it instead, a soft edge pixel
      // kept its own brownish color and showed as a thin dark line along the ridge), then drawn as one.
      blit(strip.canvas, true, 1, snow > 0 ? mixColor(layer.groundColor, SNOW_TOP, snow * 0.92) : layer.groundColor, false)
      const deviceScale = ctx.getTransform().a
      const sw = Math.ceil(viewWidth * deviceScale)
      const sh = Math.ceil(viewHeight * deviceScale)
      if (!tintCanvas) {
        tintCanvas = document.createElement('canvas')
      }
      if (tintCanvas.width !== sw || tintCanvas.height !== sh) {
        tintCanvas.width = sw
        tintCanvas.height = sh
      }
      const tctx = tintCanvas.getContext('2d')
      let regionBottom = topRow
      for (let sl = 0; sl < slabs; sl += 1) {
        regionBottom = Math.max(regionBottom, Math.min(stripHeight, (layerLimits[sl] ?? viewHeight) - base + strip.originY))
      }
      const regionTop = Math.max(0, base - strip.originY + topRow)
      const regionHeight = Math.min(viewHeight, base - strip.originY + regionBottom) - regionTop
      if (tctx && regionHeight > 0) {
        tctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0)
        tctx.imageSmoothingQuality = 'high'
        tctx.globalCompositeOperation = 'source-over'
        tctx.globalAlpha = 1
        tctx.clearRect(0, regionTop - 1, viewWidth, regionHeight + 2)
        blit(strip.canvas, false, 1, layer.groundColor, true, tctx)
        tctx.globalCompositeOperation = 'source-atop'
        if (snow > 0) {
          tctx.save()
          if (cover < 0.999) {
            // While it melts the snow goes in patches here too (the same patches as the foreground's, at this
            // layer's scale, and not smaller than half of it).
            const scale = Math.max(0.5, layer.scale)
            const shift = camera.x * p
            const firstColumn = Math.floor((shift / scale - SNOW_CELL_X * 1.4) / SNOW_CELL_X)
            const lastColumn = Math.floor(((shift + viewWidth) / scale + SNOW_CELL_X * 1.4) / SNOW_CELL_X)
            const rows = Math.ceil(((limit - base) / scale + SNOW_CELL_DEPTH * 2) / SNOW_CELL_DEPTH)
            // The patches start above the highest ridge of the layer's ground (their depth is measured from 30 px
            // above the base line), or the ridges would be left bare the moment the melt starts.
            const firstRow = Math.floor((30 * scale - strip.rise) / scale / SNOW_CELL_DEPTH) - 1
            tctx.translate(-shift, base - 30 * scale)
            tctx.clip(meltPatches(strip, scale, cover, firstColumn, lastColumn, firstRow, rows))
            tctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0)
          }
          tctx.globalAlpha = thickness * 0.92
          tctx.fillStyle = SNOW_TOP
          tctx.fillRect(0, regionTop, viewWidth, regionHeight)
          tctx.restore()
        }
        if (winter > 0) {
          tctx.globalAlpha = winterAmount(layer, winter)
          tctx.fillStyle = WINTER_HAZE_COLOR
          tctx.fillRect(0, regionTop, viewWidth, regionHeight)
        }
        tctx.globalAlpha = 1
        tctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(tintCanvas, 0, regionTop * deviceScale, sw, regionHeight * deviceScale, 0, regionTop, viewWidth, regionHeight)
      }
    } else {
      blit(strip.canvas, true, 1, layer.groundColor)
    }
    if (!evenTint && !hidden) {
      dropTintedStrip(strip)
    }
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
      bottomColor = winterHazed(next.waterColor, next, winter)
    } else {
      bottom = world.terrain.creek.waterY - camera.y
      bottomX = world.terrain.creek.x - camera.x
      bottomHalf = world.terrain.creek.halfWidth
      bottomColor = '#6aa3c4'
    }
    bottom = Math.max(bottom, top + 1)
    const topX = layer.creek.x - camera.x * p
    if (top < limit && bottom > 0) {
      // The ribbon is painted at the layer's resolution (on a scratch canvas) and drawn up to size, so that its
      // edges are as soft as the layer's ground is: the farther back, the fuzzier.
      const ribbonRes = vegRes(layer)
      const mid = (top + bottom) / 2
      const topHalf = layer.creek.halfWidth
      const left0 = Math.max(Math.min(topX - topHalf, bottomX - bottomHalf) - 3, -4)
      const right0 = Math.min(Math.max(topX + topHalf, bottomX + bottomHalf) + 3, viewWidth + 4)
      const top0 = Math.max(top - (index === 0 ? topHalf * 0.2 : 0) - 3, -4)
      const bottom0 = Math.min(bottom + 4, viewHeight + 4)
      if (right0 > left0 && bottom0 > top0) {
        const rw = Math.ceil((right0 - left0) * ribbonRes)
        const rh = Math.ceil((bottom0 - top0) * ribbonRes)
        if (!ribbonCanvas) {
          ribbonCanvas = document.createElement('canvas')
        }
        // (Only ever grown: resizing a canvas clears and reallocates it.)
        if (ribbonCanvas.width < rw || ribbonCanvas.height < rh) {
          ribbonCanvas.width = Math.max(ribbonCanvas.width, rw)
          ribbonCanvas.height = Math.max(ribbonCanvas.height, rh)
        }
        const rctx = ribbonCanvas.getContext('2d')
        if (rctx) {
          rctx.setTransform(1, 0, 0, 1, 0, 0)
          rctx.clearRect(0, 0, rw + 1, rh + 1)
          rctx.setTransform(ribbonRes, 0, 0, ribbonRes, -left0 * ribbonRes, -top0 * ribbonRes)
          const water = rctx.createLinearGradient(0, top, 0, bottom)
          water.addColorStop(0, winterHazed(layer.waterColor, layer, winter))
          water.addColorStop(1, bottomColor)
          rctx.fillStyle = water
          // Curved sides (vertical at both ends) let the creek wind smoothly from layer to layer.
          rctx.beginPath()
          rctx.moveTo(topX - topHalf, top)
          if (index === 0) {
            // The farthest creek ends in a rounded head rather than a flat edge.
            rctx.quadraticCurveTo(topX, top - topHalf * 0.2, topX + topHalf, top)
          } else {
            rctx.lineTo(topX + topHalf, top)
          }
          // Two pixels past the end, so neighbouring ribbons overlap and no hairline shows between them.
          rctx.bezierCurveTo(topX + topHalf, mid, bottomX + bottomHalf, mid, bottomX + bottomHalf, bottom + 2)
          rctx.lineTo(bottomX - bottomHalf, bottom + 2)
          rctx.bezierCurveTo(bottomX - bottomHalf, mid, topX - topHalf, mid, topX - topHalf, top)
          rctx.closePath()
          rctx.fill()
          ctx.drawImage(ribbonCanvas, 0, 0, rw, rh, left0, top0, rw / ribbonRes, rh / ribbonRes)
        }
      }

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
        // Its resolution runs from this layer's to the next one's (the foreground's, full, after the last).
        const here = vegRes(layer)
        const nextRes = next ? vegRes(next) : ctx.getTransform().a
        drawFuzzyRock(ctx, edge.rock, py, here + (nextRes - here) * t, layer, winter)
      }
    }
    if (!hidden) {
      // The layer's own rocks, drawn at the layer's resolution (like its images), with their snow, before the
      // ferns and bushes that stand in front of them.
      const shift = camera.x * p
      for (const prop of strip.veg.props) {
        const rock = prop.kind === 'rock' ? layer.rocks[prop.index] : undefined
        if (!rock) {
          continue
        }
        const screenX = rock.x - shift
        const groundY = base - strip.originY + prop.y
        if (screenX < -rock.rx * 1.5 || screenX > viewWidth + rock.rx * 1.5 || groundY - rock.ry * 1.2 > limit) {
          continue
        }
        ctx.save()
        ctx.translate(-shift, 0)
        drawFuzzyRock(ctx, rock, groundY, vegRes(layer), layer, winter)
        ctx.restore()
      }
      drawVegetation(ctx, layer, strip, world, base, camera.x, viewWidth, limit, 'front')
    }
  }
  ctx.imageSmoothingQuality = 'low'
}

/** A screen-sized scratch canvas the creek ribbons between the layers are painted on at the layers' resolution. */
let ribbonCanvas: HTMLCanvasElement | null = null

/** A small scratch canvas the far rocks are painted on at their layer's resolution. */
let rockScratch: HTMLCanvasElement | null = null

/**
 * Draws a far rock at a resolution: painted at that many bitmap pixels per world pixel on a small scratch canvas and
 * drawn up to size (smoothed), so that it is as soft as the layer's images are, and as soft as the rocks
 * and ground next to it. A resolution at or above the screen's is drawn directly.
 *
 * @param ctx - 2D canvas context (the rock's coordinates are its coordinates).
 * @param rock - The rock (it is drawn by `drawRockSimple`).
 * @param groundY - Ground Y at the rock.
 * @param res - Bitmap pixels per world pixel it is painted at.
 * @param layer - The layer it belongs to (for its winter haze).
 * @param winter - How far the air is in its winter look, 0-1.
 */
function drawFuzzyRock(
  ctx: CanvasRenderingContext2D,
  rock: Rock,
  groundY: number,
  res: number,
  layer: ForestLayer,
  winter: number,
): void {
  const { color, highlight } = rock
  if (winter > 0) {
    rock.color = winterHazed(color, layer, winter)
    rock.highlight = winterHazed(highlight, layer, winter)
  }
  const pad = 3
  const halfWidth = rock.rx * 1.4 + pad
  const above = rock.ry * 1.7 + pad
  const below = rock.ry * 0.6 + pad
  const width = Math.ceil(halfWidth * 2 * res)
  const height = Math.ceil((above + below) * res)
  if (res >= ctx.getTransform().a * 0.97 || width > 640 || height > 320) {
    drawRockSimple(ctx, rock, groundY)
  } else {
    if (!rockScratch) {
      rockScratch = document.createElement('canvas')
      rockScratch.width = 640
      rockScratch.height = 320
    }
    const sctx = rockScratch.getContext('2d')
    if (sctx) {
      const baseY = groundY + rock.ry * 0.4
      sctx.setTransform(1, 0, 0, 1, 0, 0)
      sctx.clearRect(0, 0, width + 1, height + 1)
      sctx.setTransform(res, 0, 0, res, (halfWidth - rock.x) * res, (above - baseY) * res)
      drawRockSimple(sctx, rock, groundY)
      ctx.drawImage(rockScratch, 0, 0, width, height, rock.x - halfWidth, baseY - above, width / res, height / res)
    }
  }
  rock.color = color
  rock.highlight = highlight
}

/**
 * Makes a layer's ground bitmap with its full winter haze over it (the opaque pixels are blended toward the
 * light blue; the transparent ones stay as they are).
 *
 * @param strip - The layer's ground bitmap.
 * @param color - The color the mask is in.
 * @param scale - Its size against the bitmap's.
 * @param repeats - How many times the shape is drawn on itself (soft edges get more opaque).
 */
function makeMask(strip: ForestStrip, color: string, scale: number, repeats = 1): HTMLCanvasElement {
  const copy = document.createElement('canvas')
  copy.width = Math.max(1, Math.round(strip.canvas.width * scale))
  copy.height = Math.max(1, Math.round(strip.canvas.height * scale))
  const copyCtx = copy.getContext('2d')
  if (copyCtx && strip.canvas.width > 0 && strip.canvas.height > 0) {
    // The shape is drawn `repeats` times in the same place: its soft edge pixels get more opaque (so the ground's
    // own brownish edge never peeks out from under the mask as a line along the surface) while nothing is
    // spread outward (which made a blue or white outline along the ridges against the sky).
    for (let i = 0; i < repeats; i += 1) {
      copyCtx.drawImage(strip.canvas, 0, 0, copy.width, copy.height)
    }
    // Keep the shape (the opaque and soft-edged pixels) and make all of it one color.
    copyCtx.globalCompositeOperation = 'source-in'
    copyCtx.fillStyle = color
    copyCtx.fillRect(0, 0, copy.width, copy.height)
  }
  return copy
}

/** A screen-sized scratch canvas where a far layer's ground is tinted before it is drawn (see `drawForest`). */
let tintCanvas: HTMLCanvasElement | null = null

/** Pre-rendered forest layer: horizon, trees, bushes and logs drawn once into a wide bitmap. */
type ForestStrip = {
  canvas: HTMLCanvasElement
  /** Bitmap pixels per CSS pixel. */
  resolution: number
  /** Y of the layer's base line inside the bitmap. */
  originY: number
  /** Y of the layer's creek waterline relative to its base line (negative is up): where its water ribbon starts. */
  waterLine: number
  /** Lowest ground line of each `GROUND_COLUMN`-wide column relative to the base line: all below it is opaque. */
  columnGround: Float32Array
  /** Where the layer's trees, logs, rocks, ferns and bushes stand (they are drawn onto images of their own). */
  veg: VegPlan
  /** How far the layer's ground rises above its base line at the highest (the melting snow's patches reach that high). */
  rise: number
  /** The ground's shape in its final color once the snow is complete (drawn alone then, instead of the bitmap and two masks). */
  frozenCanvas?: HTMLCanvasElement
  /** That color. */
  frozenColor?: string
  /** The ground bitmap with the even snow and haze of the moment on it, and those two as steps of 1/255. */
  tinted?: { canvas: HTMLCanvasElement; snow: number; haze: number }
  /** The melting snow's patches in the layer's own coordinates: for which cover, and which grid cells they reach over. */
  patches?: { path: Path2D; cover: number; firstColumn: number; lastColumn: number; firstRow: number; lastRow: number }
}

/** How many layers may have their tinted ground or their melt patches remade in the current frame. */
let tintBuildsLeft = 0
let patchBuildsLeft = 0

/** How many steps of 1/255 a tinted ground may lag behind while it waits for its turn to be remade (too little to see). */
const TINT_STALE_STEPS = 2

/**
 * A layer's ground bitmap with an even tint over it (the tint only goes onto the pixels the ground painted), remade
 * only when the tint has changed by a step that can show, one layer per frame.
 *
 * @param strip - The layer's ground bitmap.
 * @param snowAlpha - Opacity of the snow's color.
 * @param hazeAlpha - Opacity of the winter haze's color.
 * @returns The tinted bitmap, or null if it is not ready for this tint yet.
 */
function tintedStrip(strip: ForestStrip, snowAlpha: number, hazeAlpha: number): HTMLCanvasElement | null {
  const snow = Math.round(snowAlpha * 255)
  const haze = Math.round(hazeAlpha * 255)
  const held = strip.tinted
  if (held && held.snow === snow && held.haze === haze) {
    return held.canvas
  }
  if (tintBuildsLeft <= 0) {
    return held && Math.abs(held.snow - snow) <= TINT_STALE_STEPS && Math.abs(held.haze - haze) <= TINT_STALE_STEPS ? held.canvas : null
  }
  const canvas = held?.canvas ?? document.createElement('canvas')
  if (canvas.width !== strip.canvas.width || canvas.height !== strip.canvas.height) {
    canvas.width = strip.canvas.width
    canvas.height = strip.canvas.height
  }
  const tctx = canvas.getContext('2d')
  if (!tctx) {
    return null
  }
  tintBuildsLeft -= 1
  tctx.globalCompositeOperation = 'source-over'
  tctx.globalAlpha = 1
  tctx.clearRect(0, 0, canvas.width, canvas.height)
  tctx.drawImage(strip.canvas, 0, 0)
  tctx.globalCompositeOperation = 'source-atop'
  if (snowAlpha > 0) {
    tctx.globalAlpha = snowAlpha
    tctx.fillStyle = SNOW_TOP
    tctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  if (hazeAlpha > 0) {
    tctx.globalAlpha = hazeAlpha
    tctx.fillStyle = WINTER_HAZE_COLOR
    tctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  tctx.globalAlpha = 1
  tctx.globalCompositeOperation = 'source-over'
  strip.tinted = { canvas, snow, haze }
  return canvas
}

/**
 * Frees a layer's tinted ground when no even tint is showing.
 *
 * @param strip - The layer's ground bitmap.
 */
function dropTintedStrip(strip: ForestStrip): void {
  if (strip.tinted) {
    strip.tinted.canvas.width = 0
    strip.tinted.canvas.height = 0
    strip.tinted = undefined
  }
}

/**
 * The melting snow's patches on a layer's ground, in the layer's own coordinates (from its left end, and from 30 px
 * above its base line at the layer's scale), reused from frame to frame until the melt has moved them by a fraction
 * of a pixel, one layer per frame.
 *
 * @param strip - The layer's ground bitmap (it keeps the patches).
 * @param scale - The patches' scale on this layer.
 * @param cover - Share of the ground covered, 0-1.
 * @param firstColumn - First grid column in view.
 * @param lastColumn - Last grid column in view.
 * @param firstRow - First grid row in view.
 * @param lastRow - Last grid row in view.
 */
function meltPatches(
  strip: ForestStrip,
  scale: number,
  cover: number,
  firstColumn: number,
  lastColumn: number,
  firstRow: number,
  lastRow: number,
): Path2D {
  const held = strip.patches
  const step = Math.min(0.004, MELT_COVER_STEP / scale)
  if (held && firstColumn >= held.firstColumn && lastColumn <= held.lastColumn && firstRow >= held.firstRow && lastRow <= held.lastRow) {
    const behind = Math.abs(held.cover - cover)
    if (behind < step || (patchBuildsLeft <= 0 && behind < step * 3)) {
      return held.path
    }
  }
  patchBuildsLeft -= 1
  const path = new Path2D()
  const points = 10
  const columnFrom = firstColumn - MELT_COLUMN_MARGIN
  const columnTo = lastColumn + MELT_COLUMN_MARGIN
  for (let i = columnFrom; i <= columnTo; i += 1) {
    for (let j = firstRow; j <= lastRow; j += 1) {
      const blob = snowBlob(i, j, cover)
      if (!blob) {
        continue
      }
      for (let k = 0; k < points; k += 1) {
        const angle = (k / points) * Math.PI * 2
        const stretch = blobStretch(blob, angle)
        const x = (blob.x + Math.cos(angle) * blob.rx * stretch) * scale
        const y = (blob.depth + Math.sin(angle) * blob.ry * stretch) * scale
        if (k === 0) {
          path.moveTo(x, y)
        } else {
          path.lineTo(x, y)
        }
      }
      path.closePath()
    }
  }
  strip.patches = { path, cover, firstColumn: columnFrom, lastColumn: columnTo, firstRow, lastRow }
  return path
}

/** How far the snow's cover may change before the foreground's melt patches are remade (their edges then move about 0.3 px). */
const MELT_COVER_STEP = 0.0005

/** Grid columns the melt patches are made for beyond those in view, so that scrolling does not remake them. */
const MELT_COLUMN_MARGIN = 4

/** Where a layer's vegetation stands, in the strip's coordinates, and which rows of the strip its images cover. */
export type VegPlan = {
  trees: { x: number; y: number }[]
  logs: { x: number; y: number; angle: number }[]
  props: { kind: 'rock' | 'fern' | 'bush'; index: number; y: number }[]
  /** The trees' and logs' image covers rows from 0 down to here (the ground hides what is below). */
  backBottom: number
  /** The props' image covers rows from here down to ... */
  frontTop: number
  /** ... here (the bottom of the strip). */
  frontBottom: number
}


/** Narrowest variation (in a layer's own pixels) kept in a layer's shared base elevation. */
const LAYER_SMOOTH_WIDTH = 700

/** Width (in a layer's own x) of the columns whose lowest ground line is recorded for culling. */
const GROUND_COLUMN = 64

/** Width of the screen slabs the forest layers are blitted in, each with its own cull line. */
const FOREST_SLAB = 64

const forestStrips = new WeakMap<ForestLayer, ForestStrip>()

/**
 * Bitmap pixels per layer pixel of a layer's vegetation images: 0.4 for the farthest layers (parallax
 * under 0.15), 0.5 up to 0.3, 0.6 up to 0.4, and 0.75 for the nearest, which are prominent.
 *
 * @param layer - Forest layer.
 */
function vegRes(layer: ForestLayer): number {
  // The farthest layers are hazy and small: far less detail; the nearest ones (0.5 and up) are prominent.
  if (layer.parallax < 0.15) {
    return 0.4
  }
  if (layer.parallax < 0.3) {
    return 0.5
  }
  return layer.parallax < 0.4 ? 0.6 : 0.75
}

/** Width, in layer pixels, of the chunks the layers' vegetation images are made in (only those near the camera exist). */
const VEG_CHUNK = 1024

/** Layer pixels each chunk image reaches into the next chunk, so that no seam shows between them. */
const VEG_OVERLAP = 3

/** An image of one kind of a layer's vegetation at one moment of the seasons over one chunk, and the first strip row it covers. */
type VegImage = { canvas: HTMLCanvasElement | OffscreenCanvas | ImageBitmap; rowTop: number }

/** The images of a layer by moment, kind and chunk (`k|part|chunk`). */
const vegImages = new WeakMap<ForestLayer, Map<string, VegImage>>()

/**
 * A layer's images.
 *
 * @param layer - Forest layer.
 */
function vegMap(layer: ForestLayer): Map<string, VegImage> {
  let map = vegImages.get(layer)
  if (!map) {
    map = new Map()
    vegImages.set(layer, map)
  }
  return map
}

/**
 * The key of an image of a layer's vegetation.
 *
 * @param k - Moment.
 * @param part - Kind.
 * @param chunk - Chunk.
 */
function vegKey(k: number, part: 'back' | 'front', chunk: number): string {
  return `${k}|${part}|${chunk}`
}

/**
 * Draws one kind of a layer's vegetation as it is at one moment of the seasons onto an image of one chunk of
 * the layer, in steps (a generator that yields every object or so, so it can be done a little each frame).
 * Every object is at its own point of its change at that moment: trees and bushes have each of their leaves
 * there or not and green or in fall color (the same ones every time), ferns and moss have their own shade.
 *
 * @param layer - Forest layer.
 * @param strip - Its strip (where things stand).
 * @param k - Which moment (see `sampleTime`).
 * @param part - Trees and logs, or rocks, ferns and bushes.
 * @param chunk - Which chunk of the layer.
 */
function* buildVegImage(
  plainLayer: ForestLayer,
  veg: VegPlan,
  k: number,
  part: 'back' | 'front',
  chunk: number,
): Generator<void, VegImage> {
  const time = sampleTime(k)
  const winter = winterTintAt(time)
  // In winter the layer's colors (and the haze its leaves are blended with) have the light blue haze.
  const layer = winterLayer(plainLayer, winter)
  const res = vegRes(layer)
  const rowTop = part === 'back' ? 0 : veg.frontTop
  const rowBottom = part === 'back' ? veg.backBottom : veg.frontBottom
  const left = chunk * VEG_CHUNK
  const right = Math.min(layer.span + 8, left + VEG_CHUNK + VEG_OVERLAP)
  // In a worker there is no document: the image is an offscreen canvas.
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((right - left) * res))
  canvas.height = Math.max(1, Math.ceil((rowBottom - rowTop) * res))
  // In the worker the image is painted by the processor: on the graphics card its many thousands of leaves would
  // hold up the frames the game is drawing there.
  const ctx = canvas.getContext('2d', typeof document === 'undefined' ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D | null
  if (!ctx) {
    return { canvas, rowTop }
  }
  ctx.scale(res, res)
  ctx.translate(-left, -rowTop)
  const near = (x: number, reach: number): boolean => x + reach >= left && x - reach <= right
  const haze = { color: mixHex(FOREST_HAZE_COLOR, WINTER_HAZE_COLOR, WINTER_HAZE_STRENGTH * winter), amount: layer.fog }
  if (part === 'back') {
    for (const [index, tree] of layer.trees.entries()) {
      const at = veg.trees[index]
      if (at && near(at.x, tree.shape.halfWidth)) {
        const look = leafLook(transitionProgress(tree.shape.leaf.start, time))
        yield* drawOakSteps(ctx, tree.shape, at.x, at.y, layer.tones, layer.trunkColor, 0.02 + layer.parallax * 0.4, false, { ...look, haze })
      }
    }
    for (const [index, log] of layer.logs.entries()) {
      const at = veg.logs[index]
      if (at && near(at.x, log.length)) {
        ctx.save()
        ctx.translate(at.x, at.y)
        ctx.rotate(at.angle)
        drawFallenLog(ctx, log, layer.trunkColor, layer.fog, transitionProgress(log.fadeStart, time))
        ctx.restore()
        yield
      }
    }
  } else {
    for (const prop of veg.props) {
      if (prop.kind === 'rock') {
        // (A layer's rocks are not in its images: they would be at the layer's lower resolution, blurrier than
        // the rocks next to them, and the images stop at the start of winter, before the snow. They are drawn
        // every frame, see `drawForest`.)
      } else if (prop.kind === 'fern') {
        const fern = layer.ferns[prop.index]
        if (fern && near(fern.x, fern.size * 1.4)) {
          const fade = transitionProgress(fern.fadeStart, time)
          const summerLeaf = layer.tones[1 + (fern.tone % 2)] ?? layer.groundColor
          const summerStem = layer.tones[0] ?? layer.trunkColor
          const asHex = (color: string): string => {
            const [red, green, blue] = parseRgb(color)
            return `#${[red, green, blue].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
          }
          ctx.save()
          ctx.translate(fern.x, prop.y + 2)
          paintFern(
            ctx,
            fern,
            mixHex(asHex(summerLeaf), winterGreen(summerLeaf, 1), fade),
            mixHex(asHex(summerStem), winterGreen(summerStem, 1), fade),
          )
          ctx.restore()
        }
      } else {
        const bush = layer.bushes[prop.index]
        let reach = 0
        for (const lobe of bush?.lobes ?? []) {
          reach = Math.max(reach, Math.abs(lobe.dx) + lobe.radius)
        }
        if (bush && near(bush.x, reach)) {
          const look = leafLook(transitionProgress(bush.leaf.start, time))
          ctx.save()
          ctx.translate(bush.x, prop.y)
          drawBushWood(ctx, bush, layer.trunkColor)
          yield* paintBushLeaves(ctx, bush, () => layer.tones, haze, look, 1, 0.3)
          ctx.restore()
        }
      }
      yield
    }
  }
  if (layer.localRadius !== null) {
    // Fade the layer out into the haze away from the creek.
    ctx.globalCompositeOperation = 'destination-in'
    const mask = ctx.createLinearGradient(layer.creek.x - layer.localRadius, 0, layer.creek.x + layer.localRadius, 0)
    mask.addColorStop(0, 'rgba(0, 0, 0, 0)')
    mask.addColorStop(0.3, 'rgba(0, 0, 0, 1)')
    mask.addColorStop(0.7, 'rgba(0, 0, 0, 1)')
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = mask
    ctx.fillRect(left, rowTop, right - left, rowBottom - rowTop + 10)
    ctx.globalCompositeOperation = 'source-over'
  }
  return { canvas, rowTop }
}

/**
 * For the background worker: builds one image of a layer's vegetation in one go and hands it over as a bitmap.
 *
 * @param layer - Forest layer (the parts the drawing needs).
 * @param veg - Where its vegetation stands.
 * @param k - Which moment.
 * @param part - Which kind.
 * @param chunk - Which chunk.
 */
export function buildVegImageSync(
  layer: ForestLayer,
  veg: VegPlan,
  k: number,
  part: 'back' | 'front',
  chunk: number,
): { bitmap: ImageBitmap; rowTop: number } {
  const steps = buildVegImage(layer, veg, k, part, chunk)
  let step = steps.next()
  while (!step.done) {
    step = steps.next()
  }
  return { bitmap: (step.value.canvas as OffscreenCanvas).transferToImageBitmap(), rowTop: step.value.rowTop }
}

/** The ids the background worker knows the layers by (absent when drawing happens on the main thread). */
const workerLayerIds = new WeakMap<ForestLayer, number>()

/** What a layer's images are still wanted for: the chunks and moments (kept up to date by `planVegetation`). */
const vegWanted = new WeakMap<ForestLayer, { first: number; last: number; lo: number; hi: number }>()

/**
 * Frees a layer image's memory when it is dropped.
 *
 * @param image - The image.
 */
function releaseVegImage(image: VegImage): void {
  if (typeof ImageBitmap !== 'undefined' && image.canvas instanceof ImageBitmap) {
    image.canvas.close()
  }
}

/**
 * Builds one image of a layer's vegetation (queued work) and stores it.
 *
 * @param layer - Forest layer.
 * @param strip - Its strip.
 * @param k - Which moment.
 * @param part - Which kind.
 * @param chunk - Which chunk.
 */
function* vegJob(layer: ForestLayer, strip: ForestStrip, k: number, part: 'back' | 'front', chunk: number): Generator<void> {
  const image = yield* buildVegImage(layer, strip.veg, k, part, chunk)
  vegMap(layer).set(vegKey(k, part, chunk), image)
}

/**
 * The chunks of a layer that the camera sees or will soon see (one more each side).
 *
 * @param layer - Forest layer.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 * @param margin - Chunks to add each side.
 */
function visibleChunks(layer: ForestLayer, cameraX: number, viewWidth: number, margin = 1): { first: number; last: number } {
  const x0 = cameraX * layer.parallax
  const lastChunk = Math.max(0, Math.floor((layer.span + 8) / VEG_CHUNK))
  return {
    first: Math.max(0, Math.floor(x0 / VEG_CHUNK) - margin),
    last: Math.min(lastChunk, Math.floor((x0 + viewWidth) / VEG_CHUNK) + margin),
  }
}

let planFrame = 0
let plannedMoment = -1

/**
 * Queues the images the layers' vegetation needs for the time now and next, for the chunks the camera
 * sees: the two moments the time is between first, then the moments after them (so they are ready by the
 * time they are wanted) with less urgency; images of moments passed or chunks far away are dropped.
 *
 * @param world - Play space (the season and the layers).
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function planVegetation(world: World, cameraX: number, viewWidth: number): void {
  const { k, t } = sampleAt(world.season.time)
  // The images of later moments are made between the fades, never during one (see `buildHoldAt`).
  const hold = buildHoldAt(world.season.time)
  holdAheadWork(hold)
  // Planning goes through every layer's chunks and images, which makes a lot of small strings: a few times a
  // second is enough (a chunk is queued a screen or so before it is seen), and at once when the moment changes.
  planFrame += 1
  if (planFrame % 8 !== 0 && k === plannedMoment) {
    return
  }
  plannedMoment = k
  const now = t > 0 ? [k, k + 1] : [k]
  // The next moments are only prepared when they are about to be needed (not all summer long).
  const position = sampleIndexAt(world.season.time)
  const through = position - Math.floor(position)
  const ahead = position < -0.6 || hold ? [] : through >= BUILD_HOLD_END ? [k + 1, k + 2] : [k + 1]
  world.forest.forEach((layer, index) => {
    const strip = forestStrips.get(layer)
    if (!strip) {
      return
    }
    const map = vegMap(layer)
    const { first, last } = visibleChunks(layer, cameraX, viewWidth)
    const exact = visibleChunks(layer, cameraX, viewWidth, 0)
    vegWanted.set(layer, { first: first - 1, last: last + 1, lo: k - 1, hi: k + 3 })
    const workerId = workerLayerIds.get(layer)
    for (const [list, priority] of [[now, 2], [ahead, 7]] as const) {
      for (const moment of list) {
        if (moment >= SAMPLE_COUNT) {
          continue
        }
        // The moments in use get the chunks next to the visible ones too, and so does the next one (it comes into
        // use when the fade starts, and nothing should have to be made then); the ones after it only the visible ones.
        const wide = priority === 2 || moment === k + 1
        for (let chunk = wide ? first : exact.first; chunk <= (wide ? last : exact.last); chunk += 1) {
          for (const part of ['back', 'front'] as const) {
            if (map.has(vegKey(moment, part, chunk)) || !chunkHasContent(layer, strip.veg, part, chunk)) {
              continue
            }
            if (workerId !== undefined && workerUsable()) {
              const key = vegKey(moment, part, chunk)
              requestImage({
                key: `veg|${index}|${key}`,
                priority: priority - index * 0.01 + Math.abs(chunk - Math.floor((cameraX * layer.parallax) / VEG_CHUNK)) * 0.001,
                id: workerId,
                k: moment,
                part,
                chunk,
                wanted: () => vegStillWanted(layer, moment, chunk),
                onDone: (bitmap, rowTop) => {
                  const image: VegImage = { canvas: bitmap, rowTop }
                  if (map.has(key) || !vegStillWanted(layer, moment, chunk)) {
                    releaseVegImage(image)
                  } else {
                    arrivals.push({ layer, map, key, image, moment, chunk })
                  }
                },
              })
            } else {
              enqueueJob(
                `veg|${index}|${moment}|${part}|${chunk}`,
                priority - index * 0.01 + Math.abs(chunk - Math.floor((cameraX * layer.parallax) / VEG_CHUNK)) * 0.001,
                vegJob(layer, strip, moment, part, chunk),
              )
            }
          }
        }
      }
    }
    for (const key of [...map.keys()]) {
      const [moment, , chunk] = key.split('|').map((piece, position) => (position === 1 ? 0 : Number(piece)))
      if ((chunk ?? 0) < first - 1 || (chunk ?? 0) > last + 1 || (moment ?? 0) < k - 1 || (moment ?? 0) > k + 3) {
        const old = map.get(key)
        if (old) {
          releaseVegImage(old)
        }
        map.delete(key)
      }
    }
  })
}

/** Images that came from the worker and are not shown yet (each is given to the graphics card in a frame of its own). */
const arrivals: { layer: ForestLayer; map: Map<string, VegImage>; key: string; image: VegImage; moment: number; chunk: number }[] = []

let uploadCanvas: HTMLCanvasElement | null = null

/**
 * Makes the images that arrived from the worker ready, a few milliseconds' worth a frame: the first time a
 * bitmap is drawn it has to be uploaded to the graphics card, which for a big one is a noticeable stall, so
 * that is done here, one at a time, before the image goes into the layer's map and is used.
 *
 * @param budgetMs - Time to spend.
 */
function settleArrivals(budgetMs: number): void {
  const start = performance.now()
  while (arrivals.length > 0 && performance.now() - start < budgetMs) {
    const arrival = arrivals.shift()
    if (!arrival) {
      break
    }
    if (arrival.map.has(arrival.key) || !vegStillWanted(arrival.layer, arrival.moment, arrival.chunk)) {
      releaseVegImage(arrival.image)
      continue
    }
    // (Big enough for the browser to keep this canvas on the graphics card: a tiny one would not upload anything.)
    if (!uploadCanvas) {
      uploadCanvas = document.createElement('canvas')
      uploadCanvas.width = 512
      uploadCanvas.height = 512
    }
    uploadCanvas.getContext('2d')?.drawImage(arrival.image.canvas, 0, 0, 1, 1)
    arrival.map.set(arrival.key, arrival.image)
  }
}

const contentCache = new WeakMap<ForestLayer, Map<string, boolean>>()

/**
 * Whether anything of a kind of a layer's vegetation reaches into a chunk (an image is only made for chunks that
 * have something in them).
 *
 * @param layer - Forest layer.
 * @param veg - Where its vegetation stands.
 * @param part - Trees and logs, or rocks, ferns and bushes.
 * @param chunk - Chunk.
 */
function chunkHasContent(layer: ForestLayer, veg: VegPlan, part: 'back' | 'front', chunk: number): boolean {
  let cache = contentCache.get(layer)
  if (!cache) {
    cache = new Map()
    contentCache.set(layer, cache)
  }
  const key = `${part}|${chunk}`
  const known = cache.get(key)
  if (known !== undefined) {
    return known
  }
  const left = chunk * VEG_CHUNK
  const right = left + VEG_CHUNK + VEG_OVERLAP
  const near = (x: number, reach: number): boolean => x + reach >= left && x - reach <= right
  let has = false
  if (part === 'back') {
    has =
      layer.trees.some((tree, index) => {
        const at = veg.trees[index]
        return at !== undefined && near(at.x, tree.shape.halfWidth)
      }) ||
      layer.logs.some((log, index) => {
        const at = veg.logs[index]
        return at !== undefined && near(at.x, log.length)
      })
  } else {
    has = veg.props.some((prop) => {
      if (prop.kind === 'rock') {
        return false
      }
      if (prop.kind === 'fern') {
        const fern = layer.ferns[prop.index]
        return fern !== undefined && near(fern.x, fern.size * 1.4)
      }
      const bush = layer.bushes[prop.index]
      let reach = 0
      for (const lobe of bush?.lobes ?? []) {
        reach = Math.max(reach, Math.abs(lobe.dx) + lobe.radius)
      }
      return bush !== undefined && near(bush.x, reach)
    })
  }
  cache.set(key, has)
  return has
}

/**
 * Whether an image of a layer is still needed (its moment and chunk are inside what is being kept).
 *
 * @param layer - Forest layer.
 * @param moment - Moment.
 * @param chunk - Chunk.
 */
function vegStillWanted(layer: ForestLayer, moment: number, chunk: number): boolean {
  const range = vegWanted.get(layer)
  return !range || (chunk >= range.first && chunk <= range.last && moment >= range.lo && moment <= range.hi)
}

/**
 * How much of the seasons' background work is done (for the debug display and tests): jobs waiting, and
 * how many layer images of vegetation exist and how many megapixels they hold.
 *
 * @param world - Play space.
 */
export function seasonWorkStatus(world: World): { pending: number; images: number; megapixels: number } {
  let images = 0
  let pixels = 0
  for (const layer of world.forest) {
    for (const image of vegMap(layer).values()) {
      images += 1
      pixels += image.canvas.width * image.canvas.height
    }
  }
  return { pending: pendingJobs() + pendingRequests(), images, megapixels: Math.round(pixels / 1e5) / 10 }
}

/** The season time of the frame being drawn (rocks get their snow from it). */
let seasonNow = 0

/**
 * Whether everything the first view of the forest needs is made: every layer's images for the chunks in view
 * (for the moment the clock is at), with none still on their way to being shown.
 *
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
export function forestReady(world: World, cameraX: number, viewWidth: number): boolean {
  if (arrivals.length > 0 || oakArrivalsPending()) {
    return false
  }
  const { k } = sampleAt(world.season.time)
  for (const layer of world.forest) {
    const strip = forestStrips.get(layer)
    if (!strip) {
      return false
    }
    const { first, last } = visibleChunks(layer, cameraX, viewWidth, 0)
    for (let chunk = first; chunk <= last; chunk += 1) {
      for (const part of ['back', 'front'] as const) {
        if (chunkHasContent(layer, strip.veg, part, chunk) && !vegMap(layer).has(vegKey(k, part, chunk))) {
          return false
        }
      }
    }
  }
  return true
}

/**
 * For experiments: megapixels of the main bitmap caches.
 *
 * @param world - Play space.
 */
export function memoryReport(world: World): Record<string, number | { count: number; mp: number }> {
  const mp = (pixels: number): number => Math.round(pixels / 1e5) / 10
  let strips = 0
  let winterStrips = 0
  let veg = 0
  let vegCount = 0
  let fades = 0
  let bush = 0
  for (const layer of world.forest) {
    const strip = forestStrips.get(layer)
    if (strip) {
      strips += strip.canvas.width * strip.canvas.height
      winterStrips += strip.frozenCanvas ? strip.frozenCanvas.width * strip.frozenCanvas.height : 0
    }
    for (const image of vegMap(layer).values()) {
      veg += image.canvas.width * image.canvas.height
      vegCount += 1
    }
    for (const piece of fadePieces.get(layer)?.values() ?? []) {
      fades += piece.canvas.width * piece.canvas.height
    }
  }
  for (const b of [...world.bushes, ...world.frontBushes.map((front) => front.bush)]) {
    for (const sprite of bushParts.get(b)?.values() ?? []) {
      bush += sprite.canvas.width * sprite.canvas.height
    }
  }
  let tiles = 0
  for (const tile of leafTileEntry(world).tiles.values()) {
    tiles += tile.canvas.width * tile.canvas.height
  }
  return { strips: mp(strips), winterStrips: mp(winterStrips), veg: mp(veg), vegCount, fades: mp(fades), bush: mp(bush), tiles: mp(tiles), oak: oakCacheReport() }
}

/**
 * For experiments: per layer, the parallax, the images' count and megapixels and the resolution.
 *
 * @param world - Play space.
 */
export function layerImageReport(world: World): { p: number; res: number; images: number; mp: number }[] {
  return world.forest.map((layer) => {
    let pixels = 0
    const images = [...vegMap(layer).values()]
    for (const image of images) {
      pixels += image.canvas.width * image.canvas.height
    }
    return { p: layer.parallax, res: vegRes(layer), images: images.length, mp: Math.round(pixels / 1e5) / 10 }
  })
}

/** How long the last frame's drawing took (the background work is given more time when it was cheap). */
let lastSceneMs = 0

type FadePiece = { k: number; q: number; canvas: HTMLCanvasElement }
const fadePieces = new WeakMap<ForestLayer, Map<string, FadePiece>>()

/**
 * Draws one kind of a layer's vegetation for the time now: for each chunk in view, the image of the moment
 * the time is just past and the image of the next moment, cross-faded by how far between them it is
 * (composed per chunk and quantized to tenths, so the composing happens a few times a minute, not every
 * frame). A chunk whose image is not made yet shows the image of another moment, or nothing.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param layer - Forest layer.
 * @param strip - Its strip.
 * @param world - Play space (the season).
 * @param base - Screen y of the layer's base line.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 * @param limit - Screen y below which nothing of this layer can show (nearer layers cover it): rows below are not drawn.
 * @param part - Trees and logs, or rocks, ferns and bushes.
 */
function drawVegetation(
  ctx: CanvasRenderingContext2D,
  layer: ForestLayer,
  strip: ForestStrip,
  world: World,
  base: number,
  cameraX: number,
  viewWidth: number,
  limit: number,
  part: 'back' | 'front',
): void {
  const { k, t } = sampleAt(world.season.time)
  const map = vegMap(layer)
  const res = vegRes(layer)
  const x0 = cameraX * layer.parallax
  const firstChunk = Math.max(0, Math.floor((x0 - 8) / VEG_CHUNK))
  const lastChunk = Math.floor((x0 + viewWidth + 8) / VEG_CHUNK)
  let pieces = fadePieces.get(layer)
  if (!pieces) {
    pieces = new Map()
    fadePieces.set(layer, pieces)
  }
  for (let chunk = firstChunk; chunk <= lastChunk; chunk += 1) {
    if (!chunkHasContent(layer, strip.veg, part, chunk)) {
      continue
    }
    const first = map.get(vegKey(k, part, chunk))
    const second = map.get(vegKey(k + 1, part, chunk))
    // A chunk whose image for these moments is not made yet shows the nearest moment's image that exists.
    let any = first ?? second
    for (let distance = 1; !any && distance < SAMPLE_COUNT; distance += 1) {
      any = map.get(vegKey(k - distance, part, chunk)) ?? map.get(vegKey(k + 1 + distance, part, chunk))
    }
    if (!any) {
      continue
    }
    const y = base - strip.originY + any.rowTop
    // Only the rows on the screen and above the cull line are drawn.
    const firstRow = Math.max(0, Math.floor(-y * res))
    const rows = Math.max(0, Math.min(any.canvas.height, Math.ceil((limit - y) * res)) - firstRow)
    if (rows <= 0) {
      continue
    }
    const x = chunk * VEG_CHUNK - x0
    let source = any.canvas
    let cropX = 0
    let cropWidth = 0
    if (first && second && t > 0 && t < 1) {
      // During the short fade the two images are added up every frame, each at its own share (the
      // leaves of one fade out as the other's fade in), onto a canvas kept for the chunk. Only the part
      // that shows is added up (two columns more each side, so smoothing at the screen's edges is unchanged).
      cropX = Math.max(0, Math.floor(-x * res) - 2)
      cropWidth = Math.min(first.canvas.width, Math.ceil((viewWidth - x) * res) + 2) - cropX
      if (cropWidth <= 0) {
        continue
      }
      const key = `${part}|${chunk}`
      let fade = pieces.get(key)
      if (!fade) {
        fade = { k, q: 0, canvas: document.createElement('canvas') }
        pieces.set(key, fade)
      }
      if (fade.canvas.width !== first.canvas.width || fade.canvas.height !== first.canvas.height) {
        fade.canvas.width = first.canvas.width
        fade.canvas.height = first.canvas.height
      }
      const pctx = fade.canvas.getContext('2d')
      if (pctx) {
        pctx.globalCompositeOperation = 'source-over'
        pctx.clearRect(cropX, firstRow, cropWidth, rows)
        pctx.globalAlpha = 1 - t
        pctx.drawImage(first.canvas, cropX, firstRow, cropWidth, rows, cropX, firstRow, cropWidth, rows)
        pctx.globalCompositeOperation = 'lighter'
        pctx.globalAlpha = t
        pctx.drawImage(second.canvas, cropX, firstRow, cropWidth, rows, cropX, firstRow, cropWidth, rows)
        pctx.globalAlpha = 1
        pctx.globalCompositeOperation = 'source-over'
      }
      source = fade.canvas
    } else if (second && (t >= 1 || !first)) {
      source = second.canvas
    } else if (first) {
      source = first.canvas
    }
    const columns = cropWidth > 0 ? cropWidth : source.width
    ctx.drawImage(source, cropX, firstRow, columns, rows, x + cropX / res, y + firstRow / res, columns / res, rows / res)
  }
}

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
  const veg: VegPlan = { trees: [], logs: [], props: [], backBottom: 0, frontTop: 0, frontBottom: 0 }
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(layer.span * resolution)
  // Extra depth below the horizon so the layer's whole ground can carry leaf litter.
  const litterDepth = Math.round(world.viewHeight * 0.4)
  const bottomPad = 6 + Math.ceil(bedBottom) + litterDepth
  canvas.height = Math.ceil((originY + bottomPad) * resolution)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(resolution, resolution)
    // Trees, logs, rocks, ferns and bushes are not painted here: where each stands is recorded, and they are
    // drawn (for each moment of the seasons) onto images of their own (`buildVegImage`), the trees and logs
    // behind this ground and the rest in front of it. A trunk reaches down to the lowest ground under it so
    // neither side of its base hangs in the air.
    for (const tree of layer.trees) {
      const trunkHalf = (tree.shape.segments[0]?.w0 ?? 40) / 2
      const lowest = Math.max(offset(tree.x - trunkHalf), offset(tree.x), offset(tree.x + trunkHalf))
      veg.trees.push({ x: tree.x, y: originY + lowest + 2 })
    }
    for (const log of layer.logs) {
      // The log lies along the horizon: tilted with its slope and resting on the ground at its
      // middle, so neither end hangs in the air.
      const half = log.length / 2
      const endL = offset(log.x - half)
      const endR = offset(log.x + half)
      const ground = Math.max(endL, offset(log.x - half / 2), offset(log.x), offset(log.x + half / 2), endR)
      veg.logs.push({ x: log.x, y: originY + ground - log.radius * 0.8, angle: Math.atan2(endR - endL, log.length) })
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
    // (Seeded, so that rebuilding the strip when the trees' leaves change leaves the litter as it was.)
    const rnd = seededRandom(Math.floor(layer.parallax * 100000) + 17)
    const batches: number[][] = layer.leafColors.map(() => [])
    for (let x = 0; x < layer.span; x += columnStep) {
      const perColumn = perColumnAt(x)
      const count = Math.floor(perColumn) + (rnd() < perColumn - Math.floor(perColumn) ? 1 : 0)
      for (let i = 0; i < count; i += 1) {
        const lx = x + (rnd() * 2 - 1) * columnStep
        if (Math.abs(lx - creek.x) < creek.halfWidth) {
          continue
        }
        const top = offset(lx) + 0.02 * leafUnit
        const lowest = limitAt(lx)
        if (lowest <= top) {
          continue
        }
        const y = top + rnd() * (lowest - top)
        const nearness = Math.min(1, Math.max(0, (y - top) / Math.max(1, bottomEdge - top)))
        const rx = (0.035 + rnd() * 0.045) * leafUnit * (1 + 0.5 * nearness)
        batches[Math.floor(rnd() * batches.length)]?.push(lx, originY + y, rx, rx * (0.35 + rnd() * 0.2), (rnd() - 0.5) * Math.PI)
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
    // Rocks, ferns and bushes: recorded, back to front (see above).
    for (const [index, rock] of layer.rocks.entries()) {
      veg.props.push({ kind: 'rock', index, y: originY + offset(rock.x) + dropOf(rock.x) })
    }
    for (const [index, fern] of layer.ferns.entries()) {
      veg.props.push({ kind: 'fern', index, y: originY + offset(fern.x) + dropOf(fern.x + 1) })
    }
    for (const [index, bush] of layer.bushes.entries()) {
      veg.props.push({ kind: 'bush', index, y: originY + offset(bush.x) + dropOf(bush.x + 2) * 0.6 })
    }
    veg.props.sort((p, q) => p.y - q.y)
  }
  if (layer.localRadius !== null) {
    // Fade the layer out into the haze away from the creek.
    for (const c of [ctx]) {
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
  // How far down the trees' image reaches (the ground covers the rest) and how high the props' image starts.
  let lowestGround = 0
  let highestGround = 0
  for (let x = 0; x <= layer.span + 8; x += 8) {
    lowestGround = Math.max(lowestGround, offset(x))
    highestGround = Math.min(highestGround, offset(x))
  }
  veg.backBottom = Math.min(originY + bottomPad, originY + lowestGround + 12)
  let highest = originY
  for (const prop of veg.props) {
    const reach =
      prop.kind === 'rock'
        ? (layer.rocks[prop.index]?.ry ?? 0) * 1.6
        : prop.kind === 'fern'
          ? (layer.ferns[prop.index]?.size ?? 0) * 1.3
          : Math.max(0, ...(layer.bushes[prop.index]?.lobes.map((lobe) => lobe.radius - lobe.dy) ?? [0])) + 8
    highest = Math.min(highest, prop.y - reach)
  }
  veg.frontTop = Math.max(0, Math.floor(highest))
  veg.frontBottom = originY + bottomPad
  const strip = { canvas, resolution, originY, waterLine, columnGround, veg, rise: Math.max(0, -highestGround) + 20 }
  forestStrips.set(layer, strip)
  if (workerUsable()) {
    const id = registerLayer(layer, veg)
    if (id >= 0) {
      workerLayerIds.set(layer, id)
    }
  }
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
  // While snow covers all of the ground (it comes in, and stays until the melt) the ground itself is its color,
  // mixed from the dirt's by how thick the snow is, and the litter on it fades away: the same as a layer of
  // snow over it, with no edge of its own. Once the snow melts in patches, the patches are drawn over the dirt
  // (see `drawSnow`).
  const whiteness = snowCover(world.season.time) >= 0.999 ? snowThickness(world.season.time) : 0
  const dirt = ctx.createLinearGradient(0, world.groundY - world.groundHeight * 4, 0, bottom)
  dirt.addColorStop(0, whiteness > 0 ? mixColor(GROUND_COLOR, SNOW_TOP, whiteness) : GROUND_COLOR)
  dirt.addColorStop(1, whiteness > 0 ? mixColor('#4b2f1a', SNOW_BOTTOM, whiteness) : '#4b2f1a')
  ctx.fillStyle = dirt
  ctx.beginPath()
  ctx.moveTo(startX, bottom)
  // The snow patches that take over at the start of the melt stand 3 px above the surface: the snow-colored
  // ground rises that much over the 30 s before, slowly, so that nothing seems to move when the patches start.
  const meltIn = (world.season.time / SEGMENT_SECONDS - (6 - 30 / SEGMENT_SECONDS)) / (30 / SEGMENT_SECONDS)
  const raise = whiteness >= 0.999 ? 3 * Math.max(0, Math.min(1, meltIn)) * Math.max(0, Math.min(1, meltIn)) * (3 - 2 * Math.max(0, Math.min(1, meltIn))) : 0
  for (let x = startX; x <= endX; x += terrain.step) {
    ctx.lineTo(x, groundYAt(terrain, x) - raise)
  }
  ctx.lineTo(endX, bottom)
  ctx.closePath()
  ctx.fill()
}

/**
 * Draws the melting snow's patches on the foreground ground, over the litter (while snow covers everything the
 * ground itself is snow-colored, see `drawGround`), else
 * its patches (grid cells that each hold a patch, which grow from their own moment of the melt).
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space (the terrain and the season).
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawSnow(ctx: CanvasRenderingContext2D, world: World, cameraX: number, viewWidth: number): void {
  const thickness = snowThickness(world.season.time)
  const cover = snowCover(world.season.time)
  // (While it covers everything the ground itself is snow-colored, see `drawGround`.)
  if (thickness <= 0 || cover <= 0 || cover >= 0.999) {
    return
  }
  const { terrain } = world
  const bottom = world.height + terrain.creek.depth
  const gradient = ctx.createLinearGradient(0, world.groundY - world.groundHeight * 4, 0, bottom)
  gradient.addColorStop(0, SNOW_TOP)
  gradient.addColorStop(1, SNOW_BOTTOM)
  ctx.fillStyle = gradient
  ctx.globalAlpha = thickness
  const firstColumn = Math.floor((cameraX - SNOW_CELL_X * 1.4) / SNOW_CELL_X)
  const lastColumn = Math.floor((cameraX + viewWidth + SNOW_CELL_X * 1.4) / SNOW_CELL_X)
  // The patches are kept from frame to frame until the melt has moved them by a fraction of a pixel.
  let held = groundPatches.get(world)
  if (!held || firstColumn < held.firstColumn || lastColumn > held.lastColumn || Math.abs(held.cover - cover) >= MELT_COVER_STEP) {
    const rows = Math.ceil((bottom - world.groundY + SNOW_CELL_DEPTH) / SNOW_CELL_DEPTH)
    const columnFrom = firstColumn - MELT_COLUMN_MARGIN
    const columnTo = lastColumn + MELT_COLUMN_MARGIN
    const path = new Path2D()
    const points = 30
    for (let i = columnFrom; i <= columnTo; i += 1) {
      for (let j = 0; j <= rows; j += 1) {
        const blob = snowBlob(i, j, cover)
        if (!blob) {
          continue
        }
        for (let k = 0; k < points; k += 1) {
          const angle = (k / points) * Math.PI * 2
          const stretch = blobStretch(blob, angle)
          const x = blob.x + Math.cos(angle) * blob.rx * stretch
          const depth = Math.max(0, blob.depth + Math.sin(angle) * blob.ry * stretch)
          const y = groundYAt(terrain, x) + depth - (depth === 0 ? 3 : 0)
          if (k === 0) {
            path.moveTo(x, y)
          } else {
            path.lineTo(x, y)
          }
        }
        path.closePath()
      }
    }
    held = { path, cover, firstColumn: columnFrom, lastColumn: columnTo }
    groundPatches.set(world, held)
  }
  ctx.fill(held.path)
  ctx.globalAlpha = 1
}

/** The foreground's melting snow patches per world, and the cover and grid columns they were made for. */
const groundPatches = new WeakMap<World, { path: Path2D; cover: number; firstColumn: number; lastColumn: number }>()

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
  // The litter fades away as the snow comes in (while it covers everything); once the snow starts to melt it is
  // all there again, showing wherever the snow has gone (the patches that are left cover it).
  const litterAlpha = snowCover(world.season.time) >= 0.999 ? 1 - snowThickness(world.season.time) : 1
  if (litterAlpha <= 0.01) {
    return
  }
  ctx.globalAlpha = litterAlpha
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
  ctx.globalAlpha = 1
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

/** Whether the debug display is on: the minimap, the NPC labels above the birds and the follow arrows are drawn only then. */
let showMinimap = true

/**
 * Shows or hides the minimap.
 *
 * @param on - Whether to show it.
 */
export function setShowMinimap(on: boolean): void {
  showMinimap = on
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
    if (leaf.snow) {
      // A puff of snow: round, and it fades into the snow.
      ctx.fillStyle = f > 0.01 ? mixColor(leaf.color, SNOW_BOTTOM, f) : leaf.color
      ctx.beginPath()
      ctx.ellipse(leaf.x, leaf.y + f * leaf.rx * 0.8, leaf.rx * (1 - 0.5 * f), leaf.rx * 0.8 * (1 - 0.8 * f), 0, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    // Leaves under the snow are hidden by it (thin snow lets them show through).
    const covered = snowAt(leaf.restX, leaf.restY - groundYAt(world.terrain, leaf.restX), world.season.time)
    if (covered > 0.99) {
      continue
    }
    ctx.globalAlpha = 1 - covered
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
    ctx.globalAlpha = 1
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
  seasonTime: number,
): void {
  const left = cameraX - 8
  const right = cameraX + viewWidth + 8
  for (const tree of trees) {
    const baseX = tree.x + tree.trunkWidth / 2
    if (baseX + tree.shape.halfWidth < left || baseX - tree.shape.halfWidth > right) {
      continue
    }
    drawOak(ctx, tree.shape, baseX, groundYAt(terrain, baseX), OAK_TONES, TRUNK_COLOR, leafStageMix(transitionProgress(tree.shape.leaf.start, seasonTime)))
  }
}

/**
 * How far along its change from summer to winter an object is.
 *
 * @param start - The object's start, 0-1.
 * @param world - Play space (the season).
 */
function fadeOf(start: number, world: World): number {
  return transitionProgress(start, world.season.time)
}

/**
 * The look of the leaves of a tree or bush (which look it holds and the fade to the next).
 *
 * @param start - The object's start, 0-1.
 * @param world - Play space (the season).
 */
function alphasOf(start: number, world: World): { a: number; b: number; w: number } {
  return leafStageMix(fadeOf(start, world))
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
      drawFern(ctx, fern, groundYAt(world.terrain, fern.x) + 6, fadeOf(fern.fadeStart, world))
    }
  }
  for (const bush of world.bushes) {
    if (bushOnScreen(bush, cameraX, viewWidth) && !overhangsWater(world, bush)) {
      drawBush(ctx, bush, groundYAt(world.terrain, bush.x) + 14, alphasOf(bush.leaf.start, world))
    }
  }
  for (const rock of world.rocks) {
    if (rock.x + rock.rx * 1.5 > left && rock.x - rock.rx * 1.5 < right && !isCreekRock(world, rock)) {
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
        fadeOf(rock.fadeStart, world),
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
      drawLog(ctx, log, under, fadeOf(log.fadeStart, world))
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
  // The creek flows on toward the viewer into an imaginary layer in front of the foreground, placed by
  // the same parallax math as the layers behind it (see `drawForest`): its position moves with the
  // camera by `CREEK_FRONT_PARALLAX` times as much as the foreground does, horizontally and vertically,
  // so the water does not seem tied to the bottom of the screen when the bird flies up or down.
  const refWidth = world.viewHeight * TYPICAL_ASPECT_RATIO
  const refCamera = creek.x - refWidth / 2
  const maxCamY = Math.max(0, world.height - world.viewHeight)
  const frontX = cameraX + refWidth / 2 + creek.frontOffset + CREEK_FRONT_PARALLAX * (refCamera - cameraX)
  const frontY = creek.waterY + (CREEK_FRONT_PARALLAX - 1) * (maxCamY - camera.y) + CREEK_FRONT_DROP_IN_VIEWS * world.viewHeight
  const farLeft = Math.min(creek.x - creek.halfWidth, frontX - creek.frontHalfWidth)
  const farRight = Math.max(creek.x + creek.halfWidth, frontX + creek.frontHalfWidth)
  if (farRight < cameraX - step || farLeft > cameraX + viewWidth + step) {
    // The water is off screen, but the shore rocks (up to a bank's width from it) may still be in view.
    drawShoreRocks(ctx, world, camera, viewWidth)
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

  // From the water's edges the creek widens to the front layer's creek (above), then runs straight down
  // that layer's banks to the bottom of the screen.
  const bottom = Math.max(camera.y + viewHeight + 4, frontY + 4)
  if (bottom > creek.waterY) {
    const mid = (creek.waterY + frontY) / 2
    const front = ctx.createLinearGradient(0, creek.waterY, 0, bottom)
    front.addColorStop(0, '#6aa3c4')
    front.addColorStop(1, '#5f9bbd')
    ctx.fillStyle = front
    ctx.beginPath()
    ctx.moveTo(creek.x - creek.halfWidth, creek.waterY)
    ctx.lineTo(creek.x + creek.halfWidth, creek.waterY)
    ctx.bezierCurveTo(creek.x + creek.halfWidth, mid, frontX + creek.frontHalfWidth, mid, frontX + creek.frontHalfWidth, frontY)
    ctx.lineTo(frontX + creek.frontHalfWidth, bottom)
    ctx.lineTo(frontX - creek.frontHalfWidth, bottom)
    ctx.lineTo(frontX - creek.frontHalfWidth, frontY)
    ctx.bezierCurveTo(frontX - creek.frontHalfWidth, mid, creek.x - creek.halfWidth, mid, creek.x - creek.halfWidth, creek.waterY)
    ctx.closePath()
    ctx.fill()
  }

  drawShoreRocks(ctx, world, camera, viewWidth)
}

/**
 * Draws the shore rocks (the rocks on the creek's banks) in front of the water.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param camera - View origin.
 * @param viewWidth - Viewport width.
 */
function drawShoreRocks(ctx: CanvasRenderingContext2D, world: World, camera: Camera, viewWidth: number): void {
  const cameraX = camera.x
  const { step } = world.terrain
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
    if (isCreekRock(world, rock) && rock.x + rock.rx * 1.5 > viewLeft && rock.x - rock.rx * 1.5 < viewRight) {
      drawRock(ctx, rock, groundYAt(world.terrain, rock.x), fadeOf(rock.fadeStart, world))
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
    if (front.rock.x + front.rock.rx * 1.5 > left && front.rock.x - front.rock.rx * 1.5 < right) {
      items.push({ y: front.y, draw: () => drawRock(ctx, front.rock, front.y, fadeOf(front.rock.fadeStart, world)) })
    }
  }
  for (const front of world.frontBushes) {
    if (bushOnScreen(front.bush, cameraX, viewWidth)) {
      items.push({ y: front.y, draw: () => drawBush(ctx, front.bush, front.y, alphasOf(front.bush.leaf.start, world)) })
    }
  }
  for (const front of world.frontFerns) {
    if (front.fern.x > left && front.fern.x < right) {
      items.push({ y: front.y, draw: () => drawFern(ctx, front.fern, front.y, fadeOf(front.fern.fadeStart, world)) })
    }
  }
  // Bushes and ferns reaching over the creek are drawn in front of the water (not cut off by it) but
  // stand far enough down (their whole height below the surface line) that they never overlap what
  // is on the surface: the birds, acorns and kicked leaves.
  for (const bush of world.bushes) {
    if (overhangsWater(world, bush) && bushOnScreen(bush, cameraX, viewWidth)) {
      const y = groundYAt(world.terrain, bush.x) + bushHeight(bush) + 6
      items.push({ y, draw: () => drawBush(ctx, bush, y, alphasOf(bush.leaf.start, world)) })
    }
  }
  for (const fern of world.ferns) {
    if (fernOverhangsWater(world, fern) && fern.x > left && fern.x < right) {
      const y = groundYAt(world.terrain, fern.x) + fern.size * 1.05 + 6
      items.push({ y, draw: () => drawFern(ctx, fern, y, fadeOf(fern.fadeStart, world)) })
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
const SQUIRREL_FUR_WARM = '#a09a93'
const SQUIRREL_BELLY = '#dcdedf'

/**
 * Fills and outlines a closed path of cubic bezier segments, given as a flat list: the start point,
 * then groups of six numbers (two control points and the end point).
 *
 * @param ctx - 2D canvas context.
 * @param pts - Start x, y, then c1x, c1y, c2x, c2y, x, y for every segment.
 * @param fill - Fill color.
 * @param outline - Outline color, or null for none.
 */
function bezierShape(ctx: CanvasRenderingContext2D, pts: number[], fill: string, outline: string | null = null): void {
  ctx.beginPath()
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0)
  for (let i = 2; i + 5 < pts.length; i += 6) {
    ctx.bezierCurveTo(pts[i] ?? 0, pts[i + 1] ?? 0, pts[i + 2] ?? 0, pts[i + 3] ?? 0, pts[i + 4] ?? 0, pts[i + 5] ?? 0)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (outline) {
    ctx.strokeStyle = outline
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
}

/**
 * Draws a tapered limb along a polyline: a smooth organic shape from `w0` wide at the first point to
 * `w1` at the last.
 *
 * @param ctx - 2D canvas context.
 * @param pts - Points along the limb, [x, y] each.
 * @param w0 - Width at the start.
 * @param w1 - Width at the end.
 * @param fill - Fill color.
 */
function taperedLimb(ctx: CanvasRenderingContext2D, pts: [number, number][], w0: number, w1: number, fill: string): void {
  const left: [number, number][] = []
  const right: [number, number][] = []
  pts.forEach(([x, y], i) => {
    const a = pts[Math.max(0, i - 1)] ?? [x, y]
    const b = pts[Math.min(pts.length - 1, i + 1)] ?? [x, y]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = -(b[1] - a[1]) / len
    const ny = (b[0] - a[0]) / len
    const w = (w0 + ((w1 - w0) * i) / Math.max(1, pts.length - 1)) / 2
    left.push([x + nx * w, y + ny * w])
    right.push([x - nx * w, y - ny * w])
  })
  ctx.beginPath()
  left.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  for (let i = right.length - 1; i >= 0; i -= 1) {
    ctx.lineTo(right[i]?.[0] ?? 0, right[i]?.[1] ?? 0)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  // A rounded end for the paw.
  const [px, py] = pts[pts.length - 1] ?? [0, 0]
  ctx.beginPath()
  ctx.arc(px, py, w1 / 2, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Draws a squirrel's bushy tail from its rump with an S-shaped sweep: stretched out fully (`curl` 0) it
 * trails back, 0.8 of the body's length; the more it is curled (up to 1) the more it rises over the
 * back, bowing backward low down and forward higher up, as in the photos.
 *
 * @param ctx - 2D canvas context (sprite units, body facing +x).
 * @param curl - 0 stretched out, 1 curled up over the back.
 * @param hug - 0 to 1: pulls the curl in toward the body (a squirrel sitting up keeps its tail close behind its back).
 */
function drawSquirrelTail(ctx: CanvasRenderingContext2D, curl: number, hug = 0): void {
  const base = [-44, 10]
  const length = 80 - 12 * curl
  // Chord direction: straight back when stretched, up and a little back when curled.
  let dx = -1 + 0.72 * curl
  let dy = -0.96 * curl
  const dl = Math.hypot(dx, dy) || 1
  dx /= dl
  dy /= dl
  // Normal to the chord, pointing forward (toward the head) for the sweep.
  const nx = -dy
  const ny = dx
  const sweep = (3 + 12 * curl) * (1 - 0.3 * hug)
  const n = 24
  const centre: [number, number][] = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    // S: back first, then forward (the sign flips at the middle), fading to nothing at both ends.
    const s = -sweep * Math.sin(2 * Math.PI * t) * (0.6 + 0.4 * Math.sin(Math.PI * t))
    centre.push([(base[0] ?? 0) + dx * length * t + nx * s, (base[1] ?? 0) + dy * length * t + ny * s])
  }
  const left: [number, number][] = []
  const right: [number, number][] = []
  const normals: [number, number][] = []
  const halfWidths: number[] = []
  centre.forEach(([x, y], i) => {
    const a = centre[Math.max(0, i - 1)] ?? [x, y]
    const b = centre[Math.min(n, i + 1)] ?? [x, y]
    const tx = b[0] - a[0]
    const ty = b[1] - a[1]
    const len = Math.hypot(tx, ty) || 1
    const px = -ty / len
    const py = tx / len
    // Bushy but slim: narrow at the rump, fullest in the upper half, a rounded fuzzy end.
    const t = i / n
    const w = 4 + 11 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.06)) ** 0.8 + (t > 0.9 ? 1.6 : 0)
    normals.push([px, py])
    halfWidths.push(w)
    left.push([x + px * w, y + py * w])
    right.push([x - px * w, y - py * w])
  })
  ctx.fillStyle = SQUIRREL_FUR
  ctx.strokeStyle = SQUIRREL_FUR_WARM
  ctx.lineWidth = 2.2
  ctx.beginPath()
  left.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  for (let i = n; i >= 0; i -= 1) {
    ctx.lineTo(right[i]?.[0] ?? 0, right[i]?.[1] ?? 0)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Fur: lighter and darker hairs along the tail.
  ctx.lineWidth = 1.4
  for (const f of [-0.62, -0.25, 0.12, 0.45, 0.72]) {
    ctx.strokeStyle = f > 0.5 || f < -0.5 ? SQUIRREL_FUR_LIGHT : SQUIRREL_FUR_DARK
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    for (let i = 2; i <= n - 1; i += 1) {
      const [x, y] = centre[i] ?? [0, 0]
      const [px, py] = normals[i] ?? [0, 0]
      const w = (halfWidths[i] ?? 0) * f
      if (i === 2) {
        ctx.moveTo(x + px * w, y + py * w)
      } else {
        ctx.lineTo(x + px * w, y + py * w)
      }
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/**
 * Draws a squirrel's head, nose to +x, centred where the head's middle is: a rounded skull sloping to a
 * pointed snout, a pale muzzle, a dark eye with a pale ring and two rounded ears.
 *
 * @param ctx - 2D canvas context, origin at the head's centre.
 */
function drawSquirrelHead(ctx: CanvasRenderingContext2D): void {
  // Far ear, head, muzzle, near ear, nose, eye.
  bezierShape(ctx, [-1, -9, -2, -17, 5, -21, 7, -14, 8, -11, 7, -9, 5, -8], SQUIRREL_FUR_DARK)
  bezierShape(
    ctx,
    [-11, 3, -12, -7, -4, -12, 5, -10, 12, -8, 17, -1, 17, 4, 17, 8, 13, 10, 9, 11, 2, 13, -10, 12, -11, 3],
    SQUIRREL_FUR,
  )
  bezierShape(ctx, [6, 3, 10, -0.5, 17, 2, 17, 5, 17, 8, 13, 10, 9, 10, 5, 9.5, 4, 5.5, 6, 3], SQUIRREL_BELLY)
  bezierShape(ctx, [-8, -8, -11, -17, -4, -22, -1, -14, 0, -11, -1, -8, -3, -7], SQUIRREL_FUR_DARK)
  ctx.fillStyle = '#3b2c2c'
  ctx.beginPath()
  ctx.arc(16.3, 3.8, 2.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = SQUIRREL_FUR_LIGHT
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(4, -3, 3.6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#16181b'
  ctx.beginPath()
  ctx.arc(4, -3, 2.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(4.7, -3.6, 0.7, 0, Math.PI * 2)
  ctx.fill()
}

/** The squirrel's torso (a hunched back, a deep chest and belly) as bezier points, nose toward +x. */
const SQUIRREL_TORSO = [-42, 18, -46, 1, -30, -11, -8, -10, 8, -9, 20, -6, 30, 0, 36, 5, 38, 15, 32, 25, 26, 33, 6, 34, -10, 33, -22, 33, -34, 31, -42, 18]
/** The pale underside along the belly and chest. */
const SQUIRREL_BELLY_SHAPE = [-14, 32, 0, 34, 20, 32, 32, 22, 25, 28, 6, 29, -14, 32]
/** The hindquarters: a big rounded thigh over the haunch. */
const SQUIRREL_THIGH = [-42, 9, -34, -4, -10, -3, -7, 15, -5, 27, -13, 34, -22, 35, -32, 36, -44, 29, -42, 9]
/** A hind foot lying along the ground: heel, long sole, toes. */
const SQUIRREL_FOOT = [-36, 33, -30, 31, -15, 31, -4, 34, 0, 35.5, 0, 39.5, -5, 40.5, -14, 41.5, -26, 41.5, -35, 40, -39, 39, -39, 34, -36, 33]

/** Where the hind legs stay in every pose: the haunch is the hip, and the big foot lies out in front of it. */
const SQUIRREL_HIP = [-24, 24]
/** How far the body tips up about the hip when the squirrel sits up to eat. */
const SQUIRREL_SIT_TILT = -1.15

/**
 * Draws a squirrel: gray fur, a long hunched body (as long as a blue jay) with a big bushy S-curved
 * tail, a pale belly and small round ears. The haunch and the big hind foot are the same in every
 * pose; what changes is the body (it tips up about the hip to sit upright, as in the photos, when the
 * squirrel eats, the head tilted down and both front paws holding the acorn at its mouth) and the tail
 * (arched over the back when moving or standing, curled up behind when sitting, trailing when
 * climbing). While sniffing, digging or burying its nose goes to the ground, and on its trunk it is
 * turned to climb up or down.
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
  const eating = bird.eatTimer > 0 && !climbing
  const progress = eating ? 1 - bird.eatTimer / EAT_DURATION : 0
  // Nibbling: the head and paws bob a little.
  const nibble = eating ? Math.sin(progress * Math.PI * 12) : 0
  // How far the head is down (0 up, 1 nose on the ground), smoothly in and out so it never jumps.
  const smooth = (x: number): number => {
    const t = Math.max(0, Math.min(1, x))
    return t * t * (3 - 2 * t)
  }
  const envelope = (p: number): number => smooth(p / 0.15) * smooth((1 - p) / 0.15)
  // Digging (burying, digging up): the front paws scratch at the ground, alternating.
  let digging = false
  let digPhase = 0
  let dip = 0
  if (bird.sniff >= 0) {
    // Sniffing: the nose goes down and stays there, hardly moving.
    dip = envelope(bird.sniff) * (0.97 + 0.03 * Math.sin(bird.sniff * Math.PI * 9))
  } else if (bird.action) {
    const p = Math.max(0, Math.min(1, bird.action.timer / bird.action.duration))
    if (bird.action.kind === 'pickup') {
      // One smooth stoop to the acorn and back up.
      dip = Math.sin(Math.PI * p) ** 0.8
    } else {
      // Burying / digging up: the head works up and down while the paws scratch.
      digging = true
      digPhase = p * Math.PI * 2 * 4
      dip = envelope(p) * (0.8 + 0.2 * Math.sin(p * Math.PI * 2 * 2.5))
    }
  }
  // The tail is rarely stretched out: arched over the back when moving or standing, curled right up
  // when sitting, trailing when climbing.
  const curl = eating ? 1 : climbing ? 0.25 : hopping ? 0.6 : dip > 0 ? 0.55 : 0.75
  const [hipX, hipY] = SQUIRREL_HIP as [number, number]
  const tilt = eating ? SQUIRREL_SIT_TILT : 0
  /** Turns the context about the hip by the sitting tilt (the body, front legs and head follow it). */
  const tipUp = (): void => {
    ctx.translate(hipX, hipY)
    ctx.rotate(tilt)
    ctx.translate(-hipX, -hipY)
  }

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(u, u)
  if (climbing) {
    // Clinging to the trunk: head up (climbing up) or down, back away from the trunk.
    ctx.scale(bird.climbSide, 1)
    ctx.rotate(bird.climbDir > 0 ? -Math.PI / 2 : Math.PI / 2)
    ctx.scale(1, bird.climbDir > 0 ? 1 : -1)
    ctx.translate(0, 6)
  } else {
    ctx.scale(bird.facing, 1)
    ctx.translate(0, 10 - lift)
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // The legs only swing while it really hops (or climbs): a squirrel resting between hops stands still.
  const step = climbing || (hopping && bird.walking) ? Math.sin(bird.animTime * 14) : 0

  // The tail: arched over the back, or curled up close behind the sitting body.
  ctx.save()
  if (eating) {
    ctx.translate(24, 2)
  }
  drawSquirrelTail(ctx, curl, eating ? 1 : 0)
  ctx.restore()

  // The body (it tips up about the hip when sitting), with its pale underside.
  ctx.save()
  tipUp()
  bezierShape(ctx, SQUIRREL_TORSO, SQUIRREL_FUR)
  bezierShape(ctx, SQUIRREL_BELLY_SHAPE, SQUIRREL_BELLY)
  ctx.restore()

  // The haunch and the big hind foot lying out in front of it: the same in every pose.
  bezierShape(ctx, SQUIRREL_THIGH, SQUIRREL_FUR_DARK)
  ctx.save()
  ctx.translate(18, 0)
  bezierShape(ctx, SQUIRREL_FOOT, SQUIRREL_FUR_DARK, SQUIRREL_FUR)
  ctx.restore()

  // Front legs and head, on the body (so they tip up with it).
  ctx.save()
  tipUp()
  if (eating) {
    // Both front paws hold the acorn up at the mouth.
    taperedLimb(ctx, [[18, 14], [28, 20 + nibble * 0.6], [34, 24 + nibble * 0.6]], 6, 4, SQUIRREL_FUR_DARK)
  } else if (digging) {
    // Two front paws scratching the ground under the nose, one back as the other comes forward.
    for (const offset of [0, Math.PI]) {
      const reach = Math.cos(digPhase + offset)
      const lifted = Math.max(0, Math.sin(digPhase + offset)) * 6
      taperedLimb(ctx, [[22, 22], [30 + 4 * reach, 31], [37 + 9 * reach, 39 - lifted]], 7, 4, SQUIRREL_FUR_DARK)
    }
  } else {
    taperedLimb(ctx, [[22, 22], [24 - 6 * step, 32], [30 - 6 * step, 39]], 7, 4.2, SQUIRREL_FUR_DARK)
  }

  // Head: dips toward the ground about the neck; tilted right down toward the food when eating.
  ctx.save()
  ctx.translate(-2 * dip, 22 * dip)
  ctx.translate(30, 6)
  ctx.rotate(0.6 * dip)
  ctx.translate(-30, -6)
  if (eating) {
    ctx.translate(26, 4)
    ctx.rotate(-SQUIRREL_SIT_TILT + 0.35 + nibble * 0.05)
    ctx.translate(-26, -4)
  }
  ctx.save()
  ctx.translate(31, 2)
  ctx.scale(1.2, 1.2)
  drawSquirrelHead(ctx)
  ctx.restore()
  ctx.restore()

  if (bird.held && !eating) {
    // The acorn carried in the mouth.
    ctx.save()
    ctx.translate(-2 * dip, 22 * dip)
    ctx.translate(30, 6)
    ctx.rotate(0.6 * dip)
    ctx.translate(-30, -6)
    drawAcornShape(ctx, 44, 12, bird.held.radius / u, -Math.PI / 2)
    ctx.restore()
  }
  if (bird.held && eating) {
    // It shrinks as it is eaten; the near paw closes over it.
    drawAcornShape(ctx, 37, 24 + nibble * 0.6, (bird.held.radius / u) * (1 - progress * 0.85), -Math.PI / 2 + 0.3)
    taperedLimb(ctx, [[20, 12], [30, 18 + nibble * 0.6], [36, 23 + nibble * 0.6]], 7, 4.6, SQUIRREL_FUR)
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

/** The parts a foreground bush is drawn from: its wood, and its leaves in each look it holds (`STAGE_LOOKS`). */
type BushPart = 'wood' | 'c0' | 'c1' | 'c2' | 'c3'

/** A bush part drawn once into a bitmap, since its many leaves are expensive to draw every frame. */
type BushSprite = {
  canvas: HTMLCanvasElement | OffscreenCanvas | ImageBitmap
  res: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

const bushParts = new WeakMap<Bush, Map<string, BushSprite>>()

/**
 * Paints the woody branches of a bush under its leaves: from its base a stem to each lobe's center,
 * which forks into a few twigs inside the lobe, so a bush with no leaves is still a bush.
 *
 * @param ctx - 2D canvas context (the bush's base at the origin of the bush's coordinates).
 * @param bush - The bush.
 * @param color - Wood color.
 */
function drawBushWood(ctx: CanvasRenderingContext2D, bush: Bush, color: string): void {
  const rand = seededRandom(Math.floor(bush.x * 7) + 3)
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  // A bare bush: many stems rise from one spot, fan out like a vase and fork again and again into fine
  // twigs that fill the bush's outline. The wood stays well inside the leaves (a tip may not pass 0.55 of a
  // lobe's radius from its center, nor rise more than 0.3 above it: the leaf clumps are thin on top), so none shows past the leaf edge in summer.
  const inside = (x: number, y: number): boolean =>
    bush.lobes.some(
      (lobe) => Math.hypot(x - lobe.dx, y - lobe.dy) < lobe.radius * 0.55 && y > lobe.dy - lobe.radius * 0.3,
    )
  let radiusSum = 0
  let reach = 0
  for (const lobe of bush.lobes) {
    radiusSum += lobe.radius
    reach = Math.max(reach, Math.abs(lobe.dx) + lobe.radius)
  }
  const meanRadius = radiusSum / Math.max(1, bush.lobes.length)
  const segment = meanRadius * 0.26
  /**
   * Grows a stem or twig from a point in a direction (radians from straight up): short pieces that bend a
   * little and are pulled back toward the vertical, getting thinner, and each piece has a chance to fork.
   */
  const grow = (x: number, y: number, heading: number, width: number, depth: number, pieceLength: number): void => {
    let px = x
    let py = y
    let h = heading
    for (let i = 0; i < 16; i += 1) {
      h += (rand() - 0.5) * 0.4 - h * 0.05
      const nx = px + Math.sin(h) * pieceLength
      const ny = py - Math.cos(h) * pieceLength
      // The first pieces rise from the ground and may be below the leaves.
      if (i >= 2 && !(inside(nx, ny) && inside((px + nx) / 2, (py + ny) / 2))) {
        break
      }
      ctx.lineWidth = Math.max(0.7, width * (1 - i * 0.05))
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      px = nx
      py = ny
      if (depth > 0 && i >= 1 && rand() < 0.34 && inside(px, py)) {
        const side = rand() < 0.5 ? -1 : 1
        grow(px, py, h + side * (0.35 + rand() * 0.55), width * 0.62, depth - 1, pieceLength * 0.82)
      }
    }
  }
  const stems = 7 + bush.lobes.length * 2
  for (let s = 0; s < stems; s += 1) {
    const t = s / (stems - 1) - 0.5
    const x = t * reach * 0.35 + (rand() - 0.5) * meanRadius * 0.15
    grow(x, 4, t * 1.7 + (rand() - 0.5) * 0.3, Math.max(2.4, meanRadius * 0.075), 4, segment)
  }
}

/** Wood color of a foreground bush's branches. */
const BUSH_WOOD_COLOR = '#4d3b2c'

/**
 * Paints a bush's leaves, lobe by lobe, in steps: green, in fall color or mixed, and with some of them
 * missing (see `LeafMix`).
 *
 * @param ctx - 2D canvas context (the bush's base at the origin of the bush's coordinates).
 * @param bush - The bush.
 * @param tonesFor - The green tones of a lobe.
 * @param haze - Fall colors blend toward this haze (distant bushes), or null.
 * @param look - How many leaves there are and how many of those are in fall color.
 * @param baseTone - Which tone is the lobe's base.
 * @param detail - Leaf density.
 */
function* paintBushLeaves(
  ctx: CanvasRenderingContext2D,
  bush: Bush,
  tonesFor: (lobe: BushLobe) => string[],
  haze: { color: string; amount: number } | null,
  look: { presence: number; fall: number },
  baseTone: number,
  detail: number,
): Generator<void> {
  if (look.presence <= 0) {
    return
  }
  const rand = seededRandom(Math.floor(bush.x * 13))
  for (const [index, lobe] of bush.lobes.entries()) {
    const mix =
      look.fall > 0 || look.presence < 1
        ? {
            tonesB:
              look.fall > 0
                ? fallTones(bush.leaf.hue, (seededRandom(Math.floor(bush.x * 5) + index)() - 0.5) * 16, haze, bush.leaf.sat)
                : tonesFor(lobe),
            fall: look.fall,
            presence: look.presence,
            seed: Math.floor(bush.x * 17) + index * 7,
          }
        : undefined
    drawLeafyDisk(ctx, lobe.dx, lobe.dy, lobe.radius, tonesFor(lobe), baseTone, rand, detail, 1, mix)
    yield
  }
}

/**
 * Renders a part of a bush into a bitmap positioned relative to its base point, in steps.
 *
 * @param bush - Bush to render.
 * @param res - Bitmap pixels per world pixel (capped so a bush stays a few megapixels at most).
 * @param part - Which part.
 */
function* buildBushPart(bush: Bush, res: number, part: BushPart): Generator<void, BushSprite> {
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
  const canvas = newCanvas()
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (ctx) {
    ctx.scale(scale, scale)
    ctx.translate(-(minX - pad), -(minY - pad))
    if (part === 'wood') {
      drawBushWood(ctx, bush, BUSH_WOOD_COLOR)
    } else {
      yield* paintBushLeaves(ctx, bush, (lobe) => shadeRamp(lobe.color), null, STAGE_LOOKS[Number(part.slice(1))] ?? { presence: 1, fall: 0 }, 2, 0.9)
    }
  }
  return { canvas, res, offsetX: minX - pad, offsetY: minY - pad, width, height }
}

/**
 * The key of a bush part's job and bitmap.
 *
 * @param bush - Bush.
 * @param part - Which part.
 * @param res - Bitmap pixels per world pixel.
 */
function bushPartKey(bush: Bush, part: BushPart, res: number): string {
  return `bush|${bush.x}|${part}|${res.toFixed(2)}`
}

/**
 * Builds a bush part's bitmap in steps and stores it.
 *
 * @param bush - Bush.
 * @param res - Bitmap pixels per world pixel.
 * @param part - Which part.
 */
function* bushPartJob(bush: Bush, res: number, part: BushPart): Generator<void> {
  const sprite = yield* buildBushPart(bush, res, part)
  let map = bushParts.get(bush)
  if (!map) {
    map = new Map()
    bushParts.set(bush, map)
  }
  map.set(`${part}|${res.toFixed(2)}`, sprite)
}

/**
 * A bush part's bitmap, built now if it is missing and `now` is set.
 *
 * @param bush - Bush.
 * @param res - Bitmap pixels per world pixel.
 * @param part - Which part.
 * @param now - Build it at once if it is not there.
 */
function bushPartSprite(bush: Bush, res: number, part: BushPart, now: boolean): BushSprite | null {
  const key = `${part}|${res.toFixed(2)}`
  const found = bushParts.get(bush)?.get(key)
  if (found || !now) {
    return found ?? null
  }
  for (const step of bushPartJob(bush, res, part)) {
    void step
  }
  return bushParts.get(bush)?.get(key) ?? null
}

/**
 * Draws a bush from its prebuilt parts: its wood, then the leaves of the look it holds, and while it
 * passes to the next look (over a few seconds) the two faded against each other. Leaves not built yet are
 * queued (until then the nearest look built stands in).
 *
 * @param ctx - 2D canvas context in world space.
 * @param bush - Bush to draw.
 * @param groundY - Ground Y at the bush.
 * @param mix - Which look (`a`), which look it passes to (`b`) and how far (`w`).
 */
function drawBush(ctx: CanvasRenderingContext2D, bush: Bush, groundY: number, mix: { a: number; b: number; w: number; soon?: boolean }): void {
  const res = ctx.getTransform().a
  const place = (sprite: BushSprite | null, alpha: number): void => {
    if (!sprite || alpha <= 0) {
      return
    }
    ctx.globalAlpha = alpha
    ctx.drawImage(sprite.canvas, bush.x + sprite.offsetX, groundY + sprite.offsetY, sprite.width, sprite.height)
    ctx.globalAlpha = 1
  }
  place(bushPartSprite(bush, res, 'wood', true), 1)
  const stages: [number, number][] = mix.w > 0 && mix.a !== mix.b ? [[mix.a, 1 - mix.w], [mix.b, mix.w]] : [[mix.a, 1]]
  const shown: { sprite: BushSprite; alpha: number }[] = []
  for (const [stage, alpha] of stages) {
    if (stage > 3 || alpha <= 0) {
      continue
    }
    let sprite = bushPartSprite(bush, res, `c${stage}` as BushPart, false)
    if (!sprite) {
      queueBushPart(bush, res, `c${stage}` as BushPart, 1)
      for (const other of [stage - 1, stage + 1, stage - 2, stage + 2]) {
        sprite = other >= 0 && other <= 3 ? bushPartSprite(bush, res, `c${other}` as BushPart, false) : null
        if (sprite) {
          break
        }
      }
      sprite = sprite ?? bushPartSprite(bush, res, 'c0', true)
    }
    if (sprite) {
      shown.push({ sprite, alpha })
    }
  }
  const [first, second] = shown
  if (first && second) {
    drawCrossfade(ctx, bush, first.sprite.canvas, second.sprite.canvas, second.alpha, bush.x + first.sprite.offsetX, groundY + first.sprite.offsetY, first.sprite.width, first.sprite.height)
  } else {
    if (first) {
      place(first.sprite, first.alpha)
    }
    endCrossfade(bush)
    // Holding a look: the next one is made when its change is near.
    if (mix.soon && mix.a < 3) {
      queueBushPart(bush, res, `c${mix.a + 1}` as BushPart, 6)
    }
  }
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
type FernSprite = { canvas: HTMLCanvasElement | OffscreenCanvas | ImageBitmap; res: number; offsetX: number; offsetY: number; width: number; height: number }

const fernSprites = new WeakMap<Fern, Map<string, FernSprite>>()

/**
 * Renders a foreground fern in its summer or winter colors into a bitmap.
 *
 * @param fern - Fern to render.
 * @param res - Bitmap pixels per world pixel.
 * @param winter - Winter colors instead of summer ones.
 */
function buildFernSprite(fern: Fern, res: number, winter: boolean): FernSprite {
  const reachX = fern.size * 1.25
  const width = reachX * 2 + 8
  const below = fern.size * 0.55
  const height = fern.size * 1.2 + below + 10
  const scale = Math.min(res, Math.sqrt(2_000_000 / (width * height)))
  const canvas = newCanvas()
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const sctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (sctx) {
    sctx.scale(scale, scale)
    sctx.translate(width / 2, height - below - 4)
    const amount = winter ? 1 : 0
    paintFern(sctx, fern, winterGreen(FERN_TONES[fern.tone] ?? '#3f8f3b', amount), winterGreen('#2a5a2a', amount))
  }
  return { canvas, res, offsetX: -width / 2, offsetY: -(height - below - 4), width, height }
}

/**
 * Builds a fern's winter bitmap (queued work) and stores it.
 *
 * @param fern - Fern.
 * @param res - Bitmap pixels per world pixel.
 */
function* fernWinterJob(fern: Fern, res: number): Generator<void> {
  yield
  let map = fernSprites.get(fern)
  if (!map) {
    map = new Map()
    fernSprites.set(fern, map)
  }
  map.set(`1|${res.toFixed(2)}`, buildFernSprite(fern, res, true))
}

/**
 * Draws a foreground fern from its summer bitmap, with its winter one fading in over it as its change goes on.
 *
 * @param ctx - 2D canvas context in world space.
 * @param fern - Fern to draw.
 * @param groundY - Ground Y at the fern.
 * @param fade - How far into its winter color it is, 0-1.
 */
function drawFern(ctx: CanvasRenderingContext2D, fern: Fern, groundY: number, fade: number): void {
  const res = ctx.getTransform().a
  let map = fernSprites.get(fern)
  if (!map) {
    map = new Map()
    fernSprites.set(fern, map)
  }
  let summer = map.get(`0|${res.toFixed(2)}`)
  if (!summer) {
    summer = buildFernSprite(fern, res, false)
    map.set(`0|${res.toFixed(2)}`, summer)
  }
  ctx.drawImage(summer.canvas, fern.x + summer.offsetX, groundY + summer.offsetY, summer.width, summer.height)
  if (fade > 0) {
    const winter = map.get(`1|${res.toFixed(2)}`)
    if (winter) {
      ctx.globalAlpha = fade
      ctx.drawImage(winter.canvas, fern.x + winter.offsetX, groundY + winter.offsetY, winter.width, winter.height)
      ctx.globalAlpha = 1
    } else {
      queueFernWinter(fern, res)
    }
  }
}

/**
 * A new canvas (an offscreen one inside the background worker, which has no document).
 */
function newCanvas(): HTMLCanvasElement | OffscreenCanvas {
  return typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
}

/**
 * For the background worker: builds a foreground bush part, or a fern's or rock's winter bitmap, in one go
 * and hands it over as a bitmap.
 *
 * @param kind - What to build.
 * @param item - The bush, fern or rock.
 * @param res - Bitmap pixels per world pixel.
 * @param part - For a bush, which part.
 */
export function buildPropSync(
  kind: 'bush' | 'fern' | 'rock',
  item: Bush | Fern | Rock,
  res: number,
  part: string,
): { bitmap: ImageBitmap; offsetX: number; offsetY: number; width: number; height: number } {
  let sprite: BushSprite | FernSprite | RockSprite
  if (kind === 'bush') {
    const steps = buildBushPart(item as Bush, res, part as BushPart)
    let step = steps.next()
    while (!step.done) {
      step = steps.next()
    }
    sprite = step.value
  } else if (kind === 'fern') {
    sprite = buildFernSprite(item as Fern, res, true)
  } else {
    sprite = buildRockSprite(item as Rock, res, true)
  }
  return {
    bitmap: (sprite.canvas as OffscreenCanvas).transferToImageBitmap(),
    offsetX: sprite.offsetX,
    offsetY: sprite.offsetY,
    width: sprite.width,
    height: sprite.height,
  }
}

/** Foreground bitmaps that came from the worker and are not in use yet. */
const propArrivals: { bitmap: ImageBitmap; apply: (bitmap: ImageBitmap) => void }[] = []

/**
 * Puts the bitmaps that came from the worker in use, a few milliseconds' worth a frame (each is first drawn
 * into a tiny canvas so that the browser takes it up now, not in the middle of a frame).
 *
 * @param budgetMs - Time to spend.
 */
function settleProps(budgetMs: number): void {
  const start = performance.now()
  while (propArrivals.length > 0 && performance.now() - start < budgetMs) {
    const arrival = propArrivals.shift()
    if (!arrival) {
      break
    }
    touchBitmap(arrival.bitmap)
    arrival.apply(arrival.bitmap)
  }
}

/**
 * Has a foreground bush part built in the background (in the worker if there is one).
 *
 * @param bush - Bush.
 * @param res - Bitmap pixels per world pixel.
 * @param part - Which part.
 * @param priority - Lower is more urgent.
 */
function queueBushPart(bush: Bush, res: number, part: BushPart, priority: number): void {
  const key = `${part}|${res.toFixed(2)}`
  if (bushParts.get(bush)?.has(key)) {
    return
  }
  if (!workerUsable()) {
    enqueueJob(bushPartKey(bush, part, res), priority, bushPartJob(bush, res, part))
    return
  }
  requestWork({
    key: bushPartKey(bush, part, res),
    priority,
    payload: { type: 'prop', kind: 'bush', item: bush, res, part },
    wanted: () => !bushParts.get(bush)?.has(key),
    onDone: (bitmap, meta) => {
      propArrivals.push({
        bitmap,
        apply: (ready) => {
          let map = bushParts.get(bush)
          if (!map) {
            map = new Map()
            bushParts.set(bush, map)
          }
          map.set(key, { canvas: ready, res, offsetX: meta['offsetX'] ?? 0, offsetY: meta['offsetY'] ?? 0, width: meta['width'] ?? 0, height: meta['height'] ?? 0 })
        },
      })
    },
  })
}

/**
 * Has a fern's winter bitmap built in the background (in the worker if there is one).
 *
 * @param fern - Fern.
 * @param res - Bitmap pixels per world pixel.
 */
function queueFernWinter(fern: Fern, res: number): void {
  if (!workerUsable()) {
    enqueueJob(`fern|${fern.x}|${res.toFixed(2)}`, 3, fernWinterJob(fern, res))
    return
  }
  requestWork({
    key: `fern|${fern.x}|${res.toFixed(2)}`,
    priority: 3,
    payload: { type: 'prop', kind: 'fern', item: fern, res, part: 'winter' },
    wanted: () => !fernSprites.get(fern)?.has(`1|${res.toFixed(2)}`),
    onDone: (bitmap, meta) => {
      propArrivals.push({
        bitmap,
        apply: (ready) => {
          let map = fernSprites.get(fern)
          if (!map) {
            map = new Map()
            fernSprites.set(fern, map)
          }
          map.set(`1|${res.toFixed(2)}`, { canvas: ready, res, offsetX: meta['offsetX'] ?? 0, offsetY: meta['offsetY'] ?? 0, width: meta['width'] ?? 0, height: meta['height'] ?? 0 })
        },
      })
    },
  })
}

/**
 * Has a mossy rock's winter bitmap built in the background (in the worker if there is one).
 *
 * @param rock - Rock.
 * @param res - Bitmap pixels per world pixel.
 */
function queueRockWinter(rock: Rock, res: number): void {
  if (!workerUsable()) {
    enqueueJob(`rock|${rock.x}|${res.toFixed(2)}`, 3, rockWinterJob(rock, res))
    return
  }
  requestWork({
    key: `rock|${rock.x}|${res.toFixed(2)}`,
    priority: 3,
    payload: { type: 'prop', kind: 'rock', item: rock, res, part: 'winter' },
    wanted: () => !rockSprites.get(rock)?.has(`1|${res.toFixed(2)}`),
    onDone: (bitmap, meta) => {
      propArrivals.push({
        bitmap,
        apply: (ready) => {
          let map = rockSprites.get(rock)
          if (!map) {
            map = new Map()
            rockSprites.set(rock, map)
          }
          map.set(`1|${res.toFixed(2)}`, { canvas: ready, res, offsetX: meta['offsetX'] ?? 0, offsetY: meta['offsetY'] ?? 0, width: meta['width'] ?? 0, height: meta['height'] ?? 0 })
        },
      })
    },
  })
}

let touchCanvas: HTMLCanvasElement | null = null

/**
 * Draws a bitmap once into a tiny canvas, which makes the browser finish drawing it and hand it to the
 * graphics card now (a canvas drawn into is only really rendered when it is first used, which is a stall).
 *
 * @param source - The bitmap.
 */
function touchBitmap(source: CanvasImageSource): void {
  touchCanvas ??= document.createElement('canvas')
  touchCanvas.width = 1
  touchCanvas.height = 1
  touchCanvas.getContext('2d')?.drawImage(source, 0, 0, 1, 1)
}

/**
 * Makes a fern's summer bitmap now (it is otherwise made when it is first drawn).
 *
 * @param fern - Fern.
 * @param res - Bitmap pixels per world pixel.
 */
function warmFernSprite(fern: Fern, res: number): void {
  let map = fernSprites.get(fern)
  if (!map) {
    map = new Map()
    fernSprites.set(fern, map)
  }
  const key = `0|${res.toFixed(2)}`
  let sprite = map.get(key)
  if (!sprite) {
    sprite = buildFernSprite(fern, res, false)
    map.set(key, sprite)
  }
  touchBitmap(sprite.canvas)
}

/**
 * Makes a rock's summer bitmap now (it is otherwise made when it is first drawn).
 *
 * @param rock - Rock.
 * @param res - Bitmap pixels per world pixel.
 */
function warmRockSprite(rock: Rock, res: number): void {
  let map = rockSprites.get(rock)
  if (!map) {
    map = new Map()
    rockSprites.set(rock, map)
  }
  const key = `0|${res.toFixed(2)}`
  let sprite = map.get(key)
  if (!sprite) {
    sprite = buildRockSprite(rock, res, false)
    map.set(key, sprite)
  }
  touchBitmap(sprite.canvas)
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
function drawLog(ctx: CanvasRenderingContext2D, log: Log, groundY: number, fade: number): void {
  ctx.save()
  // Sunk a little into the ground: the ground polygon is drawn over the lower part.
  ctx.translate(log.x, groundY - log.radius * 0.8)
  ctx.rotate(log.tilt)
  drawFallenLog(ctx, log, TRUNK_COLOR, 0, fade)
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
function drawFallenLog(ctx: CanvasRenderingContext2D, log: Log, color: string, fog = 0, fade = 0): void {
  mossFade = fade
  paintFallenLog(ctx, log, color, fog)
  mossFade = 0
}

/**
 * Paints a fallen log (see `drawFallenLog`).
 *
 * @param ctx - 2D canvas context.
 * @param log - The log.
 * @param color - Its wood color.
 * @param fog - Haze blended into its colors.
 */
function paintFallenLog(ctx: CanvasRenderingContext2D, log: Log, color: string, fog: number): void {
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

/** How far into its winter color the moss being painted is, 0-1 (set around the painting by the caller). */
let mossFade = 0

/**
 * A moss tone as it looks now (a little darker and less saturated as it goes into its winter color).
 *
 * @param index - Tone from shadow (0) to highlight (3).
 */
function mossTone(index: number): string {
  return winterGreen(MOSS_TONES[index] ?? '#4a7a2a', mossFade)
}

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
    ctx.fillStyle = hazy(mossTone(tone), fog)
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
  ctx.strokeStyle = hazy(mossTone(3), fog)
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
 * The outline of a boulder (a squared ellipse with smooth bumps) and the random stream that goes with it.
 *
 * @param rock - The rock.
 * @param cx - Center x.
 * @param baseY - Y of the rock's base line.
 */
function rockShape(
  rock: Rock,
  cx: number,
  baseY: number,
): { outline: [number, number][]; rng: () => number; edge: (theta: number, bump: number) => [number, number] } {
  const { rx, ry } = rock
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
  return { outline, rng, edge }
}

/**
 * How big the snow on a rock is now (full until the melt, where each rock's snow shrinks at its own moment).
 *
 * @param rock - The rock.
 * @param time - Seconds along the timeline.
 */
function rockSnowSize(rock: Rock, time: number): number {
  const key = (rock.jitter.reduce((a, b) => a + b, 0) * 997) % 1
  return snowCapSize(time, key)
}

/**
 * The geometry of the snow on a rock: where the dusting and the full cap end, with lumps.
 *
 * @param cx - Center x.
 * @param baseY - Y of the rock's base line.
 * @param rx - Half width.
 * @param ry - Height.
 * @param phase - Shape of the lumps.
 * @param amount - How big the snow is, 0-1.
 */
function snowGeometry(
  cx: number,
  baseY: number,
  rx: number,
  ry: number,
  phase: number,
  amount: number,
): {
  top: number
  depth: number
  dustDepth: number
  thick: (x: number) => number
  edgeY: (x: number) => number
  dustY: (x: number) => number
} {
  // The cap's lower edge: lumps across the rock, lower in the middle, as deep as the snow is thick.
  const depth = rx > 120 ? ry * 0.75 : ry * 1.05
  const lumps = (x: number): number => ry * 0.16 * Math.sin(((x - cx) / rx) * 7 + phase) - ry * 0.2 * ((x - cx) / rx) ** 2
  const dustDepth = ry * 0.6
  // While it melts, the snow thins away in patches, from the bottom up: each place along the rock has its own
  // point of the melt (a smooth pattern across the rock) and loses its thickness toward it, the last of it
  // shrinking to nothing; at a size of 1 all of it is as thick as it was.
  const pattern = (x: number): number => {
    const u = (x - cx) / rx
    return Math.max(0, Math.min(1, 0.5 + 0.22 * Math.sin(u * 3.4 + phase) + 0.095 * Math.sin(u * 8 + phase * 2.1)))
  }
  const thick = (x: number): number => {
    const t = Math.max(0, Math.min(1, (amount - 0.42 * pattern(x)) / 0.58))
    return t * t * (3 - 2 * t)
  }
  // The thin outlines (the dusting along the top and the heap) must be gone before the main cap is: they
  // fade out earlier, while the cap there is still some way from nothing.
  const ramp = (value: number, from: number, to: number): number => {
    const t = Math.max(0, Math.min(1, (value - from) / (to - from)))
    return t * t * (3 - 2 * t)
  }
  return {
    top: baseY - ry * 1.2,
    depth,
    dustDepth,
    thick: (x) => ramp(thick(x), 0.4, 0.8),
    edgeY: (x) => baseY - ry * 1.15 + (depth + lumps(x)) * ramp(thick(x), 0.02, 1),
    dustY: (x) => baseY - ry * 1.15 + (dustDepth + lumps(x) * 0.6) * ramp(thick(x), 0.3, 0.7),
  }
}

/**
 * The colors of a rock's snow (it takes some of the rock's distance haze).
 *
 * @param fog - The rock's distance haze.
 */
function snowColors(fog: number): { top: string; bottom: string } {
  return {
    top: fog > 0 ? mixHex(SNOW_TOP, WINTER_HAZE_COLOR, Math.min(0.7, fog * 0.7)) : SNOW_TOP,
    bottom: mixHex('#d4e3f3', WINTER_HAZE_COLOR, Math.min(0.7, fog * 0.7)),
  }
}

/**
 * Paints the snow shapes of a rock, not cut to anything (the caller keeps them to the rock's silhouette): a
 * dusting along the upper boundary that thins out downward (no hard line where it ends), and over it the full
 * cap with a lumpy lower edge, which comes in inside the rock.
 *
 * @param ctx - 2D canvas context.
 * @param cx - Center x.
 * @param baseY - Y of the rock's base line.
 * @param rx - Half width.
 * @param ry - Height.
 * @param phase - Shape of the lumps.
 * @param amount - How big the snow is, 0-1.
 * @param layers - How strongly the dusting and the full cap show, 0-1.
 * @param fog - The rock's distance haze.
 */
function paintSnowShapes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  rx: number,
  ry: number,
  phase: number,
  amount: number,
  layers: { thin: number; full: number },
  fog: number,
): void {
  const colors = snowColors(fog)
  const [tr, tg, tb] = parseRgb(colors.top)
  const g = snowGeometry(cx, baseY, rx, ry, phase, amount)
  const across = (edge: (x: number) => number): void => {
    ctx.beginPath()
    ctx.moveTo(cx - rx * 1.4, baseY - ry * 1.5)
    for (let k = 0; k <= 24; k += 1) {
      const x = cx - rx * 1.4 + (rx * 2.8 * k) / 24
      ctx.lineTo(x, edge(x))
    }
    ctx.lineTo(cx + rx * 1.4, baseY - ry * 1.5)
    ctx.closePath()
  }
  ctx.save()
  if (layers.thin > 0.02) {
    ctx.globalAlpha = layers.thin
    // Fully opaque along the rock's top (where the heap line will start to grow, so it does not stand out as a
    // brighter line), then thinning out downward.
    const dust = ctx.createLinearGradient(0, baseY - ry * 1.08, 0, baseY - ry * 1.15 + g.dustDepth + ry * 0.12)
    dust.addColorStop(0, `rgba(${tr}, ${tg}, ${tb}, 1)`)
    dust.addColorStop(0.3, `rgba(${tr}, ${tg}, ${tb}, 1)`)
    dust.addColorStop(0.7, `rgba(${tr}, ${tg}, ${tb}, 0.45)`)
    dust.addColorStop(1, `rgba(${tr}, ${tg}, ${tb}, 0)`)
    ctx.fillStyle = dust
    across(g.dustY)
    ctx.fill()
  }
  if (layers.full > 0.02) {
    ctx.globalAlpha = layers.full
    const cap = ctx.createLinearGradient(0, g.top, 0, baseY - ry * 1.15 + g.depth + ry * 0.2)
    cap.addColorStop(0, colors.top)
    cap.addColorStop(1, colors.bottom)
    ctx.fillStyle = cap
    across(g.edgeY)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * The path of the snow heaped over the top edge of a rock (built from its top contour).
 *
 * @param outline - The top contour to follow.
 * @param offX - Added to the contour's x.
 * @param offY - Added to the contour's y.
 * @param cx - Center x.
 * @param baseY - Y of the rock's base line.
 * @param rx - Half width.
 * @param ry - Height.
 * @param phase - Shape of the lumps.
 * @param amount - How big the snow is, 0-1.
 * @param full - How far the full cap has come in, 0-1.
 */
function snowHeapPath(
  outline: [number, number][],
  offX: number,
  offY: number,
  cx: number,
  baseY: number,
  rx: number,
  ry: number,
  phase: number,
  amount: number,
  full: number,
): Path2D {
  const g = snowGeometry(cx, baseY, rx, ry, phase, amount)
  const base = Math.max(1.5, ry * 0.14) * full
  // The contour, smoothed over its neighbours (its pixels are stepped), then a ribbon along it whose width
  // follows how much snow is left there (so the heap thins away smoothly and in patches with the cap).
  const upper: [number, number][] = []
  const lower: [number, number][] = []
  // (A contour with only a few points is not smoothed: averaging them would flatten it.)
  const radius = Math.min(5, Math.floor(outline.length / 40))
  for (let i = 0; i < outline.length; i += 1) {
    let sum = 0
    let count = 0
    for (let d = -radius; d <= radius; d += 1) {
      const other = outline[i + d]
      if (other) {
        sum += other[1]
        count += 1
      }
    }
    const x = (outline[i]?.[0] ?? 0) + offX
    const y = sum / Math.max(1, count) + offY
    const side = Math.max(0, Math.min(1, (baseY - ry * 0.05 - y) / (ry * 0.2)))
    const half = base * 0.5 * g.thick(x) * side
    upper.push([x, y - half * 1.5])
    lower.push([x, y + half * 0.5])
  }
  const path = new Path2D()
  upper.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)))
  for (let i = lower.length - 1; i >= 0; i -= 1) {
    path.lineTo(lower[i]?.[0] ?? 0, lower[i]?.[1] ?? 0)
  }
  path.closePath()
  return path
}

/**
 * Strokes a rock's heap path.
 *
 * @param ctx - 2D canvas context.
 * @param path - The heap's path.
 * @param ry - The rock's height (the line's width is a share of it).
 * @param full - How far the full cap has come in, 0-1.
 * @param fog - The rock's distance haze.
 */
function strokeSnowHeap(ctx: CanvasRenderingContext2D, path: Path2D, _ry: number, _full: number, fog: number): void {
  ctx.save()
  ctx.fillStyle = snowColors(fog).top
  ctx.fill(path)
  ctx.restore()
}

/** The silhouette of a bitmap by column: where each column's painted pixels start and end (world coordinates). */
type Silhouette = { x: number[]; top: number[]; bottom: number[] }

/**
 * The silhouette of what a bitmap shows, column by column (a little smoothed), in world coordinates: so snow can
 * follow a rock with its moss, not just the rock's outline.
 *
 * @param source - The bitmap.
 * @param left - Where its left edge is in the world.
 * @param top - Where its top edge is.
 * @param width - Its width in the world.
 * @param height - Its height in the world.
 */
function silhouetteColumns(
  source: CanvasImageSource & { width: number; height: number },
  left: number,
  top: number,
  width: number,
  height: number,
): Silhouette {
  const columns = Math.max(8, Math.min(360, Math.round(source.width)))
  const rows = Math.max(8, Math.min(400, Math.round((columns * source.height) / Math.max(1, source.width))))
  const probe = newCanvas()
  probe.width = columns
  probe.height = rows
  const result: Silhouette = { x: [], top: [], bottom: [] }
  const pctx = probe.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null
  if (!pctx) {
    return result
  }
  pctx.drawImage(source, 0, 0, columns, rows)
  const data = pctx.getImageData(0, 0, columns, rows).data
  const firsts: (number | null)[] = []
  const lasts: (number | null)[] = []
  for (let c = 0; c < columns; c += 1) {
    let first: number | null = null
    let last: number | null = null
    for (let row = 0; row < rows; row += 1) {
      if ((data[(row * columns + c) * 4 + 3] ?? 0) > 60) {
        if (first === null) {
          first = row
        }
        last = row
      }
    }
    firsts.push(first)
    lasts.push(last)
  }
  const smooth = (values: (number | null)[], c: number): number => {
    let sum = 0
    let count = 0
    for (let d = -2; d <= 2; d += 1) {
      const other = values[c + d]
      if (other !== null && other !== undefined) {
        sum += other
        count += 1
      }
    }
    return sum / Math.max(1, count)
  }
  for (let c = 0; c < columns; c += 1) {
    if (firsts[c] === null || firsts[c] === undefined) {
      continue
    }
    result.x.push(left + ((c + 0.5) / columns) * width)
    result.top.push(top + ((smooth(firsts, c) + 0.5) / rows) * height)
    result.bottom.push(top + ((smooth(lasts, c) + 1) / rows) * height)
  }
  return result
}

/**
 * The shape phase of a rock's snow lumps.
 *
 * @param rock - The rock.
 */
function snowPhase(rock: Rock): number {
  return (rock.jitter.reduce((a, b) => a + b, 0) * 31) % 6.28
}

/** Each rock's silhouette (moss included) relative to its center and base line, found once. */
const rockSilhouettes = new WeakMap<Rock, Silhouette>()

/**
 * Draws the snow on a rock from its bitmap's silhouette: the dusting and the full cap are shapes between the
 * silhouette's top (moss that hangs over the outline included) and their lower edges, drawn afresh every frame
 * (so the melt shrinks them continuously), and the heap over the top edge.
 *
 * @param ctx - 2D canvas context in world space.
 * @param rock - The rock.
 * @param sprite - The rock's bitmap (its silhouette).
 * @param baseY - Y of the rock's base line.
 * @param amount - How big the snow is, 0-1.
 * @param layers - How strongly the dusting and the full cap show, 0-1.
 */
function drawRockSnow(
  ctx: CanvasRenderingContext2D,
  rock: Rock,
  sprite: RockSprite,
  baseY: number,
  amount: number,
  layers: { thin: number; full: number },
): void {
  if (amount < 0.003 || layers.thin < 0.02) {
    return
  }
  let sil = rockSilhouettes.get(rock)
  if (!sil) {
    sil = silhouetteColumns(sprite.canvas, sprite.offsetX, sprite.offsetY, sprite.width, sprite.height)
    rockSilhouettes.set(rock, sil)
  }
  const n = sil.x.length
  if (n < 2) {
    return
  }
  const cx = rock.x
  const phase = snowPhase(rock)
  const g = snowGeometry(cx, baseY, rock.rx, rock.ry, phase, amount)
  const colors = snowColors(rock.fog)
  const [tr, tg, tb] = parseRgb(colors.top)
  // The shape between the silhouette's top (a pixel or two above, to cover its edge) and a lower edge, not
  // going below the silhouette.
  const shape = (edge: (x: number) => number): Path2D => {
    const path = new Path2D()
    for (let i = 0; i < n; i += 1) {
      const x = cx + (sil.x[i] ?? 0)
      const y = baseY + (sil.top[i] ?? 0) - 1.5
      if (i === 0) {
        path.moveTo(x, y)
      } else {
        path.lineTo(x, y)
      }
    }
    for (let i = n - 1; i >= 0; i -= 1) {
      const x = cx + (sil.x[i] ?? 0)
      const upper = baseY + (sil.top[i] ?? 0) - 1.5
      path.lineTo(x, Math.max(upper, Math.min(edge(x), baseY + (sil.bottom[i] ?? 0))))
    }
    path.closePath()
    return path
  }
  ctx.save()
  // First the dusting, opaque along the top and thinning out downward.
  ctx.globalAlpha = layers.thin
  const dust = ctx.createLinearGradient(0, baseY - rock.ry * 1.08, 0, baseY - rock.ry * 1.15 + g.dustDepth + rock.ry * 0.12)
  dust.addColorStop(0, `rgba(${tr}, ${tg}, ${tb}, 1)`)
  dust.addColorStop(0.3, `rgba(${tr}, ${tg}, ${tb}, 1)`)
  dust.addColorStop(0.7, `rgba(${tr}, ${tg}, ${tb}, 0.45)`)
  dust.addColorStop(1, `rgba(${tr}, ${tg}, ${tb}, 0)`)
  ctx.fillStyle = dust
  ctx.fill(shape(g.dustY))
  // Then the full cap, inside the rock.
  if (layers.full > 0.02) {
    ctx.globalAlpha = layers.full
    const cap = ctx.createLinearGradient(0, g.top, 0, baseY - rock.ry * 1.15 + g.depth + rock.ry * 0.2)
    cap.addColorStop(0, colors.top)
    cap.addColorStop(1, colors.bottom)
    ctx.fillStyle = cap
    ctx.fill(shape(g.edgeY))
  }
  ctx.restore()
  if (layers.full > 0.02) {
    const outline: [number, number][] = sil.x.map((x, i): [number, number] => [x, sil.top[i] ?? 0])
    strokeSnowHeap(ctx, snowHeapPath(outline, cx, baseY, cx, baseY, rock.rx, rock.ry, phase, amount, layers.full), rock.ry, layers.full, rock.fog)
  }
}

/**
 * Lays a cap of snow over the upper part of a simple (little, hazy) rock's outline: clipped to the outline
 * (these rocks have no moss over their edge). They get no heap over the top edge: their outline has only a few
 * points, and a ribbon along it showed as white rims around the creek's little rocks.
 *
 * @param ctx - 2D canvas context.
 * @param outline - The rock's outline.
 * @param cx - Center x.
 * @param baseY - Y of the rock's base line.
 * @param rx - Half width.
 * @param ry - Height.
 * @param phase - Shape of the lumps.
 * @param amount - How big the snow is, 0-1.
 * @param layers - How strongly the dusting and the full cap show, 0-1.
 * @param fog - The rock's distance haze.
 */
function paintSnowCap(
  ctx: CanvasRenderingContext2D,
  outline: [number, number][],
  cx: number,
  baseY: number,
  rx: number,
  ry: number,
  phase: number,
  amount: number,
  layers: { thin: number; full: number },
  fog: number,
): void {
  ctx.save()
  ctx.beginPath()
  outline.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  ctx.clip()
  paintSnowShapes(ctx, cx, baseY, rx, ry, phase, amount, layers, fog)
  ctx.restore()
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
  const { outline, rng, edge } = rockShape(rock, cx, baseY)
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
    ctx.fillStyle = hazy(mossTone(1), fog)
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

type RockSprite = { canvas: HTMLCanvasElement | OffscreenCanvas | ImageBitmap; res: number; offsetX: number; offsetY: number; width: number; height: number }

const rockSprites = new WeakMap<Rock, Map<string, RockSprite>>()

/**
 * Renders a rock into a bitmap, with its moss in its summer or winter color.
 *
 * @param rock - Rock to render.
 * @param res - Bitmap pixels per world pixel.
 * @param winter - Winter moss.
 */
function buildRockSprite(rock: Rock, res: number, winter: boolean): RockSprite {
  const pad = rock.rx * 0.2 + 8
  const width = rock.rx * 2.5 + pad * 2
  const above = rock.ry * 1.5 + pad
  const height = above + rock.ry * 0.55 + pad
  const scale = Math.min(res, Math.sqrt(4_000_000 / (width * height)))
  const canvas = newCanvas()
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const sctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (sctx) {
    sctx.scale(scale, scale)
    sctx.translate(width / 2, above)
    mossFade = winter ? 1 : 0
    paintRock(sctx, rock, 0, 0)
    mossFade = 0
  }
  return { canvas, res, offsetX: -width / 2, offsetY: -above, width, height }
}

/**
 * Builds a mossy rock's winter bitmap (queued work) and stores it.
 *
 * @param rock - Rock.
 * @param res - Bitmap pixels per world pixel.
 */
function* rockWinterJob(rock: Rock, res: number): Generator<void> {
  yield
  let map = rockSprites.get(rock)
  if (!map) {
    map = new Map()
    rockSprites.set(rock, map)
  }
  map.set(`1|${res.toFixed(2)}`, buildRockSprite(rock, res, true))
}

/**
 * Draws a rock from a bitmap of its detailed painting, with its base at `groundY` plus a little sink (the
 * ground polygon drawn afterwards hides the lowest part). A mossy rock's winter bitmap fades in over its
 * summer one as its moss goes into its winter color.
 *
 * @param ctx - 2D canvas context in world space.
 * @param rock - Rock to draw.
 * @param groundY - Ground Y at the rock.
 * @param fade - How far into its winter color its moss is, 0-1.
 */
function drawRock(ctx: CanvasRenderingContext2D, rock: Rock, groundY: number, fade: number): void {
  const res = ctx.getTransform().a
  let map = rockSprites.get(rock)
  if (!map) {
    map = new Map()
    rockSprites.set(rock, map)
  }
  let summer = map.get(`0|${res.toFixed(2)}`)
  if (!summer) {
    summer = buildRockSprite(rock, res, false)
    map.set(`0|${res.toFixed(2)}`, summer)
  }
  const y = groundY + rock.ry * 0.4
  ctx.drawImage(summer.canvas, rock.x + summer.offsetX, y + summer.offsetY, summer.width, summer.height)
  if (rock.moss && fade > 0) {
    const winter = map.get(`1|${res.toFixed(2)}`)
    if (winter) {
      ctx.globalAlpha = fade
      ctx.drawImage(winter.canvas, rock.x + winter.offsetX, y + winter.offsetY, winter.width, winter.height)
      ctx.globalAlpha = 1
    } else {
      queueRockWinter(rock, res)
    }
  }
  drawRockSnow(ctx, rock, summer, y, rockSnowSize(rock, seasonNow), snowCapLayers(seasonNow))
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
  const outline: [number, number][] = []
  rock.jitter.forEach((j, i) => {
    const angle = Math.PI - 0.35 + (sweep * i) / (n - 1)
    const px = rock.x + Math.cos(angle) * rock.rx * j
    const py = baseY + Math.sin(angle) * rock.ry * j
    outline.push([px, py])
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
  // Snow over the top (after the highlight, so nothing shows through it).
  const snowSize = rockSnowSize(rock, seasonNow)
  const snowLayers = snowCapLayers(seasonNow)
  if (snowSize > 0.04 && snowLayers.thin > 0.02) {
    paintSnowCap(ctx, outline, rock.x, baseY, rock.rx, rock.ry, snowPhase(rock), snowSize, snowLayers, rock.fog)
  }
  // A few fallen leaves over the base, as if the rock were settled into the litter.
  if (rock.rx < 7) {
    return
  }
  const buried = snowAt(rock.x, 0, seasonNow)
  if (buried > 0.99) {
    return
  }
  ctx.globalAlpha = 1 - buried
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
  ctx.globalAlpha = 1
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
  const mapW = Math.min(320, viewWidth * 0.3)
  const scale = mapW / world.width
  const mapH = Math.max(36, world.height * scale)
  // Top right, under the Restart button.
  const mx = viewWidth - mapW - 12
  const my = 84
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
 * Draws a dashed white line from each NPC's eye to every burial site it recently noticed that has to do with
 * the player (the player's own burial, or the player burying or digging), with a little padding at both
 * ends, fading out over `NOTICE_LINE_FADE_SECONDS`. With debug on, the lines to what has nothing to do with the
 * player are drawn too, in gray; with debug off they are not drawn. The line is redrawn from the bird's current
 * position every frame, so it stays connected as the bird moves.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - NPCs, their sites, terrain, and the game clock.
 * @param player - The player (a site is the player's if the player buried it or was seen digging there).
 */
function drawNoticeLines(ctx: CanvasRenderingContext2D, world: World, player: Player): void {
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
      // Only what has to do with the player is shown (white); the rest only with debug on (gray).
      const aboutPlayer = site.owner === player
      if (!aboutPlayer && !showMinimap) {
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
      ctx.strokeStyle = aboutPlayer ? `rgba(255, 255, 255, ${0.9 * fade})` : `rgba(150, 150, 150, ${0.85 * fade})`
      ctx.beginPath()
      ctx.moveTo(eyeX + (dx / length) * padStart, eyeY + (dy / length) * padStart)
      ctx.lineTo(toX - (dx / length) * padEnd, toY - (dy / length) * padEnd)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Scratch bitmap for drawing a climbing squirrel behind its tree's leaves. */
let climbCanvas: HTMLCanvasElement | null = null

/**
 * Draws a squirrel climbing its trunk so that the tree's leaves hang in front of it: the squirrel is
 * painted on a scratch bitmap, the oak's leaf bitmap is cut out of it (destination-out, so a leaf's soft
 * edge hides the squirrel just as much as it covers it) and the result goes onto the scene. Nothing of
 * the tree is painted over again, so no leaf is drawn twice and no patch of leaves seems to move with
 * the squirrel.
 *
 * @param ctx - 2D canvas context in world space.
 * @param squirrel - The climbing squirrel (with its home tree).
 * @param world - Terrain for the ground height at the trunk.
 */
function drawClimbingSquirrel(ctx: CanvasRenderingContext2D, squirrel: Npc, world: World): void {
  const home = squirrel.home
  const bird = squirrel.bird
  if (!home) {
    drawSquirrel(ctx, bird)
    return
  }
  const scale = ctx.getTransform().a
  const pad = bird.size * 1.6
  const ox = bird.x - pad
  const oy = bird.y - pad
  const span = bird.size + pad * 2
  climbCanvas ??= document.createElement('canvas')
  const width = Math.ceil(span * scale)
  if (climbCanvas.width !== width || climbCanvas.height !== width) {
    climbCanvas.width = width
    climbCanvas.height = width
  }
  const off = climbCanvas.getContext('2d')
  if (!off) {
    drawSquirrel(ctx, bird)
    return
  }
  off.setTransform(1, 0, 0, 1, 0, 0)
  off.clearRect(0, 0, width, width)
  off.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale)
  drawSquirrel(off, bird)
  off.globalCompositeOperation = 'destination-out'
  drawOakCrown(
    off,
    home.tree.shape,
    home.trunkX,
    groundYAt(world.terrain, home.trunkX),
    OAK_TONES,
    TRUNK_COLOR,
    leafStageMix(transitionProgress(home.tree.shape.leaf.start, world.season.time)),
  )
  off.globalCompositeOperation = 'source-over'
  ctx.drawImage(climbCanvas, ox, oy, span, span)
}

/**
 * Debug: draws a pink arrow from every jay in the follow state to the bird it follows, stopping short of
 * both birds so that it does not overlap them.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - NPCs.
 */
function drawFollowArrows(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.save()
  ctx.strokeStyle = '#ff5fb4'
  ctx.fillStyle = '#ff5fb4'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  for (const npc of world.npcs) {
    const target = npc.followTarget
    if (npc.state !== 'follow' || !target) {
      continue
    }
    const size = npc.bird.size
    const fromX = npc.bird.x + size / 2
    const fromY = npc.bird.y + size / 2
    const dx = target.x + target.size / 2 - fromX
    const dy = target.y + target.size / 2 - fromY
    const length = Math.hypot(dx, dy)
    const padStart = size * 0.7
    const padEnd = size * 0.7
    if (length <= padStart + padEnd + 12) {
      continue
    }
    const ux = dx / length
    const uy = dy / length
    const startX = fromX + ux * padStart
    const startY = fromY + uy * padStart
    const tipX = fromX + dx - ux * padEnd
    const tipY = fromY + dy - uy * padEnd
    const head = 16
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.lineTo(tipX - ux * head * 0.6, tipY - uy * head * 0.6)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(tipX - ux * head - uy * head * 0.5, tipY - uy * head + ux * head * 0.5)
    ctx.lineTo(tipX - ux * head + uy * head * 0.5, tipY - uy * head - ux * head * 0.5)
    ctx.closePath()
    ctx.fill()
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
  // Only summer is made before play: each layer's ground and its summer images for the chunks around the
  // player. The other seasons' images, and the chunks farther away, are made a little at a time while the
  // game is played (see `planVegetation`).
  const startCameraX = Math.max(0, player.x - (world.viewHeight * TYPICAL_ASPECT_RATIO) / 2)
  for (const layer of world.forest) {
    const strip = forestStripFor(layer, world)
    yield
    const { first, last } = visibleChunks(layer, startCameraX, world.viewHeight * TYPICAL_ASPECT_RATIO)
    const workerId = workerLayerIds.get(layer)
    if (workerId !== undefined && workerUsable()) {
      // The worker makes the first (summer) images; the start waits for them.
      let waiting = 0
      for (let chunk = first; chunk <= last; chunk += 1) {
        for (const part of ['back', 'front'] as const) {
          waiting += 1
          requestImage({
            key: `warm|${workerId}|${part}|${chunk}`,
            priority: 0,
            id: workerId,
            k: 0,
            part,
            chunk,
            wanted: () => true,
            onDone: (bitmap, rowTop) => {
              vegMap(layer).set(vegKey(0, part, chunk), { canvas: bitmap, rowTop })
              waiting -= 1
            },
          })
        }
      }
      while (waiting > 0 && workerUsable()) {
        yield
      }
      if (waiting <= 0) {
        continue
      }
    }
    for (let chunk = first; chunk <= last; chunk += 1) {
      for (const part of ['back', 'front'] as const) {
        const steps = buildVegImage(layer, strip.veg, 0, part, chunk)
        let step = steps.next()
        let sliceStart = performance.now()
        while (!step.done) {
          // A frame at a time, about 30 ms of work each (the steps are far smaller than that).
          if (performance.now() - sliceStart > 30) {
            yield
            sliceStart = performance.now()
          }
          step = steps.next()
        }
        vegMap(layer).set(vegKey(0, part, chunk), step.value)
      }
    }
    yield
  }
  for (const tree of world.trees) {
    touchBitmap(getOakPart(tree.shape, OAK_TONES, TRUNK_COLOR, dpr, 'trunk').canvas)
    yield
    touchBitmap(getOakPart(tree.shape, OAK_TONES, TRUNK_COLOR, dpr, 'c0').canvas)
    yield
  }
  for (const bush of world.bushes) {
    const wood = bushPartSprite(bush, dpr, 'wood', true)
    const leaves = bushPartSprite(bush, dpr, 'c0', true)
    if (wood) {
      touchBitmap(wood.canvas)
    }
    if (leaves) {
      touchBitmap(leaves.canvas)
    }
  }
  yield
  // The foreground's rocks and ferns (their summer bitmaps are otherwise made when first drawn).
  const rocks = [...world.rocks, ...world.frontRocks.map((front) => front.rock)]
  const ferns = [...world.ferns, ...world.frontFerns.map((front) => front.fern)]
  for (const [index, rock] of rocks.entries()) {
    warmRockSprite(rock, dpr)
    if (index % 6 === 5) {
      yield
    }
  }
  for (const [index, fern] of ferns.entries()) {
    warmFernSprite(fern, dpr)
    if (index % 6 === 5) {
      yield
    }
  }
  yield
  // The other looks of the foreground are made in the background as they come near (see `drawBush`, `drawCrowns`).
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
