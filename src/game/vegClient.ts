/**
 * The main thread's side of the vegetation worker (see `vegWorker.ts`): layers are registered once, then
 * images are requested most urgent first with a couple in flight at a time, and each arrives as a bitmap.
 */
import type { VegPlan } from './render'
import type { ForestLayer } from './types'
import type { FromWorker, ToWorker } from './vegWorker'

/** A request for one image. */
export type VegRequest = {
  key: string
  priority: number
  id: number
  k: number
  part: 'back' | 'front'
  chunk: number
  /** Asked again just before sending: false if the image is not needed any more. */
  wanted: () => boolean
  onDone: (bitmap: ImageBitmap, rowTop: number) => void
}

/** How many requests the worker has at once (one being drawn, one waiting, so it never idles). */
const IN_FLIGHT = 2

let worker: Worker | null = null
// `?noworker` in the address draws everything on the main thread (to compare).
let broken =
  typeof Worker === 'undefined' ||
  typeof OffscreenCanvas === 'undefined' ||
  (typeof location !== 'undefined' && location.search.includes('noworker'))
let nextLayer = 0
let nextReq = 0
const waiting: VegRequest[] = []
const keys = new Set<string>()
const inFlight = new Map<number, VegRequest>()

/**
 * Gives up on the worker (the game then draws the images itself).
 */
function fail(): void {
  broken = true
  worker?.terminate()
  worker = null
  waiting.length = 0
  inFlight.clear()
  keys.clear()
}

/**
 * Sends waiting requests, most urgent first, while fewer than `IN_FLIGHT` are out.
 */
function pump(): void {
  while (worker && inFlight.size < IN_FLIGHT && waiting.length > 0) {
    let best = 0
    for (let i = 1; i < waiting.length; i += 1) {
      if ((waiting[i]?.priority ?? 0) < (waiting[best]?.priority ?? 0)) {
        best = i
      }
    }
    const [request] = waiting.splice(best, 1)
    if (!request) {
      break
    }
    if (!request.wanted()) {
      keys.delete(request.key)
      continue
    }
    const req = nextReq
    nextReq += 1
    inFlight.set(req, request)
    worker.postMessage({ type: 'build', req, id: request.id, k: request.k, part: request.part, chunk: request.chunk } satisfies ToWorker)
  }
}

/**
 * Starts the worker on first use.
 */
function ensureWorker(): Worker | null {
  if (broken) {
    return null
  }
  if (!worker) {
    try {
      const created = new Worker(new URL('./vegWorker.ts', import.meta.url), { type: 'module' })
      created.onmessage = (event: MessageEvent<FromWorker>): void => {
        const message = event.data
        const request = inFlight.get(message.req)
        inFlight.delete(message.req)
        if (request) {
          keys.delete(request.key)
          if (message.type === 'done') {
            request.onDone(message.bitmap, message.rowTop)
          }
        }
        if (message.type === 'error') {
          console.error('vegetation worker:', message.message)
        }
        pump()
      }
      created.onerror = (event): void => {
        console.error('vegetation worker failed, drawing on the main thread:', event.message)
        fail()
      }
      worker = created
    } catch {
      fail()
    }
  }
  return worker
}

/**
 * Whether the worker can be used.
 */
export function workerUsable(): boolean {
  return ensureWorker() !== null
}

/**
 * Sends a layer's scenery to the worker (once per layer).
 *
 * @param layer - The layer.
 * @param veg - Where its vegetation stands.
 * @returns The layer's id for requests, or -1 if there is no worker.
 */
export function registerLayer(layer: ForestLayer, veg: VegPlan): number {
  const target = ensureWorker()
  if (!target) {
    return -1
  }
  const id = nextLayer
  nextLayer += 1
  // Only what the drawing needs (not the terrain noise or the rocks between layers).
  const subset: Partial<ForestLayer> = {
    parallax: layer.parallax,
    span: layer.span,
    groundColor: layer.groundColor,
    trunkColor: layer.trunkColor,
    tones: layer.tones,
    trees: layer.trees,
    bushes: layer.bushes,
    logs: layer.logs,
    rocks: layer.rocks,
    ferns: layer.ferns,
    localRadius: layer.localRadius,
    creek: layer.creek,
    fog: layer.fog,
    scale: layer.scale,
    leafColors: layer.leafColors,
  }
  target.postMessage({ type: 'layer', id, layer: subset, veg } satisfies ToWorker)
  return id
}

/**
 * Asks for an image unless the same one is already waiting or being made.
 *
 * @param request - The request.
 */
export function requestImage(request: VegRequest): void {
  if (!worker || keys.has(request.key)) {
    return
  }
  keys.add(request.key)
  waiting.push(request)
  pump()
}

/**
 * How many requests are waiting or being made.
 */
export function pendingRequests(): number {
  return waiting.length + inFlight.size
}
