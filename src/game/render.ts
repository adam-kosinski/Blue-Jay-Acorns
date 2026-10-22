import {
  ACORN_COLOR,
  CROWN_COLOR,
  EAT_DURATION,
  FOREST_HAZE_COLOR,
  GROUND_COLOR,
  HUNGER_THRESHOLD,
  OAK_TONES,
  PLAYER_COLOR,
  TRUNK_COLOR,
} from './constants'
import { drawLeafyDisk, drawOak, drawOakVector, seededRandom } from './oak'
import { groundYAt } from './terrain'
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
  Rock,
  Terrain,
  World,
} from './types'

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
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  viewHeight: number,
  world: World,
  camera: Camera,
  player: Player,
): void {
  const haze = ctx.createLinearGradient(0, 0, 0, viewHeight)
  haze.addColorStop(0, '#9dbf9c')
  haze.addColorStop(1, FOREST_HAZE_COLOR)
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, viewWidth, viewHeight)

  drawForest(ctx, world.forest, world, camera, viewWidth, viewHeight)

  ctx.save()
  ctx.translate(-camera.x, -camera.y)

  drawLogs(ctx, world, camera.x, viewWidth)
  drawGround(ctx, world, camera.x, viewWidth)
  drawLeafLitter(ctx, world.leaves, camera.x, viewWidth)
  drawMounds(ctx, world.acorns, world.terrain, camera.x, viewWidth)
  drawTrees(ctx, world.trees, world.terrain, camera.x, viewWidth)
  drawProps(ctx, world, camera.x, viewWidth)
  for (const npc of world.npcs) {
    drawBird(ctx, npc.bird)
    drawNpcLabel(ctx, npc)
  }
  drawBird(ctx, player)
  drawAcorns(ctx, world.acorns, camera.x, viewWidth)

  ctx.restore()

  drawMinimap(ctx, viewWidth, world, camera, viewHeight, player)
  drawHungerBar(ctx, viewWidth, player)

  ctx.fillStyle = '#1b2838'
  ctx.font = '18px Georgia, serif'
  ctx.textAlign = 'left'
  ctx.fillText(`state: ${player.state}${player.walking ? ' (walking)' : ''}`, 16, 32)
  ctx.fillText(player.held ? 'holding an acorn' : 'beak empty', 16, 56)
  ctx.fillText(
    'WASD move · S (ground) pick up / drop · B bury / dig up · E eat when hungry',
    16,
    viewHeight - 14,
  )
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
  for (const layer of layers) {
    const p = layer.parallax
    const base = world.groundY - maxCamY * (1 - p) - camera.y * p - layer.lift * viewHeight
    if (base >= viewHeight + 400) {
      continue
    }
    const strip = forestStripFor(layer, world)
    const srcX = Math.min(camera.x * p * strip.resolution, Math.max(0, strip.canvas.width - 1))
    const srcW = Math.min(viewWidth * strip.resolution, strip.canvas.width - srcX)
    const stripHeight = strip.canvas.height / strip.resolution
    // Only blit the rows that land on screen.
    const topRow = Math.max(0, strip.originY - base)
    const bottomRow = Math.min(stripHeight, viewHeight - base + strip.originY)
    if (bottomRow > topRow) {
      ctx.drawImage(
        strip.canvas,
        srcX,
        topRow * strip.resolution,
        srcW,
        (bottomRow - topRow) * strip.resolution,
        0,
        base - strip.originY + topRow,
        srcW / strip.resolution,
        bottomRow - topRow,
      )
    }
    const below = base - strip.originY + stripHeight
    if (below < viewHeight) {
      ctx.fillStyle = layer.groundColor
      ctx.fillRect(0, below - 1, viewWidth, viewHeight - below + 1)
    }
  }
}

/** Pre-rendered forest layer: horizon, trees, bushes and logs drawn once into a wide bitmap. */
type ForestStrip = {
  canvas: HTMLCanvasElement
  /** Bitmap pixels per CSS pixel. */
  resolution: number
  /** Y of the layer's base line inside the bitmap. */
  originY: number
}

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
  const relief = 0.3 + 0.7 * layer.parallax
  const phase = Math.round(layer.parallax * 10000)
  const offset = (layerX: number): number =>
    (groundYAt(world.terrain, (layerX + phase) % world.width) - world.groundY) * relief

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
  const originY = Math.ceil(treeHeight + (world.groundY - minGround) * relief + 20)
  const resolution = layer.parallax < 0.4 ? 0.5 : 0.75
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(layer.span * resolution)
  canvas.height = Math.ceil((originY + 6) * resolution)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(resolution, resolution)
    ctx.fillStyle = layer.groundColor
    ctx.beginPath()
    ctx.moveTo(0, originY + 6)
    for (let x = 0; x <= layer.span + 8; x += 8) {
      ctx.lineTo(x, originY + offset(x))
    }
    ctx.lineTo(layer.span + 8, originY + 6)
    ctx.closePath()
    ctx.fill()
    for (const tree of layer.trees) {
      drawOakVector(ctx, tree.shape, tree.x, originY + offset(tree.x), layer.tones, layer.trunkColor, 0.02 + layer.parallax * 0.4)
    }
    ctx.fillStyle = layer.trunkColor
    for (const log of layer.logs) {
      ctx.beginPath()
      ctx.roundRect(
        log.x - log.length / 2,
        originY + offset(log.x) - log.radius * 1.7,
        log.length,
        log.radius * 2,
        log.radius * 0.5,
      )
      ctx.fill()
    }
    for (const bush of layer.bushes) {
      const bushY = originY + offset(bush.x)
      const rand = seededRandom(Math.floor(bush.x * 13))
      for (const lobe of bush.lobes) {
        drawLeafyDisk(ctx, bush.x + lobe.dx, bushY + lobe.dy, lobe.radius, layer.tones, 1, rand, 0.3)
      }
    }
  }
  const strip = { canvas, resolution, originY }
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
  const endX = Math.min(world.width, cameraX + viewWidth + 16 + terrain.step)
  const dirt = ctx.createLinearGradient(0, world.groundY - world.groundHeight * 4, 0, world.height)
  dirt.addColorStop(0, GROUND_COLOR)
  dirt.addColorStop(1, '#4b2f1a')
  ctx.fillStyle = dirt
  ctx.beginPath()
  ctx.moveTo(startX, world.height)
  for (let x = startX; x <= endX; x += terrain.step) {
    ctx.lineTo(x, groundYAt(terrain, x))
  }
  ctx.lineTo(endX, world.height)
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

/**
 * Draws fallen leaves that overlap the current view (the list is sorted by x).
 *
 * @param ctx - 2D canvas context in world space.
 * @param leaves - Generated leaf litter.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawLeafLitter(
  ctx: CanvasRenderingContext2D,
  leaves: LeafLitter[],
  cameraX: number,
  viewWidth: number,
): void {
  const left = cameraX - 20
  const right = cameraX + viewWidth + 20
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
  for (let i = lo; i < leaves.length; i += 1) {
    const leaf = leaves[i]
    if (!leaf || leaf.x > right) {
      break
    }
    ctx.fillStyle = leaf.color
    ctx.beginPath()
    ctx.ellipse(leaf.x, leaf.y, leaf.rx, leaf.ry, leaf.angle, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Draws small dirt mounds marking where acorns are buried.
 *
 * @param ctx - 2D canvas context in world space.
 * @param acorns - All acorns.
 * @param terrain - Ground heights.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawMounds(
  ctx: CanvasRenderingContext2D,
  acorns: Acorn[],
  terrain: Terrain,
  cameraX: number,
  viewWidth: number,
): void {
  ctx.fillStyle = '#6b4a2b'
  for (const acorn of acorns) {
    if (acorn.state !== 'buried' || acorn.x < cameraX - 40 || acorn.x > cameraX + viewWidth + 40) {
      continue
    }
    ctx.beginPath()
    ctx.ellipse(acorn.x, groundYAt(terrain, acorn.x), acorn.radius * 1.8, acorn.radius * 0.8, 0, Math.PI, 0)
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
 * Draws fallen logs that overlap the view, resting on the average ground height under them.
 *
 * Called before the ground so the ground (and leaf litter) covers the lower part of each log.
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawLogs(
  ctx: CanvasRenderingContext2D,
  world: World,
  cameraX: number,
  viewWidth: number,
): void {
  const left = cameraX - 600
  const right = cameraX + viewWidth + 600
  for (const log of world.logs) {
    if (log.x > left && log.x < right) {
      const under =
        (groundYAt(world.terrain, log.x - log.length / 2) +
          groundYAt(world.terrain, log.x) +
          groundYAt(world.terrain, log.x + log.length / 2)) /
        3
      drawLog(ctx, log, under)
    }
  }
}

/**
 * Draws bushes and rocks that overlap the view (no collision).
 * (Logs are drawn earlier, behind the ground.)
 *
 * @param ctx - 2D canvas context in world space.
 * @param world - Play space.
 * @param cameraX - View left edge.
 * @param viewWidth - Viewport width.
 */
function drawProps(
  ctx: CanvasRenderingContext2D,
  world: World,
  cameraX: number,
  viewWidth: number,
): void {
  const left = cameraX - 400
  const right = cameraX + viewWidth + 400
  for (const rock of world.rocks) {
    if (rock.x > left && rock.x < right) {
      drawRock(ctx, rock, groundYAt(world.terrain, rock.x))
    }
  }
  for (const bush of world.bushes) {
    if (bush.x > left && bush.x < right) {
      drawBush(ctx, bush, groundYAt(world.terrain, bush.x))
    }
  }
}

/**
 * Draws a bush as overlapping green lobes with soft highlights.
 *
 * @param ctx - 2D canvas context in world space.
 * @param bush - Bush to draw.
 * @param groundY - Ground Y at the bush.
 */
function drawBush(ctx: CanvasRenderingContext2D, bush: Bush, groundY: number): void {
  const rand = seededRandom(Math.floor(bush.x * 13))
  for (const lobe of bush.lobes) {
    drawLeafyDisk(
      ctx,
      bush.x + lobe.dx,
      groundY + lobe.dy,
      lobe.radius,
      shadeRamp(lobe.color),
      2,
      rand,
      0.9,
    )
  }
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
  const { length: len, radius: r } = log
  ctx.save()
  // Sunk about 40% into the ground: the ground polygon is drawn over the lower part.
  ctx.translate(log.x, groundY - r * 0.2)
  ctx.rotate(log.tilt)
  ctx.fillStyle = '#6b4423'
  ctx.fillRect(-len / 2, -r, len, r * 2)
  ctx.strokeStyle = '#4a2d14'
  ctx.lineWidth = 2
  for (const f of [-0.5, 0, 0.5]) {
    ctx.beginPath()
    ctx.moveTo(-len / 2 + len * 0.05, r * f)
    ctx.lineTo(len / 2 - len * 0.05, r * f)
    ctx.stroke()
  }
  ctx.fillStyle = '#4f3118'
  ctx.beginPath()
  ctx.ellipse(-len / 2, 0, r * 0.35, r, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#d2a972'
  ctx.beginPath()
  ctx.ellipse(len / 2, 0, r * 0.35, r, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#8c6236'
  ctx.lineWidth = 1.5
  for (const k of [0.7, 0.4, 0.15]) {
    ctx.beginPath()
    ctx.ellipse(len / 2, 0, r * 0.35 * k, r * k, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draws a rock as a jittered half-ellipse polygon with a highlight.
 *
 * @param ctx - 2D canvas context in world space.
 * @param rock - Rock to draw.
 * @param groundY - Ground Y at the rock.
 */
function drawRock(ctx: CanvasRenderingContext2D, rock: Rock, groundY: number): void {
  const n = rock.jitter.length
  const baseY = groundY + rock.ry * 0.15
  ctx.fillStyle = rock.color
  ctx.beginPath()
  rock.jitter.forEach((j, i) => {
    const angle = Math.PI + (Math.PI * i) / (n - 1)
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
  ctx.fillStyle = rock.highlight
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.ellipse(rock.x - rock.rx * 0.28, baseY - rock.ry * 0.55, rock.rx * 0.3, rock.ry * 0.2, -0.4, 0, Math.PI * 2)
  ctx.fill()
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
    // Settle slightly into the ground with a soft contact shadow.
    ctx.fillStyle = 'rgba(30, 15, 5, 0.35)'
    ctx.beginPath()
    ctx.ellipse(acorn.x, acorn.y + acorn.radius * 0.8, acorn.radius * 1.05, acorn.radius * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()
    drawAcornShape(ctx, acorn.x, acorn.y + acorn.radius * 0.2, acorn.radius, (lean < 0.5 ? 1 : -1) * (0.9 + lean * 0.6))
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
  return player.walking ? -Math.abs(Math.sin(player.animTime * 12)) * 5 : 0
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
function drawBird(ctx: CanvasRenderingContext2D, player: Player): void {
  const u = player.size / 100
  const flying = player.state === 'flying'
  const t = player.animTime
  const eating = player.eatTimer > 0
  const eatProgress = eating ? 1 - player.eatTimer / EAT_DURATION : 0
  // Beak gap: open around the held acorn, chomping while eating.
  const beakGap = !player.held ? 0 : eating ? 2 + Math.abs(Math.sin(eatProgress * Math.PI * 5)) * 7 : 8.5

  ctx.save()
  ctx.translate(player.x + player.size / 2, player.y + player.size / 2 + bodyBob(player) * u)
  ctx.scale(player.facing * u, u)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Legs
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineWidth = 4
  if (flying) {
    for (const dx of [-6, 4]) {
      ctx.beginPath()
      ctx.moveTo(dx, 24)
      ctx.lineTo(dx - 8, 34)
      ctx.stroke()
    }
  } else {
    const swing = player.walking ? Math.sin(t * 12) * 12 : 0
    const lift = player.walking ? 5 : 0
    const legs: [number, number, number][] = [
      [-6, swing, Math.max(0, Math.cos(t * 12)) * lift],
      [6, -swing, Math.max(0, -Math.cos(t * 12)) * lift],
    ]
    for (const [hipX, footDx, footLift] of legs) {
      const footX = hipX + footDx
      const footY = 47 - footLift
      ctx.beginPath()
      ctx.moveTo(hipX, 24)
      ctx.lineTo(footX, footY)
      ctx.lineTo(footX + 7, footY)
      ctx.stroke()
    }
  }

  // Posture: upright when standing, a slight incline in flight (wings hinge on this axis)
  ctx.save()
  ctx.translate(0, 6)
  const bodyTilt = flying ? -0.04 : -0.3
  ctx.rotate(bodyTilt)
  ctx.translate(0, -6)
  // The head keeps one world tilt in every pose; only the body tilt changes (pivot at the neck).
  const headTurn = -0.04 - bodyTilt
  const tiltHead = (): void => {
    ctx.translate(16, -8)
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

  ctx.save()
  ctx.translate(mx, my)
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

  for (const tree of world.trees) {
    const cx = (tree.x + tree.trunkWidth / 2) * scale
    const treeGround = groundYAt(world.terrain, tree.x + tree.trunkWidth / 2)
    ctx.fillStyle = CROWN_COLOR
    ctx.beginPath()
    ctx.arc(cx, (treeGround - tree.trunkHeight) * scale, Math.max(3, tree.crownRadius * scale), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = TRUNK_COLOR
    ctx.fillRect(cx - 1, (treeGround - tree.trunkHeight) * scale, 2, tree.trunkHeight * scale)
  }

  ctx.fillStyle = ACORN_COLOR
  for (const acorn of world.acorns) {
    if (acorn.state === 'ground') {
      ctx.fillRect(acorn.x * scale - 1, groundYAt(world.terrain, acorn.x) * scale - 3, 2.5, 3)
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

  ctx.strokeStyle = '#1f3d52'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, mapW, mapH)
  ctx.restore()
}

/**
 * Draws a debug label above an NPC: its state, hunger, and nosiness.
 *
 * @param ctx - 2D canvas context in world space.
 * @param npc - NPC to annotate.
 */
function drawNpcLabel(ctx: CanvasRenderingContext2D, npc: Npc): void {
  const x = npc.bird.x + npc.bird.size / 2
  const y = npc.bird.y - npc.bird.size * 0.75
  ctx.font = '12px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fillStyle = '#1b2838'
  const lines = [npc.state, `hunger ${npc.bird.hunger.toFixed(2)} · nosy ${npc.nosiness.toFixed(2)}`]
  lines.forEach((line, i) => {
    const ly = y - (lines.length - 1 - i) * 14
    ctx.strokeText(line, x, ly)
    ctx.fillText(line, x, ly)
  })
  ctx.textAlign = 'left'
}

/**
 * Draws the hunger bar (top right): green when fed, yellow below the threshold marker.
 *
 * @param ctx - 2D canvas context in screen space.
 * @param viewWidth - Viewport width.
 * @param player - Bird (hunger level and held acorn).
 */
function drawHungerBar(ctx: CanvasRenderingContext2D, viewWidth: number, player: Player): void {
  const w = Math.min(220, viewWidth * 0.25)
  const h = 18
  const x = viewWidth - w - 120
  const y = 16
  const hungry = player.hunger < HUNGER_THRESHOLD

  ctx.fillStyle = 'rgba(27, 40, 56, 0.55)'
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
  ctx.fillStyle = hungry ? '#f2c230' : '#5cb85c'
  ctx.fillRect(x, y, w * player.hunger, h)

  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x + w * HUNGER_THRESHOLD, y - 5)
  ctx.lineTo(x + w * HUNGER_THRESHOLD, y + h + 5)
  ctx.stroke()

  ctx.fillStyle = '#1b2838'
  ctx.font = '14px Georgia, serif'
  ctx.textAlign = 'right'
  ctx.fillText(
    hungry && player.held ? 'Hungry - press E to eat' : hungry ? 'Hungry' : 'Hunger',
    x + w,
    y + h + 20,
  )
  ctx.textAlign = 'left'
}
