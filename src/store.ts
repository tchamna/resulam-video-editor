import { create } from 'zustand'

export type Kind = 'video' | 'audio' | 'image' | 'demo' | 'text' | 'arrow' | 'highlight' | 'blur'
export type TrackId = 'annotations' | 'overlay' | 'main'
export type FrameSize = { width: number; height: number }
export type Asset = { id: string; name: string; kind: Kind; duration: number; url?: string; thumb?: string; frameSize?: FrameSize }
export type Crop = { left: number; top: number; right: number; bottom: number }
export type Clip = {
  id: string; assetId?: string; name: string; kind: Kind; track: TrackId
  start: number; duration: number; offset: number; speed: number
  x: number; y: number; w: number; h: number; scale: number; rotation: number
  opacity: number; volume: number; text: string; color: string; fontSize: number
  bold: boolean; align: 'left' | 'center' | 'right'; blur: number; redact?: boolean; fadeIn: number; fadeOut: number
  fadeWindow?: { offset: number; duration: number }
  crop?: Crop
  silentRanges?: { start: number; end: number }[]
  endTransform?: { x: number; y: number; scale: number }; shape: 'none' | 'circle' | 'rounded'
}
type Track = { id: TrackId; name: string; muted: boolean; locked: boolean; hidden?: boolean; snappingDisabled?: boolean }
type Project = { title: string; assets: Asset[]; clips: Clip[]; tracks: Track[] }
type TimeRange = { anchor: number; focus: number; track?: TrackId; clipId?: string }
type Selection = { selectedClipId: string | null; selectedClipIds: string[]; range: TimeRange | null }
type Snapshot = Project & Selection & { currentTime: number }
type Clipboard = { clips: Clip[]; assets: Asset[]; duration: number }
type Editor = Project & {
  currentTime: number; selectedClipId: string | null; zoomLevel: number; playing: boolean; snapping: boolean
  selectedClipIds: string[]; range: TimeRange | null; clipboard: Clipboard | null; rangeMode: boolean
  annotationEditVersion: number; editAnnotation: (id: string) => void
  past: Snapshot[]; future: Snapshot[]
  checkpoint: () => void; undo: () => void; redo: () => void
  titleTo: (title: string) => void; addAssets: (assets: Asset[]) => void
  select: (id: string | null) => void; seek: (time: number) => void; play: (playing: boolean) => void
  toggleSelection: (id: string) => void; selectAll: (track?: TrackId) => void; selectRange: (range: TimeRange) => void; toggleRangeMode: () => void
  copy: (cut?: boolean) => boolean; paste: () => boolean; duplicate: () => boolean
  zoom: (zoomLevel: number) => void; snap: () => void; toggleTrack: (id: TrackId, key: 'muted' | 'locked' | 'hidden' | 'snappingDisabled') => void
  add: (item: Asset | Kind, start?: number, track?: TrackId) => string | undefined
  change: (id: string, patch: Partial<Clip>, history?: boolean) => void
  split: () => void; remove: (ripple?: boolean) => void; silence: () => boolean
}
export const FRAME = 1 / 60
export const MIN_CLIP = FRAME
const EPSILON = 0.000001
export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x))
export const timed = (kind: Kind) => ['video', 'audio', 'demo'].includes(kind)
export const canCrop = (kind: Kind) => kind === 'video' || kind === 'image' || kind === 'demo'
export const EMPTY_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 }
export const durationOf = (clips: Clip[]) => clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0)
export const DEFAULT_FRAME: FrameSize = { width: 1280, height: 720 }
export function canvasSizeOf({ clips, assets }: Pick<Project, 'clips' | 'assets'>): FrameSize {
  for (const clip of clips) {
    if (clip.track !== 'main' || clip.kind !== 'video') continue
    const size = assets.find(asset => asset.id === clip.assetId)?.frameSize
    if (size) return size
  }
  return DEFAULT_FRAME
}
export const isAnnotation = (kind: Kind) => ['text', 'arrow', 'highlight', 'blur'].includes(kind)
export const names: Partial<Record<Kind, string>> = { text: 'Text Box', arrow: 'Arrow', highlight: 'Highlight Box', blur: 'Blur / Redact' }
export function makeClip(item: Asset | Kind, start: number, track?: TrackId): Clip {
  const asset = typeof item === 'string' ? undefined : item
  const kind = typeof item === 'string' ? item : item.kind
  const lane = track ?? (isAnnotation(kind) ? 'annotations' : kind === 'image' ? 'overlay' : 'main')
  const pip = lane === 'overlay' && !isAnnotation(kind)
  const text = kind === 'text'
  return {
    id: crypto.randomUUID(), assetId: asset?.id, name: asset?.name ?? names[kind] ?? kind, kind, track: lane,
    start, duration: asset?.duration ?? 4, offset: 0, speed: 1,
    x: pip ? 80 : 50, y: pip ? 76 : text ? 80 : 50,
    w: pip ? 29 : text ? 34 : isAnnotation(kind) ? 23 : 100,
    h: pip ? 29 : text ? 12 : isAnnotation(kind) ? 21 : 100,
    scale: 100, rotation: 0, opacity: 100, volume: 100, text: 'Add your text',
    color: kind === 'text' ? '#ffffff' : '#69ecc1', fontSize: 44, bold: true, align: 'center',
    blur: 22, fadeIn: 0, fadeOut: 0, shape: pip ? 'rounded' : 'none',
  }
}
const screen: Asset = { id: 'demo-screen', name: 'Screen recording', kind: 'demo', duration: 32 }
const logo: Asset = { id: 'demo-overlay', name: 'Brand overlay.png', kind: 'image', duration: 17 }
const demoMain = makeClip(screen, 0)
const demoOverlay = { ...makeClip(logo, 7.5), h: 25, w: 24, x: 83, y: 76 }
const demoText = { ...makeClip('text', 2), name: 'Getting started', text: 'Getting started', duration: 6, x: 39, y: 83, w: 30 }
const demoHighlight = { ...makeClip('highlight', 17), duration: 7, x: 64, y: 34, w: 38, h: 33 }
const selection = (ids: string[] = [], range: TimeRange | null = null): Selection => ({ selectedClipIds: ids, selectedClipId: ids.at(-1) ?? null, range })
const snapshot = (s: Editor): Snapshot => ({ title: s.title, assets: s.assets, clips: s.clips, tracks: s.tracks, currentTime: s.currentTime, ...selection(s.selectedClipIds, s.range) })
const keyframeAt = (clip: Clip, ratio: number) => clip.endTransform && ({
  x: clip.x + (clip.endTransform.x - clip.x) * ratio,
  y: clip.y + (clip.endTransform.y - clip.y) * ratio,
  scale: clip.scale + (clip.endTransform.scale - clip.scale) * ratio,
})
const clipEnd = (clip: Clip) => clip.start + clip.duration
export const rangeBounds = (range: TimeRange) => ({ start: Math.min(range.anchor, range.focus), end: Math.max(range.anchor, range.focus) })
const unlocked = (state: Editor, track: TrackId) => !state.tracks.find(item => item.id === track)?.locked
const inRange = (clip: Clip, range: TimeRange) => {
  const { start, end } = rangeBounds(range)
  return end - start > EPSILON && (!range.track || clip.track === range.track) &&
    (!range.clipId || clip.id === range.clipId) && clip.start < end - EPSILON && clipEnd(clip) > start + EPSILON
}
export function affectedClips(state: Editor, editable = true) {
  return state.clips.filter(clip => {
    const selected = state.range ? inRange(clip, state.range) : state.selectedClipIds.includes(clip.id)
    return selected && (!editable || unlocked(state, clip.track))
  })
}
export function splitTargets(state: Editor) {
  return state.clips.filter(clip =>
    unlocked(state, clip.track) &&
    (!state.selectedClipIds.length || state.selectedClipIds.includes(clip.id)) &&
    (!state.range?.track || state.range.track === clip.track) &&
    (!state.range?.clipId || state.range.clipId === clip.id) &&
    state.currentTime - clip.start >= MIN_CLIP - EPSILON && clipEnd(clip) - state.currentTime >= MIN_CLIP - EPSILON)
}
function sliceClip(clip: Clip, start: number, end: number, id = clip.id): Clip {
  const elapsed = start - clip.start
  return {
    ...clip, ...keyframeAt(clip, elapsed / clip.duration), id, start, duration: end - start,
    offset: clip.offset + elapsed * clip.speed, endTransform: keyframeAt(clip, (end - clip.start) / clip.duration),
    fadeWindow: clip.fadeIn || clip.fadeOut ? { offset: (clip.fadeWindow?.offset ?? 0) + elapsed, duration: clip.fadeWindow?.duration ?? clip.duration } : undefined,
  }
}
function clipboardOf(state: Editor, clips: Clip[]): Clipboard {
  const bounds = state.range ? rangeBounds(state.range) : { start: Math.min(...clips.map(clip => clip.start)), end: durationOf(clips) }
  const copies = clips.map(clip => ({
    ...sliceClip(clip, Math.max(clip.start, bounds.start), Math.min(clipEnd(clip), bounds.end)),
    start: Math.max(clip.start, bounds.start) - bounds.start,
  }))
  return { clips: copies, duration: bounds.end - bounds.start, assets: state.assets.filter(asset => clips.some(clip => clip.assetId === asset.id)) }
}
function insertClipboard(state: Editor, clipboard: Clipboard, at: number) {
  const tracks = new Set(clipboard.clips.map(clip => clip.track))
  if ([...tracks].some(track => !unlocked(state, track))) return null
  const clips = state.clips.flatMap(clip => {
    if (!tracks.has(clip.track) || clipEnd(clip) <= at + EPSILON) return [clip]
    if (clip.start >= at - EPSILON) return [{ ...clip, start: clip.start + clipboard.duration }]
    return [sliceClip(clip, clip.start, at), { ...sliceClip(clip, at, clipEnd(clip), crypto.randomUUID()), start: at + clipboard.duration }]
  })
  const pasted = clipboard.clips.map(clip => ({ ...clip, id: crypto.randomUUID(), start: at + clip.start }))
  return { clips: [...clips, ...pasted], assets: [...state.assets, ...clipboard.assets.filter(asset => !state.assets.some(existing => existing.id === asset.id))],
    ...selection(pasted.map(clip => clip.id)), currentTime: at, playing: false }
}
function removeSelection(state: Editor, ripple = false) {
  let range = state.range
  const clips = affectedClips(state)
  if (ripple && !range && clips.length === 1 && state.selectedClipIds.length === 1) {
    const clip = clips[0]
    range = { anchor: clip.start, focus: clipEnd(clip), track: clip.track }
  }
  if (!range) {
    if (!clips.length) return null
    const remaining = state.clips.filter(clip => !clips.includes(clip))
    if (!ripple) return remaining
    const intervals = new Map<TrackId, { start: number; end: number }[]>()
    for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
      const spans = intervals.get(clip.track) ?? []
      const last = spans.at(-1)
      if (last && clip.start <= last.end + EPSILON) last.end = Math.max(last.end, clipEnd(clip))
      else spans.push({ start: clip.start, end: clipEnd(clip) })
      intervals.set(clip.track, spans)
    }
    return remaining.map(clip => {
      const shift = intervals.get(clip.track)?.reduce((total, span) =>
        span.end <= clip.start + EPSILON ? total + span.end - span.start : total, 0) ?? 0
      return shift ? { ...clip, start: Math.max(0, clip.start - shift) } : clip
    })
  }
  const { start, end } = rangeBounds(range)
  if (end - start < EPSILON) return null
  let changed = false
  const result = state.clips.flatMap(clip => {
    if ((range.track && range.track !== clip.track) || !unlocked(state, clip.track) || clipEnd(clip) <= start + EPSILON) return [clip]
    if (clip.start >= end - EPSILON) {
      if (!ripple) return [clip]
      changed = true
      return [{ ...clip, start: Math.max(start, clip.start - (end - start)) }]
    }
    if (range.clipId && clip.id !== range.clipId) return [clip]
    changed = true
    const before = clip.start < start - EPSILON
    const after = clipEnd(clip) > end + EPSILON
    const parts = before ? [sliceClip(clip, clip.start, start)] : []
    if (after) parts.push({ ...sliceClip(clip, end, clipEnd(clip), before ? crypto.randomUUID() : clip.id), start: ripple ? start : end })
    return parts
  })
  return changed ? result : null
}
export const useEditor = create<Editor>((set, get) => ({
  title: 'Untitled tutorial', assets: [screen, logo], clips: [demoMain, demoOverlay, demoText, demoHighlight],
  tracks: [
    { id: 'annotations', name: 'Annotations', muted: false, locked: false },
    { id: 'overlay', name: 'Webcam / Overlay', muted: false, locked: false },
    { id: 'main', name: 'Screen / Main', muted: false, locked: false },
  ],
  currentTime: 0, ...selection([demoMain.id]), zoomLevel: 36, playing: false, snapping: true,
  past: [], future: [], clipboard: null, rangeMode: false, annotationEditVersion: 0,
  editAnnotation: id => set(s => {
    const clip = s.clips.find(item => item.id === id)
    if (!clip || !isAnnotation(clip.kind) || !unlocked(s, clip.track)) return s
    const time = s.currentTime >= clip.start && s.currentTime < clipEnd(clip) ? s.currentTime : clip.start + clip.duration / 2
    return { ...selection([id]), currentTime: time, playing: false, annotationEditVersion: s.annotationEditVersion + 1 }
  }),
  checkpoint: () => set(s => ({ past: [...s.past.slice(-49), snapshot(s)], future: [] })),
  undo: () => set(s => {
    const previous = s.past.at(-1)
    return previous ? { ...previous, past: s.past.slice(0, -1), future: [snapshot(s), ...s.future], playing: false } : s
  }),
  redo: () => set(s => {
    const next = s.future[0]
    return next ? { ...next, past: [...s.past, snapshot(s)], future: s.future.slice(1), playing: false } : s
  }),
  titleTo: title => set({ title }),
  addAssets: assets => { if (assets.length) { get().checkpoint(); set(s => ({ assets: [...s.assets, ...assets] })) } },
  select: id => set(selection(id ? [id] : [])),
  toggleSelection: id => set(s => selection(s.selectedClipIds.includes(id) ? s.selectedClipIds.filter(item => item !== id) : [...s.selectedClipIds, id])),
  selectAll: track => set(s => selection(s.clips.filter(clip => !track || clip.track === track).map(clip => clip.id))),
  selectRange: range => set(s => {
    const duration = durationOf(s.clips)
    const focus = clamp(range.focus, 0, duration)
    const anchor = clamp(range.anchor, 0, duration)
    return { ...selection([], { ...range, anchor, focus }), currentTime: focus, playing: false }
  }),
  toggleRangeMode: () => set(s => ({ rangeMode: !s.rangeMode })),
  copy: (cut = false) => {
    const state = get()
    const selected = affectedClips(state, cut || !!state.range)
    if (!selected.length) return false
    const clipboard = clipboardOf(state, selected)
    if (!cut) { set({ clipboard }); return true }
    const clips = removeSelection(state, true)
    if (!clips) return false
    state.checkpoint()
    const start = state.range ? rangeBounds(state.range).start : Math.min(...selected.map(clip => clip.start))
    set({ clipboard, clips, ...selection(), playing: false, currentTime: Math.min(start, durationOf(clips)) })
    return true
  },
  paste: () => {
    const state = get()
    if (!state.clipboard) return false
    const result = insertClipboard(state, state.clipboard, state.range ? rangeBounds(state.range).start : state.currentTime)
    if (!result) return false
    state.checkpoint()
    set(result)
    return true
  },
  duplicate: () => {
    const state = get()
    const clips = affectedClips(state)
    if (!clips.length) return false
    const clipboard = clipboardOf(state, clips)
    const result = insertClipboard(state, clipboard, state.range ? rangeBounds(state.range).end : durationOf(clips))
    if (!result) return false
    state.checkpoint()
    set(result)
    return true
  },
  seek: currentTime => set(s => ({ currentTime: clamp(currentTime, 0, durationOf(s.clips)) })),
  play: playing => set(s => {
    const duration = durationOf(s.clips)
    return { playing: playing && duration > 0, currentTime: playing && s.currentTime >= duration ? 0 : s.currentTime }
  }),
  zoom: zoomLevel => set({ zoomLevel }),
  snap: () => set(s => ({ snapping: !s.snapping })),
  toggleTrack: (id, key) => {
    get().checkpoint()
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, [key]: !t[key] } : t) }))
  },
  add: (item, start = get().currentTime, track) => {
    const clip = makeClip(item, Math.max(0, start), track)
    if (get().tracks.find(t => t.id === clip.track)?.locked) return
    get().checkpoint()
    set(s => ({ clips: [...s.clips, clip], ...selection([clip.id]) }))
    return clip.id
  },
  change: (id, patch, history = true) => {
    const state = get()
    const clip = state.clips.find(c => c.id === id)
    if (!clip || state.tracks.some(t => t.locked && (t.id === clip.track || t.id === patch.track))) return
    if (history) state.checkpoint()
    set(s => {
      const clips = s.clips.map(c => c.id === id ? {
        ...c, ...(patch.fadeIn !== undefined || patch.fadeOut !== undefined ? { fadeWindow: undefined } : {}), ...patch,
      } : c)
      return { clips, currentTime: Math.min(s.currentTime, durationOf(clips)) }
    })
  },
  split: () => {
    const state = get()
    const targets = splitTargets(state)
    if (!targets.length) return
    const rightIds: string[] = []
    const clips = state.clips.flatMap(clip => {
      if (!targets.includes(clip)) return [clip]
      const right = sliceClip(clip, state.currentTime, clipEnd(clip), crypto.randomUUID())
      rightIds.push(right.id)
      return [sliceClip(clip, clip.start, state.currentTime), right]
    })
    state.checkpoint()
    set({ clips, ...selection(rightIds), playing: false, rangeMode: false })
  },
  remove: (ripple = false) => {
    const state = get()
    const clips = removeSelection(state, ripple)
    if (!clips) return
    state.checkpoint()
    const start = state.range ? rangeBounds(state.range).start : state.currentTime
    set({ clips, ...selection(), playing: false, currentTime: Math.min(start, durationOf(clips)) })
  },
  silence: () => {
    const state = get()
    const targets = affectedClips(state).filter(clip => timed(clip.kind) && clip.volume > 0)
    if (!targets.length) return false
    const bounds = state.range && rangeBounds(state.range)
    const clips = state.clips.map(clip => {
      if (!targets.includes(clip)) return clip
      const start = clip.offset + (Math.max(clip.start, bounds?.start ?? clip.start) - clip.start) * clip.speed
      const end = clip.offset + (Math.min(clipEnd(clip), bounds?.end ?? clipEnd(clip)) - clip.start) * clip.speed
      if (clip.silentRanges?.some(span => span.start <= start + EPSILON && span.end >= end - EPSILON)) return clip
      const silentRanges: NonNullable<Clip['silentRanges']> = []
      for (const span of [...(clip.silentRanges ?? []), { start, end }].sort((a, b) => a.start - b.start)) {
        const last = silentRanges.at(-1)
        if (last && span.start <= last.end + EPSILON) last.end = Math.max(last.end, span.end)
        else silentRanges.push({ ...span })
      }
      return { ...clip, silentRanges }
    })
    if (clips.every((clip, index) => clip === state.clips[index])) return false
    state.checkpoint()
    set({ clips, playing: false })
    return true
  },
}))

export function timecode(seconds: number) {
  const whole = Math.floor(seconds + 0.00001)
  return [Math.floor(whole / 3600), Math.floor(whole % 3600 / 60), whole % 60].map(n => String(n).padStart(2, '0')).join(':')
}

