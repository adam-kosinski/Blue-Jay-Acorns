/**
 * Background worker that makes the next run's world while the game goes on (see `nextRun.ts`): the world itself,
 * then the ground of its forest layers and its leaf litter, each sent as soon as it is ready.
 */
import { buildLeafTileSync, buildStripSync, leafTileCount, type ForestStripImage } from './render'
import type { World } from './types'
import { createWorld } from './world'

/** What to make: a world for a view of this size (logical pixels). */
export type ToRunWorker = { viewWidth: number; viewHeight: number }

/** Messages from the worker, in the order they come: the world, its layers' grounds, its litter, then `done`. */
export type FromRunWorker =
  | { type: 'world'; world: World }
  | { type: 'strip'; layer: number; strip: ForestStripImage }
  | { type: 'tile'; index: number; bitmap: ImageBitmap }
  | { type: 'done' }
  | { type: 'error'; message: string }

const scope = self as unknown as Worker

scope.onmessage = (event: MessageEvent<ToRunWorker>): void => {
  try {
    const world = createWorld(event.data.viewWidth, event.data.viewHeight)
    // The birds' memory of actions seen cannot be copied (the page makes it anew, see `renewActionMemory`).
    for (const npc of [...world.npcs, ...world.squirrels]) {
      Reflect.deleteProperty(npc, 'seenActions')
      Reflect.deleteProperty(npc, 'missedActions')
    }
    // (A copy goes over, so what is made from the world here afterwards does not matter to it.)
    scope.postMessage({ type: 'world', world } satisfies FromRunWorker)
    for (const [layer, forest] of world.forest.entries()) {
      const strip = buildStripSync(forest, world)
      scope.postMessage({ type: 'strip', layer, strip } satisfies FromRunWorker, [strip.canvas])
    }
    for (let index = 0; index < leafTileCount(world); index += 1) {
      const bitmap = buildLeafTileSync(world, index)
      scope.postMessage({ type: 'tile', index, bitmap } satisfies FromRunWorker, [bitmap])
    }
    scope.postMessage({ type: 'done' } satisfies FromRunWorker)
  } catch (error) {
    scope.postMessage({ type: 'error', message: String(error) } satisfies FromRunWorker)
  }
}
