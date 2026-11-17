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
