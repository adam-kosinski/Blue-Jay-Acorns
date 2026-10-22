/** Player square is one eighth of the viewport height. */
export const PLAYER_VIEW_FRACTION = 1 / 8

/** Acorn diameter is one quarter of the player height. */
export const ACORN_PLAYER_FRACTION = 1 / 4

/** World width is this many times the viewport width. */
export const WORLD_WIDTH_MULTIPLIER = 10

/**
 * Extra world height above the altitude where the camera no longer
 * shows the ground, as a fraction of the viewport height.
 */
export const WORLD_TOP_EXTRA_FACTOR = 0.35

/** Ground strip height as a fraction of the viewport height. */
export const GROUND_VIEW_FRACTION = 0.04

/** Oak trees spawned when a run starts. */
export const OAK_TREE_COUNT = 10

/** Acorns scattered on the ground at the start of a run. */
export const ACORN_COUNT = 32

/** Vertical climb/descend speed as a multiple of player size. */
export const VERTICAL_SPEED_IN_SIZES = 2.7

/** Horizontal speed is twice the vertical speed. */
export const MOVE_SPEED_IN_SIZES = VERTICAL_SPEED_IN_SIZES * 2

/** Walking speed as a fraction of flying speed. */
export const WALK_SPEED_FACTOR = 0.5

/**
 * Takeoff hover gap (ground to sprite bottom) as a multiple of player size:
 * one third of the original 140px hover with a 48px sprite.
 */
export const HOVER_OFFSET_IN_SIZES = 140 / 48 / 3

/** How close (in player sizes) an acorn must be to be picked up or dug up. */
export const REACH_IN_SIZES = 0.8

/** Fall acceleration of a dropped acorn, in player sizes per second squared. */
export const ACORN_GRAVITY_IN_SIZES = 12

/** Fill color for the blue jay's body. */
export const PLAYER_COLOR = '#4a82c4'

/** Fill color for acorns. */
export const ACORN_COLOR = '#8a5a2b'

/** Dirt color at the foreground surface; distant layers blend it toward haze. */
export const GROUND_COLOR = '#7b5232'

/** Haze color distant forest layers blend toward. */
export const FOREST_HAZE_COLOR = '#cfe2c6'

/** Seconds for a full hunger bar to drain to empty. */
export const HUNGER_DRAIN_SECONDS = 120

/** Hunger level (0-1) below which the bar turns yellow and eating is allowed. */
export const HUNGER_THRESHOLD = 0.5

/** Hunger restored by eating one acorn (half of a full bar). */
export const ACORN_NUTRITION = 0.5

/** Seconds the eating animation lasts. */
export const EAT_DURATION = 0.7

/** NPC blue jays spawned per run. */
export const NPC_COUNT = 5

/** NPC viewing distance as a fraction of the viewport width. */
export const NPC_VIEW_FRACTION = 1 / 3

/** Chance per second that an exploring NPC with a visible acorn starts gathering. */
export const NPC_GATHER_PROBABILITY = 0.5

/** Maximum burial-trip distance in viewport widths (either direction). */
export const NPC_BURIAL_SPAN_VIEWS = 2

/** Leaf tones for foreground oaks, dark to light (distant layers blend these toward haze). */
export const OAK_TONES = ['#1f5a2b', '#2a6e34', '#348040', '#439150']

/** NPCs idle instead of exploring while hunger is above this. */
export const NPC_IDLE_HUNGER = 0.8

/** Chance per second that a not-so-full idle NPC starts exploring. */
export const NPC_IDLE_EXIT_PROBABILITY = 0.1

/** Trees, rocks, bushes, logs and leaf litter are drawn this many times bigger than the base design. */
export const SCENERY_SCALE = 2

/** Oak trunk fill. */
export const TRUNK_COLOR = '#6b3e1d'

/** Oak crown fill. */
export const CROWN_COLOR = '#2f7a3a'

/**
 * Player square size for the current viewport.
 *
 * @param viewHeight - Window height in CSS pixels.
 */
export function playerSizeForView(viewHeight: number): number {
  return viewHeight * PLAYER_VIEW_FRACTION
}

/**
 * Acorn radius so the circle's diameter is 1/4 of the player height.
 *
 * @param playerSize - Current player square size.
 */
export function acornRadiusForPlayer(playerSize: number): number {
  return (playerSize * ACORN_PLAYER_FRACTION) / 2
}

/**
 * Ground strip thickness for the current viewport.
 *
 * @param viewHeight - Window height in CSS pixels.
 */
export function groundHeightForView(viewHeight: number): number {
  return viewHeight * GROUND_VIEW_FRACTION
}
