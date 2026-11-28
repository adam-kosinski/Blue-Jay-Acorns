import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { handleAcornActions, updateAcorns, updateAction, updateHopTip, updateTreeDrops } from './acorns'
import { cameraForPlayer } from './camera'
import {
  ACORN_DROP_MODES,
  ACORN_DROP_MODE_ORDER,
  LOGICAL_VIEW_HEIGHT,
  playerSizeForView,
  type AcornDropMode,
  PLAYER_HUNGER_THRESHOLD,
} from './constants'
import { ControlsBox } from './ControlsBox'
import { messageOf, startDeath, updateDeath } from './death'
import { updateHunger } from './hunger'
import { createKeyState } from './input'
import { prepareNextRun, type NextRun } from './nextRun'
import { updateNpcs } from './npc'
import { createPlayer, updatePlayer } from './player'
import {
  deathMessageLayout,
  forestReady,
  renderScene,
  setBurialHeatmap,
  setShowMinimap,
  setSquirrelRegions,
  warmUpScene,
} from './render'
import { advanceSeason, baseDropRate } from './seasons'
import { Timeline } from './Timeline'
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
 * Reads whether the debug panel was left open (it is closed by default).
 */
function loadDebugOpen(): boolean {
  try {
    return window.localStorage.getItem(DEBUG_OPEN_STORAGE_KEY) === 'true'
  } catch {
    return false
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
  return 'timeline'
}

/**
 * Full-viewport canvas that runs the 2D prototype game loop, plus a debug panel in the top-left
 * corner for the acorn drop rate (kept across restarts and reloads).
 */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const restartRef = useRef<() => void>(() => {})
  const killRef = useRef<() => void>(() => {})
  const worldRef = useRef<World | null>(null)
  const [dropMode, setDropMode] = useState<AcornDropMode>(loadDropMode)
  const [pauseHunger, setPauseHunger] = useState<boolean>(loadPauseHunger)
  const rateOverrideRef = useRef<number | null>(ACORN_DROP_MODES[dropMode])
  const pauseHungerRef = useRef<boolean>(pauseHunger)
  const timePausedRef = useRef<boolean>(false)
  const [showBurialQuality, setShowBurialQuality] = useState<boolean>(false)
  const [showRegions, setShowRegions] = useState<boolean>(false)
  const [invisible, setInvisible] = useState<boolean>(false)
  const [debugOpen, setDebugOpen] = useState<boolean>(loadDebugOpen)
  const [buriedCount, setBuriedCount] = useState<number>(0)
  // A loading screen covers the game until the forest is made (at the start and after Restart).
  const [loading, setLoading] = useState<boolean>(true)
  // Once the jay has starved the controls box goes; when its collapse is over a button offers another try.
  const [starved, setStarved] = useState<boolean>(false)
  const [offerRetry, setOfferRetry] = useState<boolean>(false)
  const retryRef = useRef<HTMLButtonElement>(null)
  const invisibleRef = useRef<boolean>(false)
  const debugOpenRef = useRef<boolean>(debugOpen)

  useEffect(() => {
    rateOverrideRef.current = ACORN_DROP_MODES[dropMode]
  }, [dropMode])

  useEffect(() => {
    pauseHungerRef.current = pauseHunger
  }, [pauseHunger])

  useEffect(() => {
    setBurialHeatmap(showBurialQuality)
  }, [showBurialQuality])

  useEffect(() => {
    setSquirrelRegions(showRegions)
  }, [showRegions])

  useEffect(() => {
    setShowMinimap(debugOpen)
    debugOpenRef.current = debugOpen
    try {
      window.localStorage.setItem(DEBUG_OPEN_STORAGE_KEY, String(debugOpen))
    } catch {
      // Not being able to save is fine; the choice still applies for this session.
    }
  }, [debugOpen])

  // The "/" key opens and closes the debug tools.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== '/' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }
      // (Some browsers would open their quick search.)
      event.preventDefault()
      setDebugOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    invisibleRef.current = invisible
  }, [invisible])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) {
      return
    }

    // Opaque: every frame covers the whole canvas, and the browser then need not blend it with the page.
    const ctx2d = canvasEl.getContext('2d', { alpha: false })
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
    worldRef.current = world
    ;(window as unknown as { __world?: unknown }).__world = world
    let player: Player = createPlayer(world, playerSizeForView(LOGICAL_VIEW_HEIGHT))
    let animationId = 0
    let won = false
    let retryOffered = false
    let loading = true
    let loadedFrames = 0
    // The run after this one, made ready from the moment the jay starves (see nextRun.ts).
    let nextRun: NextRun | null = null
    let warmUp: Generator<'wait' | void> | null = warmUpScene(
      world,
      player,
      (window.devicePixelRatio || 1) * scale,
    )
    let lastTime = performance.now()
    let lastBuried = -1

    /**
     * Rebuilds world scenery and resets the player to the starting pose, taking the run already made ready if
     * there is one for this view.
     */
    function regenerate(): void {
      const dpr = (window.devicePixelRatio || 1) * scale
      const next = nextRun
      nextRun = null
      // (A world's width only matters to its forest in views wider than three times their height.)
      const spanFor = (width: number): number => Math.max(width, LOGICAL_VIEW_HEIGHT * 3)
      if (next?.ready && spanFor(next.viewWidth) === spanFor(logicalWidth())) {
        world = next.ready.world
        player = next.ready.player
        // What is left of its preparation is finished behind the loading screen (all of it again, as far as it
        // is not made, if the window has been rescaled since).
        warmUp = next.dpr === dpr ? next.steps : warmUpScene(world, player, dpr)
      } else {
        next?.cancel()
        world = createWorld(logicalWidth(), LOGICAL_VIEW_HEIGHT)
        player = createPlayer(world, playerSizeForView(LOGICAL_VIEW_HEIGHT))
        warmUp = warmUpScene(world, player, dpr)
      }
      ;(window as unknown as { __world?: unknown }).__world = world
      worldRef.current = world
      won = false
      loading = true
      loadedFrames = 0
      setLoading(true)
      retryOffered = false
      setStarved(false)
      setOfferRetry(false)
    }

    restartRef.current = regenerate
    // Debug "Kill": the jay's hunger runs out at once (a meal in progress is given up).
    killRef.current = () => {
      player.eatTimer = 0
      player.hunger = 0
    }

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
      // Behind the loading screen, steps are taken for a good part of the frame (until there is only waiting to do).
      const stepsUntil = performance.now() + (loading ? 12 : 0)
      while (warmUp) {
        const step = warmUp.next()
        if (step.done) {
          warmUp = null
        } else if (step.value === 'wait' || performance.now() >= stepsUntil) {
          break
        }
      }
      if (loading) {
        // Nothing moves until the forest is made: first the warm-up, then a few frames drawn so that the
        // images made in the background are in place.
        if (!warmUp) {
          const camera = cameraForPlayer(player, world, width, height)
          renderScene(ctx, width, height, world, camera, player, 'playing')
          loadedFrames += 1
          if (loadedFrames > 4 && forestReady(world, camera.x, width)) {
            loading = false
            lastTime = performance.now()
            setLoading(false)
          }
        }
        animationId = window.requestAnimationFrame(frame)
        return
      }
      // Opening the debug tools takes the victory screen away, and the game goes on.
      if (debugOpenRef.current) {
        won = false
      }
      if (player.death) {
        // The starved jay takes no controls: it collapses while the forest goes on around it.
        updateDeath(player, world, dt)
        // One small step a frame toward the next run.
        nextRun?.steps.next()
        world.time += dt
        updateNpcs(world, dt, player)
        updateAcorns(world, player.size, dt)
      } else if (!won) {
        player.invisible = invisibleRef.current
        updatePlayer(player, keys, dt, world)
        updateAction(player, world, dt)
        handleAcornActions(player, edges, world)
        updateHunger(player, edges, world, dt, !pauseHungerRef.current, PLAYER_HUNGER_THRESHOLD)
        world.time += dt
        updateNpcs(world, dt, player)
        // The season sets the acorn rate unless the debug panel fixes it.
        // The timeline's pause button holds the season clock still (everything else goes on).
        const reachedEnd = !timePausedRef.current && advanceSeason(world.season, dt)
        updateTreeDrops(
          world,
          player.size,
          dt,
          rateOverrideRef.current ?? baseDropRate(world.season, world.season.time),
        )
        updateAcorns(world, player.size, dt)
        updateHopTip(world, player)
        // Running out of food ends the game.
        if (player.hunger <= 0) {
          startDeath(player, world)
          setStarved(true)
          nextRun?.cancel()
          nextRun = prepareNextRun(logicalWidth(), LOGICAL_VIEW_HEIGHT, (window.devicePixelRatio || 1) * scale)
        }
        // Surviving to the end of spring wins the game (with the debug tools open it just goes on).
        won = reachedEnd && !player.death && !debugOpenRef.current
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
      renderScene(ctx, width, height, world, camera, player, player.death ? 'lost' : won ? 'won' : 'playing')
      if (player.death && messageOf(player.death) > 0) {
        if (!retryOffered) {
          retryOffered = true
          setOfferRetry(true)
        }
        // The button sits right under the message, which stands above the bird.
        const button = retryRef.current
        if (button) {
          const at = deathMessageLayout(width, camera, player)
          button.style.left = `${at.x * scale}px`
          button.style.top = `${at.buttonTop * scale}px`
        }
      }
      animationId = window.requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    animationId = window.requestAnimationFrame(frame)

    return () => {
      dispose()
      nextRun?.cancel()
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
      {!starved && <ControlsBox />}
      {offerRetry && (
        <button ref={retryRef} type="button" className="retry-button" onClick={onRestart}>
          Try again
        </button>
      )}
      {loading && (
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <div className="loading-text">Growing the forest…</div>
        </div>
      )}
      <div className="hud-left">
        <div className="debug-column">
          {debugOpen && (
            <fieldset className="debug-panel">
              <legend>Debug</legend>
              <div className="debug-readout">Acorns I buried, still buried: {buriedCount}</div>
              <div className="debug-group" role="radiogroup" aria-labelledby="acorn-rate-label">
                <div id="acorn-rate-label" className="debug-group-label">
                  Acorn rate
                </div>
                {ACORN_DROP_MODE_ORDER.map((mode) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name="acorn-drop-mode"
                      value={mode}
                      checked={dropMode === mode}
                      onChange={onDropModeChange}
                    />
                    {mode === 'timeline' ? 'Timeline value' : mode}
                  </label>
                ))}
              </div>
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
                  checked={showRegions}
                  onChange={(event) => {
                    setShowRegions(event.target.checked)
                    event.currentTarget.blur()
                  }}
                />
                Squirrel regions
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
              <button
                type="button"
                className="debug-button"
                onClick={(event) => {
                  killRef.current()
                  event.currentTarget.blur()
                }}
              >
                Kill
              </button>
            </fieldset>
          )}
        </div>
        {debugOpen && <Timeline worldRef={worldRef} overrideRef={rateOverrideRef} pausedRef={timePausedRef} />}
      </div>
      {debugOpen && (
        <div className="hud-right">
          <button type="button" className="restart-button" onClick={onRestart}>
            Restart
          </button>
        </div>
      )}
    </div>
  )
}
