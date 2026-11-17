/**
 * Background worker that draws the forest layers' vegetation images (the trees, logs, rocks, ferns and
 * bushes of one chunk of a layer at one moment of the seasons) off the main thread, so that the game's frames
 * never wait for them. It gets each layer's scenery once, then build requests, and answers with bitmaps.
 */
import { buildOakPartSync, type OakPart } from './oak'
import { buildPropSync, buildVegImageSync, type VegPlan } from './render'
import type { Bush, Fern, ForestLayer, Rock, TreeShape } from './types'

/** Messages to the worker. */
export type ToWorker =
  | { type: 'layer'; id: number; layer: Partial<ForestLayer>; veg: VegPlan }
  | { type: 'build'; req: number; id: number; k: number; part: 'back' | 'front'; chunk: number }
  | { type: 'prop'; req: number; kind: 'bush' | 'fern' | 'rock'; item: Bush | Fern | Rock; res: number; part: string }
  | { type: 'oak'; req: number; shape: TreeShape; tones: string[]; trunkColor: string; res: number; part: OakPart }

/** Messages from the worker. */
export type FromWorker =
  | { type: 'done'; req: number; bitmap: ImageBitmap; meta: Record<string, number> }
  | { type: 'error'; req: number; message: string }

const layers = new Map<number, { layer: ForestLayer; veg: VegPlan }>()
const scope = self as unknown as Worker

scope.onmessage = (event: MessageEvent<ToWorker>): void => {
  const message = event.data
  if (message.type === 'layer') {
    layers.set(message.id, { layer: message.layer as ForestLayer, veg: message.veg })
    return
  }
  if (message.type === 'prop') {
    try {
      const { bitmap, ...meta } = buildPropSync(message.kind, message.item, message.res, message.part)
      scope.postMessage({ type: 'done', req: message.req, bitmap, meta } satisfies FromWorker, [bitmap])
    } catch (error) {
      scope.postMessage({ type: 'error', req: message.req, message: String(error) } satisfies FromWorker)
    }
    return
  }
  if (message.type === 'oak') {
    try {
      const { bitmap, ...meta } = buildOakPartSync(message.shape, message.tones, message.trunkColor, message.res, message.part)
      scope.postMessage({ type: 'done', req: message.req, bitmap, meta } satisfies FromWorker, [bitmap])
    } catch (error) {
      scope.postMessage({ type: 'error', req: message.req, message: String(error) } satisfies FromWorker)
    }
    return
  }
  const entry = layers.get(message.id)
  if (!entry) {
    scope.postMessage({ type: 'error', req: message.req, message: 'unknown layer' } satisfies FromWorker)
    return
  }
  try {
    const { bitmap, rowTop } = buildVegImageSync(entry.layer, entry.veg, message.k, message.part, message.chunk)
    scope.postMessage({ type: 'done', req: message.req, bitmap, meta: { rowTop } } satisfies FromWorker, [bitmap])
  } catch (error) {
    scope.postMessage({ type: 'error', req: message.req, message: String(error) } satisfies FromWorker)
  }
}
