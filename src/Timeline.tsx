import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Clapperboard, ClipboardPaste, Copy, Download, Eye, EyeOff, Keyboard, Layers2, Lock, Magnet, Maximize2, Minus, Monitor, Plus, ScanLine, Scissors, Split, Trash2, Type, Unlock, Volume2, VolumeX, X } from 'lucide-react'
import { affectedClips, clamp, type Clip, durationOf, FRAME, isAnnotation, type Kind, MIN_CLIP, rangeBounds, splitTargets, timecode, timed, type TrackId, useEditor } from './store'
import { icons, pointerGesture, ToolButton } from './ui'

const trackIcons = { annotations: Type, overlay: Layers2, main: Monitor }
const MIN_ZOOM = 0.5
const MAX_ZOOM = 256
const MIN_TRACK_HEIGHT = 34
const MAX_TRACK_HEIGHT = 160
const zoomSlider = (scale: number) => Math.log2(scale)
const types = ['text', 'arrow', 'highlight', 'blur']
export const ITEM_TYPE = 'application/x-revie-item'
const validTrack = (kind: Kind, track: TrackId) => isAnnotation(kind) ? track === 'annotations' : track !== 'annotations'
const shortcuts = [
  ['Select part of a clip', 'Drag across the clip'],
  ['Select across tracks', 'Drag the time ruler'],
  ['Select across clips on one track', 'Shift+drag · R'],
  ['Move clip', 'Drag the bottom grip · Alt+drag'],
  ['Select all clips', 'Ctrl/Cmd+A'],
  ['Add or remove a clip from selection', 'Ctrl/Cmd+click'],
  ['Cut / Copy / Paste at playhead', 'Ctrl/Cmd+X / C / V'],
  ['Duplicate selection after its end', 'Ctrl/Cmd+D'],
  ['Undo / Redo', 'Ctrl/Cmd+Z / Shift+Z · Ctrl+Y'],
  ['Delete / Ripple delete', 'Delete / Shift+Delete'],
  ['Split selected clips', 'S'],
  ['Play / Pause', 'Space'],
  ['Step one frame / One second', 'Left/Right · Shift+Left/Right'],
  ['Go to start / End', 'Home / End'],
  ['Clear selection', 'Esc'],
]
function snapTime(time: number, points: number[], pixels: number) {
  let closest = time
  let distance = 8 / pixels
  for (const point of points) {
    if (Math.abs(point - time) < distance) {
      distance = Math.abs(point - time)
      closest = point
    }
  }
  return closest
}

function Playhead({ pixelsPerSecond, onPointerDown }: {
  pixelsPerSecond: number
  onPointerDown?: (event: ReactPointerEvent<HTMLSpanElement>) => void
}) {
  const time = useEditor(s => s.currentTime)
  const left = time * pixelsPerSecond
  if (onPointerDown) return <span className="playhead-marker" style={{ left }} aria-hidden="true" title="Drag to scrub" onPointerDown={onPointerDown} />
  return <div className="needle-area" aria-hidden="true"><div className="playhead" style={{ transform: `translateX(${left}px)` }} /></div>
}

export function Timeline({ disabled, copySelection, exportDisabled, exportSelection }: {
  disabled: boolean
  copySelection: (cut?: boolean) => void
  exportDisabled: boolean
  exportSelection: () => void
}) {
  const tracks = useEditor(s => s.tracks)
  const clips = useEditor(s => s.clips)
  const assets = useEditor(s => s.assets)
  const selected = useEditor(s => s.selectedClipIds)
  const range = useEditor(s => s.range)
  const rangeMode = useEditor(s => s.rangeMode)
  const canCopy = useEditor(s => affectedClips(s, !!s.range).length > 0)
  const editable = useEditor(s => affectedClips(s).length > 0)
  const canSilence = useEditor(s => affectedClips(s).some(clip => timed(clip.kind) && clip.volume > 0))
  const canPaste = useEditor(s => !!s.clipboard && s.clipboard.clips.every(clip => !s.tracks.find(track => track.id === clip.track)?.locked))
  const currentSecond = useEditor(s => Math.floor(s.currentTime))
  const canSplit = useEditor(s => splitTargets(s).length > 0)
  const pps = useEditor(s => s.zoomLevel)
  const snapping = useEditor(s => s.snapping)
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const zoomScroll = useRef<number | null>(null)
  const shortcutDialog = useRef<HTMLDialogElement>(null)
  const [over, setOver] = useState<TrackId | null>(null)
  const [gestureWidth, setGestureWidth] = useState(0)
  const [trackHeights, setTrackHeights] = useState<Partial<Record<TrackId, number>>>({})
  const duration = durationOf(clips)
  const timelineWidth = Math.max(36 * pps, Math.ceil((duration + 3) / 4) * 4 * pps, gestureWidth)
  const tickSeconds = [1, 2, 5, 10, 15, 30, 60, 120, 300].find(step => step * pps >= 66) ?? 300
  const ticks = Array.from({ length: Math.floor(timelineWidth / (pps * tickSeconds)) + 1 }, (_, i) => i * tickSeconds)
  const bounds = range && rangeBounds(range)

  useLayoutEffect(() => {
    if (scroll.current && zoomScroll.current !== null) scroll.current.scrollLeft = zoomScroll.current
    zoomScroll.current = null
  }, [pps])

  useEffect(() => {
    if (!clips.length && scroll.current) scroll.current.scrollLeft = 0
  }, [clips.length])

  useEffect(() => useEditor.subscribe((state, previous) => {
    const scroller = scroll.current
    const row = ruler.current
    if (!scroller || !row || !state.playing || state.currentTime === previous.currentTime) return
    const view = scroller.getBoundingClientRect()
    const timeline = row.getBoundingClientRect()
    const trackWidth = timeline.left - view.left + scroller.scrollLeft
    const playheadX = state.currentTime * state.zoomLevel
    const visibleWidth = scroller.clientWidth - trackWidth
    if (playheadX < scroller.scrollLeft || playheadX > scroller.scrollLeft + visibleWidth - 18) {
      scroller.scrollLeft = Math.max(0, playheadX - visibleWidth * 0.2)
    }
  }), [])

  function changeZoom(scale: number, fit = false) {
    const scroller = scroll.current!
    const headerWidth = content.current!.querySelector('.track-heading')!.getBoundingClientRect().width
    const viewWidth = scroller.clientWidth - headerWidth
    const playhead = useEditor.getState().currentTime
    const playheadX = playhead * pps - scroller.scrollLeft
    const rangeCenter = bounds && (bounds.start + bounds.end) / 2
    const visibleAnchor = rangeCenter !== null ? rangeCenter * pps - scroller.scrollLeft : playheadX
    const offset = fit || visibleAnchor < 0 || visibleAnchor > viewWidth ? viewWidth / 2 : visibleAnchor
    const anchor = fit ? rangeCenter ?? duration / 2 : rangeCenter ?? (scroller.scrollLeft + offset) / pps
    const next = clamp(fit ? (viewWidth - 24) / Math.max(FRAME, bounds ? bounds.end - bounds.start : duration) : scale, MIN_ZOOM, MAX_ZOOM)
    const nextScroll = Math.max(0, anchor * next - offset)
    if (next === pps) scroller.scrollLeft = nextScroll
    else {
      zoomScroll.current = nextScroll
      useEditor.getState().zoom(next)
    }
  }

  function resizeTrack(event: ReactPointerEvent<HTMLElement>, track: TrackId) {
    if (disabled || event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const lane = content.current!.querySelector<HTMLElement>(`[data-lane="${track}"]`)!
    const height = lane.offsetHeight
    const startY = event.clientY
    const resize = (next: PointerEvent) => setTrackHeights(current => ({
      ...current, [track]: clamp(height + startY - next.clientY, MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT),
    }))
    pointerGesture(event, resize, next => { if (next.type === 'pointerup') resize(next) })
  }

  function xToTime(x: number) {
    const lane = ruler.current!.getBoundingClientRect()
    return Math.max(0, (x - lane.left) / pps)
  }
  function rangeGesture(event: ReactPointerEvent<HTMLElement>, track?: TrackId, clip?: Clip, onTap?: () => void, fixedEdge?: 'start' | 'end') {
    event.preventDefault()
    const state = useEditor.getState()
    state.play(false)
    const scroller = scroll.current!
    const points = clip ? [clip.start, clip.start + clip.duration] :
      [0, duration, ...state.clips.filter(item => (!track || item.track === track) &&
        !tracks.find(candidate => candidate.id === item.track)?.snappingDisabled).flatMap(item => [item.start, item.start + item.duration])]
    const snap = (time: number) => state.snapping && !tracks.find(item => item.id === track)?.snappingDisabled ? snapTime(time, points, pps) : time
    const min = clip?.start ?? 0
    const max = clip ? clip.start + clip.duration : duration
    const position = (x: number) => clamp(xToTime(x), min, max)
    const pressX = event.clientX
    const fixed = fixedEdge && bounds ? bounds[fixedEdge] : undefined
    const rawStart = fixed ?? position(pressX)
    const anchor = fixed ?? snap(rawStart)
    const offset = fixedEdge && bounds ? bounds[fixedEdge === 'start' ? 'end' : 'start'] - position(pressX) : 0
    let clientX = pressX
    let animation = 0
    let moved = false
    const updateRange = () => {
      const rawEnd = clamp(xToTime(clientX) + offset, min, max)
      const focus = snap(rawEnd)
      if (fixedEdge) {
        const edge = fixedEdge === 'start' ? Math.max(anchor + FRAME, focus) : Math.min(anchor - FRAME, focus)
        state.selectRange({ anchor, focus: clamp(edge, min, max), track, clipId: clip?.id })
      } else {
        state.selectRange({ ...(focus === anchor ? { anchor: rawStart, focus: rawEnd } : { anchor, focus }), track, clipId: clip?.id })
      }
    }
    const scrollOnEdge = () => {
      const edge = scroller.getBoundingClientRect()
      const left = ruler.current!.getBoundingClientRect().left + scroller.scrollLeft
      const previous = scroller.scrollLeft
      if (clientX > edge.right - 22) scroller.scrollLeft += 12
      else if (clientX < left + 22) scroller.scrollLeft -= 12
      if (previous !== scroller.scrollLeft) updateRange()
      animation = requestAnimationFrame(scrollOnEdge)
    }
    pointerGesture(event, next => {
      clientX = next.clientX
      if (!moved && Math.abs(clientX - pressX) < 3) return
      if (!moved) { moved = true; animation = requestAnimationFrame(scrollOnEdge) }
      updateRange()
    }, next => {
      cancelAnimationFrame(animation)
      if (next.type !== 'pointerup') return
      clientX = next.clientX
      if (moved || Math.abs(clientX - pressX) >= 3) updateRange()
      else if (onTap) onTap()
      else if (!fixedEdge) { state.select(null); state.seek(rawStart) }
    })
  }
  function adjustRange(event: ReactPointerEvent<HTMLButtonElement>, edge: 'start' | 'end') {
    if (disabled || event.button !== 0 || !range) return
    event.stopPropagation()
    rangeGesture(event, range.track, clips.find(clip => clip.id === range.clipId), undefined, edge === 'start' ? 'end' : 'start')
  }
  function scrub(event: ReactPointerEvent<HTMLElement>, track?: TrackId) {
    if (disabled || event.button !== 0) return
    ruler.current?.focus({ preventScroll: true })
    if (event.shiftKey || rangeMode) { rangeGesture(event, track); return }
    const state = useEditor.getState()
    if (state.range) state.select(null)
    state.play(false)
    const seek = (x: number) => state.seek(xToTime(x))
    seek(event.clientX)
    pointerGesture(event, next => seek(next.clientX))
  }
  function clipGesture(event: ReactPointerEvent<HTMLElement>, clip: Clip, handle?: 'left' | 'right' | 'move') {
    if (disabled || event.button !== 0) return
    event.stopPropagation()
    const state = useEditor.getState()
    if (event.ctrlKey || event.metaKey) { state.toggleSelection(clip.id); return }
    if (tracks.find(t => t.id === clip.track)?.locked) { state.select(clip.id); return }
    if (!event.altKey && (event.shiftKey || rangeMode)) {
      ruler.current?.focus({ preventScroll: true })
      rangeGesture(event, clip.track, undefined, () => state.select(clip.id))
      return
    }
    if (!handle && !event.altKey) {
      event.currentTarget.focus({ preventScroll: true })
      rangeGesture(event, clip.track, clip, () => state.select(clip.id))
      return
    }
    const edge = event.altKey || handle === 'move' ? undefined : handle
    state.select(clip.id)
    state.play(false)
    const startX = event.clientX
    const startY = event.clientY
    const startScroll = scroll.current!.scrollLeft
    const other = clips.filter(c => c.id !== clip.id)
    const media = assets.find(a => a.id === clip.assetId)
    const end = clip.start + clip.duration
    const followPlayhead = !edge && state.currentTime >= clip.start && state.currentTime < end
    let changed = false
    let destination = clip.track
    const dragClip = (next: PointerEvent, scrollAtEdge = true) => {
      if (!changed && Math.hypot(next.clientX - startX, next.clientY - startY) < 3) return
      const scroller = scroll.current!
      const viewport = scroller.getBoundingClientRect()
      if (scrollAtEdge && next.clientX > viewport.right - 35) {
        if (scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - 45) setGestureWidth(scroller.scrollWidth + 100)
        scroller.scrollLeft += 14
      } else if (scrollAtEdge && next.clientX < viewport.left + 200) scroller.scrollLeft -= 14
      const delta = (next.clientX - startX + scroller.scrollLeft - startScroll) / pps
      if (!changed) { state.checkpoint(); changed = true }
      const lane = Array.from(content.current!.querySelectorAll<HTMLElement>('[data-lane]')).find(element => {
        const rect = element.getBoundingClientRect()
        return next.clientY >= rect.top && next.clientY < rect.bottom
      })?.dataset.lane as TrackId | undefined
      const track = !edge && Math.abs(next.clientY - startY) >= 16 && lane && validTrack(clip.kind, lane) && !tracks.find(t => t.id === lane)?.locked ? lane : clip.track
      destination = track
      if (!edge) setOver(track === clip.track ? null : track)
      const points = [0, state.currentTime, ...other.filter(c => c.track === track).flatMap(c => [c.start, c.start + c.duration])]
      const snap = (value: number) => snapping && !tracks.find(item => item.id === track)?.snappingDisabled ? snapTime(value, points, pps) : value
      if (edge === 'left') {
        const earliest = media && timed(clip.kind) ? clip.start - clip.offset / clip.speed : 0
        const start = clamp(snap(clip.start + delta), Math.max(0, earliest), end - MIN_CLIP)
        const fadeWindow = clip.fadeWindow && { ...clip.fadeWindow, offset: clip.fadeWindow.offset + start - clip.start }
        state.change(clip.id, { start, duration: end - start, offset: Math.max(0, clip.offset + (start - clip.start) * clip.speed), fadeWindow }, false)
      } else if (edge === 'right') {
        const max = media && timed(clip.kind) ? Math.max(MIN_CLIP, (media.duration - clip.offset) / clip.speed) : Infinity
        state.change(clip.id, { duration: clamp(snap(end + delta) - clip.start, MIN_CLIP, max) }, false)
      } else {
        const proposed = clip.start + delta
        const left = snap(proposed)
        const right = snap(proposed + clip.duration) - clip.duration
        const start = left !== proposed && (Math.abs(left - proposed) <= Math.abs(right - proposed) || Math.abs(right - proposed) < .00001) ? left : right
        const nextStart = Math.max(0, start)
        state.change(clip.id, { start: nextStart }, false)
        if (followPlayhead) state.seek(nextStart + state.currentTime - clip.start)
      }
    }
    pointerGesture(event, dragClip, next => {
      if (next.type === 'pointerup') dragClip(next, false)
      if (changed && !edge && destination !== clip.track) state.change(clip.id, { track: destination }, false)
      setGestureWidth(0)
      setOver(null)
    })
  }

  function drop(event: DragEvent, track: TrackId) {
    if (disabled || tracks.find(t => t.id === track)?.locked) return
    event.preventDefault()
    setOver(null)
    const item = event.dataTransfer.getData(ITEM_TYPE)
    const asset = assets.find(a => a.id === item)
    const kind = asset?.kind ?? (types.includes(item) ? item as Kind : undefined)
    if (!kind || !validTrack(kind, track)) return
    const start = xToTime(event.clientX)
    const state = useEditor.getState()
    const points = [0, state.currentTime, ...clips.filter(c => c.track === track).flatMap(c => [c.start, c.start + c.duration])]
    const position = snapping && !tracks.find(item => item.id === track)?.snappingDisabled ? snapTime(start, points, pps) : start
    state.play(false)
    state.add(asset ?? kind, position, track)
    state.seek(position)
  }

  return <section className={`timeline ${rangeMode ? 'range-mode' : ''}`} aria-label="Timeline">
    <div className="timeline-toolbar">
      <div className="timeline-title"><Clapperboard size={17} /><h2>Timeline</h2></div>
      <div className="timeline-tools">
        <button type="button" className="timeline-action range-toggle" title="Select a time range (R or Shift+drag)" aria-label="Range selection" aria-pressed={rangeMode} disabled={disabled} onClick={() => useEditor.getState().toggleRangeMode()}><ScanLine size={15} /> <span>Select range</span><kbd>R</kbd></button>
        <button type="button" className="timeline-action" aria-label="Cut (Ctrl/Cmd+X)" title="Cut selection (Ctrl/Cmd+X)" disabled={disabled || !editable} onClick={() => copySelection(true)}><Scissors size={15} /><span>Cut</span></button>
        <button type="button" className="timeline-action" aria-label="Copy (Ctrl/Cmd+C)" title="Copy selection (Ctrl/Cmd+C)" disabled={disabled || !canCopy} onClick={() => copySelection()}><Copy size={15} /><span>Copy</span></button>
        <ToolButton label="Paste (Ctrl/Cmd+V)" disabled={disabled || !canPaste} onClick={() => useEditor.getState().paste()}><ClipboardPaste size={15} /></ToolButton>
        <button type="button" className="timeline-action" title="Split at playhead (S)" aria-label="Split at playhead (S)" disabled={disabled || !canSplit} onClick={() => useEditor.getState().split()}><Split size={15} /> <span>Split</span><kbd>S</kbd></button>
        <button type="button" className="timeline-action" title="Delete selection (Delete or Backspace)" aria-label="Delete selection" disabled={disabled || !editable} onClick={() => useEditor.getState().remove()}><Trash2 size={15} /> <span>Delete</span></button>
      </div>
      <div className="timeline-right">
        <button type="button" className={`timeline-action snap ${snapping ? 'on' : ''}`} aria-label="Magnetic snapping" aria-pressed={snapping} onClick={() => useEditor.getState().snap()}><Magnet size={15} /> <span>Snap</span></button>
        <div className="timeline-zoom">
          <ToolButton label="Zoom out timeline" disabled={pps <= MIN_ZOOM} onClick={() => changeZoom(pps / 1.5)}><Minus size={14} /></ToolButton>
          <input type="range" min={zoomSlider(MIN_ZOOM)} max={zoomSlider(MAX_ZOOM)} step="any" value={zoomSlider(pps)} aria-label="Timeline zoom" aria-valuetext={`${Math.round(pps)} pixels per second`} onChange={e => changeZoom(2 ** +e.target.value)} />
          <ToolButton label="Zoom in timeline" disabled={pps >= MAX_ZOOM} onClick={() => changeZoom(pps * 1.5)}><Plus size={14} /></ToolButton>
          <ToolButton label={bounds ? 'Fit selection to timeline' : 'Fit project to timeline'} disabled={!duration} onClick={() => changeZoom(pps, true)}><Maximize2 size={13} /></ToolButton>
        </div>
      </div>
    </div>
    <div className="timeline-scroll" ref={scroll}>
      <div className="timeline-grid" ref={content} style={{ '--length': `${timelineWidth}px`, '--tick': `${pps * tickSeconds / 5}px`,
        gridTemplateRows: `var(--ruler-height) ${tracks.map(track => trackHeights[track.id] ? `${trackHeights[track.id]}px` : 'var(--track-height)').join(' ')}`,
      } as CSSProperties}>
        <div className="track-heading">TRACKS</div>
        <div className="ruler" ref={ruler} aria-label="Time ruler" role="slider" tabIndex={disabled ? -1 : 0} aria-valuemin={0} aria-valuemax={Math.floor(duration)} aria-valuenow={currentSecond} onPointerDown={event => {
          if (disabled || event.button !== 0) return
          ruler.current?.focus({ preventScroll: true })
          rangeGesture(event)
        }} onKeyDown={e => {
          if (disabled || e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
          e.preventDefault()
          const state = useEditor.getState()
          const focus = state.currentTime + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : FRAME)
          if (state.rangeMode || e.shiftKey) state.selectRange({ ...state.range, anchor: state.range?.anchor ?? state.currentTime, focus })
          else { state.play(false); state.seek(focus) }
        }}>
          {bounds && <div className="time-range" aria-hidden="true" style={{ left: bounds.start * pps, width: Math.max(2, (bounds.end - bounds.start) * pps) }} />}
          {ticks.map(tick => <span className="ruler-label" key={tick} style={{ left: tick * pps }}>{timecode(tick).slice(tick < 3600 ? 3 : 0)}</span>)}
          <Playhead pixelsPerSecond={pps} onPointerDown={event => {
            if (disabled || event.button !== 0) return
            event.stopPropagation()
            event.preventDefault()
            ruler.current?.focus({ preventScroll: true })
            const state = useEditor.getState()
            const startX = event.clientX
            const startTime = state.currentTime
            state.play(false)
            const seek = (next: PointerEvent) => state.seek(startTime + (next.clientX - startX) / pps)
            pointerGesture(event, seek, next => { if (next.type === 'pointerup') seek(next) })
          }} />
          {bounds && (['start', 'end'] as const).map(edge => <button key={edge} type="button" className={`range-handle ${edge}`} style={{ left: bounds[edge] * pps }}
            aria-label={`Adjust selection ${edge}`} title={`Drag to adjust selection ${edge}`} disabled={disabled} onPointerDown={event => adjustRange(event, edge)}
            onKeyDown={event => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              event.stopPropagation()
              const clip = clips.find(item => item.id === range?.clipId)
              const delta = (event.shiftKey ? 1 : FRAME) * (event.key === 'ArrowLeft' ? -1 : 1)
              const min = edge === 'start' ? clip?.start ?? 0 : Math.min(duration, bounds.start + FRAME)
              const max = edge === 'end' ? (clip ? clip.start + clip.duration : duration) : Math.max(min, bounds.end - FRAME)
              useEditor.getState().selectRange({ ...range, anchor: bounds[edge === 'start' ? 'end' : 'start'], focus: clamp(bounds[edge] + delta, min, max) })
            }} />)}
        </div>
        {tracks.map((track, index) => {
          const Icon = trackIcons[track.id]
          const trackClips = clips.filter(clip => clip.track === track.id)
          const trackSelected = trackClips.length > 0 && trackClips.length === selected.length && trackClips.every(clip => selected.includes(clip.id))
          return <div className="track-row" key={track.id}>
            <div className={`track-header ${trackSelected ? 'track-selected' : ''}`}>
              <button type="button" className="track-resizer" aria-label={`Resize ${track.name} track`} title="Drag up to expand or down to shrink" disabled={disabled}
                onPointerDown={event => resizeTrack(event, track.id)} onKeyDown={event => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  event.stopPropagation()
                  const lane = content.current!.querySelector<HTMLElement>(`[data-lane="${track.id}"]`)!
                  const delta = event.key === 'ArrowUp' ? 8 : -8
                  setTrackHeights(current => ({ ...current, [track.id]: clamp(lane.offsetHeight + delta, MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT) }))
                }} />
              <button type="button" className="track-select" aria-label={`Select all clips on ${track.name}`} title="Select all clips on this track" aria-pressed={trackSelected}
                disabled={disabled || !trackClips.length} onClick={() => useEditor.getState().selectAll(track.id)}>
                <span className={`track-glyph ${track.id}`}><Icon size={14} /></span>
                <span className="track-info"><span>Track {tracks.length - index}</span><strong>{track.name}</strong></span>
              </button>
              <ToolButton label={`${track.hidden ? 'Show' : 'Hide'} ${track.name}`} disabled={disabled} className={track.hidden ? 'active' : ''} onClick={() => useEditor.getState().toggleTrack(track.id, 'hidden')}>{track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</ToolButton>
              <ToolButton label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`} disabled={disabled} className={track.muted ? 'active' : ''} onClick={() => useEditor.getState().toggleTrack(track.id, 'muted')}>{track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</ToolButton>
              <ToolButton label={`${track.snappingDisabled ? 'Enable' : 'Disable'} snapping on ${track.name}`} aria-pressed={!track.snappingDisabled && snapping} disabled={disabled || !snapping}
                className={!track.snappingDisabled && snapping ? 'track-snap-on' : ''} onClick={() => useEditor.getState().toggleTrack(track.id, 'snappingDisabled')}><Magnet size={13} /></ToolButton>
              <ToolButton label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`} disabled={disabled} className={track.locked ? 'active' : ''} onClick={() => useEditor.getState().toggleTrack(track.id, 'locked')}>{track.locked ? <Lock size={13} /> : <Unlock size={13} />}</ToolButton>
            </div>
            <div data-lane={track.id} className={`track-lane ${over === track.id ? 'drop-over' : ''} ${track.hidden ? 'track-hidden' : ''}`} onPointerDown={event => scrub(event, track.id)}
              onDragOver={e => {
                if (!disabled && !track.locked && e.dataTransfer.types.includes(ITEM_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(track.id) }
              }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }} onDrop={e => drop(e, track.id)}>
              <div className="track-resizer" title="Drag up to expand or down to shrink" onPointerDown={event => resizeTrack(event, track.id)} />
              {trackClips.map(clip => {
                const Icon = icons[clip.kind]
                return <div key={clip.id} className={`timeline-clip ${track.id} ${selected.includes(clip.id) ? 'selected' : ''} ${track.locked ? 'locked' : ''}`}
                  style={{ left: clip.start * pps, width: Math.max(3, clip.duration * pps) }}
                  tabIndex={disabled ? -1 : 0} role="button" aria-pressed={selected.includes(clip.id)} aria-label={`${clip.name}, ${clip.duration.toFixed(2)} seconds`}
                  title={isAnnotation(clip.kind) ? 'Double-click to edit this annotation' : 'Drag across the clip to select time. Drag the bottom grip to move it.'}
                  onKeyDown={event => { if (event.key === 'Enter') {
                    const state = useEditor.getState()
                    if (isAnnotation(clip.kind)) state.editAnnotation(clip.id)
                    else state.select(clip.id)
                  } }}
                  onDoubleClick={() => { if (!disabled && isAnnotation(clip.kind)) useEditor.getState().editAnnotation(clip.id) }}
                  onPointerDown={event => clipGesture(event, clip)}>
                  {!track.locked && <div className="trim-handle left" aria-label="Trim clip start" onPointerDown={e => clipGesture(e, clip, 'left')} />}
                  <div className="clip-details"><Icon size={13} /><span>{clip.name}</span></div>
                  {!track.locked && <div className="trim-handle right" aria-label="Trim clip end" onPointerDown={e => clipGesture(e, clip, 'right')} />}
                  {track.id === 'main' && <div className="clip-pattern" />}
                  {clip.silentRanges?.map(span => {
                    const start = clamp((span.start - clip.offset) / clip.speed, 0, clip.duration)
                    const end = clamp((span.end - clip.offset) / clip.speed, 0, clip.duration)
                    return end > start && <div key={span.start} className="clip-silenced" aria-hidden="true" style={{ left: `${100 * start / clip.duration}%`, width: `${100 * (end - start) / clip.duration}%` }} />
                  })}
                  {!track.locked && <div className="clip-move-grip" title="Drag to move this clip" onPointerDown={e => clipGesture(e, clip, 'move')} />}
                </div>
              })}
              {bounds && !track.locked && (!range?.track || range.track === track.id) && <div className="time-range" aria-hidden="true" style={{ left: bounds.start * pps, width: Math.max(2, (bounds.end - bounds.start) * pps) }} />}
            </div>
          </div>
        })}
        <Playhead pixelsPerSecond={pps} />
      </div>
    </div>
    <div className="timeline-footer">
      <span>{bounds ? `${bounds.start.toFixed(2)}–${bounds.end.toFixed(2)} s · ${range?.clipId ? 'Single clip' : range?.track ? tracks.find(track => track.id === range.track)?.name : 'All unlocked tracks'}`
        : selected.length > 1 ? `${selected.length} clips selected` : `${clips.length} ${clips.length === 1 ? 'clip' : 'clips'} · ${tracks.length} tracks`}</span>
      {bounds ? <div className="range-actions">
        <button type="button" className="export-range" title="Export this time range with all visible layers" disabled={exportDisabled || bounds.end - bounds.start < FRAME} onClick={exportSelection}><Download size={13} /> Export selection</button>
        <button type="button" className="silence-range" title="Silence audio within the selected time range" disabled={disabled || !canSilence} onClick={() => useEditor.getState().silence()}><VolumeX size={13} /> Silence</button>
        <button type="button" className="ripple-range" disabled={disabled || !editable} onClick={() => useEditor.getState().remove(true)}>Remove &amp; close gap</button>
        <ToolButton label="Clear range" disabled={disabled} onClick={() => useEditor.getState().select(null)}><X size={13} /></ToolButton>
      </div> : <span className="timeline-edit-hint">Drag the ruler to select time across tracks · Drag a clip to select within it</span>}
      <button type="button" className="shortcut-help" onClick={() => shortcutDialog.current?.showModal()}><Keyboard size={14} /> Shortcuts</button>
    </div>
    <dialog ref={shortcutDialog} className="shortcut-dialog" aria-labelledby="shortcut-heading">
      <h2 id="shortcut-heading">Keyboard shortcuts</h2>
      <dl>{shortcuts.map(([name, keys]) => <div key={name}><dt>{name}</dt><dd>{keys}</dd></div>)}</dl>
      <p>Drag the ruler to select time across tracks. Click it to move the playhead. Drag across a clip to select part of it, or drag its bottom grip to move it. Paste inserts time on the copied tracks.</p>
      <form method="dialog"><button type="submit" className="header-action" autoFocus>Close</button></form>
    </dialog>
  </section>
}

