import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ChevronDown, Circle, Download, Film, FolderUp, Plus, Redo2, Square, Undo2, X } from 'lucide-react'
import { type Asset, clamp, durationOf, FRAME, playbackBounds, rangeBounds, timecode, useEditor } from './store'
import { exportMP4, importFile } from './media'
import { Inspector } from './Inspector'
import { Preview, togglePlayback } from './Preview'
import { Sidebar, type SidebarTab } from './Sidebar'
import { Timeline, type TimelineControls } from './Timeline'
import { ToolButton } from './ui'
import { shortcutFor } from './shortcuts'

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = name
  link.href = url
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export function App() {
  const files = useRef<HTMLInputElement>(null)
  const previewCanvas = useRef<HTMLCanvasElement>(null)
  const spaceGesture = useRef({ held: false, dragged: false })
  const timeline = useRef<TimelineControls>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const exportController = useRef<AbortController | null>(null)
  const [notice, setNotice] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordingPaused, setRecordingPaused] = useState(false)
  const [recordPending, setRecordPending] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const [fileDrag, setFileDrag] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('Media')
  const dragDepth = useRef(0)
  const titleChanged = useRef(false)
  const title = useEditor(s => s.title)
  const canUndo = useEditor(s => s.past.length > 0)
  const canRedo = useEditor(s => s.future.length > 0)
  const hasClips = useEditor(s => s.clips.length > 0)
  const exporting = progress !== null
  const exportDisabled = exporting || recording || recordPending || importing || !hasClips

  function copySelection(cut = false) {
    const state = useEditor.getState()
    const range = state.range
    if (!state.copy(cut)) return
    const action = cut ? 'Cut' : 'Copied'
    if (range) {
      const { start, end } = rangeBounds(range)
      setNotice(`${action} ${(end - start).toFixed(2)} seconds. Press Ctrl/Cmd+V to paste.`)
    } else setNotice(`${action} to the editor clipboard. Press Ctrl/Cmd+V to paste.`)
  }

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 5800)
    return () => clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const editingText = (event: KeyboardEvent) => event.isComposing || (event.target instanceof Element &&
      !!event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog'))

    function holdSpace(event: KeyboardEvent) {
      if (shortcutFor(event) !== 'play' || event.defaultPrevented || exporting || editingText(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) spaceGesture.current = { held: true, dragged: false }
    }

    function shortcuts(event: KeyboardEvent) {
      if (event.defaultPrevented || exporting || editingText(event)) return
      const target = event.target instanceof Element ? event.target : null
      const action = shortcutFor(event)
      if (!action || action === 'play') return
      event.preventDefault()
      const repeatable = action.startsWith('frame') && action !== 'frame' ||
        action.startsWith('extend') || ['zoomIn', 'zoomOut', 'heightUp', 'heightDown'].includes(action)
      if (event.repeat && !repeatable) return

      const state = useEditor.getState()
      const duration = durationOf(state.clips)
      const seek = (time: number) => {
        state.play(false)
        state.seek(time)
        timeline.current?.revealPlayhead()
      }
      const extend = (time: number, wholeTimeline = false) => {
        const clip = !wholeTimeline && state.clips.find(item => item.id === state.range?.clipId)
        const focus = clip ? clamp(time, clip.start, clip.start + clip.duration) : time
        state.selectRange({ ...(!wholeTimeline && state.range), anchor: state.range?.anchor ?? state.currentTime, focus })
        timeline.current?.revealPlayhead()
      }
      const boundary = (points: number[], forward: boolean, from = state.currentTime) => {
        const nearby = points.filter(time => forward ? time > from + FRAME / 2 : time < from - FRAME / 2)
        return nearby.length ? (forward ? Math.min(...nearby) : Math.max(...nearby)) : undefined
      }
      const addAnnotation = (kind: 'text' | 'karaoke') => {
        setSidebarTab(kind === 'text' ? 'Annotations' : 'Captions')
        state.play(false)
        const id = state.add(kind)
        if (id) {
          state.seek(useEditor.getState().clips.find(clip => clip.id === id)!.start)
          state.editAnnotation(id)
        }
      }
      switch (action) {
        case 'restart': seek(playbackBounds(state).start); togglePlayback(); break
        case 'return': seek(state.playbackStart); break
        case 'frameBack':
        case 'frameForward': {
          const time = state.currentTime + (action === 'frameBack' ? -FRAME : FRAME)
          if (state.rangeMode && target?.closest('.ruler') && event.key.startsWith('Arrow')) extend(time)
          else seek(time)
          break
        }
        case 'start': seek(0); break
        case 'end': seek(duration); break
        case 'extendStart': extend(0, true); break
        case 'extendEnd': extend(duration, true); break
        case 'extendLeft': extend((state.range?.focus ?? state.currentTime) - FRAME); break
        case 'extendRight': extend((state.range?.focus ?? state.currentTime) + FRAME); break
        case 'extendSecondLeft': extend((state.range?.focus ?? state.currentTime) - 1); break
        case 'extendSecondRight': extend((state.range?.focus ?? state.currentTime) + 1); break
        case 'clipBack':
        case 'clipForward':
        case 'extendClipBack':
        case 'extendClipForward': {
          const extending = action.startsWith('extend')
          const points = state.clips.flatMap(clip => [clip.start, clip.start + clip.duration])
          const time = boundary(points, action.endsWith('Forward'), extending ? state.range?.focus : undefined)
          if (time !== undefined) { if (extending) extend(time, true); else seek(time) }
          break
        }
        case 'before': state.selectMedia(-1); break
        case 'after': state.selectMedia(1); break
        case 'selectAll': state.selectAll(); break
        case 'clear':
          setMenu(false)
          state.select(null)
          if (event.key === 'Escape' && state.rangeMode) state.toggleRangeMode()
          break
        case 'cut': copySelection(true); break
        case 'copy': copySelection(); break
        case 'paste': state.paste(); break
        case 'duplicate': state.duplicate(); break
        case 'delete': state.remove(); break
        case 'ripple': state.remove(true); break
        case 'split': state.split(); break
        case 'splitAll': state.split(true); break
        case 'silence': if (state.silence()) setNotice('Audio silenced in the selection.'); break
        case 'undo': state.undo(); break
        case 'redo': state.redo(); break
        case 'zoomIn': timeline.current?.zoom('in'); break
        case 'zoomOut': timeline.current?.zoom('out'); break
        case 'zoomFit': timeline.current?.zoom('project'); break
        case 'zoomRange': timeline.current?.zoom('range'); break
        case 'zoomMax': timeline.current?.zoom('max'); break
        case 'heightUp': timeline.current?.resizeTracks(8); break
        case 'heightDown': timeline.current?.resizeTracks(-8); break
        case 'snap': state.snap(); break
        case 'addMarker': state.addMarker(); break
        case 'markers': state.toggleMarkers(); break
        case 'markerBack':
        case 'markerForward':
        case 'extendMarkerBack':
        case 'extendMarkerForward': {
          const extending = action.startsWith('extend')
          const points = state.markers.map(marker => marker.time).filter(time => time <= duration)
          const time = boundary(points, action.endsWith('Forward'), extending ? state.range?.focus : undefined)
          if (time !== undefined) { if (extending) extend(time, true); else seek(time) }
          break
        }
        case 'media': setSidebarTab('Media'); break
        case 'annotations': setSidebarTab('Annotations'); break
        case 'effects': setSidebarTab('Effects'); break
        case 'captions': setSidebarTab('Captions'); break
        case 'addText': addAnnotation('text'); break
        case 'addCaption': addAnnotation('karaoke'); break
        case 'range': state.toggleRangeMode(); break
        case 'import': if (!importing) { setSidebarTab('Media'); files.current?.click() } break
        case 'record': if (!recordPending) void recordScreen(); break
        case 'pauseRecord':
          if (recorder.current?.state === 'recording') { recorder.current.pause(); setRecordingPaused(true) }
          else if (recorder.current?.state === 'paused') { recorder.current.resume(); setRecordingPaused(false) }
          else if (!recordPending) void recordScreen()
          break
        case 'stopRecord': if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); break
        case 'new': if (!recording && !recordPending && !importing) newProject(); break
        case 'frame': {
          if (!hasClips) break
          state.play(false)
          previewCanvas.current?.toBlob(blob => { if (blob) saveFile(blob, `Frame-${timecode(state.currentTime).replaceAll(':', '-')}.png`) })
          break
        }
        case 'export': void exportProject(); break
        case 'help': timeline.current?.showShortcuts(); break
      }
    }
    const releaseSpace = (event: KeyboardEvent) => {
      if ((event.code !== 'Space' && event.key !== ' ') || !spaceGesture.current.held) return
      event.preventDefault()
      event.stopPropagation()
      const { dragged } = spaceGesture.current
      spaceGesture.current = { held: false, dragged: false }
      if (!dragged && !exporting) togglePlayback()
    }
    const clearGesture = () => { spaceGesture.current = { held: false, dragged: false } }
    window.addEventListener('keydown', holdSpace, true)
    window.addEventListener('keydown', shortcuts)
    window.addEventListener('keyup', releaseSpace, true)
    window.addEventListener('blur', clearGesture)
    return () => {
      window.removeEventListener('keydown', holdSpace, true)
      window.removeEventListener('keydown', shortcuts)
      window.removeEventListener('keyup', releaseSpace, true)
      window.removeEventListener('blur', clearGesture)
    }
  }, [exporting, exportDisabled, hasClips, importing, recordPending, recording, title])

  async function importMedia(list: FileList | File[], dropTime?: number) {
    if (!list.length || exporting || importing) return
    setImporting(true)
    try {
      const result = await Promise.allSettled(Array.from(list).map(file => importFile(file)))
      const imported = result.flatMap(item => item.status === 'fulfilled' ? [item.value] : [])
      const failed = result.filter(item => item.status === 'rejected').length
      const state = useEditor.getState()
      state.addAssets(imported)
      if (dropTime !== undefined && !state.tracks.find(track => track.id === 'main')?.locked) {
        let position = dropTime
        let first: { id: string; start: number } | undefined
        for (const asset of imported.filter(item => item.kind === 'video')) {
          const id = state.add(asset, position, 'main')
          const clip = useEditor.getState().clips.find(item => item.id === id)
          if (!clip) continue
          first ??= clip
          position = clip.start + clip.duration
        }
        if (first) {
          state.play(false)
          state.seek(first.start)
          state.select(first.id)
        }
      }
      if (failed) setNotice(imported.length ? `Imported ${imported.length}. Could not open ${failed} ${failed === 1 ? 'file' : 'files'}.` : (result[0] as PromiseRejectedResult).reason.message)
      else setNotice(`Imported ${imported.length} ${imported.length === 1 ? 'asset' : 'assets'}.`)
    } finally { setImporting(false) }
  }
  function fileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void importMedia(Array.from(event.target.files))
    event.target.value = ''
  }

  async function recordScreen() {
    if (recorder.current && recorder.current.state !== 'inactive') { recorder.current.stop(); return }
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setNotice('Screen recording requires a supported desktop browser on HTTPS or localhost.')
      return
    }
    setRecordPending(true)
    let stream: MediaStream | undefined
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } }, audio: true })
      const state = useEditor.getState()
      state.play(false)
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find(mime => MediaRecorder.isTypeSupported(mime))
      const next = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      const start = performance.now()
      let pausedAt: number | undefined
      let pausedDuration = 0
      recorder.current = next
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      next.onpause = () => { pausedAt = performance.now() }
      next.onresume = () => {
        if (pausedAt !== undefined) pausedDuration += performance.now() - pausedAt
        pausedAt = undefined
      }
      next.onstop = async () => {
        recorder.current = null
        stream?.getTracks().forEach(track => track.stop())
        setRecording(false)
        setRecordingPaused(false)
        setRecordPending(true)
        try {
          if (!chunks.length) throw new Error('No screen recording was captured.')
          const ext = next.mimeType.includes('mp4') ? 'mp4' : 'webm'
          const file = new File(chunks, `Recording ${new Date().toLocaleTimeString().replaceAll(':', '-') }.${ext}`, { type: next.mimeType })
          const elapsed = (pausedAt ?? performance.now()) - start - pausedDuration
          const asset: Asset = await importFile(file, Math.max(.1, elapsed / 1000))
          const current = useEditor.getState()
          current.addAssets([asset])
          const position = durationOf(current.clips)
          const id = current.add(asset, position, 'main')
          const clip = useEditor.getState().clips.find(item => item.id === id)
          if (clip) current.seek(clip.start)
          setNotice('Screen recording added to the media bin.')
        } catch (error) { setNotice((error as Error).message) }
        finally { setRecordPending(false) }
      }
      next.onerror = () => {
        stream?.getTracks().forEach(track => track.stop())
        setRecording(false); setRecordingPaused(false); setRecordPending(false); recorder.current = null
        setNotice('The browser could not complete the recording.')
      }
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (next.state !== 'inactive') next.stop() })
      next.start(300)
      setRecording(true)
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop())
      if ((error as Error).name !== 'NotAllowedError') setNotice((error as Error).message)
    } finally { setRecordPending(false) }
  }

  async function exportProject(selectionOnly = false) {
    if (exportDisabled || exportController.current) return
    const state = useEditor.getState()
    const bounds = selectionOnly && state.range ? rangeBounds(state.range) : undefined
    if (selectionOnly && (!bounds || bounds.end - bounds.start < FRAME)) return
    const controller = new AbortController()
    exportController.current = controller
    useEditor.getState().play(false)
    setProgress(0)
    try {
      const blob = await exportMP4(value => setProgress(Math.floor(value * 100)), controller.signal, bounds)
      const name = title.trim().replace(/[<>:"/\\|?*]/g, '-') || 'Tutorial'
      const suffix = bounds ? `-${bounds.start.toFixed(2)}-${bounds.end.toFixed(2)}s` : ''
      saveFile(blob, `${name}${suffix}.mp4`)
      setNotice(bounds ? 'Selected range exported.' : 'MP4 export complete.')
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setNotice((error as Error).message)
    } finally { exportController.current = null; setProgress(null) }
  }

  function newProject() {
    const state = useEditor.getState()
    state.checkpoint()
    useEditor.setState({ title: 'Untitled tutorial', clips: [], assets: [], currentTime: 0, playbackStart: 0, markers: [], selectedClipId: null, selectedClipIds: [], range: null, rangeMode: false, playing: false,
      tracks: state.tracks.map(t => ({ ...t, locked: false, muted: false, hidden: false, magnetic: false })) })
    setMenu(false)
  }
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  const showImport = () => files.current?.click()
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setFileDrag(false)
    const target = event.target instanceof Element ? event.target : null
    const lane = target?.closest('[data-lane="main"]')
    const { currentTime, zoomLevel } = useEditor.getState()
    const start = lane ? Math.max(0, (event.clientX - lane.getBoundingClientRect().left) / zoomLevel)
      : target?.closest('[data-preview-drop]') ? currentTime : undefined
    void importMedia(Array.from(event.dataTransfer.files), start)
  }
  return <div className="editor-shell"
    onDragEnter={event => { if (hasFiles(event) && !exporting) { event.preventDefault(); dragDepth.current++; setFileDrag(true) } }}
    onDragOver={event => { if (hasFiles(event)) event.preventDefault() }}
    onDragLeave={event => { if (hasFiles(event) && --dragDepth.current <= 0) { dragDepth.current = 0; setFileDrag(false) } }}
    onDrop={handleDrop}>
    <input className="sr-only" type="file" ref={files} multiple accept=".mp4,.webm,.mp3,.png" onChange={fileChange} tabIndex={-1} />
    <header className="topbar">
      <div className="brand" title="Resulam Video Editor - ReViE"><div className="brand-icon"><Film size={19} strokeWidth={2.2} /></div><strong>ReViE<span>Resulam Video Editor</span></strong></div>
      <div className="header-divider" />
      <div className="project">
        <input aria-label="Project title" value={title} disabled={exporting} spellCheck={false} onFocus={() => { titleChanged.current = false }} onChange={e => {
          const state = useEditor.getState()
          if (!titleChanged.current) { state.checkpoint(); titleChanged.current = true }
          state.titleTo(e.target.value)
        }} />
        <ToolButton label="Project options" disabled={exporting || recording} aria-expanded={menu} onClick={() => setMenu(!menu)}><ChevronDown size={15} /></ToolButton>
        {menu && <div className="project-menu"><button type="button" onClick={newProject}><Plus size={16} /> New project</button></div>}
      </div>
      <div className="history">
        <ToolButton label="Undo (Ctrl+Z)" disabled={!canUndo || exporting} onClick={() => useEditor.getState().undo()}><Undo2 size={17} /></ToolButton>
        <ToolButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo || exporting} onClick={() => useEditor.getState().redo()}><Redo2 size={17} /></ToolButton>
      </div>
      <div className="header-actions">
        <button className={`header-action ${recording ? 'recording' : ''}`} type="button" disabled={exporting || recordPending} onClick={() => void recordScreen()}>
          {recording ? <Square size={14} fill="currentColor" /> : <span className="record-icon"><Circle size={14} /><i /></span>}
          <span>{recording ? (recordingPaused ? 'Stop paused recording' : 'Stop recording') : recordPending ? 'Preparing…' : 'Record Screen'}</span>
        </button>
        <button className="header-action" type="button" disabled={exporting || importing} onClick={showImport}><FolderUp size={16} /><span>{importing ? 'Importing…' : 'Import Media'}</span></button>
        <button className="export-button" type="button" title="Export the full project" disabled={exportDisabled} onClick={() => void exportProject()}><Download size={16} /><span>Export MP4</span></button>
      </div>
    </header>
    <main className="workspace">
      <Sidebar importMedia={showImport} disabled={exporting || importing} tab={sidebarTab} setTab={setSidebarTab} />
      <Preview exporting={exporting} canvas={previewCanvas} spaceGesture={spaceGesture} />
      <Inspector exporting={exporting} />
    </main>
    <Timeline ref={timeline} disabled={exporting} copySelection={copySelection} exportDisabled={exportDisabled} exportSelection={() => void exportProject(true)} />
    {notice && <div className="toast" role="status"><span>{notice}</span><ToolButton label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></ToolButton></div>}
    {fileDrag && <div className="file-drop"><FolderUp size={34} /><strong>Drop files to import media</strong></div>}
    {exporting && <div className="modal-backdrop">
      <div className="export-dialog" role="dialog" aria-modal="true" aria-label="Exporting project">
        <div className="export-dialog-icon"><Download size={21} /></div><h2>Exporting MP4</h2>
        <p>Keep this tab open while ReViE renders your video.</p>
        <progress max={100} value={progress} /><div className="export-dialog-actions"><span>{progress}%</span><button autoFocus type="button" className="header-action" onClick={() => exportController.current?.abort()}>Cancel</button></div>
      </div>
    </div>}
  </div>
}

