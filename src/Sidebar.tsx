import { useMemo, useState, type DragEvent } from 'react'
import { Aperture, ArrowUpRight, Blend, Captions, Circle, Download, Focus, FolderOpen, Plus, RectangleHorizontal, Sparkles, Type } from 'lucide-react'
import { type Asset, type Kind, isAnnotation, names, timecode, useEditor } from './store'
import { exportSrt, type CaptionLanguage } from './karaoke'
import { saveCaptionFile } from './saveFile'
import { thumbnail, thumbnailTime } from './media'
import { ITEM_TYPE } from './Timeline'
import { icons, ToolButton } from './ui'

const tabs = [['Media', FolderOpen], ['Annotations', Type], ['Effects', Sparkles], ['Captions', Captions]] as const
export type SidebarTab = typeof tabs[number][0]
const annotations = [
  ['text', 'Custom text and titles'], ['arrow', 'Point out on-screen details'],
  ['highlight', 'Outline an area of interest'], ['blur', 'Obscure part of the frame'],
] as const

function beginDrag(event: DragEvent, item: string) {
  event.dataTransfer.setData(ITEM_TYPE, item)
  event.dataTransfer.effectAllowed = 'copy'
}

export function Sidebar({ importMedia, disabled, tab, setTab }: {
  importMedia: () => void; disabled: boolean; tab: SidebarTab; setTab: (tab: SidebarTab) => void
}) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [savingCaptions, setSavingCaptions] = useState(false)
  const [captionStatus, setCaptionStatus] = useState('')
  const assets = useEditor(s => s.assets)
  const clip = useEditor(s => s.clips.find(c => c.id === s.selectedClipId))
  const locked = useEditor(s => s.tracks.find(t => t.id === clip?.track)?.locked)
  const captionsLocked = useEditor(s => s.tracks.find(t => t.id === 'annotations')?.locked)
  const visibleCaptions = useEditor(s => s.clips)
  const tracks = useEditor(s => s.tracks)
  const thumbnails = useMemo(() => ({ 'demo-screen': thumbnail('demo'), 'demo-overlay': thumbnail('image') }), [])
  function add(item: Asset | Kind) {
    const state = useEditor.getState()
    const start = state.currentTime
    state.play(false)
    const id = state.add(item, start)
    const clip = useEditor.getState().clips.find(item => item.id === id)
    if (clip) state.seek(clip.start)
  }
  const apply = (effect: 'in' | 'out' | 'zoom' | 'circle' | 'rounded') => {
    if (!clip) return
    const state = useEditor.getState()
    if (effect === 'zoom') state.change(clip.id, { endTransform: { x: clip.x - 3, y: clip.y - 2, scale: clip.scale * 1.2 } })
    else if (effect === 'in') state.change(clip.id, { fadeIn: Math.min(1, clip.duration / 2) })
    else if (effect === 'out') state.change(clip.id, { fadeOut: Math.min(1, clip.duration / 2) })
    else state.change(clip.id, clip.track === 'main' ? { shape: effect, track: 'overlay', x: 81, y: 74, w: 28, h: 30 } : { shape: effect })
  }
  const noVisual = !clip || clip.kind === 'audio' || isAnnotation(clip.kind)
  const captionFiles = useMemo(() => {
    const clips = visibleCaptions.filter(item => item.karaoke && !tracks.some(track => track.id === item.track && track.hidden))
    return { main: exportSrt(clips, 'main'), second: exportSrt(clips, 'second') }
  }, [visibleCaptions, tracks])
  async function exportCaptions(language: CaptionLanguage) {
    const title = useEditor.getState().title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 150).replace(/[. ]+$/, '') || 'Tutorial'
    setSavingCaptions(true)
    setCaptionStatus('')
    try {
      if (await saveCaptionFile(captionFiles[language], `${title}-${language}.srt`)) setCaptionStatus('SRT exported.')
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setCaptionStatus((error as Error).message)
    } finally { setSavingCaptions(false) }
  }
  return <aside className="sidebar" aria-label="Editor assets">
    <div className="sidebar-tabs" role="tablist" aria-label="Asset libraries">
      {tabs.map(([label, Icon]) => <button key={label} type="button" role="tab" aria-selected={tab === label} aria-controls="asset-panel" className={tab === label ? 'active' : ''} onClick={() => setTab(label)}><Icon size={15} /><span>{label}</span></button>)}
    </div>
    <div className="library-content" role="tabpanel" id="asset-panel" aria-label={tab}>
      {tab === 'Media' && <>
        <div className="library-heading"><div><h2>Media bin</h2><span>{assets.length} {assets.length === 1 ? 'asset' : 'assets'}</span></div><ToolButton label="Add media to bin" disabled={disabled} onClick={importMedia}><Plus size={17} /></ToolButton></div>
        <div className="asset-grid">
          {assets.map(asset => {
            const Icon = icons[asset.kind]
            const thumb = asset.thumb ?? thumbnails[asset.id as keyof typeof thumbnails]
            const video = asset.kind === 'video' ? asset.url : undefined
            const previewing = !!video && !disabled && previewId === asset.id
            const stopPreview = () => setPreviewId(id => id === asset.id ? null : id)
            return <button key={asset.id} type="button" className="asset-card" draggable={!disabled} disabled={disabled}
              aria-label={`Add ${asset.name} to timeline`} title={`${asset.name} · Click to add or drag to the timeline`}
              onPointerEnter={e => { if (video && e.pointerType !== 'touch') setPreviewId(asset.id) }}
              onPointerLeave={stopPreview}
              onFocus={e => { if (video && e.currentTarget.matches(':focus-visible')) setPreviewId(asset.id) }}
              onBlur={stopPreview}
              onClick={() => add(asset)} onDragStart={e => { stopPreview(); beginDrag(e, asset.id) }}>
              <div className={`asset-thumb ${asset.kind}`}>
                {thumb ? <img src={thumb} alt="" draggable={false} /> : <Icon size={25} />}
                {video && (previewing || !thumb) && <video src={video} poster={thumb} muted playsInline loop
                  preload="auto" autoPlay={previewing} aria-hidden="true"
                  ref={element => {
                    if (!element) return
                    if (previewing) void element.play().catch(() => {})
                    else element.pause()
                  }}
                  onLoadedMetadata={event => { event.currentTarget.currentTime = thumbnailTime(asset.duration) }} />}
                <div className="asset-badge">{asset.kind === 'image' ? 'PNG' : timecode(asset.duration).slice(3)}</div>
                <div className="asset-add"><Plus size={15} /></div>
              </div>
              <span className="asset-title"><Icon size={12} /><span>{asset.name}</span></span>
            </button>
          })}
        </div>
        <button className="import-zone" disabled={disabled} onClick={importMedia} type="button">
          <span className="import-icon"><Plus size={17} /></span><strong>Import media</strong><span>MP4, WebM, MP3, PNG</span>
        </button>
      </>}
      {tab === 'Annotations' && <>
        <div className="library-heading"><div><h2>Annotations</h2><span>Drag or click to add a callout</span></div></div>
        <div className="library-list">
          {annotations.map(([kind, description]) => {
            const Icon = icons[kind]
            return <button key={kind} className="library-item" type="button" disabled={disabled} draggable={!disabled}
              onDragStart={e => beginDrag(e, kind)} onClick={event => {
                if (event.detail <= 1) { add(kind); return }
                const state = useEditor.getState()
                const previous = state.clips.find(clip => clip.id === state.selectedClipId && clip.kind === kind && clip.start === state.currentTime)
                if (previous) state.editAnnotation(previous.id)
              }}>
              <div className="track-glyph annotations"><Icon size={17} /></div><div><strong>{names[kind]}</strong><small>{description}</small></div><Plus size={14} />
            </button>
          })}
        </div>
      </>}
      {tab === 'Effects' && <>
        <div className="library-heading"><div><h2>Transitions &amp; effects</h2><span>{clip ? 'Applies to the selected clip' : 'Select a clip to apply an effect'}</span></div></div>
        <div className="library-list">
          {([
            ['in', 'Fade in', Blend], ['out', 'Fade out', Aperture], ['zoom', 'Smooth pan & zoom', Focus],
            ['circle', 'Circle PiP', Circle], ['rounded', 'Rounded rectangle PiP', RectangleHorizontal],
          ] as const).map(([name, title, Icon]) => <button key={name} className="library-item" type="button"
            disabled={disabled || !clip || locked || (['zoom', 'circle', 'rounded'].includes(name) && noVisual)} onClick={() => apply(name)}>
              <div className="track-glyph overlay"><Icon size={17} /></div><div><strong>{title}</strong></div><ArrowUpRight size={14} />
            </button>)}
        </div>
      </>}
      {tab === 'Captions' && <>
        <div className="library-heading"><div><h2>Karaoke captions</h2><span>Add at the playhead or over a marked range</span></div></div>
        <button type="button" className="library-item" draggable={!disabled && !captionsLocked} disabled={disabled || captionsLocked}
          onDragStart={event => beginDrag(event, 'karaoke')} onClick={() => useEditor.getState().addCaption()}>
          <div className="track-glyph annotations"><Captions size={17} /></div><div><strong>Add karaoke captions</strong></div><Plus size={14} />
        </button>
        <div className="caption-exports">
          <h2>Export subtitles</h2>
          {([['main', 'Export main SRT'], ['second', 'Export second-language SRT']] as const).map(([language, label]) =>
            <button key={language} type="button" className="library-item" disabled={disabled || savingCaptions || !captionFiles[language]}
              onClick={() => void exportCaptions(language)}><Download size={15} /><strong>{label}</strong></button>)}
          {captionStatus && <p role="status">{captionStatus}</p>}
        </div>
      </>}
    </div>
  </aside>
}

