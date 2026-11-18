import { create } from 'zustand'
import { fitLyricEnds, splitLyrics, type CaptionLanguage, type Karaoke } from './karaoke.ts'

export type Kind = 'video' | 'audio' | 'image' | 'demo' | 'text' | 'arrow' | 'highlight' | 'blur' | 'karaoke'
export type TrackId = 'annotations' | 'overlay' | 'main' | 'audio'
export type FrameSize = { width: number; height: number }
export type Asset = { id: string; name: string; kind: Kind; duration: number; url?: string; file?: Blob; thumb?: string; frameSize?: FrameSize }
export type Crop = { left: number; top: number; right: number; bottom: number }
export type Clip = {
  id: string; assetId?: string; name: string; kind: Kind; track: TrackId
  start: number; duration: number; offset: number; speed: number
  x: number; y: number; w: number; h: number; scale: number; rotation: number
  opacity: number; volume: number; text: string; color: string; fontSize: number
  bold: boolean; align: 'left' | 'center' | 'right'; blur: number; redact?: boolean; fadeIn: number; fadeOut: number
  fadeWindow?: { offset: number; duration: number }
  crop?: Crop
  karaoke?: Karaoke
  fixedCaptionLength?: boolean
  silentRanges?: { start: number; end: number }[]
  endTransform?: { x: number; y: number; scale: number }; shape: 'none' | 'circle' | 'rounded'
}
type Track = { id: TrackId; name: string; muted: boolean; locked: boolean; hidden?: boolean; magnetic?: boolean }
export const audioTrack: Track = { id: 'audio', name: 'Audio', muted: false, locked: false }
type Marker = { id: string; time: number; name: string }
export type Project = { title: string; assets: Asset[]; clips: Clip[]; tracks: Track[]; markers: Marker[] }
type TimeRange = { anchor: number; focus: number; track?: TrackId; clipId?: string }
type Selection = { selectedClipId: string | null; selectedClipIds: string[]; range: TimeRange | null }
type Snapshot = Project & Selection & { currentTime: number }
type Clipboard = { clips: Clip[]; assets: Asset[]; duration: number }
type Editor = Project & {
  currentTime: number; selectedClipId: string | null; zoomLevel: number; playing: boolean; snapping: boolean
  playbackStart: number; markersVisible: boolean
  selectedClipIds: string[]; range: TimeRange | null; clipboard: Clipboard | null; rangeMode: boolean
  annotationEditVersion: number; annotationEditLanguage?: CaptionLanguage
  editAnnotation: (id: string, at?: number, language?: CaptionLanguage) => void
  past: Snapshot[]; future: Snapshot[]
  checkpoint: () => void; undo: () => void; redo: () => void
  titleTo: (title: string) => void; addAssets: (assets: Asset[]) => void
  select: (id: string | null) => void; seek: (time: number) => void; play: (playing: boolean) => void
  advancePlayback: (time: number) => void
  toggleSelection: (id: string) => void; selectAll: (track?: TrackId) => void; selectRange: (range: TimeRange) => void; toggleRangeMode: () => void
  copy: (cut?: boolean) => boolean; paste: () => boolean; duplicate: () => boolean
  zoom: (zoomLevel: number) => void; snap: () => void; toggleTrack: (id: TrackId, key: 'muted' | 'locked' | 'hidden' | 'magnetic') => void
  add: (item: Asset | Kind, start?: number, track?: TrackId) => string | undefined
  addCaption: () => void
  change: (id: string, patch: Partial<Clip>, history?: boolean) => void
  settleClip: (id: string, destination?: TrackId) => void
  split: (allTracks?: boolean) => void; remove: (ripple?: boolean) => void; silence: () => boolean
  addMarker: () => void; changeMarker: (id: string, name: string | null) => void; toggleMarkers: () => void
  selectMedia: (direction: -1 | 1) => void
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
  for (const clip of clipsOnTrack(clips, 'main')) {
    if (clip.kind !== 'video') continue
    const size = assets.find(asset => asset.id === clip.assetId)?.frameSize
    if (size) return size
  }
  return DEFAULT_FRAME
}
export const isAnnotation = (kind: Kind) => ['text', 'arrow', 'highlight', 'blur', 'karaoke'].includes(kind)
export const names: Partial<Record<Kind, string>> = { text: 'Text Box', arrow: 'Arrow', highlight: 'Highlight Box', blur: 'Blur / Redact', karaoke: 'Karaoke captions' }
export function makeClip(item: Asset | Kind, start: number, track?: TrackId): Clip {
  const asset = typeof item === 'string' ? undefined : item
  const kind = typeof item === 'string' ? item : item.kind
  const lane = track ?? (isAnnotation(kind) ? 'annotations' : kind === 'image' ? 'overlay' : kind === 'audio' ? 'audio' : 'main')
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
const snapshot = (s: Editor): Snapshot => ({ title: s.title, assets: s.assets, clips: s.clips, tracks: s.tracks, markers: s.markers, currentTime: s.currentTime, ...selection(s.selectedClipIds, s.range) })
const keyframeAt = (clip: Clip, ratio: number) => clip.endTransform && ({
  x: clip.x + (clip.endTransform.x - clip.x) * ratio,
  y: clip.y + (clip.endTransform.y - clip.y) * ratio,
  scale: clip.scale + (clip.endTransform.scale - clip.scale) * ratio,
})
const clipEnd = (clip: Clip) => clip.start + clip.duration
export const nextCaptionStart = (clips: Clip[], clip: Clip) => clips.reduce((next, item) =>
  item.id !== clip.id && item.kind === 'karaoke' && item.track === clip.track && item.start > clip.start
    ? Math.min(next, item.start) : next, Infinity)
export const rangeBounds = (range: TimeRange) => ({ start: Math.min(range.anchor, range.focus), end: Math.max(range.anchor, range.focus) })
export function playbackBounds({ range, clips }: Pick<Editor, 'range' | 'clips'>) {
  const duration = durationOf(clips)
  if (range) {
    const bounds = rangeBounds(range)
    const start = Math.min(bounds.start, duration)
    const end = Math.min(bounds.end, duration)
    if (end - start > EPSILON) return { start, end }
  }
  return { start: 0, end: duration }
}
const unlocked = (state: Editor, track: TrackId) => !state.tracks.find(item => item.id === track)?.locked
const magnetic = (state: Editor, id: TrackId) => state.tracks.some(track => track.id === id && track.magnetic && !track.locked)
export const clipsOnTrack = (clips: Clip[], track: TrackId) => clips.filter(clip => clip.track === track).sort((a, b) => a.start - b.start)

function packTrack(clips: Clip[], ordered: Clip[]) {
  const byId = new Map<string, Clip>()
  let start = 0
  for (const clip of ordered) {
    byId.set(clip.id, clip.start === start ? clip : { ...clip, start })
    start += clip.duration
  }
  return clips.map(clip => byId.get(clip.id) ?? clip)
}

function insertMagnetically(clips: Clip[], additions: Clip[], track: TrackId, time: number) {
  const ids = new Set(additions.map(clip => clip.id))
  const ordered = clipsOnTrack(clips, track).filter(clip => !ids.has(clip.id))
  const index = ordered.findIndex(clip => time < clip.start + clip.duration / 2)
  ordered.splice(index < 0 ? ordered.length : index, 0, ...additions)
  return packTrack(clips, ordered)
}

function compactMagneticTracks(state: Editor, clips: Clip[]) {
  for (const track of state.tracks) {
    if (magnetic(state, track.id)) clips = packTrack(clips, clipsOnTrack(clips, track.id))
  }
  return clips
}
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
export function splitTargets(state: Editor, allTracks = false) {
  return state.clips.filter(clip =>
    unlocked(state, clip.track) &&
    (allTracks || ((!state.selectedClipIds.length || state.selectedClipIds.includes(clip.id)) &&
      (!state.range?.track || state.range.track === clip.track) &&
      (!state.range?.clipId || state.range.clipId === clip.id))) &&
    state.currentTime - clip.start >= MIN_CLIP - EPSILON && clipEnd(clip) - state.currentTime >= MIN_CLIP - EPSILON)
}
function sliceClip(clip: Clip, start: number, end: number, id = clip.id): Clip {
  const elapsed = start - clip.start
  return {
    ...clip, ...keyframeAt(clip, elapsed / clip.duration), id, start, duration: end - start,
    ...(clip.kind === 'karaoke' && (start > clip.start + EPSILON || end < clipEnd(clip) - EPSILON) ? { fixedCaptionLength: true } : {}),
    offset: clip.offset + elapsed * clip.speed, endTransform: keyframeAt(clip, (end - clip.start) / clip.duration),
    fadeWindow: clip.fadeIn || clip.fadeOut ? { offset: (clip.fadeWindow?.offset ?? 0) + elapsed, duration: clip.fadeWindow?.duration ?? clip.duration } : undefined,
  }
}
function splitClip(clip: Clip, at: number): [Clip, Clip] {
  const left = sliceClip(clip, clip.start, at)
  const right = sliceClip(clip, at, clipEnd(clip), crypto.randomUUID())
  if (clip.karaoke) [left.karaoke, right.karaoke] = splitLyrics(clip.karaoke, right.offset)
  return [left, right]
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
  const existing = state.clips.flatMap(clip => {
    if (!tracks.has(clip.track) || magnetic(state, clip.track) || clipEnd(clip) <= at + EPSILON) return [clip]
    if (clip.start >= at - EPSILON) return [{ ...clip, start: clip.start + clipboard.duration }]
    return [sliceClip(clip, clip.start, at), { ...sliceClip(clip, at, clipEnd(clip), crypto.randomUUID()), start: at + clipboard.duration }]
  })
  const pasted: Clip[] = clipboard.clips.map(clip => ({ ...clip, id: crypto.randomUUID(), start: at + clip.start }))
  let clips = [...existing, ...pasted]
  for (const track of tracks) {
    if (magnetic(state, track)) clips = insertMagnetically(clips, clipsOnTrack(pasted, track), track, at)
  }
  const insertedIds = new Set(pasted.map(clip => clip.id))
  const currentTime = Math.min(...clips.filter(clip => insertedIds.has(clip.id)).map(clip => clip.start))
  return { clips, assets: [...state.assets, ...clipboard.assets.filter(asset => !state.assets.some(existing => existing.id === asset.id))],
    ...selection([...insertedIds]), currentTime: [...tracks].some(track => magnetic(state, track)) ? currentTime : at, playing: false }
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
    audioTrack,
  ],
  currentTime: 0, ...selection([demoMain.id]), zoomLevel: 36, playing: false, snapping: true,
  playbackStart: 0, markers: [], markersVisible: true,
  past: [], future: [], clipboard: null, rangeMode: false, annotationEditVersion: 0,
  editAnnotation: (id, at, language) => set(s => {
    const clip = s.clips.find(item => item.id === id)
    if (!clip || !isAnnotation(clip.kind) || !unlocked(s, clip.track)) return s
    const target = at ?? s.currentTime
    const time = target >= clip.start && target < clipEnd(clip) ? target : clip.start + clip.duration / 2
    return { ...selection([id]), currentTime: time, playing: false, annotationEditVersion: s.annotationEditVersion + 1, annotationEditLanguage: language }
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
    const remaining = removeSelection(state, true)
    if (!remaining) return false
    const clips = compactMagneticTracks(state, remaining)
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
    if (!playing) return { playing: false }
    const { start, end } = playbackBounds(s)
    const currentTime = s.currentTime < start || s.currentTime >= end - EPSILON ? start : s.currentTime
    return { playing: end > start, currentTime, playbackStart: currentTime }
  }),
  advancePlayback: time => set(s => {
    if (!s.playing) return s
    const { start, end } = playbackBounds(s)
    return { currentTime: clamp(time, start, end), playing: time < end }
  }),
  zoom: zoomLevel => set({ zoomLevel }),
  snap: () => set(s => ({ snapping: !s.snapping })),
  toggleTrack: (id, key) => {
    const state = get()
    const track = state.tracks.find(item => item.id === id)
    if (!track || (key === 'magnetic' && track.locked)) return
    state.checkpoint()
    const clips = key === 'magnetic' && !track.magnetic ? packTrack(state.clips, clipsOnTrack(state.clips, id)) : state.clips
    set({ clips, currentTime: Math.min(state.currentTime, durationOf(clips)),
      tracks: state.tracks.map(item => item.id === id ? { ...item, [key]: !item[key] } : item) })
  },
  add: (item, start = get().currentTime, track) => {
    let clip = makeClip(item, Math.max(0, start), track)
    const state = get()
    if (!unlocked(state, clip.track)) return
    if (clip.kind === 'karaoke' && !magnetic(state, clip.track)) {
      const captions = state.clips.filter(item => item.kind === 'karaoke' && item.track === clip.track)
      const occupied = captions.find(item => item.start <= clip.start + EPSILON && clipEnd(item) > clip.start + EPSILON)
      if (occupied) {
        if (clip.start - occupied.start < MIN_CLIP || clipEnd(occupied) - clip.start < MIN_CLIP) {
          state.editAnnotation(occupied.id)
          return occupied.id
        }
        const [left, right] = splitClip(occupied, clip.start)
        state.checkpoint()
        set({ clips: state.clips.flatMap(item => item === occupied ? [left, right] : [item]) })
        get().editAnnotation(right.id)
        return right.id
      }
      const next = nextCaptionStart(captions, clip)
      const duration = Math.min(clip.duration, next - clip.start)
      if (duration < MIN_CLIP) return undefined
      clip = { ...clip, duration, ...(duration < clip.duration ? { fixedCaptionLength: true } : {}) }
    }
    state.checkpoint()
    const appended = [...state.clips, clip]
    const clips = magnetic(state, clip.track) ? insertMagnetically(appended, [clip], clip.track, clip.start) : appended
    set({ clips, ...selection([clip.id]) })
    return clip.id
  },
  addCaption: () => {
    const state = get()
    if (!unlocked(state, 'annotations')) return
    const bounds = state.range && rangeBounds(state.range)
    if (!bounds || bounds.end - bounds.start < MIN_CLIP || magnetic(state, 'annotations')) {
      const id = state.add('karaoke')
      if (id) get().editAnnotation(id)
      return
    }
    const clip = { ...makeClip('karaoke', bounds.start), duration: bounds.end - bounds.start, fixedCaptionLength: true }
    const clips = state.clips.flatMap(item => {
      if (item.kind !== 'karaoke' || item.track !== clip.track || clipEnd(item) <= bounds.start || item.start >= bounds.end) return [item]
      return [
        ...(bounds.start - item.start >= MIN_CLIP ? [sliceClip(item, item.start, bounds.start)] : []),
        ...(clipEnd(item) - bounds.end >= MIN_CLIP ? [sliceClip(item, bounds.end, clipEnd(item), crypto.randomUUID())] : []),
      ]
    })
    state.checkpoint()
    set({ clips: [...clips, clip], currentTime: clip.start, rangeMode: false })
    get().editAnnotation(clip.id)
  },
  change: (id, patch, history = true) => {
    const state = get()
    const clip = state.clips.find(c => c.id === id)
    if (!clip || state.tracks.some(t => t.locked && (t.id === clip.track || t.id === patch.track))) return
    if (clip.kind === 'karaoke' && patch.duration !== undefined && patch.karaoke === undefined && patch.duration !== clip.duration) {
      const end = (patch.offset ?? clip.offset) + patch.duration * (patch.speed ?? clip.speed)
      patch = { ...patch, fixedCaptionLength: true, ...(clip.karaoke && { karaoke: fitLyricEnds(clip.karaoke, end) }) }
    }
    if (history) state.checkpoint()
    set(s => {
      let clips = s.clips.map(c => c.id === id ? {
        ...c, ...(patch.fadeIn !== undefined || patch.fadeOut !== undefined ? { fadeWindow: undefined } : {}), ...patch,
      } : c)
      if (history && (patch.start !== undefined || patch.duration !== undefined || patch.track !== undefined)) {
        const updated = clips.find(item => item.id === id)!
        if ((patch.start !== undefined || patch.track !== undefined) && magnetic(s, updated.track)) {
          clips = insertMagnetically(clips, [updated], updated.track, updated.start)
        } else if (magnetic(s, updated.track)) {
          clips = packTrack(clips, clipsOnTrack(clips, updated.track))
        }
        if (updated.track !== clip.track && magnetic(s, clip.track)) clips = packTrack(clips, clipsOnTrack(clips, clip.track))
      }
      return { clips, currentTime: Math.min(s.currentTime, durationOf(clips)) }
    })
  },
  settleClip: (id, destination) => set(s => {
    const clip = s.clips.find(item => item.id === id)
    if (!clip || !unlocked(s, clip.track) || (destination && !unlocked(s, destination))) return s
    const track = destination ?? clip.track
    const moved = track !== clip.track ? { ...clip, track } : clip
    let clips = moved === clip ? s.clips : s.clips.map(item => item.id === id ? moved : item)
    if (destination && magnetic(s, track)) clips = insertMagnetically(clips, [moved], track, moved.start)
    else if (magnetic(s, track)) clips = packTrack(clips, clipsOnTrack(clips, track))
    if (track !== clip.track && magnetic(s, clip.track)) clips = packTrack(clips, clipsOnTrack(clips, clip.track))
    return { clips, currentTime: Math.min(s.currentTime, durationOf(clips)) }
  }),
  split: (allTracks = false) => {
    const state = get()
    const targets = splitTargets(state, allTracks)
    if (!targets.length) return
    const rightIds: string[] = []
    const clips = state.clips.flatMap(clip => {
      if (!targets.includes(clip)) return [clip]
      const [left, right] = splitClip(clip, state.currentTime)
      rightIds.push(right.id)
      return [left, right]
    })
    state.checkpoint()
    set({ clips, ...selection(rightIds), playing: false, rangeMode: false })
  },
  remove: (ripple = false) => {
    const state = get()
    const remaining = removeSelection(state, ripple)
    if (!remaining) return
    const clips = compactMagneticTracks(state, remaining)
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
  addMarker: () => {
    const { markers, currentTime, clips, checkpoint } = get()
    if (!clips.length) return
    if (markers.some(marker => Math.abs(marker.time - currentTime) < FRAME / 2)) {
      set({ markersVisible: true })
      return
    }
    checkpoint()
    const marker = { id: crypto.randomUUID(), time: currentTime, name: `Marker ${markers.length + 1}` }
    set({ markers: [...markers, marker].sort((a, b) => a.time - b.time), markersVisible: true })
  },
  changeMarker: (id, name) => {
    const { markers, checkpoint } = get()
    const marker = markers.find(item => item.id === id)
    if (!marker || name === marker.name) return
    checkpoint()
    set({ markers: name === null ? markers.filter(item => item.id !== id) :
      markers.map(item => item.id === id ? { ...item, name: name.trim() || item.name } : item) })
  },
  toggleMarkers: () => set(s => ({ markersVisible: !s.markersVisible })),
  selectMedia: direction => set(s => {
    const ids = s.clips.filter(clip => direction < 0 ? clipEnd(clip) <= s.currentTime + EPSILON : clip.start >= s.currentTime - EPSILON)
      .map(clip => clip.id)
    return selection(ids)
  }),
}))

export function timecode(seconds: number) {
  const whole = Math.floor(seconds + 0.00001)
  return [Math.floor(whole / 3600), Math.floor(whole % 3600 / 60), whole % 60].map(n => String(n).padStart(2, '0')).join(':')
}

