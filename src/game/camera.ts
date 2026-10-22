import type { Camera, Player, World } from './types'

/**
 * Camera top-left that centers the player, clamped so the view stays in the world.
 *
 * Near the ground the vertical clamp pins the camera to the bottom of the world
 * (same composition as the original scene). Flying up recenters the player
 * until the top of the world is reached.
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
  const maxY = Math.max(0, world.height - viewHeight)
  return {
    x: clamp(centerX - viewWidth / 2, 0, maxX),
    y: clamp(centerY - viewHeight / 2, 0, maxY),
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
