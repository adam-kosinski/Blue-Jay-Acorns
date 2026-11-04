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
  /** Seconds since the current hop began; at or past `HOP_DURATION` the bird is not hopping. */
  hopT: number
  /** World x where the current hop began. */
  hopStartX: number
  /** Direction of the current hop. */
  hopDir: 1 | -1
  /** Pick-up, bury or dig-up animation in progress, if any. */
  action: PlayerAction | null
  /** World x of a dig that came up empty since the owner last looked (consumed by the NPC code). */
  digFailX: number | null
  /** Standing on the creek's surface: floats with no legs and cannot pick up, drop, bury or dig. */
  floating: boolean
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

/** Finite-state-machine states for an NPC blue jay (follow and hide are not wired up yet). */
export type NpcState =
  | 'idle'
  | 'explore'
  | 'follow'
  | 'hide'
  | 'gather'
  | 'eat'
  | 'findBurialSpot'
  | 'retrieve'
  | 'bury'

/** Computer-controlled blue jay: a bird body driven by simulated keys plus AI state. */
export type Npc = {
  bird: Player
  /** Simulated held keys fed to the shared player movement code. */
  keys: KeyState
  /** Personality: 0 (aloof) to 1 (nosy). */
  nosiness: number
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
  /** World x of every spot where this NPC buried an acorn and has not yet checked. */
  memory: number[]
  /** The remembered spot currently being visited while retrieving, or null. */
  digSpot: number | null
  /** Free acorns currently in the bird's view (used to detect acorns entering view). */
  inView: Set<Acorn>
  /** Free acorns the bird noticed, with where it last saw each (kept even when out of view). */
  /** Bury / dig actions this NPC has already had its one chance to notice (each is rolled once). */
  seenActions: WeakSet<PlayerAction>
  /** Actions a flying NPC already failed its notice roll for; it notices them on landing. */
  missedActions: WeakSet<PlayerAction>
  noticed: Map<Acorn, { x: number; y: number }>
  /** Other birds' burial sites this NPC noticed and still remembers. */
  sites: BurialSite[]
  /** The burial site being gathered by digging, or null. */
  siteTarget: BurialSite | null
  /** Straight-line descent into the current ground target: where the trip started. */
  glide: { targetX: number; startAltitude: number; startDistance: number } | null
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
  /** Seconds accumulated toward the next once-per-second acorn-drop roll. */
  acornDropTimer: number
  /** Game clock in seconds (drives the fading lines to noticed burial sites). */
  time: number
}
