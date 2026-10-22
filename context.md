# Blue Jay Acorns — Specs and Plans

## Vision

A game about a blue jay burying acorns.

## Current milestone

Entities (acorn, oak tree), five trees at start, random ground grass, a world 10× the view width with a following camera, and a restart button that regenerates the starting state.

**Status:** implemented. Dev server: `npm run dev`. Scene lives in `src/game/`.

## Stack

- React (Vite dev server)
- 2D scene rendered on an HTML canvas, driven by `requestAnimationFrame` (no game engine yet)

## Scene and world

- Viewport is the browser window. The **world** is larger and the camera scrolls.
- World **width** is 10× the window width at generation (start or restart).
- World **height**: from the ground up, enough that a camera locked to the top of the world no longer shows the ground, plus extra sky (`WORLD_TOP_EXTRA_FACTOR` of the view height).
- **Ground** stays a strip along the bottom of the world. Standing still looks like the original prototype (ground along the bottom of the view).
- **Camera** tries to keep the player centered horizontally and vertically. If that would show area outside the world, it clamps to the world bounds (player can sit off-center at edges). Flying up therefore transitions from “ground-pinned” to “player-centered.”
- Player is a filled square, **1/8 of the window height**.
- On-screen debug label shows the current locomotion state.
- **Restart** regenerates trees, acorns, grass, world size (from the current window), and player pose.

## Entities

- **Acorn** — small brown circle; diameter is **1/4 of player height**. Scattered on the ground at start so the entity is visible.
- **Oak tree** — about **one window tall**: tall brown rectangle trunk with a green circle of leaves on top. **Five** spawn at start, spread across the world.
- **Grass** — randomly generated blades/tufts along the ground for a nature pattern.

## Player locomotion

States:

- **standing** — the sprite is in contact with the ground.
- **flying** — the sprite is above the ground and hovering (no gravity while airborne).

Transitions:

- Touching the ground (bottom of sprite at ground line) → **standing**.
- From **standing**, press **W** → take off: rise to a hover altitude above the ground and enter **flying**. The bird stays at that height until the player climbs or descends.

Controls (held keys, polled each frame):

| Key | Standing                   | Flying                              |
| --- | -------------------------- | ----------------------------------- |
| W   | Take off to hover altitude | Climb (increase altitude)           |
| S   | No effect                  | Descend; cannot go below the ground |
| A   | Move left                  | Move left                           |
| D   | Move right                 | Move right                          |

Horizontal movement is allowed in both states. The player is clamped to the **world** edges, not the viewport.

## Assumptions (open to change)

- W while already flying climbs freely; it is not limited to the initial hover height.
- Flying has no gravity: releasing keys holds altitude.
- A tap of W while standing auto-rises to a fixed hover offset, even if W is released mid-ascent. Holding W continues climbing past that height. S during takeoff cancels the auto-rise and descends.
- After a partial descent, releasing S holds the new altitude (does not snap back to the original hover height).
- No collision with trees or acorns yet (overlap is allowed).
- Placeholder art (geometry only); no burying gameplay yet.
- World size is baked at start/restart from the current window; resizing the window does not rebuild the world until Restart.

## Next (not this milestone)

- Blue jay sprite / animation
- Burying acorns, collecting, more gameplay

## Update: blue jay and acorn mechanics

- Takeoff hover is 1/3 of the old height; horizontal speed is 2× vertical (`MOVE_SPEED_IN_SIZES = 2 × VERTICAL_SPEED_IN_SIZES`, vertical lowered to 2.7).
- Acorns are drawn last (in front of everything). They spawn in Gaussian clusters around the oak trunks (round-robin per tree).
- Mini-map (top center): trees, ground acorns, camera rectangle, bird dot.
- Cartoon blue jay drawn on canvas in `render.ts` (`drawBird`): walk cycle (leg swing, hop, folded wing) and fly cycle (flapping wing, tucked legs); faces movement direction.
- **S on the ground** (fresh key-down only; held-S carry-over from flight is ignored; while flying S still descends): pick up the nearest ground acorn within reach, or drop the held one (it falls). One acorn at a time. **O is removed.**
- **B** (standing, fresh press): holding → bury ahead of the bird (mound shown); empty-beaked → dig up a buried acorn near the bird into the beak.
- **Held acorn** is drawn inside `drawBird`, behind the body, with the beak open (separate upper/lower mandibles). Ground acorns still draw in front of everything.
- Logic in `src/game/acorns.ts`; key edges (`{ s, space, e }`) in `input.ts`.

## Update: hunger

- Hunger bar (top right, left of Restart): drains from full over `HUNGER_DRAIN_SECONDS` (120s). Green above the threshold marker (halfway), yellow below it.
- **E**: only when below the threshold and holding an acorn: ~0.7s eating animation (beak chomps, head bobs, acorn shrinks), then the acorn is consumed and the bar refills by half (`ACORN_NUTRITION`). S/B are ignored while eating. Reaching 0 has no penalty yet.
- Logic in `src/game/hunger.ts`; constants in `constants.ts`.

## Update: terrain, scenery, forest backdrop

- **Terrain** (`terrain.ts`): fractal 1D Perlin noise (2 octaves, amplitude 0.04 of view height) precomputed every 8px into a `Float32Array` on `world.terrain`; `groundYAt(terrain, x)` interpolates. `world.groundY` is only the flat reference line. Everything (player standing/landing/hover, acorns, trees, props, mounds, minimap) uses the local height. Standing sticks to the ground on slopes; only W lifts off.
- **Ground** is a brown dirt-gradient polygon; grass is replaced by **leaf litter** (small rotated ellipses in browns/oranges, on and just below the surface, culled to the view).
- **Props** (generated per run in `world.ts`, drawn after trees and before the bird, no collision): 28 bushes (green lobe clusters), 9 logs (tilted to the slope, end-grain rings), 12 boulders and ~22 clusters of 1-3 small rocks (jittered half-ellipse polygons with a highlight), sized relative to player size.
- **Background**: hazy green gradient plus 5 parallax forest layers (factors 0.12, 0.22, 0.35, 0.5, 0.68; fog 0.8 down to 0.12 blending toward the haze color; farther layers lifted higher). Each layer fills solid from its base to the screen bottom, with `base = groundY - maxCamY*(1-p) - camY*p - lift*viewHeight`, so with the camera pinned to the ground it meets the ground line. Layer x on screen = layerX - camera.x*p. Foreground oaks stay the darkest.
- Minimap: green background, brown terrain polygon.

## Update: NPC blue jays

- 5 NPC jays (`npc.ts`, `world.npcs`) with random `nosiness` (0-1, no effect yet) and their own hunger bar; both are annotated above each NPC along with its state. NPCs are drawn before the player and shown as orange dots on the minimap.
- They run a finite state machine (explore, gather, eat, find burial spot, bury; follow/hide are placeholders) driven by simulated W/A/S/D keys through the shared `updatePlayer`. Probabilistic decisions run once per second. Full chart: [NPC_STATE_MACHINE.md](NPC_STATE_MACHINE.md) (keep it in sync).
- Background parallax trees now match the foreground oaks: about one viewport tall, trunk plus one round crown (scale 0.9-1.0 by layer).

## Update: trees, terrain, idle, B key

- **B** (not Space) buries / digs up; `KeyEdges` is `{ s, b, e }`.
- **Oaks** are generated per tree (`oak.ts`): leaning tapered trunk, random asymmetric branches with sub-branches, and many leaf-lobe clusters in four tones. There are now 10 oaks (acorns doubled to 32). The parallax layers use the same generator, blended toward haze, plus bush and log silhouettes along each layer's base.
- **Terrain** uses two Perlin scales: a large one (wavelength 6 view heights, amplitude 0.5) for land shape and a small one (0.3 view heights, amplitude 0.09) for local bumps. Terrain only rises above the flat `groundY`.
- Held acorn: beak opens wider (gap 8.5 sprite units).
- NPCs gained an **idle** state (see NPC_STATE_MACHINE.md); there are 5 NPCs.
- Parallax layers each have their own rolling horizon (terrain flattened and phase-shifted by distance); layer trees, bushes and logs stand on it, so background trunks meet ground instead of floating.

## Update: performance and layer heights

- Each parallax layer is pre-rendered once into a wide offscreen bitmap (`forestStripFor` in `render.ts`: horizon, trees, bushes, logs) and blitted per frame, cropped to the visible rows. Foreground oaks are cached as sprites (`drawOak` in `oak.ts`, LRU of 80). Leaf litter is sorted by x and found with a binary search.
- Background layers sit higher (lifts 0.4/0.33/0.26/0.2/0.14 of view height) and terrain amplitudes are lower (0.2 large, 0.04 small) so the background ground is usually visible above the foreground ground.
- Background layers use brown trunks/logs and brown ground (the foreground colors blended toward haze by distance), with green bushes and leaves.
- Oaks (and so the parallax trees) are 1.5-2x taller than the earlier design, about 18% keep one or two low branches near the ground. Tree bitmaps are capped at 4 megapixels. Bushes are mostly rejected within 3 player sizes of an oak (12% keep chance).
- Walking speed is half of flying speed (`WALK_SPEED_FACTOR`); applies to NPCs too.
- Farther parallax layers pack trees denser (per-layer `spacing`, an average trunk gap of 0.11 (farthest, densest) to 0.36 (nearest) view heights, in `FOREST_LAYERS`).

## Update: jay sprite redesign

- `drawBird` follows real blue jays but stays clipart-cute. The body (`drawBody`) is an organic bezier shape: pale throat/breast/belly, blue back only on top, white speckles on the back when standing. Round head with blue crown and pale face (clipped), small swept-back crest, plain dark bead eye with a highlight and a thin eye line (no white ring), black necklace from behind the eye across the breast, short beak, tapered tail barred black with a white tip (fanned in flight).
- Wings are one organic shape (`traceWing`/`drawWingShape`): widest at the curved leading edge, tapering to a pointed tip, with a scalloped trailing edge of feather tips, feather lines, and a blue gradient to dark tips. Flying wings have two white wing bars (separated by a black bar) and sweep with the tip lagging the stroke, plus a darker far wing behind the body (`drawFlightWing`). The folded wing on the ground has one white bar and lies along the back (`drawFoldedWing`). `PLAYER_COLOR` is a brighter cornflower blue.
- Sprite refinements: flapping wings never sweep forward past about 100 degrees from the body; the necklace is an open crescent (band behind the eye widening down the neck, thinning to a line under the throat); the inner wing and the tail use a teal-blue (`#3fa3d6` / `#3f95cf`) distinct from the periwinkle head and back.
- Wing shape: nearly flat leading edge, curved trailing edge of scalloped feather tips, broad root along the body (`traceWing`). Bars: the middle white bar shows in every pose; the second bar is a white fringe along the trailing secondaries, drawn only on a spread (flying) wing. The necklace is a tapered brush shape (`fillTaperedCurve`): thick behind the eye, thinning under the throat.
- Flight wings hinge on a fixed root along the body: the span swings up and down (a 2D transform that foreshortens it like a side view, `drawFlightWing`), so the attached edge never moves. A raised wing shows its dull blue-grey underside with a blacker leading-edge patch and long feather streaks (`drawWingUnderside`); a lowered wing shows the blue upper side (`drawWingUpper`); the far wing shows the opposite face. Both white bars (the coverts bar and the trailing-edge fringe) follow the trailing edge so they run roughly parallel; the folded wing shows only the coverts bar.
- Sprite posture: the body is upright when standing (axis tilted about 24 degrees) and nearly flat in flight (about 7 degrees); the wing hinge axis follows the body so the folded wing lies parallel to it. The wing tip sits slightly forward of the leading edge. Teal fills the trailing half of the upper wing from just ahead of the white bar; the necklace is a slight S-curve; speckles only on the rump; the tail is narrower from the side with white outer-feather bands along both sides near the tip.
- Head and body tilt separately: the head keeps one world tilt in every pose (pivoting at the neck), while the body is more flat when standing (about 17 degrees) and about 2 degrees in flight. Flying wings hinge along the back line (nape to rump), not a horizontal line. The necklace is thick behind the head, thin in the middle and thick at the throat. The tail's white lining is a thin (1.8px) line wrapped around the tip, so the tip reads mostly blue.
- The perched (folded) wing has its own design (`drawFoldedWing`, body frame): top edge flush with the back, feathers running toward the tail past the rump, teal from just ahead of the white bar to the tail end, black barring and the middle white bar perpendicular to the body. The tail's white is a thin 1.6px lining along the lower and upper outer edges only (not around the tip).
- Crest is a subtle tuft in the crown color, drawn under the head: its front edge leaves the head contour tangentially and tapers back to a tip, the back edge is almost straight. Wing bars are placed by fraction of the wing: on the folded wing the white bar sits in the middle of the first third from the shoulder (teal starts just ahead of it); on the spread top wing the first bar sits about 0.19 of the chord from the leading edge and runs spanwise only about halfway out (the black bar beside it too), and the second bar is the trailing-edge fringe over the same inner half of the span (`traceWingBar`, `wingEdgesAt`).
- Folded wing now starts below the neck (the mantle stays plain), with a zigzag white bar leaning toward the head (about 20 degrees below horizontal in the world), a scale pattern of dark feather edges behind it, fine barring on the tail-end feathers, and teal from just ahead of the bar. The necklace now starts in the crest's back edge, fading in, before running behind the eye and down the neck.
- The necklace's top fades out through a gradient into the crest blue rather than ending abruptly.
- The necklace starts at the crest tip, flush with the crest's back edge (fading in), and is drawn in the head's frame so it stays attached to the crest as the head tilts relative to the body.
- Necklace fades in about halfway up the crest and is fattest just below the crest behind the eye (Gaussian bump in the width profile), thin through the neck, thick again at the throat.
- The necklace's throat end extends forward to the edge of the throat patch, tapering and fading out (one gradient fades both ends: in at the crest, out at the throat).
- The necklace is clipped to the body, head and crest silhouette (`traceBodyOutline`) so it never extends off the front. The flying posture is nearly horizontal (body and head tilt about 2 degrees); standing posture is unchanged.
- Acorns (`drawAcornShape`) are drawn as real acorns: a tan pointed nut with a highlight, a dark scaly cap with dot texture, and a small stem. Ground acorns lie at a stable per-position angle; a held acorn points forward from the beak (cap toward the head).
- Scenery scale: trees (foreground and parallax), rocks, bushes, logs and leaf litter are 2x bigger (`SCENERY_SCALE` in `constants.ts`); the jay and acorns keep their size. Tree bitmaps are capped at 8 megapixels.
- Leaves and bushes are detailed (`drawLeafyDisk` in `oak.ts`): each lobe is a base disk plus scattered pointed leaves (with faint midribs at high detail) shaded lighter toward the upper left, and a ring of outward-pointing leaves for a scalloped edge. Randomness is seeded (`seededRandom`) so redraws and cache rebuilds look identical. Foreground trees and bushes use full detail; parallax layers use less (none on the farthest two). Known cost: parallax strips are built on first draw, which takes a noticeable moment (about 2 s in the software-rendered test pane).
- Logs are drawn before the ground polygon and sunk about 40% into the ground (resting on the average ground height under them), so the ground and leaf litter cover their lower part. Ground acorns settle slightly into the ground with a soft contact shadow. Leafy clumps (`drawLeafyDisk`) now have organic outlines: a lumpy, randomly stretched and rotated base blob, leaves hanging mostly downward inside it, and edge leaves lying along the outline (not radiating outward).
