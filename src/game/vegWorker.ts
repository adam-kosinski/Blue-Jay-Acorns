/**
 * Background worker that draws the forest layers' vegetation images (the trees, logs, rocks, ferns and
 * bushes of one chunk of a layer at one moment of the seasons) off the main thread, so that the game's frames
 * never wait for them. It gets each layer's scenery once, then build requests, and answers with bitmaps.
 */
import { buildVegImageSync, type VegPlan } from './render'
import type { ForestLayer } from './types'

/** Messages to the worker. */
export type ToWorker =
  | { type: 'layer'; id: number; layer: Partial<ForestLayer>; veg: VegPlan }
  | { type: 'build'; req: number; id: number; k: number; part: 'back' | 'front'; chunk: number }

/** Messages from the worker. */
export type FromWorker =
  | { type: 'done'; req: number; bitmap: ImageBitmap; rowTop: number }
  | { type: 'error'; req: number; message: string }

const layers = new Map<number, { layer: ForestLayer; veg: VegPlan }>()
const scope = self as unknown as Worker

scope.onmessage = (event: MessageEvent<ToWorker>): void => {
  const message = event.data
  if (message.type === 'layer') {
    layers.set(message.id, { layer: message.layer as ForestLayer, veg: message.veg })
    return
  }
  const entry = layers.get(message.id)
  if (!entry) {
    scope.postMessage({ type: 'error', req: message.req, message: 'unknown layer' } satisfies FromWorker)
    return
  }
  try {
    const { bitmap, rowTop } = buildVegImageSync(entry.layer, entry.veg, message.k, message.part, message.chunk)
    scope.postMessage({ type: 'done', req: message.req, bitmap, rowTop } satisfies FromWorker, [bitmap])
  } catch (error) {
    scope.postMessage({ type: 'error', req: message.req, message: String(error) } satisfies FromWorker)
  }
}
