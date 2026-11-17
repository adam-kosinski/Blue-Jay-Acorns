# Performance notes (seasons rendering)

## What was slow

Changing the look of the scenery (leaves turning, falling) used to redraw big bitmaps in one frame: a foreground oak is 150-200 ms of canvas drawing, a backdrop layer strip 500-800 ms. Steady-state drawing of cached bitmaps was never the problem (about 2-4 ms in the test browser); the hitches came from **making** bitmaps at the moment they were needed.

## What is done now

- **Per-object change curves** (`seasons.ts`): every tree, bush, fern, mossy rock and log has its own random start inside early fall and changes over two segments (`transitionProgress`). Trees and bushes go green, half colorful, fully colorful, half bare, bare (`leafLook`, a third of the change for each colorful period); ferns and moss fade linearly to their winter color. Spring keeps the winter look.
- **Foreground objects are prebuilt in parts and cross-faded** (`oak.ts`, `render.ts`): trunk, green crown and fall crown per oak (bush: wood, green leaves, fall leaves; fern and rock: summer and winter bitmaps). Per frame it is only `drawImage` with an alpha. Summer parts are made before play; fall and winter parts are queued in the background.
- **Backdrop layers are drawn as images per layer and moment** (`buildVegImage`): trees and logs ("back", behind the ground), rocks, ferns and bushes ("front"). Moments are every half segment from the start of early fall to the start of winter (`SAMPLE_COUNT` = 7); at each moment every object is drawn at its own point of its change (each leaf has a fixed random draw deciding whether it is there and whether it is green or in fall color, so leaves that are gone stay gone). An image is shown as it is for most of the interval; only for 4 seconds in the middle of it are the two images around the time cross-faded (premultiplied "lighter" blend, composed per chunk and quantized to tenths), so objects are never left translucent for long. The images are made per 1024 px chunk near the camera at the layers' own resolution (0.5 or 0.75 px per layer px). The ground strip (ground and litter) is static and built once.
- **Background work scheduler** (`work.ts`): jobs are generators that yield every lobe or object; each frame `runWork` spends about 4 ms (1.5 ms when the last frame was slow) on the most urgent job. Only summer is made before play (about 1.6 s in the test browser); fall and winter images are made while playing, the next two moments ahead of the clock.
- **Culling**: the layer images are cut to the screen rows and the rows above the nearer layers' cover line before drawing.

## Measured (software-rendered test browser, so absolute numbers are inflated)

- Layer images for the chunks near the camera: about 44-50 MP (about 190 MB) with three moments resident, after an earlier version at 0.4 px per layer px that used less memory but was visibly blurry.
- Frame cost with images ready: about 9 ms median in the test browser (it was about 4 ms before the layers were split into back and front images; this environment has no GPU), background work included.
- A leaf stage change no longer stalls a frame: slices are one lobe or one object.

## PixiJS

Looked at, not adopted yet. What it would buy: GPU texture memory and batching for the roughly 300 sprites per frame, and cross-fades as a blend mode or shader instead of composed canvases. What it would not fix: all the procedural drawing (leaves, bark, ferns, moss) is Canvas 2D and would still have to be rasterized into canvases and uploaded as textures (a big upload can stall a frame like a big draw does); the squirrel's destination-out crown cut-out, the text labels and the HUD would need rewrites; and it adds about 400 KB of bundle. The measured costs are in making bitmaps, not in drawing them, so the best use of Pixi would be a contained experiment: the eight backdrop layers as Pixi sprites in a canvas under the 2D one. Worth doing if frame time on target hardware stays above budget after the items below.

## Ideas, roughly in order of value

1. **Window the layer images** (tiles of about 1024 layer px around the camera, built on demand and evicted): the far layers' images are only visible in a 1400 px window, so memory drops by about a third now and far more on larger worlds, and building a moment becomes proportional to what can be seen.
2. **Build the images in a worker with OffscreenCanvas** and transfer ImageBitmaps: the main thread then does no drawing for the seasons at all. Needs the drawing code (leaf disks, bark, ferns, moss) to run without `document`.
3. **Lower resolution for the far layers** (0.25-0.3): they are hazy, and memory goes down with the square.
4. **Build the next moment late** (only when the clock is past 60% of the current interval) and keep two moments, not three.
5. **Skip what cannot be seen**: layer images beyond the reachable camera range, and layers entirely behind nearer ground.
6. **Pause the work** when the tab is hidden or the game is over, and give it more time when the player is standing still.
7. **Share images**: summer is identical for every moment before the first start, winter after the last end.
8. **Drop the `getImageData` rasterization hacks** once the layers are not rebuilt (they force a synchronous raster).
9. **Render at the screen's scale**: images are made at a fixed 0.4 px per layer px; matching the device pixel ratio and window scale avoids resampling.
10. **Foreground cross-fade composites**: for the three oaks the per-frame alpha draws are cheap, but a composed (green plus fall) bitmap per tenth step would cut it to one draw.

## Experiments (test browser, no GPU)

1. **Why the cross-fade stuttered.** It was not the drawing: the composed images were quantized to tenths, so a fade showed ten visible steps, and the pieces were recomposed a few per frame. Composing the two images every frame (continuous, no quantization) costs about 0.4 ms more per frame than not fading at all (2.7 ms against 2.3 ms with the images ready), so the smooth fade needs no new library. The fade now runs over 3 seconds (`FADE_SECONDS`), with 13 moments (one every quarter segment) instead of 7.
2. **PixiJS.** Not measured: loading its script from a CDN into the page was blocked by the permission check, and I did not work around that. The experiment to run, if you allow the download or add `pixi.js` as a dependency: 16 layers x 3 chunks as sprites in two moments, one at alpha 1-t and one at alpha t with the ADD blend mode, and compare the frame time with the canvas version above. Given experiment 1, I would not expect a gain from the fade itself; the expected gains are texture memory and batching.
3. **Images on disk.** A backdrop tree crown at the layers' resolution averages 0.3 megapixels: 149 KB as PNG, 17 KB as WebP (quality 0.8). The world has about 230 trees. A library of ready-made trees (say 24 shapes x 5 looks x 6 hues = 720 images) would be about 12 MB of WebP, plus bushes, ferns and rocks. That is feasible for git but every regeneration rewrites binaries; a smaller library with the hue applied at load (or lightness-only templates tinted at runtime) would keep the repository small. Not built yet.
4. **Rocks disappearing.** Two causes found: culling by a rock's center instead of its extent at the screen edges (fixed for the foreground, creek and front rocks), and chunks of the layer images that were not made yet for the new moment right after the clock passed into it, so the layer's rocks, ferns, bushes and trees in those chunks were not drawn until they were made (fixed: such a chunk shows the nearest moment's image, and images are kept longer).

