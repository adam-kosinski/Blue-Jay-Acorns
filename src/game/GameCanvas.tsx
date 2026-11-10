import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { handleAcornActions, updateAcorns, updateAction, updateTreeDrops } from './acorns'
import { cameraForPlayer } from './camera'
import {
  ACORN_DROP_MODES,
  LOGICAL_VIEW_HEIGHT,
  playerSizeForView,
  type AcornDropMode,
} from './constants'
import { updateHunger } from './hunger'
import { createKeyState } from './input'
import { updateNpcs } from './npc'
import { createPlayer, updatePlayer } from './player'
import { renderScene, setBurialHeatmap, warmUpScene } from './render'
import type { Player, World } from './types'
import { createWorld } from './world'

const DROP_MODE_STORAGE_KEY = 'blue-jay-acorns:drop-mode'
const PAUSE_HUNGER_STORAGE_KEY = 'blue-jay-acorns:pause-hunger'
const DEBUG_OPEN_STORAGE_KEY = 'blue-jay-acorns:debug-open'

/**
 * Reads whether the debug "pause my hunger" toggle was left on.
 */
function loadPauseHunger(): boolean {
  try {
    return window.localStorage.getItem(PAUSE_HUNGER_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Reads whether the debug panel was left open (it is open by default).
 */
function loadDebugOpen(): boolean {
  try {
    return window.localStorage.getItem(DEBUG_OPEN_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * Reads the saved acorn drop-rate mode (defaults when nothing valid is stored or storage fails).
 */
function loadDropMode(): AcornDropMode {
  try {
    const saved = window.localStorage.getItem(DROP_MODE_STORAGE_KEY)
    if (saved && saved in ACORN_DROP_MODES) {
      return saved as AcornDropMode
    }
  } catch {
    // Storage can be unavailable; fall back to the default.
  }
  return 'default'
}

/**
 * Full-viewport canvas that runs the 2D prototype game loop, plus a debug panel in the top-left
 * corner for the acorn drop rate (kept across restarts and reloads).
 */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const restartRef = useRef<() => void>(() => {})
  const [dropMode, setDropMode] = useState<AcornDropMode>(loadDropMode)
  const [pauseHunger, setPauseHunger] = useState<boolean>(loadPauseHunger)
  const dropMultiplierRef = useRef<number>(ACORN_DROP_MODES[dropMode])
  const pauseHungerRef = useRef<boolean>(pauseHunger)
  const [showBurialQuality, setShowBurialQuality] = useState<boolean>(false)
  const [invisible, setInvisible] = useState<boolean>(false)
  const [debugOpen, setDebugOpen] = useState<boolean>(loadDebugOpen)
  const [buriedCount, setBuriedCount] = useState<number>(0)
  const invisibleRef = useRef<boolean>(false)

  useEffect(() => {
    dropMultiplierRef.current = ACORN_DROP_MODES[dropMode]
  }, [dropMode])

  useEffect(() => {
    pauseHungerRef.current = pauseHunger
  }, [pauseHunger])

  useEffect(() => {
    setBurialHeatmap(showBurialQuality)
  }, [showBurialQuality])

  useEffect(() => {
    invisibleRef.current = invisible
  }, [invisible])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) {
      return
    }

    const ctx2d = canvasEl.getContext('2d')
    if (!ctx2d) {
      return
    }
    const canvas = canvasEl
    const ctx = ctx2d

    const { keys, edges, clearEdges, dispose } = createKeyState()
    // The game runs in a fixed logical view (LOGICAL_VIEW_HEIGHT tall) scaled to the window, so
    // gameplay distances never depend on the window's size.
    let scale = window.innerHeight / LOGICAL_VIEW_HEIGHT
    const logicalWidth = (): number => window.innerWidth / scale
    let world: World = createWorld(logicalWidth(), LOGICAL_VIEW_HEIGHT)
    let player: Player = createPlayer(world, playerSizeForView(LOGICAL_VIEW_HEIGHT))
    let animationId = 0
    let gameOver = false
    let warmUp: Generator<void> | null = warmUpScene(
      world,
      player,
      (window.devicePixelRatio || 1) * scale,
    )
    let lastTime = performance.now()
    let lastBuried = -1

    /**
     * Rebuilds world scenery and resets the player to the starting pose.
     */
    function regenerate(): void {
      world = createWorld(logicalWidth(), LOGICAL_VIEW_HEIGHT)
      player = createPlayer(world, playerSizeForView(LOGICAL_VIEW_HEIGHT))
      warmUp = warmUpScene(world, player, (window.devicePixelRatio || 1) * scale)
      gameOver = false
    }

    restartRef.current = regenerate

    /**
     * Matches the backing store to the window and rescales the logical view to fit.
     */
    function resize(): void {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      scale = window.innerHeight / LOGICAL_VIEW_HEIGHT
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
      // Cached bitmaps are rendered for the new scale a few at a time.
      warmUp = warmUpScene(world, player, dpr * scale)
    }

    /**
     * Advances simulation and paints the current frame.
     */
    function frame(now: number): void {
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const width = logicalWidth()
      const height = LOGICAL_VIEW_HEIGHT
      if (warmUp && warmUp.next().done) {
        warmUp = null
      }
      if (!gameOver) {
        player.invisible = invisibleRef.current
        updatePlayer(player, keys, dt, world)
        updateAction(player, world, dt)
        handleAcornActions(player, edges, world)
        updateHunger(player, edges, world, dt, !pauseHungerRef.current)
        world.time += dt
        updateNpcs(world, dt, player)
        updateTreeDrops(world, player.size, dt, dropMultiplierRef.current)
        updateAcorns(world, player.size, dt)
        // Running out of food ends the game.
        gameOver = player.hunger <= 0
        // How many of the player's buried acorns are still buried (shown in the debug panel).
        const buried = world.acorns.reduce(
          (count, acorn) => (acorn.state === 'buried' && acorn.owner === player ? count + 1 : count),
          0,
        )
        if (buried !== lastBuried) {
          lastBuried = buried
          setBuriedCount(buried)
        }
      }
      clearEdges()
      const camera = cameraForPlayer(player, world, width, height)
      renderScene(ctx, width, height, world, camera, player, gameOver)
      animationId = window.requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    animationId = window.requestAnimationFrame(frame)

    return () => {
      dispose()
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(animationId)
    }
  }, [])

  /**
   * Regenerates the run and returns keyboard focus to the page.
   */
  function onRestart(event: MouseEvent<HTMLButtonElement>): void {
    restartRef.current()
    event.currentTarget.blur()
  }

  /**
   * Selects an acorn drop-rate mode, saves it, and returns keyboard focus to the game.
   */
  function onDropModeChange(event: ChangeEvent<HTMLInputElement>): void {
    const mode = event.currentTarget.value as AcornDropMode
    setDropMode(mode)
    try {
      window.localStorage.setItem(DROP_MODE_STORAGE_KEY, mode)
    } catch {
      // Not being able to save is fine; the choice still applies for this session.
    }
    event.currentTarget.blur()
  }

  /**
   * Toggles pausing the player's hunger, saves it, and returns keyboard focus to the game.
   */
  function onPauseHungerChange(event: ChangeEvent<HTMLInputElement>): void {
    const paused = event.currentTarget.checked
    setPauseHunger(paused)
    try {
      window.localStorage.setItem(PAUSE_HUNGER_STORAGE_KEY, String(paused))
    } catch {
      // Not being able to save is fine; the choice still applies for this session.
    }
    event.currentTarget.blur()
  }

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" />
      <button
        type="button"
        className="debug-button"
        aria-pressed={debugOpen}
        onClick={(event) => {
          const next = !debugOpen
          setDebugOpen(next)
          try {
            window.localStorage.setItem(DEBUG_OPEN_STORAGE_KEY, String(next))
          } catch {
            // Not being able to save is fine; the choice still applies for this session.
          }
          event.currentTarget.blur()
        }}
      >
        Debug {debugOpen ? 'on' : 'off'}
      </button>
      {debugOpen && (
        <fieldset className="debug-panel">
          <legend>Debug</legend>
          <div className="debug-readout">Acorns I buried, still buried: {buriedCount}</div>
          {(Object.keys(ACORN_DROP_MODES) as AcornDropMode[]).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="acorn-drop-mode"
                value={mode}
                checked={dropMode === mode}
                onChange={onDropModeChange}
              />
              {mode === 'none'
                ? 'No acorns'
                : mode === 'deficit'
                  ? 'Deficit (-25%)'
                  : mode === 'surplus'
                    ? 'Surplus (+25%)'
                    : 'Default'}
            </label>
          ))}
          <label className="debug-toggle">
            <input type="checkbox" checked={pauseHunger} onChange={onPauseHungerChange} />
            Pause my hunger
          </label>
          <label className="debug-toggle">
            <input
              type="checkbox"
              checked={showBurialQuality}
              onChange={(event) => {
                setShowBurialQuality(event.target.checked)
                event.currentTarget.blur()
              }}
            />
            Burial quality heatmap
          </label>
          <label className="debug-toggle">
            <input
              type="checkbox"
              checked={invisible}
              onChange={(event) => {
                setInvisible(event.target.checked)
                event.currentTarget.blur()
              }}
            />
            Turn invisible
          </label>
        </fieldset>
      )}
      <button type="button" className="restart-button" onClick={onRestart}>
        Restart
      </button>
    </div>
  )
}
