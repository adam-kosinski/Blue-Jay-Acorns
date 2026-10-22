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
}

/** One-shot key presses (fresh key-downs, not auto-repeat) since the last frame. */
export type KeyEdges = {
  s: boolean
  b: boolean
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

/** Ground heights sampled at a fixed horizontal step. */
export type Terrain = {
  /** Horizontal spacing between samples in pixels. */
  step: number
  /** Absolute surface Y at `i * step`. */
  heights: Float32Array
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
}

/** One tree silhouette in a parallax background layer. */
export type BackdropTree = {
  /** Base X within the layer's own span. */
  x: number
  shape: TreeShape
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
  forest: ForestLayer[]
  npcs: Npc[]
}
