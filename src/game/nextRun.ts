/**
 * Gets the next run ready while the player's starved jay collapses, so that "Try again" does not have to wait for a
 * whole forest: a new world is made in a background worker (`runWorker.ts`), and its summer scenery is built a
 * little each frame, nearly all of it in workers too, so that the collapse stays smooth.
 */
import { playerSizeForView } from './constants'
import { renewActionMemory } from './npc'
import { adoptShapes } from './oak'
import { createPlayer } from './player'
import { adoptLeafTile, adoptStrip, warmUpScene } from './render'
import type { FromRunWorker, ToRunWorker } from './runWorker'
import type { ForestLayer, Player, World } from './types'
import { workerUsable } from './vegClient'

/** A run being made ready. */
export type NextRun = {
  /** The view it is made for (logical pixels), and the resolution its foreground is drawn at. */
  viewWidth: number
  viewHeight: number
  dpr: number
  /** The new world and its jay, once the worker has made them. */
  ready: { world: World; player: Player } | null
  /** The work still to do on this side, a step at a time: it yields 'wait' while there is nothing to do but wait. */
  steps: Generator<'wait' | void>
  /** Ends the worker (when this run is not going to be used). */
  cancel: () => void
}

/**
 * Starts making the next run.
 *
 * @param viewWidth - Logical view width.
 * @param viewHeight - Logical view height.
 * @param dpr - Bitmap pixels per world pixel the game renders at.
 * @returns The run in the making, or null where there are no background workers (it is then made when asked for).
 */
export function prepareNextRun(viewWidth: number, viewHeight: number, dpr: number): NextRun | null {
  if (!workerUsable()) {
    return null
  }
  let worker: Worker
  try {
    worker = new Worker(new URL('./runWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  /** Whether the worker is still at it, and the layers whose ground has arrived. */
  let working = true
  const arrived = new Set<ForestLayer>()
  const stop = (): void => {
    working = false
    worker.terminate()
  }
  function* steps(): Generator<'wait' | void> {
    while (working && !run.ready) {
      yield 'wait'
    }
    if (run.ready) {
      // (A layer whose ground never comes, the worker having failed, is painted on this side.)
      yield* warmUpScene(run.ready.world, run.ready.player, run.dpr, {
        stripComing: (layer) => working && !arrived.has(layer),
        tilesComing: () => working,
      })
    }
  }
  const run: NextRun = { viewWidth, viewHeight, dpr, ready: null, steps: steps(), cancel: stop }
  worker.onmessage = (event: MessageEvent<FromRunWorker>): void => {
    const message = event.data
    if (message.type === 'world') {
      const { world } = message
      // The worker numbered its trees from the start; here they must not share numbers with other worlds' trees.
      adoptShapes([...world.trees, ...world.forest.flatMap((layer) => layer.trees)].map((tree) => tree.shape))
      for (const npc of [...world.npcs, ...world.squirrels]) {
        renewActionMemory(npc)
      }
      run.ready = { world, player: createPlayer(world, playerSizeForView(viewHeight)) }
    } else if (message.type === 'strip') {
      const layer = run.ready?.world.forest[message.layer]
      if (layer) {
        adoptStrip(layer, message.strip)
        arrived.add(layer)
      }
    } else if (message.type === 'tile') {
      if (run.ready) {
        adoptLeafTile(run.ready.world, message.index, message.bitmap)
      }
    } else {
      if (message.type === 'error') {
        console.error('next run worker:', message.message)
      }
      stop()
    }
  }
  worker.onerror = (event): void => {
    console.error('next run worker failed:', event.message)
    stop()
  }
  worker.postMessage({ viewWidth, viewHeight } satisfies ToRunWorker)
  return run
}
