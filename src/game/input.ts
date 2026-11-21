import type { KeyEdges, KeyState } from './types'

/** One-shot actions: Q drops, left Shift or the left mouse button picks up a free acorn in reach, else buries (holding one) / digs up, E or the right mouse button eats. */
type EdgeKey = keyof KeyEdges

/**
 * Creates mutable WASD key state plus one-shot Q / left Shift / E presses (and mouse clicks), and attaches
 * window listeners.
 *
 * `edges` records fresh key-downs (ignoring auto-repeat); the game loop must
 * call `clearEdges` once per frame after consuming them.
 *
 * @returns The live key state, edge flags, an edge reset, and a disposer.
 */
export function createKeyState(): {
  keys: KeyState
  edges: KeyEdges
  clearEdges: () => void
  dispose: () => void
} {
  const keys: KeyState = { w: false, a: false, s: false, d: false }
  const edges: KeyEdges = { pickup: false, drop: false, bury: false, e: false }

  /**
   * Maps a KeyboardEvent to a held WASD key, or null if unrelated.
   */
  function heldKeyFor(event: KeyboardEvent): keyof KeyState | null {
    const key = event.key.toLowerCase()
    if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
      return key
    }
    return null
  }

  /**
   * Maps a KeyboardEvent to a one-shot action, or null if unrelated.
   */
  function edgeFor(event: KeyboardEvent): EdgeKey | null {
    if (event.code === 'KeyQ') {
      return 'drop'
    }
    if (event.code === 'ShiftLeft') {
      return 'bury'
    }
    if (event.key.toLowerCase() === 'e') {
      return 'e'
    }
    return null
  }

  /**
   * Marks a key as held, records fresh presses (auto-repeat is ignored, so a held S that carried the
   * bird down to the ground never counts as a pick-up tap), and blocks default browser actions.
   */
  function onKeyDown(event: KeyboardEvent): void {
    const edge = edgeFor(event)
    const held = heldKeyFor(event)
    if (!edge && !held) {
      return
    }
    event.preventDefault()
    if (edge && !event.repeat) {
      edges[edge] = true
    }
    if (held) {
      keys[held] = true
    }
  }

  /**
   * Marks a WASD key as released.
   */
  function onKeyUp(event: KeyboardEvent): void {
    const held = heldKeyFor(event)
    if (held) {
      event.preventDefault()
      keys[held] = false
    } else if (edgeFor(event)) {
      event.preventDefault()
    }
  }

  /** Whether a mouse event landed on the game itself (not on the debug panel, the Restart button, ...). */
  function onGame(event: MouseEvent): boolean {
    return !(event.target instanceof Element && event.target.closest('button, input, label, fieldset, select'))
  }

  /** Left click buries / digs up (like left Shift), right click eats (like E). */
  function onMouseDown(event: MouseEvent): void {
    if (!onGame(event)) {
      return
    }
    if (event.button === 0) {
      edges.bury = true
    } else if (event.button === 2) {
      edges.e = true
    }
  }

  /** No browser menu on a right click over the game. */
  function onContextMenu(event: MouseEvent): void {
    if (onGame(event)) {
      event.preventDefault()
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('contextmenu', onContextMenu)

  return {
    keys,
    edges,
    clearEdges: () => {
      edges.pickup = false
      edges.drop = false
      edges.bury = false
      edges.e = false
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('contextmenu', onContextMenu)
    },
  }
}
