import type { KeyEdges, KeyState } from './types'

/**
 * Creates mutable WASD key state plus one-shot S/B/E presses, and attaches window listeners.
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
  const edges: KeyEdges = { s: false, b: false, e: false }

  /**
   * Maps a KeyboardEvent to a tracked key name, or null if unrelated.
   */
  function fieldFor(event: KeyboardEvent): keyof KeyState | 'b' | 'e' | null {
    const key = event.key.toLowerCase()
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'b' || key === 'e') {
      return key
    }
    return null
  }

  /**
   * Marks a key as held, records fresh presses, and blocks default browser scrolling.
   */
  function onKeyDown(event: KeyboardEvent): void {
    const field = fieldFor(event)
    if (!field) {
      return
    }
    event.preventDefault()
    if (field === 'b' || field === 'e') {
      if (!event.repeat) {
        edges[field] = true
      }
      return
    }
    if (field === 's' && !event.repeat) {
      edges.s = true
    }
    keys[field] = true
  }

  /**
   * Marks a WASD key as released.
   */
  function onKeyUp(event: KeyboardEvent): void {
    const field = fieldFor(event)
    if (!field) {
      return
    }
    event.preventDefault()
    if (field !== 'b' && field !== 'e') {
      keys[field] = false
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  return {
    keys,
    edges,
    clearEdges: () => {
      edges.s = false
      edges.b = false
      edges.e = false
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    },
  }
}
