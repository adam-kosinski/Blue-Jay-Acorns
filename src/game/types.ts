/** Locomotion states for the player sprite. */
export type LocomotionState = 'standing' | 'flying'

/** Mutable player pose and state used by the game loop. */
export type Player = {
  x: number
  y: number
  size: number
  state: LocomotionState
  /** True while auto-rising from a standing takeoff to hover altitude. */
  takingOff: boolean
  /** Direction the bird faces: 1 right, -1 left. */
  facing: 1 | -1
  /** Seconds accumulated for sprite animation. */
  animTime: number
  /** True while standing and moving horizontally (walk cycle). */
  walking: boolean
  /** Acorn currently held in the beak, if any. */
  held: Acorn | null
  /** Fullness from 0 (starving) to 1 (full); drains over time. */
  hunger: number
  /** Seconds left in the eating animation (0 when not eating). */
  eatTimer: number
  /** Seconds left standing still after the last hop (squirrels rest between hops; 0 for birds). */
  hopRest: number
  /** Seconds since the current hop began; at or past `HOP_DURATION` the bird is not hopping. */
  hopT: number
  /** Pick-up, bury or dig-up animation in progress, if any. */
  action: PlayerAction | null
  /** World x of a dig that came up empty since the owner last looked (consumed by the NPC code). */
  digFailX: number | null
  /** Spots where this bird dug up an acorn that was not its own and has not since found them empty (the human player's list, used by the burial-quality heatmap; NPCs keep `Npc.sites`). */
  dugSites: number[]
  /** World x of every spot where this bird buried an acorn and has not dug there (or seen another bird dig there) since, whether or not an acorn is still there. */
  burials: number[]
  /** Debug: the bird is drawn half transparent and the NPCs ignore it for every purpose. */
  invisible: boolean
  /** Hops started so far (counted to find hops near burial sites). */
  hops: number
  /** Standing on the creek's surface: floats with no legs and cannot pick up, drop, bury or dig. */
  floating: boolean
  /** Which animal this body is. */
  species: 'jay' | 'squirrel'
  /** Where the beak (or nose) tip touches the ground in a pecking pose, in sprite units ahead of the centre at size 100. */
  reach: number
  /** Hunger bar scale: it drains this many times slower, and an acorn fills this many times less of it. */
  hungerScale: number
  /** Squirrels: up in its tree, not visible, perceiving nothing and perceived by nobody. */
  hidden: boolean
  /** Squirrels: how high up its tree's trunk it is (pixels); 0 on the ground. */
  climbH: number
  /** Squirrels: 1 climbing up the trunk, -1 climbing down, 0 not climbing. */
  climbDir: 0 | 1 | -1
  /** Squirrels: which side of the trunk it climbs on (-1 left, 1 right). */
  climbSide: 1 | -1
  /** Squirrels: progress 0-1 of a sniff (nose to the ground), or -1 when not sniffing. */
  sniff: number
}

/** A burial another bird made that an NPC noticed; it is treated like a free acorn to dig for. */
export type BurialSite = {
  x: number
  /** The bird that buried the acorn. */
  owner: Player
  /** World time (seconds) the NPC noticed it; the line to it fades from this moment. */
  noticedAt: number
}

/** A timed acorn action: the acorn changes hands at the halfway point of the animation. */
export type PlayerAction = {
  kind: 'pickup' | 'bury' | 'dig'
  /** Seconds elapsed. */
  timer: number
  duration: number
  /** The acorn being picked up or buried; null for a dig, which is tied to a place, not an acorn. */
  acorn: Acorn | null
  /** World x where a buried acorn is placed, or where the beak lands for a pick-up or dig. */
  spotX: number
  /** True once the acorn has changed hands. */
  transferred: boolean
  /** Total sideways shift (world px) that brings the beak onto the acorn. */
  slideTotal: number
  /** Part of the slide applied so far. */
  slideApplied: number
  /** For a dig: never bring up one of the digger's own acorns (the closest other one, or nothing, responds). */
  avoidOwn: boolean
}

/** One-shot key presses (fresh key-downs, not auto-repeat) since the last frame. */
export type KeyEdges = {
  /** S (fresh tap): pick up. */
  pickup: boolean
  /** Q: drop the held acorn. */
  drop: boolean
  /** Left Shift: bury / dig up. */
  bury: boolean
  e: boolean
}

/** Held WASD keys, updated from window keyboard events. */
export type KeyState = {
  w: boolean
  a: boolean
  s: boolean
  d: boolean
}

/** Camera top-left in world pixels. */
export type Camera = {
  x: number
  y: number
}

/** Where an acorn is: on the ground, in the beak, or underground. */
export type AcornState = 'ground' | 'held' | 'buried'

/** Acorn in the world; a filled circle. */
export type Acorn = {
  x: number
  y: number
  radius: number
  state: AcornState
  /** Downward speed while falling after a drop. */
  vy: number
  /** Hops birds have made near this acorn since it was buried (0 to BURIAL_HOPS_TO_HIDE). */
  hops: number
  /** How concealed its mound is, 0 (fully visible) to 1 (gone); eased toward a curve of the hops. */
  conceal: number
  /** The bird that buried it (own burials are known to it and never noticed as someone else's). */
  owner?: Player
}

/** A leaf kicked up by a hopping bird that lands on a burial mound and stays there. */
export type KickedLeaf = {
  x: number
  y: number
  vx: number
  vy: number
  /** Where it comes to rest. */
  restX: number
  restY: number
  rx: number
  ry: number
  angle: number
  color: string
  landed: boolean
  /** True once a nearby hop disturbed it: it then shrinks, sinks and fades into the ground. */
  fading: boolean
  /** 0 (lying there) to 1 (gone), eased while `fading`. */
  fade: number
}

/** One tapered trunk or branch piece, relative to the tree base. */
export type TreeSegment = {
  x0: number
  y0: number
  x1: number
  y1: number
  w0: number
  w1: number
}

/** One round leaf lobe, relative to the tree base. */
export type TreeLobe = {
  x: number
  y: number
  r: number
  /** Index into the tree's leaf tones, dark to light. */
  tone: number
}

/** Generated oak: trunk and branches plus many leaf lobes. */
export type TreeShape = {
  /** Unique id, used as a sprite-cache key. */
  id: number
  segments: TreeSegment[]
  lobes: TreeLobe[]
  /** Maximum horizontal extent from the base, for culling. */
  halfWidth: number
  /** Highest point (most negative y) of the tree. */
  top: number
  /**
   * An old-growth tree's trunk widens smoothly toward the ground (like a fallen log's butt end):
   * `height` is how far up the flare reaches, `left` / `right` how much wider each side is at the
   * ground, and `depth` how far below the base the widened trunk is continued (so it meets sloping
   * ground without a gap).
   */
  flare?: { height: number; left: number; right: number; depth: number }
}

/** Oak tree: a generated trunk, branches, and leaf clusters. */
export type OakTree = {
  shape: TreeShape
  /** Left edge of the trunk in world space. */
  x: number
  trunkWidth: number
  trunkHeight: number
  crownRadius: number
}

/** One fallen leaf used to texture the ground. */
export type LeafLitter = {
  x: number
  /** Absolute Y of the leaf center (on or slightly below the surface). */
  y: number
  rx: number
  ry: number
  angle: number
  color: string
}

/** The creek carved into the terrain. */
export type Creek = {
  /** World x of the creek's center. */
  x: number
  /** Half the width of the water surface. */
  halfWidth: number
  /** Horizontal distance over which the land slopes from the water's edge up to the normal terrain. */
  bank: number
  /** Y of the water surface. */
  waterY: number
  /** How far below the water surface the creek bed is at its deepest. */
  depth: number
  /** Which way (-1 left, 1 right) the creek tends to wander as it recedes into the background. */
  drift: number
  /** The creek continues toward the viewer in front of the foreground: its center offset from `x`... */
  frontOffset: number
  /** ...and its half width there (wider, since it is nearer). */
  frontHalfWidth: number
}

/** A smooth hill: the land rises by `height` at `x` and blends back to normal over `halfWidth`. */
export type Hill = {
  x: number
  halfWidth: number
  height: number
}

/** Ground heights sampled at a fixed horizontal step, plus the creek carved into them. */
export type Terrain = {
  creek: Creek
  /** Horizontal spacing between samples in pixels. */
  step: number
  /** Absolute surface Y at `i * step`. */
  heights: Float32Array
  /** Just the coarse (large-scale) part of the land's height above the base line, per sample. */
  coarse: Float32Array
  /** A broad hill added on top of the coarse terrain, away from the creek. */
  hill: Hill
}

/** One lobe of a bush cluster, relative to the bush base. */
export type BushLobe = {
  dx: number
  dy: number
  radius: number
  color: string
}

/** Cluster of green lobes sitting on the ground. */
export type Bush = {
  x: number
  lobes: BushLobe[]
}

/** Fallen log lying along the terrain slope. */
export type Log = {
  /** Center X. */
  x: number
  length: number
  radius: number
  /** Rotation in radians following the ground slope. */
  tilt: number
  /** 1 if the buttressed (root) end is on the left, -1 if on the right. */
  flip: number
  /** Whether moss grows along the top. */
  moss: boolean
}

/** Boulder or small rock: a jittered half-ellipse polygon. */
export type Rock = {
  x: number
  rx: number
  ry: number
  /** Radius multipliers for points along the dome. */
  jitter: number[]
  color: string
  highlight: string
  /** Colors of the little fallen leaves drawn over the rock's base, as if it were buried in litter. */
  litter: string[]
  /** Whether moss grows on top of the rock. */
  moss: boolean
  /** Haze blended into its colors (background layers); 0 in the foreground. */
  fog: number
}

/** A clump member: a fern, a fan of arching fronds. */
export type Fern = {
  x: number
  size: number
  /** Index into a few green tones. */
  tone: number
  /** Each frond rises from its own point (`base`, in fern sizes from the center): the crown is below the ground. */
  fronds: { angle: number; length: number; bend: number; base: number }[]
}

/** One tree silhouette in a parallax background layer. */
export type BackdropTree = {
  /** Base X within the layer's own span. */
  x: number
  shape: TreeShape
}

/**
 * A rock on the ground between a layer and the next nearer one (the ground behind the nearer layer),
 * positioned relative to the creek's bank so it never lands in the water.
 */
export type GapRock = {
  /** The rock; its x, rx and ry are set each frame from its position. */
  rock: Rock
  /** Depth between this layer's waterline (0) and the next nearer one (1). */
  s: number
  /** -1 for the left bank, 1 for the right. */
  side: number
  /** Rock half width in units of the local scenery size. */
  size: number
  /** Layer x of a free rock (anywhere on the ground between layers); null for one placed along the bank. */
  x: number | null
  /** How far beyond the bank's edge the rock sits, in units of the local scenery size. */
  out: number
}

/**
 * Rocks, bushes and ferns standing in the ground below the foreground's surface line (nearer the
 * viewer), anywhere down the dirt; each is drawn on top of the foreground at absolute height `y`.
 */
export type FrontRock = {
  rock: Rock
  y: number
}
export type FrontBush = {
  bush: Bush
  y: number
}
export type FrontFern = {
  fern: Fern
  y: number
}

/** Distant forest layer drawn with camera parallax. */
export type ForestLayer = {
  /** Fraction of camera x movement applied to this layer. */
  parallax: number
  /** Width of the layer's own x span. */
  span: number
  /** How far above the ground line the layer base sits, in view heights. */
  lift: number
  /** Brown ground fill (horizon and everything below), blended toward the haze. */
  groundColor: string
  /** Brown trunk, branch, and log color, blended toward the haze. */
  trunkColor: string
  /** Leaf tones, dark to light, already blended toward the haze. */
  tones: string[]
  trees: BackdropTree[]
  bushes: Bush[]
  logs: Log[]
  rocks: Rock[]
  ferns: Fern[]
  /** For the extra layers that only exist around the creek: how far from it they fade out; else null. */
  localRadius: number | null
  /** The layer's own fine terrain noise (lift above its base line, per `TERRAIN_STEP`). */
  fine: Float32Array
  /** Where the creek flows through this layer, in the layer's own x, and its half width. */
  creek: { x: number; halfWidth: number }
  /** Rocks on the ground between this layer and the next nearer one, thickest along the creek banks. */
  edgeRocks: GapRock[]
  /** Share blended toward the haze (atmospheric perspective). */
  fog: number
  /** Size of this layer's scenery relative to the foreground. */
  scale: number
  /** Fallen-leaf colors, blended toward the haze like the rest of the layer. */
  leafColors: string[]
  /** Water color, blended toward the haze like the rest of the layer. */
  waterColor: string
}

/** Finite-state-machine states for an NPC (follow is not wired up yet, and squirrels never use it). */
export type NpcState =
  | 'idle'
  | 'explore'
  | 'follow'
  | 'gather'
  | 'eat'
  | 'findBurialSpot'
  | 'retrieve'
  | 'bury'
  | 'cover'

/** Where a squirrel is relative to its home oak. */
export type TreePhase = 'ground' | 'up' | 'hidden' | 'down'

/** Computer-controlled animal (a blue jay or a squirrel): a body driven by simulated keys plus AI state. */
export type Npc = {
  bird: Player
  /** Squirrels only: the oak this squirrel lives in and the horizontal stretch of ground around it it stays within. */
  home: { tree: OakTree; trunkX: number; left: number; right: number } | null
  /** Squirrels only: on the ground, climbing up, hidden up in the tree, or climbing down. */
  treePhase: TreePhase
  /** Squirrels only: seconds left in the current sniff (0 when not sniffing) and hops left before the next one. */
  sniffTimer: number
  sniffHopsLeft: number
  /** Squirrels only: `bird.hops` when the last sniff finished. */
  sniffHopsAt: number
  /** Simulated held keys fed to the shared player movement code. */
  keys: KeyState
  /** Personality: 0 (aloof) to 1 (nosy); squirrels have none (null). */
  nosiness: number | null
  /** Personality 0-1: how thoroughly it hides what it buries (hops over the site 1, 2 or 3 times). */
  secrecy: number
  /** Hops still to make over a fresh burial site, and the direction of the next one. */
  coverHops: number
  coverDir: 1 | -1
  /** Direction it keeps flying while looking for a place to bury, and the spot it has picked (null while looking). */
  searchDir: 1 | -1
  spotX: number | null
  searchTimer: number
  /** Seconds accumulated toward the next once-per-second check for a jay ahead to get away from. */
  turnTimer: number
  /** Burial quality of the spot it chose, shown above its head for a few seconds after it starts burying. */
  buryQuality: number
  buryQualityTimer: number
  state: NpcState
  /** Seconds accumulated toward the next once-per-second state decision. */
  decisionTimer: number
  /** Horizontal flight direction while exploring. */
  direction: 1 | -1
  /** Desired altitude above the ground, in player sizes. */
  targetAltitude: number
  /** Seconds until a new exploring altitude is chosen. */
  altitudeTimer: number
  /** Acorn being gathered. */
  target: Acorn | null
  /** World x the bird is flying to when looking for a burial spot. */
  targetX: number
  /** True once the eat state has tried to start eating. */
  eatAttempted: boolean
  /** Seconds the NPC pauses (no movement or action) before carrying on. */
  waitTimer: number
  /** Short-trip destination while idle, or null to stay put. */
  idleTargetX: number | null
  /** Whether the idle trip is flown rather than walked. */
  idleFly: boolean
  /** The remembered spot currently being visited while retrieving, or null. */
  digSpot: number | null
  /** The beak target an NPC is currently moving to, and the way it faces on arrival (fixed per target). */
  reachX: number | null
  reachDir: 1 | -1
  /** How many acorns and burial sites it remembers (a rise means it just noticed something). */
  knownCount: number
  /** Free acorns currently in the bird's view (used to detect acorns entering view). */
  inView: Set<Acorn>
  /** Free acorns the bird noticed, with where it last saw each (kept even when out of view). */
  /** Bury / dig actions this NPC has already had its one chance to notice (each is rolled once). */
  seenActions: WeakSet<PlayerAction>
  /** Actions a flying NPC already failed its notice roll for; it notices them on landing. */
  missedActions: WeakSet<PlayerAction>
  noticed: Map<Acorn, { x: number; y: number }>
  /** Buried acorns (other birds') in view last frame, and those it already rolled for after landing. */
  viewedBuried: Set<Acorn>
  landedRolled: Set<Acorn>
  /** Whether it was standing (or floating) last frame, to spot the moment it lands. */
  wasStanding: boolean
  /** Other birds' burial sites this NPC noticed and still remembers. */
  sites: BurialSite[]
  /** The burial site being gathered by digging, or null. */
  siteTarget: BurialSite | null
  /** Straight-line descent into the current ground target: where the trip started. */
  glide: { targetX: number; startAltitude: number; startDistance: number; cruise: number } | null
}

/** Generated play space: bounds plus scenery. */
export type World = {
  /** Window height at generation (sizes the forest bitmaps). */
  viewHeight: number
  width: number
  height: number
  groundHeight: number
  /** Y of the flat reference line the terrain varies around. */
  groundY: number
  terrain: Terrain
  trees: OakTree[]
  acorns: Acorn[]
  leaves: LeafLitter[]
  bushes: Bush[]
  logs: Log[]
  rocks: Rock[]
  ferns: Fern[]
  frontRocks: FrontRock[]
  frontBushes: FrontBush[]
  frontFerns: FrontFern[]
  forest: ForestLayer[]
  npcs: Npc[]
  /** One squirrel per oak. */
  squirrels: Npc[]
  /** Seconds accumulated toward the next once-per-second acorn-drop roll. */
  acornDropTimer: number
  /** Leaves kicked onto burial mounds by hopping birds (oldest are dropped past a limit). */
  kickedLeaves: KickedLeaf[]
  /** Game clock in seconds (drives the fading lines to noticed burial sites). */
  time: number
}
