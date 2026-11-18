import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ChevronDown, Circle, Download, Film, FolderUp, Plus, Redo2, Square, Undo2, X } from 'lucide-react'
import { type Asset, durationOf, FRAME, rangeBounds, useEditor } from './store'
import { exportMP4, importFile } from './media'
import { Inspector } from './Inspector'
import { Preview, togglePlayback } from './Preview'
import { Sidebar } from './Sidebar'
import { Timeline } from './Timeline'
import { ToolButton } from './ui'

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
  const recorder = useRef<MediaRecorder | null>(null)
  const exportController = useRef<AbortController | null>(null)
  const [notice, setNotice] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordPending, setRecordPending] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const [fileDrag, setFileDrag] = useState(false)
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
    function shortcuts(event: KeyboardEvent) {
      if (event.defaultPrevented || exporting) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog') || event.isComposing) return
      const state = useEditor.getState()
      const key = event.key.toLowerCase()
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && !event.altKey && ['a', 'x', 'c', 'v', 'd', 'z', 'y'].includes(key)) {
        event.preventDefault()
        if (event.repeat) return
        switch (key) {
          case 'a': state.selectAll(); break
          case 'x': copySelection(true); break
          case 'c': copySelection(); break
          case 'v': state.paste(); break
          case 'd': state.duplicate(); break
          default: if (key === 'y' || event.shiftKey) state.redo(); else state.undo()
        }
        return
      }
      if (modifier || event.altKey) return
      if ((key === 'arrowleft' || key === 'arrowright') && !target?.closest('[role="slider"]')) {
        event.preventDefault()
        state.play(false)
        state.seek(state.currentTime + (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 1 : FRAME))
        return
      }
      if (![' ', 's', 'r', 'backspace', 'delete', 'escape', 'home', 'end'].includes(key) ||
          (key === ' ' && target?.closest('button, summary'))) return
      event.preventDefault()
      if (event.repeat) return
      switch (key) {
        case ' ': togglePlayback(); break
        case 's': state.split(); break
        case 'r': state.toggleRangeMode(); break
        case 'backspace':
        case 'delete': state.remove(event.shiftKey); break
        case 'escape': setMenu(false); state.select(null); if (state.rangeMode) state.toggleRangeMode(); break
        default: state.play(false); state.seek(key === 'home' ? 0 : durationOf(state.clips))
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  }, [exporting])

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
        let first: string | undefined
        for (const asset of imported.filter(item => item.kind === 'video')) {
          const id = state.add(asset, position, 'main')
          first ??= id
          position += asset.duration
        }
        if (first) {
          state.play(false)
          state.seek(dropTime)
          state.select(first)
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
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return }
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
      recorder.current = next
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      next.onstop = async () => {
        recorder.current = null
        stream?.getTracks().forEach(track => track.stop())
        setRecording(false)
        setRecordPending(true)
        try {
          if (!chunks.length) throw new Error('No screen recording was captured.')
          const ext = next.mimeType.includes('mp4') ? 'mp4' : 'webm'
          const file = new File(chunks, `Recording ${new Date().toLocaleTimeString().replaceAll(':', '-') }.${ext}`, { type: next.mimeType })
          const asset: Asset = await importFile(file, Math.max(.1, (performance.now() - start) / 1000))
          const current = useEditor.getState()
          current.addAssets([asset])
          const position = durationOf(current.clips)
          if (current.add(asset, position, 'main')) current.seek(position)
          setNotice('Screen recording added to the media bin.')
        } catch (error) { setNotice((error as Error).message) }
        finally { setRecordPending(false) }
      }
      next.onerror = () => {
        stream?.getTracks().forEach(track => track.stop())
        setRecording(false); setRecordPending(false); recorder.current = null
        setNotice('The browser could not complete the recording.')
      }
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (next.state === 'recording') next.stop() })
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
    useEditor.setState({ title: 'Untitled tutorial', clips: [], assets: [], currentTime: 0, selectedClipId: null, selectedClipIds: [], range: null, rangeMode: false, playing: false,
      tracks: state.tracks.map(t => ({ ...t, locked: false, muted: false, hidden: false, snappingDisabled: false })) })
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
          <span>{recording ? 'Stop recording' : recordPending ? 'Preparing…' : 'Record Screen'}</span>
        </button>
        <button className="header-action" type="button" disabled={exporting || importing} onClick={showImport}><FolderUp size={16} /><span>{importing ? 'Importing…' : 'Import Media'}</span></button>
        <button className="export-button" type="button" title="Export the full project" disabled={exportDisabled} onClick={() => void exportProject()}><Download size={16} /><span>Export MP4</span></button>
      </div>
    </header>
    <main className="workspace">
      <Sidebar importMedia={showImport} disabled={exporting || importing} />
      <Preview exporting={exporting} />
      <Inspector exporting={exporting} />
    </main>
    <Timeline disabled={exporting} copySelection={copySelection} exportDisabled={exportDisabled} exportSelection={() => void exportProject(true)} />
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

