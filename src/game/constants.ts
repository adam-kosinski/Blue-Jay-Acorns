/** Player square is one eighth of the viewport height. */
export const PLAYER_VIEW_FRACTION = 1 / 8

/** Acorn diameter is one quarter of the player height. */
export const ACORN_PLAYER_FRACTION = 1 / 4

/** World width is this many times the viewport width. */
export const WORLD_WIDTH_MULTIPLIER = 5

/**
 * Extra world height above the altitude where the camera no longer
 * shows the ground, as a fraction of the viewport height.
 */
export const WORLD_TOP_EXTRA_FACTOR = 0.35

/** Ground strip height as a fraction of the viewport height. */
export const GROUND_VIEW_FRACTION = 0.04

/** Oak trees spawned when a run starts. */
export const OAK_TREE_COUNT = 5

/** Acorns scattered on the ground at the start of a run. */
export const ACORN_COUNT = 16

/** Vertical climb/descend speed as a multiple of player size. */
export const VERTICAL_SPEED_IN_SIZES = 2.7

/** Horizontal speed is twice the vertical speed. */
export const MOVE_SPEED_IN_SIZES = VERTICAL_SPEED_IN_SIZES * 2

/** Seconds one hop takes; hops follow one another without pausing while A/D stay held. */
export const HOP_DURATION = 0.28

/** Seconds the pick-up animation lasts (the acorn changes hands halfway). */
export const PICKUP_DURATION = 0.3

/** Seconds the bury and dig-up animations last (the acorn changes hands halfway). */
export const BURY_DURATION = 0.9

/** Seconds an NPC pauses after picking up an acorn, after landing to bury, and before exploring. */
export const NPC_WAIT_SECONDS = 1

/**
 * Chance per second that an oak drops a group of acorns. With 5 oaks and 3-10 acorns per group this
 * is about 1 acorn per minute worldwide, matching what the 4 NPC jays eat once the starting acorns
 * are gone (each hungry jay eats roughly one acorn a minute; in headless runs they ate 5-8 of the
 * starting acorns in the first two minutes, then ran out).
 */
export const ACORN_DROP_CHANCE_PER_SECOND = 0.0005

/** Acorns per dropped group. */
export const ACORN_GROUP_MIN = 3
export const ACORN_GROUP_MAX = 10

/** No new acorns drop while the world already holds this many. */
export const ACORN_WORLD_CAP = 160

/** Walking speed as a fraction of flying speed (the average hopping speed). */
export const WALK_SPEED_FACTOR = 0.5

/** Hop length on the ground, as a multiple of player size: hopping speed is half the flying speed. */
export const HOP_LENGTH_IN_SIZES = MOVE_SPEED_IN_SIZES * WALK_SPEED_FACTOR * HOP_DURATION

/** Where the beak tip touches the ground in a pecking pose, in sprite units ahead of the bird's center. */
export const BEAK_REACH_X = 54

/**
 * Takeoff hover gap (ground to sprite bottom) as a multiple of player size:
 * one third of the original 140px hover with a 48px sprite.
 */
export const HOVER_OFFSET_IN_SIZES = 140 / 48 / 3

/** How close (in player sizes) an acorn must be to be picked up or dug up. */
export const REACH_IN_SIZES = 0.9

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
export const HUNGER_DRAIN_SECONDS = 60

/** Hunger level (0-1) below which the bar turns yellow and eating is allowed. */
export const HUNGER_THRESHOLD = 2 / 3

/** Hunger restored by eating one acorn (a third of a full bar). */
export const ACORN_NUTRITION = 1 / 3

/** Seconds the eating animation lasts. */
export const EAT_DURATION = 0.7

/** NPC blue jays spawned per run. */
export const NPC_COUNT = 4

/** NPC viewing distance as a fraction of the viewport width. */
export const NPC_VIEW_FRACTION = 1 / 3

/** Chance per second that an exploring NPC with a visible acorn starts gathering. */
export const NPC_GATHER_PROBABILITY = 0.5

/** Maximum burial-trip distance in viewport widths (either direction). */
export const NPC_BURIAL_SPAN_VIEWS = 2

/** Leaf tones for foreground oaks, dark to light (distant layers blend these toward haze). */
export const OAK_TONES = ['#1f5a2b', '#2a6e34', '#348040', '#439150']

/** NPC jays fly and hop at this fraction of the main bird's speed. */
export const NPC_SPEED_SCALE = 0.75

/** An exploring NPC this hungry (or hungrier) goes to dig up an acorn it remembers burying. */
export const NPC_RETRIEVE_HUNGER = 0.2

/** NPCs idle instead of exploring while hunger is above this; below it they explore. */
export const NPC_IDLE_HUNGER = 0.9

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
