import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { decodeProject, encodeProject, projectSnapshot, sameProject } from './projectFile'
import { writeDesktopFile } from './saveFile'
import { type Project, useEditor } from './store'

export type ProjectFileControls = { save: (as?: boolean) => void; open: () => void; newProject: () => void }
type Pending = { kind: 'new' | 'close' } | { kind: 'open'; file: File }

function filename(title: string) {
  return `${title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 150).replace(/[. ]+$/, '') || 'Untitled'}.revie`
}

export function ProjectFiles({ ref, blocked, onNewProject, notice, onDirty }: {
  ref?: Ref<ProjectFileControls>
  blocked: boolean
  onNewProject: () => void
  notice: (message: string) => void
  onDirty: (dirty: boolean) => void
}) {
  const disk = useRef<FileSystemFileHandle | null>(null)
  const desktopDestination = useRef(false)
  const saved = useRef(projectSnapshot(useEditor.getState()))
  const pending = useRef<Pending | null>(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const prompt = useRef<HTMLDialogElement>(null)

  const isDirty = () => !sameProject(saved.current, useEditor.getState())
  useEffect(() => useEditor.subscribe((state, previous) => {
    if (!sameProject(state, previous)) onDirty(isDirty())
  }), [onDirty])

  function dismiss() {
    pending.current = null
    prompt.current?.close()
  }

  function setSaved(project: Project) {
    saved.current = project
    onDirty(isDirty())
  }

  function replaced() {
    disk.current = null
    desktopDestination.current = false
    setSaved(projectSnapshot(useEditor.getState()))
  }

  async function enter(action: Pending) {
    dismiss()
    if (action.kind === 'close') {
      window.revieDesktop?.closeWindow()
      return
    }
    if (action.kind === 'new') {
      onNewProject()
      replaced()
      return
    }
    if (!('file' in action)) return
    busy.current = true
    try {
      const project = await decodeProject(action.file)
      useEditor.setState({
        ...project, currentTime: 0, playbackStart: 0, selectedClipId: null, selectedClipIds: [],
        range: null, rangeMode: false, playing: false, past: [], future: [], clipboard: null,
      })
      replaced()
      notice('Project opened.')
    } catch (error) {
      notice((error as Error).message)
    } finally { busy.current = false }
  }

  function request(action: Pending) {
    if (busy.current || blocked) {
      notice('Finish the current operation first.')
      return
    }
    if (!isDirty()) { void enter(action); return }
    useEditor.getState().play(false)
    pending.current = action
    setLeaveError('')
    if (!prompt.current?.open) prompt.current?.showModal()
  }

  async function save(saveAs = false) {
    if (busy.current || blocked) return
    const snapshot = projectSnapshot(useEditor.getState())
    const desktop = window.revieDesktop
    const name = filename(snapshot.title)
    let staged = false
    busy.current = true
    setSaving(true)
    try {
      if (desktop) {
        if (!await desktop.beginSave(name, desktopDestination.current && !saveAs)) return
        staged = true
        await writeDesktopFile(desktop, await encodeProject(snapshot))
        await desktop.finishSave(true)
        staged = false
        desktopDestination.current = true
      } else {
        const handle = !saveAs && disk.current ? disk.current : await window.showSaveFilePicker?.({
          suggestedName: name,
          types: [{ description: 'ReViE project', accept: { 'application/octet-stream': ['.revie'] } }],
        })
        if (!handle) throw new Error('Use Chrome, Edge, or the ReViE desktop app to save projects.')
        const blob = await encodeProject(snapshot)
        const stream = await handle.createWritable()
        try {
          await stream.write(blob)
          await stream.close()
        } catch (error) {
          await stream.abort().catch(() => {})
          throw error
        }
        disk.current = handle
      }
      setSaved(snapshot)
      notice('Project saved.')
      const afterSave = pending.current
      if (afterSave && !isDirty()) await enter(afterSave)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        const message = (error as Error).message || 'Could not save the project.'
        if (prompt.current?.open) setLeaveError(message)
        else notice(message)
      }
    } finally {
      if (staged) await desktop?.finishSave(false).catch(() => {})
      busy.current = false
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({
    save: as => void save(as),
    open: () => { if (!busy.current && !blocked) input.current?.click() },
    newProject: () => request({ kind: 'new' }),
  }))

  useEffect(() => {
    if (window.revieDesktop) return window.revieDesktop.onCloseRequest(() => request({ kind: 'close' }))
    const leave = (event: BeforeUnloadEvent) => {
      if (!isDirty() && !busy.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [blocked, notice])

  return <>
    <input ref={input} hidden type="file" accept=".revie" aria-label="Open ReViE project file" onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) request({ kind: 'open', file })
    }} />
    <dialog ref={prompt} className="shortcut-dialog project-prompt" aria-labelledby="unsaved-title"
      onCancel={event => { event.preventDefault(); if (!saving) dismiss() }}>
      <h2 id="unsaved-title">Save your changes?</h2>
      <p>Your project has unsaved changes. Save it to keep your edits and media.</p>
      {leaveError && <p role="alert">{leaveError}</p>}
      <div className="project-prompt-actions">
        <button type="button" className="header-action" disabled={saving} onClick={() => {
          if (!busy.current && pending.current) void enter(pending.current)
        }}>Discard changes</button>
        <button type="button" className="header-action" disabled={saving} onClick={dismiss}>Cancel</button>
        <button type="button" className="export-button" disabled={saving} onClick={() => void save()} autoFocus>{saving ? 'Saving…' : 'Save project'}</button>
      </div>
    </dialog>
  </>
}
