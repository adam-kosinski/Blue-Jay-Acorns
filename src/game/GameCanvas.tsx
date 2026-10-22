import { useEffect, useRef, type MouseEvent } from 'react'
import { handleAcornActions, updateAcorns, updateAction, updateTreeDrops } from './acorns'
import { cameraForPlayer } from './camera'
import { acornRadiusForPlayer, playerSizeForView } from './constants'
import { updateHunger } from './hunger'
import { createKeyState } from './input'
import { updateNpcs } from './npc'
import { createPlayer, syncPlayerToWorld, updatePlayer } from './player'
import { renderScene, warmUpScene } from './render'
import { groundYAt } from './terrain'
import type { Player, World } from './types'
import { createWorld } from './world'

/**
 * Full-viewport canvas that runs the 2D prototype game loop.
 */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const restartRef = useRef<() => void>(() => {})

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
    let world: World = createWorld(window.innerWidth, window.innerHeight)
    let player: Player = createPlayer(world, playerSizeForView(window.innerHeight))
    let animationId = 0
    let gameOver = false
    let warmUp: Generator<void> | null = warmUpScene(world, player, window.devicePixelRatio || 1)
    let lastTime = performance.now()

    /**
     * Rebuilds world scenery and resets the player to the starting pose.
     */
    function regenerate(): void {
      world = createWorld(window.innerWidth, window.innerHeight)
      player = createPlayer(world, playerSizeForView(window.innerHeight))
      warmUp = warmUpScene(world, player, window.devicePixelRatio || 1)
      gameOver = false
    }

    restartRef.current = regenerate

    /**
     * Matches the backing store to the window and keeps the player in-bounds.
     */
    function resize(): void {
      const dpr = window.devicePixelRatio || 1
      const width = window.innerWidth
      const height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const size = playerSizeForView(height)
      const radius = acornRadiusForPlayer(size)
      for (const acorn of world.acorns) {
        acorn.radius = radius
        if (acorn.state === 'ground') {
          acorn.y = groundYAt(world.terrain, acorn.x) - radius
        } else if (acorn.state === 'buried') {
          acorn.y = groundYAt(world.terrain, acorn.x) + radius * 1.5
        }
      }
      syncPlayerToWorld(player, world, size)
      for (const npc of world.npcs) {
        syncPlayerToWorld(npc.bird, world, size)
      }
    }

    /**
     * Advances simulation and paints the current frame.
     */
    function frame(now: number): void {
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const width = window.innerWidth
      const height = window.innerHeight
      if (warmUp && warmUp.next().done) {
        warmUp = null
      }
      if (!gameOver) {
        updatePlayer(player, keys, dt, world)
        updateAction(player, world, dt)
        handleAcornActions(player, edges, world)
        updateHunger(player, edges, world, dt)
        updateNpcs(world, width, dt)
        updateTreeDrops(world, player.size, dt)
        updateAcorns(world, player.size, dt)
        // Running out of food ends the game.
        gameOver = player.hunger <= 0
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

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" />
      <button type="button" className="restart-button" onClick={onRestart}>
        Restart
      </button>
    </div>
  )
}
