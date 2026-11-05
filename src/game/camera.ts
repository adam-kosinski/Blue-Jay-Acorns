import { TERRAIN_STEP, liftAt, lowPass } from './terrain'
import type { Camera, Player, Terrain, World } from './types'

/** Width (world pixels) of the window over which the terrain height is averaged for the camera, about one screen. */
const CAMERA_TERRAIN_AVERAGE_WIDTH = 1400

/** Where (as a fraction of the view height down from the top) a bird on the creek sits at the camera's lowest position. */
const CREEK_BIRD_SCREEN_FRACTION = 0.83

const smoothedTerrain = new WeakMap<Terrain, Float32Array>()

/**
 * The average height of the ground around x: the terrain smoothed over about a screen's width, so
 * the camera does not wobble with every bump and dip the bird walks over or flies above.
 *
 * @param terrain - Terrain (the creek's channel is averaged in too).
 * @param x - World x.
 */
function averageGroundAt(terrain: Terrain, x: number): number {
  let smooth = smoothedTerrain.get(terrain)
  if (!smooth) {
    smooth = lowPass(terrain.heights, CAMERA_TERRAIN_AVERAGE_WIDTH / 2.5 / TERRAIN_STEP)
    smoothedTerrain.set(terrain, smooth)
  }
  return liftAt(smooth, x)
}

/**
 * Camera top-left: horizontally centered on the player, and vertically positioned by where the
 * bird is, so the view does not bob with every small movement.
 *
 * - Standing (or floating), the bird sits two thirds of the way down the screen (a third up from
 *   the bottom).
 * - When it takes off, the camera holds still until the bird has risen to a third of the way down
 *   the screen; if it goes higher it stays there and the camera follows.
 * - Coming in to land, the camera stops panning down once the bird, were it standing on the
 *   average terrain height directly below, would sit at the two-thirds position (the average, not
 *   the exact ground, so bumps and the creek's channel do not make the view wobble).
 *
 * The camera also has a lowest position (see `lowest`), so in the creek the bird sits just above the
 * hunger bar's caption instead of the view sinking further down.
 *
 * All of that is the camera following the bird at a third of the way down, but never lower than the
 * standing camera for the average ground below it.
 *
 * @param player - Sprite to follow.
 * @param world - Play-space bounds.
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 */
export function cameraForPlayer(
  player: Player,
  world: World,
  viewWidth: number,
  viewHeight: number,
): Camera {
  const centerX = player.x + player.size / 2
  const centerY = player.y + player.size / 2
  const maxX = Math.max(0, world.width - viewWidth)
  // The camera never goes lower than the position that puts a bird floating on the creek just above
  // the hunger bar's caption (83% of the way down the screen), however low the land around is.
  const lowest = world.terrain.creek.waterY - player.size * 0.26 - viewHeight * CREEK_BIRD_SCREEN_FRACTION
  const maxY = Math.max(0, Math.min(world.height - viewHeight, lowest))
  // Where the camera would be if the bird stood on the average ground right below it.
  const standing = averageGroundAt(world.terrain, centerX) - player.size / 2 - (viewHeight * 2) / 3
  return {
    x: clamp(centerX - viewWidth / 2, 0, maxX),
    y: clamp(Math.min(centerY - viewHeight / 3, standing), 0, maxY),
  }
}

/**
 * Clamps `value` into `[min, max]`.
 *
 * @param value - Input.
 * @param min - Lower bound.
 * @param max - Upper bound.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
