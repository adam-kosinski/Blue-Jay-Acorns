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
- Bark texture (`drawBark` in `oak.ts`) matches the logs: a few straight dark grain lines along the trunk and thicker branches (no knots or hollows; skipped for the farthest parallax layers). Leafy clumps (`drawLeafyDisk`) are built from 4-5 lumpy sub-blobs so natural gaps show between them in trees; bushes pass `overlap = 1` so their sub-blobs pack tighter with few holes. Leaves are scattered throughout, and a few are centered on the outline so they poke partly outside for a fluffy edge. First-frame cost is about 3 s in the software-rendered test pane.
- Draw order: parallax forest, then trees, logs and rocks (all behind the ground so the ground and leaf litter cover their bases; rocks are sunk a bit more), then ground, leaf litter, mounds, bushes, jays, ground acorns.
- Bark grain lines run unbroken up the trunk (joined at the joints with averaged normals) and thick branches get one line that starts outside the trunk, so junctions stay clean.
- Performance: jays are drawn from cached bitmaps of quantized poses (24 wing phases, 16 walk phases, 20 eating phases; `drawBird` blits what `drawBirdVector` rendered), NPC labels are cached text bitmaps, and off-screen NPCs are not drawn. Six jays flying in view cost about 8 ms per frame in the software-rendered test pane.

## Update: hopping, acorn actions, NPC pacing, tree acorn drops

- **Hopping**: a standing bird moves in discrete hops (`hopOnGround` in `player.ts`). Distance accumulates at the old walking speed while A/D are held and is spent in hops of `HOP_LENGTH_IN_SIZES` (0.9 sizes, `HOP_DURATION` 0.2 s); the first press hops immediately and a hop in progress always finishes. The sprite hops up with legs tucked (cache key `h` + 10 phases). NPCs use the same movement; their ground arrival radius is 0.5 sizes.
- **Acorn animations**: pick-up (`PICKUP_DURATION`) is one dip of the head toward the acorn; bury and dig-up (`BURY_DURATION`) are three pecks with dirt flicking up. The acorn changes hands at the halfway point (`PlayerAction`, `startPickup`/`startBury`/`startDig`/`updateAction` in `acorns.ts`); the bird stays put meanwhile and the action cancels if another bird took the acorn first. Pick-up and dig reach are horizontal only (`REACH_IN_SIZES` 0.9). Head tilt keeps its world angle except for an extra downward turn during a dip.
- **NPC pacing**: NPCs pause 1 s (`NPC_WAIT_SECONDS`) after picking up an acorn, after landing to bury, and when entering explore. Idle NPCs sometimes hop or fly a short way (1.5-5 sizes).
- **Idle logic**: every time an NPC would enter explore or idle it checks hunger: above 0.9 (`NPC_IDLE_HUNGER`) it idles; an idle NPC whose hunger drops below 0.9 explores. NPCs also use this check at spawn.
- **Tree acorn drops**: each second every oak has a `ACORN_DROP_CHANCE_PER_SECOND` (0.0003) chance to drop 3-10 acorns from random points in its canopy lobes; they fall with gravity (`updateTreeDrops`). World cap `ACORN_WORLD_CAP` 160. That is about 1 acorn per minute worldwide, near what the 5 NPCs eat once the starting acorns are gone (headless runs: 5-8 starting acorns eaten in the first two minutes, then none).
- Flow chart updated with decision diamonds: see NPC_STATE_MACHINE.md.

- Follow-up tuning: hops are continuous (`HOP_DURATION` 0.3 s, length derived as `MOVE_SPEED_IN_SIZES * WALK_SPEED_FACTOR * HOP_DURATION` so the ground speed is exactly half the flying speed, 2.7 sizes/s); while A/D stay held the next hop starts the instant one ends, and the feet stay visible (they trail back and lift in the air). Pick-up is faster (`PICKUP_DURATION` 0.3 s). Pecking stretches the neck forward and down so the beak tip touches the ground at `BEAK_REACH_X` (54 sprite units ahead of the bird's center): the bird slides sideways during the first 40% of a pick-up or dig-up so the beak lands on the acorn, and the burial spot is where the beak touches. Animation poses are quantized finer (30 action phases, 16 hop phases) so they look smoother; the bird sprite cache holds up to 300 poses.
- NPC jays fly, climb and hop at `NPC_SPEED_SCALE` (0.75) of the main bird's speed (`updatePlayer(..., speedScale)`; hop length scales, hop time does not). Hops are about 0.75 player sizes (`HOP_DURATION` 0.28 s, 0.76 size for the main bird, 0.57 for NPCs) with the same average ground speed rule. During a hop the body keeps its posture and only the legs rotate slightly (0.2 rad) about the hips: back at launch, straight at the top, forward at landing; the feet stay visible.
- Within each hop the horizontal speed eases from 1.4x the average at launch down to 0.6x at landing (average unchanged).
- World is half as wide (`WORLD_WIDTH_MULTIPLIER` 5) with 4 NPC jays. To keep the same density the oak count (5), starting acorns (16), bushes (14), logs (5), boulders (6) and rock clusters (11) were halved too, and the acorn drop chance was raised to 0.0005 so the fewer oaks still supply about 1 acorn a minute.
- Hunger: the full bar drains in 60 s (`HUNGER_DRAIN_SECONDS`), eating is allowed below 2/3 full (`HUNGER_THRESHOLD`, also the HUD marker and the NPC eat check), and one acorn refills 1/3 of the bar (`ACORN_NUTRITION`). The NPC idle threshold stays at 0.9. Earlier notes in this file that mention 120 s, halfway and half a bar are superseded.
- The hunger bar is large (up to 520 px wide, 32 px tall) at the bottom center above the hint text, with the 2/3 marker line and a bold label ("Hunger", "Hungry - find an acorn", "Hungry - press E to eat"). At 1/5 full or less (`STARVING_LEVEL`) it flashes red (every 0.3 s) with a pulsing red outline and the label reads "Starving!".
- Lag spikes: the expensive cached bitmaps are now built ahead of time instead of when something first scrolls into view or first appears (`warmUpScene` in `render.ts`, stepped once per frame from `GameCanvas.tsx`, also after Restart): the five parallax strips, all the oaks (`getOakSprite` in `oak.ts`), and the common jay poses (24 flying phases, 16 hop phases and standing, with and without a held acorn; `birdSpriteFor`). In a scroll-through test in the software-rendered pane the worst frame went from about 790 ms (five frames over 100 ms) to 72 ms (none over 100 ms). Rare poses (eating, pecking) are still built on first use.
- The mini-map also shows rocks (gray domes), logs (dark brown bars) and bushes (green domes) as tiny low-detail shapes on the ground line.
- Game over: when the player's hunger bar reaches 0 the simulation freezes and `drawGameOver` (in `render.ts`) fades in a vignette and a parchment card with a wooden double border that eases in, the title "You got a rumbly in your tumbly" (sized to fit), a divider with three acorns, the line "The jay went hungry. Click Restart to try again.", and a pulsing "Restart ↗" pointer toward the button. The `gameOver` flag lives in `GameCanvas.tsx`; Restart clears it. NPC hunger reaching 0 has no penalty.
- NPC memory: each NPC records the x of every acorn it buries (`Npc.memory`). An exploring NPC whose hunger drops below `NPC_RETRIEVE_HUNGER` (0.2) and that remembers at least one spot enters the new `retrieve` state (`runRetrieve` in `npc.ts`): it flies to the nearest remembered spot, lands, hops to it, forgets the spot, and digs if an acorn is still buried within 0.25 sizes of it (another bird may have taken it). If not, it tries the next nearest spot until memory is empty, then goes back to explore/idle; if it digs one up it pauses 1 s and eats it. Flow chart updated.
- Buried-acorn mounds keep the original small half-ellipse shape, drawn in a dark brown (`#472b14`), darker than the dirt, so they stand out. They are drawn before the bushes, so a bush overlapping one still hides it.
