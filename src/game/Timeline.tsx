import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from 'react'
import {
  MAX_BASE_DROP_RATE,
  SEASON_SEGMENTS,
  YEAR_SECONDS,
  baseDropRate,
  seasonIndexAt,
  type SeasonClock,
} from './seasons'
import type { World } from './types'

/** Height of the drop-rate graph in CSS pixels. */
const GRAPH_HEIGHT = 56

/**
 * Draws the base acorn drop rate over the whole timeline: a filled curve (with its random wobble), a
 * dashed line at the default rate, and faint lines between the segments.
 *
 * @param canvas - The graph canvas.
 * @param clock - The world's seasonal clock.
 */
function drawGraph(canvas: HTMLCanvasElement, clock: SeasonClock): void {
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  canvas.width = Math.max(1, Math.floor(width * dpr))
  canvas.height = Math.floor(GRAPH_HEIGHT * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx || width <= 0) {
    return
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, GRAPH_HEIGHT)
  const yOf = (rate: number): number => GRAPH_HEIGHT - 3 - (rate / MAX_BASE_DROP_RATE) * (GRAPH_HEIGHT - 8)
  // Lines between the segments.
  ctx.strokeStyle = 'rgba(31, 61, 82, 0.18)'
  ctx.lineWidth = 1
  for (let i = 1; i < SEASON_SEGMENTS.length; i += 1) {
    const x = Math.round((i / SEASON_SEGMENTS.length) * width) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, GRAPH_HEIGHT)
    ctx.stroke()
  }
  // The default rate.
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = 'rgba(31, 61, 82, 0.45)'
  ctx.beginPath()
  ctx.moveTo(0, yOf(1))
  ctx.lineTo(width, yOf(1))
  ctx.stroke()
  ctx.setLineDash([])
  // The rate itself.
  ctx.beginPath()
  ctx.moveTo(0, yOf(0))
  const steps = Math.max(2, Math.floor(width))
  for (let i = 0; i <= steps; i += 1) {
    ctx.lineTo((i / steps) * width, yOf(baseDropRate(clock, (i / steps) * YEAR_SECONDS)))
  }
  ctx.lineTo(width, yOf(0))
  ctx.closePath()
  ctx.fillStyle = 'rgba(214, 122, 28, 0.28)'
  ctx.fill()
  ctx.beginPath()
  for (let i = 0; i <= steps; i += 1) {
    const x = (i / steps) * width
    const y = yOf(baseDropRate(clock, (i / steps) * YEAR_SECONDS))
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.strokeStyle = '#b25f10'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

/**
 * The debug timeline: a graph of the base acorn drop rate, a slider showing (and setting, by dragging)
 * the current time, and below them the season rectangles with the current one outlined. A button pauses and
 * resumes the passing of time (the slider still works while paused); closing the timeline resumes it.
 *
 * @param props.worldRef - The running game's world (replaced on restart).
 * @param props.overrideRef - The debug acorn rate that replaces the timeline's value, or null to use the timeline's.
 * @param props.pausedRef - True while the season clock is held still.
 */
export function Timeline({
  worldRef,
  overrideRef,
  pausedRef,
}: {
  worldRef: MutableRefObject<World | null>
  overrideRef: MutableRefObject<number | null>
  pausedRef: MutableRefObject<boolean>
}) {
  const [paused, setPaused] = useState<boolean>(false)
  const areaRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<HTMLCanvasElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const nowRef = useRef<HTMLSpanElement>(null)
  const rateRef = useRef<HTMLSpanElement>(null)
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([])
  const draggingRef = useRef<boolean>(false)

  useEffect(() => {
    let id = 0
    let lastWorld: World | null = null
    let lastWidth = 0
    let lastIndex = -1
    const tick = (): void => {
      const world = worldRef.current
      const graph = graphRef.current
      if (world && graph) {
        if (world !== lastWorld || graph.clientWidth !== lastWidth) {
          lastWorld = world
          lastWidth = graph.clientWidth
          drawGraph(graph, world.season)
        }
        const fraction = Math.max(0, Math.min(1, world.season.time / YEAR_SECONDS))
        const left = `${fraction * 100}%`
        if (thumbRef.current) {
          thumbRef.current.style.left = left
        }
        if (markerRef.current) {
          markerRef.current.style.left = left
        }
        const index = seasonIndexAt(world.season.time)
        if (index !== lastIndex) {
          lastIndex = index
          segmentRefs.current.forEach((el, i) => el?.classList.toggle('timeline-current', i === index))
        }
        if (rateRef.current) {
          const rate = (overrideRef.current ?? baseDropRate(world.season, world.season.time)).toFixed(2)
          if (rateRef.current.textContent !== rate) {
            rateRef.current.textContent = rate
          }
        }
        if (nowRef.current) {
          const seconds = Math.floor(world.season.time)
          const text = `${SEASON_SEGMENTS[index]?.name ?? ''}  ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
          if (nowRef.current.textContent !== text) {
            nowRef.current.textContent = text
          }
        }
      }
      id = window.requestAnimationFrame(tick)
    }
    id = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(id)
  }, [worldRef, overrideRef])

  // Time never stays held with the button out of sight.
  useEffect(() => {
    const held = pausedRef
    return () => {
      held.current = false
    }
  }, [pausedRef])

  /**
   * Sets the time from a pointer position over the timeline.
   */
  function seek(event: PointerEvent<HTMLDivElement>): void {
    const area = areaRef.current
    const world = worldRef.current
    if (!area || !world) {
      return
    }
    const rect = area.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    world.season.time = fraction * YEAR_SECONDS
  }

  return (
    <div className="timeline" aria-label="Timeline">
      <div className="timeline-title">
        <button
          type="button"
          className="debug-button timeline-pause"
          aria-pressed={paused}
          onClick={(event) => {
            pausedRef.current = !paused
            setPaused(!paused)
            event.currentTarget.blur()
          }}
        >
          {paused ? '\u25B6 Play' : '\u275A\u275A Pause'}
        </button>
        <span>
          Acorn rate <span ref={rateRef} className="timeline-rate" />
        </span>
        <span ref={nowRef} className="timeline-now" />
      </div>
      <div
        ref={areaRef}
        className="timeline-area"
        onPointerDown={(event) => {
          draggingRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          seek(event)
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) {
            seek(event)
          }
        }}
        onPointerUp={(event) => {
          draggingRef.current = false
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        <canvas ref={graphRef} className="timeline-graph" style={{ height: GRAPH_HEIGHT }} />
        <div className="timeline-track">
          <div className="timeline-rail" />
          <div ref={thumbRef} className="timeline-thumb" />
        </div>
        <div className="timeline-segments">
          {SEASON_SEGMENTS.map((segment, index) => (
            <div
              key={segment.name}
              ref={(el) => {
                segmentRefs.current[index] = el
              }}
              className="timeline-segment"
              style={{ background: segment.color, color: segment.text }}
            >
              {segment.name}
            </div>
          ))}
        </div>
        <div ref={markerRef} className="timeline-marker" />
      </div>
    </div>
  )
}
