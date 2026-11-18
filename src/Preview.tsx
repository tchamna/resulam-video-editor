import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ChevronDown, Crop, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { canCrop, canvasSizeOf, clamp, durationOf, EMPTY_CROP, timecode, useEditor } from './store'
import { cropRect, enableAudio, frameOf, opacityAt, preloadMedia, renderFrame, stopMedia, visibleClips } from './media'
import { ITEM_TYPE } from './Timeline'
import { pointerGesture, ToolButton } from './ui'

type Handle = 'move' | 'rotate' | 'tl' | 'tr' | 'bl' | 'br'
const corners = [[-1, -1, 'tl'], [1, -1, 'tr'], [-1, 1, 'bl'], [1, 1, 'br']] as const
const cropHandles = [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]] as const
type Frame = ReturnType<typeof frameOf>

function aspectLabel(width: number, height: number) {
  let a = width, b = height
  while (b) [a, b] = [b, a % b]
  return `${width / a}:${height / a}`
}

function world(x: number, y: number, frame: Frame) {
  const cos = Math.cos(frame.angle), sin = Math.sin(frame.angle)
  return { x: frame.x + x * cos - y * sin, y: frame.y + x * sin + y * cos }
}
function local(x: number, y: number, frame: Frame) {
  const dx = x - frame.x, dy = y - frame.y
  const cos = Math.cos(frame.angle), sin = Math.sin(frame.angle)
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
}

export function togglePlayback() {
  const state = useEditor.getState()
  if (!state.playing) enableAudio()
  state.play(!state.playing)
}

export function Preview({ exporting }: { exporting: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const display = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [sizing, setSizing] = useState('Fit')
  const [fit, setFit] = useState(0)
  const [cropClipId, setCropClipId] = useState<string | null>(null)
  const selectedClip = useEditor(s => s.clips.find(clip => clip.id === s.selectedClipId))
  const cropTrack = useEditor(s => s.tracks.find(track => track.id === selectedClip?.track))
  const cropAvailable = !!selectedClip && canCrop(selectedClip.kind) && !cropTrack?.hidden && !cropTrack?.locked
  const cropping = cropAvailable && selectedClip.id === cropClipId
  const time = useEditor(s => timecode(s.currentTime))
  const duration = useEditor(s => durationOf(s.clips))
  const playing = useEditor(s => s.playing)
  const { width: frameWidth, height: frameHeight } = useEditor(canvasSizeOf)

  useEffect(() => {
    const node = stage.current!
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setFit(Math.max(0, Math.min(width, height * frameWidth / frameHeight)))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [frameWidth, frameHeight])

  useEffect(() => { setSizing('Fit') }, [frameWidth, frameHeight])

  useEffect(() => {
    if (exporting) return
    const ctx = canvas.current!.getContext('2d', { alpha: false })!
    const overlay = display.current!.getContext('2d')!
    let raf = 0
    let lastTime = -1
    let previous = useEditor.getState()
    let previousWidth = 0
    let clock = 0
    let at = 0
    preloadMedia()
    const unsubscribe = useEditor.subscribe((next, prior) => {
      if (next.clips !== prior.clips || next.assets !== prior.assets) preloadMedia()
    })
    const step = (now: number) => {
      let state = useEditor.getState()
      if (state.playing) {
        if (!previous.playing || state.currentTime !== previous.currentTime) {
          at = state.currentTime
          clock = now
        }
        const end = durationOf(state.clips)
        const next = Math.min(end, at + (now - clock) / 1000)
        state.seek(next)
        if (next >= end) state.play(false)
        state = useEditor.getState()
      }
      const width = canvas.current!.clientWidth
      const shouldDraw = state.playing || state !== previous || state.currentTime !== lastTime || width !== previousWidth ||
        visibleClips(state.currentTime).some(c => c.kind === 'image' || c.kind === 'video')
      if (shouldDraw) {
        renderFrame(ctx, state.currentTime, state.playing)
        overlay.clearRect(0, 0, frameWidth, frameHeight)
        const selected = visibleClips(state.currentTime).find(c => c.id === state.selectedClipId && (cropping || c.track !== 'main') && c.kind !== 'audio')
        if (selected && !state.playing && !state.tracks.find(t => t.id === selected.track)?.locked) {
          const { x, y, w, h, angle } = frameOf(selected, state.currentTime, ctx.canvas)
          const unit = frameWidth / Math.max(1, width)
          overlay.save()
          overlay.translate(x, y); overlay.rotate(angle)
          overlay.lineWidth = unit * 1.25
          if (cropping) {
            const rect = cropRect(selected, { w, h })
            overlay.strokeStyle = '#89bbff'
            overlay.fillStyle = '#e2edff'
            overlay.strokeRect(rect.x, rect.y, rect.w, rect.h)
            for (const [dx, dy] of cropHandles) {
              const side = 7 * unit
              overlay.fillRect(rect.x + dx * rect.w - side / 2, rect.y + dy * rect.h - side / 2, side, side)
            }
          } else {
            overlay.strokeStyle = '#62e7bc'
            overlay.strokeRect(-w / 2, -h / 2, w, h)
            overlay.beginPath(); overlay.moveTo(0, -h / 2); overlay.lineTo(0, -h / 2 - 18 * unit); overlay.stroke()
            overlay.beginPath(); overlay.arc(0, -h / 2 - 18 * unit, 3.5 * unit, 0, Math.PI * 2)
            overlay.fillStyle = '#172822'; overlay.fill(); overlay.stroke()
            for (const [dx, dy] of corners) {
              const side = 7 * unit
              overlay.fillStyle = '#e2fcf3'
              overlay.fillRect(dx * w / 2 - side / 2, dy * h / 2 - side / 2, side, side)
              overlay.strokeRect(dx * w / 2 - side / 2, dy * h / 2 - side / 2, side, side)
            }
          }
          overlay.restore()
        }
        lastTime = state.currentTime
        previousWidth = width
      }
      previous = state
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); unsubscribe(); stopMedia() }
  }, [exporting, frameWidth, frameHeight, cropping])

  function startGesture(event: PointerEvent<HTMLCanvasElement>) {
    if (exporting || event.button !== 0) return
    const state = useEditor.getState()
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const size = { width: frameWidth, height: frameHeight }
    const convert = (px: number, py: number) => ({ x: (px - bounds.left) / bounds.width * frameWidth, y: (py - bounds.top) / bounds.height * frameHeight })
    const origin = convert(event.clientX, event.clientY)
    if (cropping) {
      const clip = visibleClips(state.currentTime).find(c => c.id === cropClipId)
      if (!clip) return
      const frame = frameOf(clip, state.currentTime, size)
      const rect = cropRect(clip, frame)
      const initial = local(origin.x, origin.y, frame)
      const tolerance = frameWidth / bounds.width * 12
      const horizontal = initial.y >= rect.y - tolerance && initial.y <= rect.y + rect.h + tolerance
      const vertical = initial.x >= rect.x - tolerance && initial.x <= rect.x + rect.w + tolerance
      const left = Math.abs(initial.x - rect.x), right = Math.abs(initial.x - rect.x - rect.w)
      const top = Math.abs(initial.y - rect.y), bottom = Math.abs(initial.y - rect.y - rect.h)
      const side = horizontal && Math.min(left, right) <= tolerance ? (left <= right ? 'left' : 'right') : null
      const edge = vertical && Math.min(top, bottom) <= tolerance ? (top <= bottom ? 'top' : 'bottom') : null
      if (!side && !edge) return
      const original = clip.crop ?? EMPTY_CROP
      let changed = false
      const update = (next: globalThis.PointerEvent) => {
        const position = convert(next.clientX, next.clientY)
        const point = local(position.x, position.y, frame)
        const dx = (point.x - initial.x) / frame.w * 100
        const dy = (point.y - initial.y) / frame.h * 100
        if (!changed) {
          if (Math.abs(dx) + Math.abs(dy) < .2) return
          state.checkpoint()
          changed = true
        }
        const crop = { ...original }
        if (side === 'left') crop.left = clamp(original.left + dx, 0, 98 - original.right)
        if (side === 'right') crop.right = clamp(original.right - dx, 0, 98 - original.left)
        if (edge === 'top') crop.top = clamp(original.top + dy, 0, 98 - original.bottom)
        if (edge === 'bottom') crop.bottom = clamp(original.bottom - dy, 0, 98 - original.top)
        state.change(clip.id, { crop }, false)
      }
      pointerGesture(event, update, next => { if (next.type === 'pointerup') update(next) })
      return
    }
    const clips = visibleClips(state.currentTime).filter(c => c.track !== 'main' && c.kind !== 'audio' && !state.tracks.find(t => t.id === c.track)?.locked)
    const selected = clips.find(c => c.id === state.selectedClipId)
    let clip = selected
    let handle: Handle = 'move'
    const tolerance = frameWidth / bounds.width * 10
    if (selected) {
      const frame = frameOf(selected, state.currentTime, size)
      const sameSpot = (x: number, y: number) => {
        const point = world(x, y, frame)
        return Math.hypot(point.x - origin.x, point.y - origin.y) < tolerance
      }
      if (sameSpot(0, -frame.h / 2 - 18 * frameWidth / bounds.width)) handle = 'rotate'
      else handle = corners.find(([dx, dy]) => sameSpot(dx * frame.w / 2, dy * frame.h / 2))?.[2] ?? 'move'
    }
    if (handle === 'move') {
      clip = [...clips].reverse().find(c => {
        const frame = frameOf(c, state.currentTime, size)
        const { x, y } = local(origin.x, origin.y, frame)
        const rect = cropRect(c, frame)
        return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h && opacityAt(c, state.currentTime) > 0
      })
    }
    state.select(clip?.id ?? null)
    if (!clip) return
    state.play(false)
    const original = clip
    const frame = frameOf(original, state.currentTime, size)
    let changed = false
    pointerGesture(event, next => {
      const position = convert(next.clientX, next.clientY)
      const dx = position.x - origin.x, dy = position.y - origin.y
      if (!changed) {
        if (Math.hypot(dx, dy) < 2) return
        state.checkpoint(); changed = true
      }
      if (handle === 'move') {
        const horizontal = dx / frameWidth * 100, vertical = dy / frameHeight * 100
        state.change(original.id, {
          x: original.x + horizontal, y: original.y + vertical,
          endTransform: original.endTransform && { ...original.endTransform, x: original.endTransform.x + horizontal, y: original.endTransform.y + vertical },
        }, false)
      } else if (handle === 'rotate') {
        const start = Math.atan2(origin.y - frame.y, origin.x - frame.x)
        const end = Math.atan2(position.y - frame.y, position.x - frame.x)
        const degrees = original.rotation + (end - start) * 180 / Math.PI
        state.change(original.id, { rotation: ((degrees % 360) + 540) % 360 - 180 }, false)
      } else {
        const [sx, sy] = corners.find(c => c[2] === handle)!
        const drag = local(position.x, position.y, frame), initial = local(origin.x, origin.y, frame)
        const w = clamp(frame.w + sx * (drag.x - initial.x), 18, frameWidth * 4)
        const h = clamp(frame.h + sy * (drag.y - initial.y), 18, frameHeight * 4)
        const center = world(sx * (w - frame.w) / 2, sy * (h - frame.h) / 2, frame)
        const moveX = (center.x - frame.x) / frameWidth * 100
        const moveY = (center.y - frame.y) / frameHeight * 100
        state.change(original.id, {
          w: original.w * w / frame.w, h: original.h * h / frame.h, x: original.x + moveX, y: original.y + moveY,
          endTransform: original.endTransform && { ...original.endTransform, x: original.endTransform.x + moveX, y: original.endTransform.y + moveY },
        }, false)
      }
    })
  }

  const width = sizing === 'Fit' ? fit : sizing === '50%' ? frameWidth / 2 : frameWidth
  return <section className="preview-panel" aria-label="Preview">
    <div className="panel-heading preview-heading"><h2>Preview</h2>
      <button type="button" className={`timeline-action preview-crop ${cropping ? 'active' : ''}`} disabled={exporting || !cropAvailable} aria-pressed={cropping}
        title="Crop the selected clip by dragging an edge or corner" onClick={() => {
          if (!selectedClip) return
          const state = useEditor.getState()
          state.play(false)
          if (!cropping && !visibleClips(state.currentTime).some(clip => clip.id === selectedClip.id)) state.seek(selectedClip.start)
          setCropClipId(cropping ? null : selectedClip.id)
        }}><Crop size={15} />{cropping ? 'Done cropping' : 'Crop'}</button>
      <span className="preview-format"><span /> {aspectLabel(frameWidth, frameHeight)} <i /> {frameWidth} × {frameHeight}</span></div>
    <div className="preview-stage" data-preview-drop ref={stage} onDragOver={event => {
      if (!exporting && event.dataTransfer.types.includes(ITEM_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
    }} onDrop={event => {
      if (exporting || !event.dataTransfer.types.includes(ITEM_TYPE)) return
      event.preventDefault()
      const state = useEditor.getState()
      const asset = state.assets.find(item => item.id === event.dataTransfer.getData(ITEM_TYPE))
      if (asset?.kind !== 'video' && asset?.kind !== 'demo') return
      state.play(false)
      state.add(asset, state.currentTime, 'main')
    }}>
      <div className="canvas-wrap" style={{ width, height: width * frameHeight / frameWidth }}>
        <canvas ref={canvas} width={frameWidth} height={frameHeight} aria-label="Video preview" />
        <canvas ref={display} width={frameWidth} height={frameHeight} className={`canvas-controls ${cropping ? 'cropping' : ''}`} aria-label={cropping ? 'Canvas crop controls' : 'Canvas overlay controls'} onPointerDown={startGesture}
          onDoubleClick={() => { const state = useEditor.getState(); if (!exporting && state.selectedClipId) state.editAnnotation(state.selectedClipId) }} />
      </div>
    </div>
    <div className="transport">
      <div className="transport-time"><strong>{time}</strong><span>/</span>{timecode(duration)}</div>
      <div className="transport-actions">
        <ToolButton label="Step back one frame" disabled={exporting} onClick={() => { const s = useEditor.getState(); s.play(false); s.seek(s.currentTime - 1 / 60) }}><SkipBack size={16} /></ToolButton>
        <ToolButton label={playing ? 'Pause (Space)' : 'Play (Space)'} className="play-button" disabled={exporting} onClick={togglePlayback}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</ToolButton>
        <ToolButton label="Step forward one frame" disabled={exporting} onClick={() => { const s = useEditor.getState(); s.play(false); s.seek(s.currentTime + 1 / 60) }}><SkipForward size={16} /></ToolButton>
      </div>
      <label className="canvas-zoom"><select aria-label="Canvas zoom" value={sizing} onChange={e => setSizing(e.target.value)}><option>Fit</option><option>50%</option><option>100%</option></select><ChevronDown size={13} /></label>
    </div>
  </section>
}

