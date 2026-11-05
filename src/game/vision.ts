import { NPC_PERCEIVE_AHEAD_IN_SIZES, NPC_PERCEIVE_BEHIND_IN_SIZES } from './constants'
import type { Player } from './types'

/**
 * Whether the bird can currently see a point on the ground (a free acorn or a burial spot).
 *
 * A bird sees acorns up to a third of a typical screen width in front of it and about one bird-width
 * behind it (and within the same distance above or below), all measured in player sizes so the range
 * never depends on the window size. "In front" follows the way the bird faces.
 *
 * @param bird - Looking bird (its facing sets "ahead").
 * @param acorn - Point to check (an acorn, or the spot of a burial).
 */
export function inView(bird: Player, acorn: { x: number; y: number }): boolean {
  const forward = (acorn.x - (bird.x + bird.size / 2)) * bird.facing
  const dy = acorn.y - (bird.y + bird.size / 2)
  const ahead = NPC_PERCEIVE_AHEAD_IN_SIZES * bird.size
  const behind = NPC_PERCEIVE_BEHIND_IN_SIZES * bird.size
  return forward <= ahead && forward >= -behind && Math.abs(dy) <= ahead
}
