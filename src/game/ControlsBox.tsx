import { useState, type CSSProperties } from 'react'
import { LOGICAL_VIEW_HEIGHT } from './constants'

const COLLAPSED_STORAGE_KEY = 'blue-jay-acorns:controls-collapsed'

/** The keys and what they do. */
const CONTROLS: [string, string][] = [
  ['WASD', 'move'],
  ['Left click / Shift', 'pick up, bury, dig up'],
  ['Right click / E', 'eat when hungry'],
  ['Q', 'drop'],
]

/**
 * Reads whether the controls box is to start collapsed: it is, unless it was left open.
 */
function loadCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * The controls cheat sheet in the bottom left corner. A click anywhere on it collapses it to its title, or opens it
 * again (kept across reloads). It is sized with the game's picture, which is scaled to the window's height.
 */
export function ControlsBox() {
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed)
  // One pixel of the game's logical view.
  const style = { '--px': `calc(100vh / ${LOGICAL_VIEW_HEIGHT})` } as CSSProperties

  return (
    <button
      type="button"
      className="controls-box"
      style={style}
      aria-expanded={!collapsed}
      onClick={(event) => {
        const next = !collapsed
        setCollapsed(next)
        try {
          window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
        } catch {
          // Not being able to save is fine; the choice still applies for this session.
        }
        // Keyboard focus goes back to the game.
        event.currentTarget.blur()
      }}
    >
      <span className="controls-title">
        Controls
        <svg className="controls-arrow" viewBox="0 0 12 8" aria-hidden="true">
          <path d="M1 1.5 6 6.5 11 1.5" />
        </svg>
      </span>
      {!collapsed && (
        <span className="controls-list">
          {CONTROLS.map(([key, action]) => (
            <span key={key} className="controls-row">
              <span className="controls-key">{key}</span>
              <span>{action}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  )
}
