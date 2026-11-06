import {
  BURIAL_HOPS_TO_HIDE,
  BURIAL_NOTICE_DECAY_PER_HOP,
  NPC_PERCEIVE_AHEAD_IN_SIZES,
  NPC_PERCEIVE_BEHIND_IN_SIZES,
} from './constants'
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

/**
 * How likely a bird in view is to notice a burial mound that `hops` hops have disguised: 1 for a fresh
 * mound, falling steeply with the first hops and ever more gently after, to 0 when fully hidden
 * (`BURIAL_HOPS_TO_HIDE`). An exponential decay, pinned to hit 0 at the last hop:
 * (e^(-k h) - e^(-k N)) / (1 - e^(-k N)). With k = 0.5 and N = 10: 1, .60, .36, .22, .13, .08, .05,
 * .02, .01, .004, 0.
 *
 * @param hops - Hops made near the mound since it was buried.
 */
export function burialSiteVisibility(hops: number): number {
  const h = Math.max(0, Math.min(BURIAL_HOPS_TO_HIDE, hops))
  const floor = Math.exp(-BURIAL_NOTICE_DECAY_PER_HOP * BURIAL_HOPS_TO_HIDE)
  return (Math.exp(-BURIAL_NOTICE_DECAY_PER_HOP * h) - floor) / (1 - floor)
}
