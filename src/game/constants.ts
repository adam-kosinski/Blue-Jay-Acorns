/** Player square is one eighth of the viewport height. */
export const PLAYER_VIEW_FRACTION = 1 / 8

/**
 * The game is simulated in a fixed logical view this tall (in logical pixels) and scaled to fit the
 * window, so no gameplay distance depends on the window's size.
 */
export const LOGICAL_VIEW_HEIGHT = 800

/** Aspect ratio of a typical screen, used wherever a "screen width" is needed as a guideline. */
export const TYPICAL_ASPECT_RATIO = 16 / 9

/** Width of a typical screen in player sizes (eight sizes tall, 16:9). */
export const TYPICAL_VIEW_WIDTH_IN_SIZES = TYPICAL_ASPECT_RATIO / PLAYER_VIEW_FRACTION

/** Acorn diameter is one quarter of the player height. */
export const ACORN_PLAYER_FRACTION = 1 / 4

/** World width is this many times the viewport width. */
export const WORLD_WIDTH_MULTIPLIER = 5

/**
 * Extra world height above the altitude where the camera no longer
 * shows the ground, as a fraction of the viewport height.
 */
export const WORLD_TOP_EXTRA_FACTOR = 0.65

/**
 * Extra dirt below the flat reference ground line, as a fraction of the viewport height. With the
 * camera keeping the bird two thirds of the way down the screen, this is what lets a standing bird
 * sit about a third up from the bottom instead of right at it.
 */
export const WORLD_BOTTOM_EXTRA_FACTOR = 0.25

/** Ground strip height as a fraction of the viewport height. */
export const GROUND_VIEW_FRACTION = 0.04

/** Oak trees spawned when a run starts. */
export const OAK_TREE_COUNT = 3

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

/**
 * The follow state: a followed bird that stays inside a horizontal window `PATIENCE_WINDOW_IN_SIZES` bird
 * widths wide for `PATIENCE_INTERVAL_SECONDS` makes the follower roll (probability 1 - nosiness) to lose
 * interest, and again every interval it stays there. A follower tries to stay within
 * a distance of `FOLLOW_DISTANCE_MIN_IN_SIZES` to `FOLLOW_DISTANCE_MAX_IN_SIZES` bird widths (uniform, drawn when it starts following) of its target, and does not follow the same bird again for
 * `FOLLOW_COOLDOWN_SECONDS` after losing interest or losing it.
 */
export const PATIENCE_INTERVAL_SECONDS = 5
export const PATIENCE_WINDOW_IN_SIZES = 1
export const FOLLOW_DISTANCE_MIN_IN_SIZES = 2
export const FOLLOW_DISTANCE_MAX_IN_SIZES = 4
export const FOLLOW_COOLDOWN_SECONDS = 10

/** Seconds an NPC pauses after picking up an acorn, after landing to bury, and before exploring. */
export const NPC_WAIT_SECONDS = 1

/**
 * Debug setting for the acorn rate: a fixed rate (1 is the baseline that exactly matches the nutrition
 * needs, 0 spawns nothing) or the value the season timeline gives (null, the default).
 */
export const ACORN_DROP_MODES = {
  '0': 0,
  '0.75': 0.75,
  '1': 1,
  '1.25': 1.25,
  timeline: null,
} as const

/** The order the debug radio buttons list them in (object keys that look like numbers would be sorted numerically). */
export const ACORN_DROP_MODE_ORDER = ['0', '0.75', '1', '1.25', 'timeline'] as const

/** Which acorn drop rate the debug toggle selects. */
export type AcornDropMode = keyof typeof ACORN_DROP_MODES

/**
 * Acorns per dropped group: `ACORN_GROUP_MEAN` plus or minus up to `ACORN_GROUP_SPREAD` at the baseline acorn
 * rate of 1. The acorn rate acts half on how often groups drop and half on how big they are: both are
 * multiplied by the square root of the rate (so acorns per second are multiplied by the rate itself); the
 * plus or minus never changes.
 */
export const ACORN_GROUP_MEAN = 3
export const ACORN_GROUP_SPREAD = 1

/** No new acorns drop while the world already holds this many that are not buried (buried ones do not count). */
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

/**
 * How close (in player sizes) a buried acorn must be to the beak tip for a dig to bring it up (the
 * closest one in range does). Hardcoded; everything derived from the dig range (burial-quality penalties
 * near remembered burials and sites, what an empty dig forgets) is expressed in terms of this value.
 * It used to be 1/3 (measured around wherever the bird was told to dig), then 0.84.
 */
export const DIG_RESPONSE_IN_SIZES = 0.25

/** How close (in player sizes) an acorn must be to be picked up or dug up. */
export const REACH_IN_SIZES = 0.9

/** Fall acceleration of a dropped acorn, in player sizes per second squared. */
export const ACORN_GRAVITY_IN_SIZES = 12

/** Fallen-leaf colors (the ground's litter, and the leaves a hopping bird kicks up). */
export const LEAF_COLORS = ['#8a5a2b', '#a8691f', '#c47f2a', '#b5651d', '#9c7a2e', '#7a4a22', '#c9962f', '#6e4320']

/** How many hops near a burial site it takes to conceal it completely. */
export const BURIAL_HOPS_TO_HIDE = 10

/**
 * How concealed a burial is, against its share of the hops needed: `(hops / hops to hide) ^ curve`.
 * Above 1, so the first hops change the mound little and the last ones the most.
 */
export const BURIAL_CONCEAL_CURVE = 2.2

/** How close (in player sizes) a bird must be when a hop starts to kick leaves over a burial site. */
export const BURIAL_HOP_RANGE_IN_SIZES = 1.1

/**
 * Kicked-up leaves lying on the ground per player size of ground (the starting piles average this,
 * and a hop keeps the stretch around the bird at the same density, so no spot, burial sites
 * included, ends up with more leaves than anywhere else).
 */
export const KICKED_LEAF_DENSITY_PER_SIZE = 4.1

/** Puffs of snow a hop kicks up where there is snow (all of them in mid winter; a share before). */
export const SNOW_PUFFS_PER_HOP = 9

/** Most kicked leaves kept lying around. */
export const KICKED_LEAVES_LIMIT = 600

/**
 * Burial quality (0-1) of a spot, for a bird looking to bury: every other bird within half a screen
 * width of the spot lowers it by this much if that bird can see the spot (it is in its view, which
 * reaches farther ahead of it than behind) and by the smaller amount below if it cannot...
 */
export const BURIAL_QUALITY_BIRD_PENALTY = 0.8
export const BURIAL_QUALITY_UNSEEN_PENALTY = 0.4

/** Burial-quality penalty near a spot where the burier itself remembers burying an acorn (within the dig-up tolerance). */
export const BURIAL_QUALITY_OWN_SITE_PENALTY = 0.2

/** Burial-quality penalty within dig range of a remembered burial site of another bird: the owner may come to dig there and would get the new acorn. */
export const BURIAL_QUALITY_OTHER_SITE_PENALTY = 0.9

/** ...an oak lowers it by up to this much (at its trunk, easing to 0 at the farthest an acorn can fall)... */
export const BURIAL_QUALITY_OAK_PENALTY = 0.5

/** Chance per second that a bird searching for a burial spot turns around when another flying jay is ahead of it going the same way. */
export const NPC_AVOID_JAY_TURN_PROBABILITY_PER_SECOND = 0.4

/** How long (seconds) an NPC shows the burial quality of the spot it chose, from when it starts burying. */
export const BURIAL_QUALITY_DISPLAY_SECONDS = 4

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
export const NPC_COUNT = 3

/** Squirrel size relative to the player's bird. */
export const SQUIRREL_SIZE_FRACTION = 1

/** Every squirrel's secrecy. */
export const SQUIRREL_SECRECY = 0.5

/** Squirrels' hunger bar is this many times as large: it drains this much slower and an acorn fills this much less of it. */
export const SQUIRREL_HUNGER_SCALE = 2

/** Squirrels hop at this multiple of the player's walking speed (the jays use NPC_SPEED_SCALE). */
export const SQUIRREL_SPEED_SCALE = 1

/**
 * A squirrel goes up its tree to idle when its hunger is above the first level and comes down again
 * when it falls below the second (lower) one, so it does not flip between the two. A jay idles
 * above 0.9 and leaves idle below 0.9. (An acorn fills only a sixth of a squirrel's bar, so it
 * rarely gets above 0.83: with 0.9 / 0.8 a squirrel idled about 1% of the time, with 0.8 / 0.7 about 20%.)
 */
export const SQUIRREL_IDLE_ENTER_HUNGER = 0.8
export const SQUIRREL_IDLE_LEAVE_HUNGER = 0.7

/**
 * How wide the stretch around an oak's trunk is that its acorns fall in and that counts as its range
 * (the squirrel's home stretch, the burial-quality penalty near the oak), as a fraction of the width
 * of its leaf clusters.
 */
export const ACORN_SPREAD_FACTOR = 0.5

/**
 * Chance per second that each oak drops a group of acorns, derived so that the default rate (1) exactly
 * matches the nutrition needs of every bird and squirrel. A bird needs 1 / (`HUNGER_DRAIN_SECONDS` x
 * `ACORN_NUTRITION`) = 0.05 acorns per second, and so does a squirrel (its bar is twice as big, drains half
 * as fast, and an acorn fills half as much of it). Each squirrel adds a mouth, so `updateTreeDrops`
 * multiplies the chance (and the world cap) by (birds + squirrels) / birds, with one squirrel per oak.
 * The player and the NPC jays are `1 + NPC_COUNT` birds; groups average `ACORN_GROUP_MEAN` at the baseline rate.
 * With 3 oaks, 3 jays + the player and 3 squirrels: 3 x 0.0222 x 1.75 x 3 = 0.35 acorns per second = 7 x 0.05.
 */
export const ACORN_DROP_CHANCE_PER_SECOND =
  ((1 + NPC_COUNT) / (HUNGER_DRAIN_SECONDS * ACORN_NUTRITION)) /
  (OAK_TREE_COUNT * ACORN_GROUP_MEAN)

/** Where a squirrel's nose tip touches the ground when it pecks or sniffs, in sprite units ahead of its centre at size 100. */
export const SQUIRREL_NOSE_REACH_X = 45

/** Squirrels climb this many sizes per second (all the way up out of the play area, where they are out of sight). */
export const SQUIRREL_CLIMB_SPEED_IN_SIZES = 4.8

/** A squirrel stands still for a random time from the first to the second value (seconds) after every hop before it hops again. */
export const SQUIRREL_HOP_PAUSE_MIN_SECONDS = 0.1
export const SQUIRREL_HOP_PAUSE_MAX_SECONDS = 0.4

/** A foraging squirrel sniffs after every this many hops (a random whole number from min to max). */
export const SQUIRREL_SNIFF_EVERY_HOPS_MIN = 2
export const SQUIRREL_SNIFF_EVERY_HOPS_MAX = 4

/** How long (seconds) a sniff lasts, how near (in squirrel widths) a buried acorn must be to the nose to be sniffed out, and by how much a sniff multiplies the usual chance to notice it. */
export const SQUIRREL_SNIFF_SECONDS = 0.9
export const SQUIRREL_SNIFF_RADIUS_IN_SIZES = 1
export const SQUIRREL_SNIFF_NOTICE_FACTOR = 2

/** A sniff notices any buried acorn of another animal within range with at least this chance (even a fully hidden one). */
export const SQUIRREL_SNIFF_MIN_CHANCE = 0.2

/** How far ahead of itself (in player sizes) an NPC can perceive acorns: a third of a typical screen. */
export const NPC_PERCEIVE_AHEAD_IN_SIZES = TYPICAL_VIEW_WIDTH_IN_SIZES / 3

/** How far behind itself (in player sizes) an NPC can perceive acorns. */
export const NPC_PERCEIVE_BEHIND_IN_SIZES = 1

/**
 * How fast the chance to notice a burial mound falls with the hops that disguised it (see
 * `burialSiteVisibility`): the first hops cut it a lot, the last ones hardly at all.
 */
export const BURIAL_NOTICE_DECAY_PER_HOP = 0.5

/**
 * Chance that a flying NPC notices an acorn at the moment it enters the bird's view. The roll is
 * made once per acorn each time it comes into view (simulating whether the bird sees it). A
 * standing bird always notices every acorn in view.
 */
export const NPC_NOTICE_PROBABILITY = 0.75

/** Maximum burial-trip distance in player sizes (either direction): two typical screen widths. */
export const NPC_BURIAL_SPAN_IN_SIZES = 2 * TYPICAL_VIEW_WIDTH_IN_SIZES

/** Leaf tones for foreground oaks, dark to light (distant layers blend these toward haze). */
export const OAK_TONES = ['#1f5a2b', '#2a6e34', '#348040', '#439150']

/** NPC jays fly and hop at this fraction of the main bird's speed. */
export const NPC_SPEED_SCALE = 0.75

/** Seconds the dashed line from an NPC to a burial site it noticed takes to fade out. */
export const NOTICE_LINE_FADE_SECONDS = 2

/** An exploring NPC this hungry (or hungrier) goes to dig up an acorn it remembers burying. */
export const NPC_RETRIEVE_HUNGER = 1 / 3

/**
 * The same threshold: an NPC this hungry (or hungrier) is starving, so it eats any acorn it gets,
 * even while on its way to bury it.
 */
export const NPC_STARVING_HUNGER = NPC_RETRIEVE_HUNGER

/** NPCs idle instead of exploring while hunger is above this; below it they explore. */
export const NPC_IDLE_HUNGER = 0.9

/** Trees, rocks, bushes, logs and leaf litter are drawn this many times bigger than the base design. */
export const SCENERY_SCALE = 2

/** Oak trunk fill. */
export const TRUNK_COLOR = '#5f4b3c'

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
