import { type Asset, type Clip, type FrameSize, canvasSizeOf, clamp, clipsOnTrack, DEFAULT_FRAME, durationOf, EMPTY_CROP, timed, useEditor } from './store'
import { drawKaraoke, loadKaraokeFont } from './karaokeCanvas'

const { width: WIDTH, height: HEIGHT } = DEFAULT_FRAME
type Layer = { el: HTMLMediaElement; gain?: GainNode }
const layers = new Map<string, Layer>()
const images = new Map<string, HTMLImageElement>()
let audio: AudioContext | undefined
let speakers: GainNode | undefined
let capture: MediaStreamAudioDestinationNode | undefined

export function enableAudio() {
  if (!audio) {
    audio = new AudioContext()
    speakers = audio.createGain()
    speakers.connect(audio.destination)
    capture = audio.createMediaStreamDestination()
  }
  void audio.resume().catch(() => {})
}

function mediaFor(clip: Clip, asset: Asset) {
  let layer = layers.get(clip.id)
  if (!layer) {
    const el = document.createElement(clip.kind === 'audio' ? 'audio' : 'video')
    el.preload = 'auto'
    if (el instanceof HTMLVideoElement) el.playsInline = true
    el.src = asset.url!
    layer = { el }
    layers.set(clip.id, layer)
  }
  if (audio && !layer.gain) {
    const source = audio.createMediaElementSource(layer.el)
    layer.gain = audio.createGain()
    source.connect(layer.gain)
    layer.gain.connect(speakers!)
    layer.gain.connect(capture!)
  }
  return layer
}

export function stopMedia() {
  for (const { el } of layers.values()) el.pause()
}

export function preloadMedia() {
  const state = useEditor.getState()
  const assetsById = new Map(state.assets.map(asset => [asset.id, asset]))
  const sources = new Map(state.clips.map(clip => [clip.id, clip.assetId && assetsById.get(clip.assetId)?.url]))
  for (const [id, layer] of layers) {
    if (sources.get(id) !== layer.el.getAttribute('src')) {
      layer.el.pause()
      layer.gain?.disconnect()
      layer.el.removeAttribute('src')
      layer.el.load()
      layers.delete(id)
    }
  }
  for (const [id, image] of images) {
    if (assetsById.get(id)?.url !== image.getAttribute('src')) images.delete(id)
  }
  for (const clip of state.clips) {
    const asset = clip.assetId ? assetsById.get(clip.assetId) : undefined
    if (!asset?.url) continue
    if (clip.kind === 'video' || clip.kind === 'audio') mediaFor(clip, asset)
    if (clip.kind === 'image') imageFor(asset)
  }
}

function imageFor(asset: Asset) {
  let image = images.get(asset.id)
  if (!image) {
    image = new Image()
    image.src = asset.url!
    images.set(asset.id, image)
  }
  return image
}

function fadeAt(clip: Clip, time: number) {
  const elapsed = time - clip.start + (clip.fadeWindow?.offset ?? 0)
  const fadeIn = clip.fadeIn ? clamp(elapsed / clip.fadeIn, 0, 1) : 1
  const fadeOut = clip.fadeOut ? clamp(((clip.fadeWindow?.duration ?? clip.duration) - elapsed) / clip.fadeOut, 0, 1) : 1
  return Math.min(fadeIn, fadeOut)
}
export const opacityAt = (clip: Clip, time: number) => clip.opacity / 100 * fadeAt(clip, time)

export function visibleClips(time: number) {
  const { clips, tracks } = useEditor.getState()
  const end = durationOf(clips)
  const active = clips.filter(clip => time >= clip.start &&
    (time < clip.start + clip.duration || (time === end && time === clip.start + clip.duration)))
  return [...tracks].reverse().flatMap(track => track.hidden ? [] : clipsOnTrack(active, track.id))
}

export function frameOf(clip: Clip, time: number, { width, height }: FrameSize) {
  const progress = clamp((time - clip.start) / clip.duration, 0, 1)
  const end = clip.endTransform
  const x = clip.x + (end ? (end.x - clip.x) * progress : 0)
  const y = clip.y + (end ? (end.y - clip.y) * progress : 0)
  const scale = (clip.scale + (end ? (end.scale - clip.scale) * progress : 0)) / 100
  const w = clip.w / 100 * width * scale
  const h = clip.h / 100 * height * scale
  return { x: x / 100 * width, y: y / 100 * height, w, h, angle: clip.rotation * Math.PI / 180 }
}

export function cropRect(clip: Clip, { w, h }: { w: number; h: number }) {
  const { left, right, top, bottom } = clip.crop ?? EMPTY_CROP
  return { x: w * (left / 100 - .5), y: h * (top / 100 - .5), w: w * (1 - (left + right) / 100), h: h * (1 - (top + bottom) / 100) }
}

type Context = CanvasRenderingContext2D
function box(ctx: Context, x: number, y: number, w: number, h: number, fill: string, radius: number | number[] = 0, stroke?: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke() }
}
function label(ctx: Context, text: string, x: number, y: number, size: number, color: string, weight = 500) {
  ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

export function drawDemo(ctx: Context, w: number, h: number, time = 0) {
  ctx.save()
  ctx.scale(w / WIDTH, h / HEIGHT)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#e4efeb'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const desktop = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  desktop.addColorStop(0, '#e3f1ec')
  desktop.addColorStop(1, '#cdded8')
  ctx.fillStyle = desktop
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.shadowColor = '#173a3430'
  ctx.shadowBlur = 35
  ctx.shadowOffsetY = 12
  box(ctx, 87, 62, 1106, 597, '#fbfdfc', 16)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  box(ctx, 87, 62, 1106, 43, '#f0f4f2', [16, 16, 0, 0])
  ;['#f19e96', '#eec475', '#8fcbb1'].forEach((color, i) => {
    ctx.beginPath(); ctx.arc(110 + i * 16, 84, 4.7, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
  })
  box(ctx, 438, 73, 404, 23, '#e6ece8', 6)
  ctx.textAlign = 'center'
  label(ctx, 'studio.fieldwork.design / projects', 640, 89, 11, '#657771')
  ctx.textAlign = 'left'
  box(ctx, 88, 105, 195, 553, '#f5f8f6', 0)
  box(ctx, 282, 105, 1, 553, '#dce8e1')
  box(ctx, 107, 124, 32, 32, '#173e32', 8)
  label(ctx, 'F', 117, 147, 21, '#aff4cd', 750)
  label(ctx, 'Fieldwork', 150, 146, 21, '#173529', 740)
  label(ctx, 'WORKSPACE', 109, 201, 11, '#82978b', 700)

  const links = ['Overview', 'Projects', 'Asset library', 'Team settings']
  links.forEach((name, i) => {
    const y = 232 + i * 41
    if (i === 1) box(ctx, 102, y - 22, 166, 34, '#dceee3', 7)
    box(ctx, 114, y - 11, 12, 12, '#00000000', 3, i === 1 ? '#236848' : '#789186')
    label(ctx, name, 140, y, 15, i === 1 ? '#215641' : '#5b7368', i === 1 ? 700 : 500)
  })
  box(ctx, 109, 609, 25, 25, '#c9e8d7', 12)
  label(ctx, 'Studio workspace', 144, 625, 12, '#567367', 630)
  label(ctx, 'Workspace  /  Projects', 320, 140, 13, '#648176', 600)
  box(ctx, 1042, 122, 111, 29, '#183f32', 6)
  label(ctx, '+ New project', 1054, 141, 12, '#effaf4', 650)
  const hero = ctx.createLinearGradient(320, 175, 1153, 380)
  hero.addColorStop(0, '#173e34'); hero.addColorStop(1, '#296956')
  box(ctx, 320, 167, 833, 204, '#173e34', 13)
  ctx.save()
  ctx.beginPath(); ctx.roundRect(320, 167, 833, 204, 13); ctx.clip()
  ctx.fillStyle = hero; ctx.fillRect(320, 167, 833, 204)
  ctx.strokeStyle = '#9ce5b88a'
  ctx.lineWidth = 1.4
  for (let i = 0; i < 26; i++) {
    ctx.beginPath()
    for (let x = 0; x <= 570; x += 5) {
      const y = 232 + i * 5 + Math.sin(x / 105 + i * .073 + time * .06) * (33 + x / 7) - x * .09
      if (x === 0) ctx.moveTo(670 + x, y); else ctx.lineTo(670 + x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
  label(ctx, 'FIELDWORK STUDIO', 351, 209, 12, '#9fd8b8', 750)
  label(ctx, 'Your projects', 348, 264, 47, '#f2fbf6', 730)
  label(ctx, 'A space for your team’s work in progress.', 351, 299, 17, '#c5e0d4')
  label(ctx, 'Recent projects', 320, 420, 25, '#1c382e', 720)
  label(ctx, 'View all  →', 1085, 420, 13, '#467561', 650)
  const cards = [
    { bg: '#c6e2d1', lines: '#569178', title: 'Brand system', subtitle: 'Design · Updated today' },
    { bg: '#e4dcc9', lines: '#a1906d', title: 'Launch campaign', subtitle: 'Marketing · Updated yesterday' },
    { bg: '#d6dfec', lines: '#7889a9', title: 'Product onboarding', subtitle: 'Product · Updated 3 days ago' },
  ]
  cards.forEach((card, i) => {
    const x = 320 + i * 282
    box(ctx, x, 441, 269, 160, '#ffffff', 11, '#dce8e1')
    box(ctx, x + 9, 450, 251, 91, card.bg, 7)
    ctx.save()
    ctx.beginPath(); ctx.roundRect(x + 9, 450, 251, 91, 7); ctx.clip()
    ctx.strokeStyle = card.lines
    for (let j = 0; j < 12; j++) {
      ctx.beginPath()
      if (i === 1) ctx.ellipse(x + 145, 493, 18 + j * 9, 11 + j * 6, -.35, 0, Math.PI * 2)
      else {
        ctx.moveTo(x + 15, 520 - j * 4)
        ctx.bezierCurveTo(x + 80, 415 + j * 7, x + 164, 555 - j * 4, x + 271, 472 + j * 6)
      }
      ctx.stroke()
    }
    ctx.restore()
    label(ctx, card.title, x + 14, 566, 15, '#28453a', 700)
    label(ctx, card.subtitle, x + 14, 585, 11, '#6d8178')
  })
  if (time > 1) {
    const x = 650 + Math.sin(time * .35) * 215
    const y = 426 + Math.cos(time * .30) * 55
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2, y + 23)
    ctx.lineTo(x + 8, y + 16); ctx.lineTo(x + 18, y + 15); ctx.closePath()
    ctx.fillStyle = '#18372e'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
  }
  ctx.restore()
}

function drawOverlay(ctx: Context, w: number, h: number) {
  box(ctx, -w / 2, -h / 2, w, h, '#143e33', 8)
  ctx.textAlign = 'center'
  label(ctx, 'F', 0, h * .19, h * .62, '#a3e9c1', 750)
}

export function thumbnail(kind: 'demo' | 'image') {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const ctx = canvas.getContext('2d')!
  if (kind === 'demo') drawDemo(ctx, 320, 180)
  else { ctx.translate(160, 90); drawOverlay(ctx, 320, 180) }
  return canvas.toDataURL()
}

function fitImage(ctx: Context, source: CanvasImageSource, sw: number, sh: number, w: number, h: number, cover: boolean) {
  if (!sw || !sh) return
  const ratio = cover ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh)
  ctx.drawImage(source, -sw * ratio / 2, -sh * ratio / 2, sw * ratio, sh * ratio)
}

let blurBuffer: HTMLCanvasElement | undefined
export function renderFrame(ctx: Context, time: number, playing: boolean, exporting = false) {
  const { assets, clips, tracks } = useEditor.getState()
  const { width, height } = ctx.canvas
  const active = visibleClips(time)
  const activeIds = new Set(active.map(c => c.id))
  for (const [id, { el }] of layers) if (!activeIds.has(id) && !el.paused) el.pause()
  if (playing || exporting) {
    for (const clip of clips) {
      if ((clip.kind !== 'video' && clip.kind !== 'audio') || clip.start <= time || clip.start > time + .5 ||
          tracks.some(track => track.id === clip.track && track.hidden)) continue
      const asset = assets.find(item => item.id === clip.assetId)
      if (!asset?.url) continue
      const { el } = mediaFor(clip, asset)
      if (el.readyState > 0 && !el.seeking && Math.abs(el.currentTime - clip.offset) > .008) el.currentTime = clip.offset
    }
  }
  ctx.fillStyle = '#111519'
  ctx.fillRect(0, 0, width, height)
  for (const clip of active) {
    if (clip.kind === 'karaoke') continue
    const asset = assets.find(a => a.id === clip.assetId)
    const frame = frameOf(clip, time, ctx.canvas)
    const opacity = opacityAt(clip, time)
    let media: HTMLMediaElement | undefined
    if ((clip.kind === 'video' || clip.kind === 'audio') && asset?.url) {
      const layer = mediaFor(clip, asset)
      media = layer.el
      media.playbackRate = clip.speed
      const sourceTime = clip.offset + (time - clip.start) * clip.speed
      const silent = tracks.find(track => track.id === clip.track)?.muted ||
        clip.silentRanges?.some(span => sourceTime >= span.start && sourceTime < span.end)
      const volume = silent ? 0 : clamp(clip.volume / 100 * fadeAt(clip, time), 0, 1)
      if (layer.gain) {
        media.volume = 1
        layer.gain.gain.value = volume
      } else media.volume = volume
      const target = clamp(sourceTime, 0, Math.max(0, Number.isFinite(media.duration) ? media.duration - 0.001 : sourceTime))
      if (!media.seeking && (media.readyState > 0 && Math.abs(media.currentTime - target) > (playing ? .13 : .008))) media.currentTime = target
      if (playing && media.paused && !media.ended) void media.play().catch(() => {})
      if (!playing && !media.paused) media.pause()
    }
    if (clip.kind === 'audio') continue

    const { x, y, w, h, angle } = frame
    if (clip.kind === 'blur') {
      if (clip.redact) {
        ctx.save()
        ctx.translate(x, y); ctx.rotate(angle)
        ctx.globalAlpha = opacity
        ctx.fillStyle = '#101216'
        ctx.fillRect(-w / 2, -h / 2, w, h)
        ctx.restore()
        continue
      }
      blurBuffer ??= document.createElement('canvas')
      if (blurBuffer.width !== width || blurBuffer.height !== height) { blurBuffer.width = width; blurBuffer.height = height }
      const copy = blurBuffer.getContext('2d')!
      copy.clearRect(0, 0, width, height)
      copy.drawImage(ctx.canvas, 0, 0)
      ctx.save()
      ctx.translate(x, y); ctx.rotate(angle)
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip()
      ctx.rotate(-angle); ctx.translate(-x, -y)
      ctx.globalAlpha = opacity
      ctx.filter = `blur(${clip.blur}px)`
      ctx.drawImage(blurBuffer, 0, 0)
      ctx.restore()
      continue
    }
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.translate(x, y)
    ctx.rotate(angle)
    if (clip.crop) {
      const cropped = cropRect(clip, frame)
      ctx.beginPath()
      ctx.rect(cropped.x, cropped.y, cropped.w, cropped.h)
      ctx.clip()
    }
    if (clip.shape !== 'none') {
      ctx.beginPath()
      if (clip.shape === 'circle') ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2)
      else ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * .1)
      ctx.clip()
    }
    if (clip.kind === 'demo') {
      const fit = Math.min(w / WIDTH, h / HEIGHT)
      ctx.translate(-WIDTH * fit / 2, -HEIGHT * fit / 2)
      drawDemo(ctx, WIDTH * fit, HEIGHT * fit, clip.offset + (time - clip.start) * clip.speed)
    } else if (clip.kind === 'image' && asset) {
      if (!asset.url) drawOverlay(ctx, w, h)
      else {
        const image = imageFor(asset)
        if (image.complete) fitImage(ctx, image, image.naturalWidth, image.naturalHeight, w, h, clip.shape !== 'none')
      }
    } else if (clip.kind === 'video' && media instanceof HTMLVideoElement && media.readyState >= 2) {
      fitImage(ctx, media, media.videoWidth, media.videoHeight, w, h, clip.shape !== 'none')
    } else if (clip.kind === 'text') {
      const fontSize = clip.fontSize * frame.w / (clip.w / 100 * width)
      ctx.fillStyle = clip.color
      ctx.font = `${clip.bold ? 700 : 400} ${fontSize}px "Segoe UI", sans-serif`
      ctx.textAlign = clip.align
      ctx.textBaseline = 'middle'
      ctx.shadowColor = '#000b'
      ctx.shadowBlur = 12
      const lines = clip.text.split('\n')
      const left = clip.align === 'left' ? -w / 2 : clip.align === 'right' ? w / 2 : 0
      lines.forEach((line, index) => ctx.fillText(line, left, (index - (lines.length - 1) / 2) * fontSize * 1.18, w))
    } else if (clip.kind === 'highlight') {
      box(ctx, -w / 2, -h / 2, w, h, `${clip.color}24`, 9)
      ctx.strokeStyle = clip.color; ctx.lineWidth = 5; ctx.stroke()
    } else if (clip.kind === 'arrow') {
      ctx.beginPath()
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0)
      ctx.moveTo(w / 2 - Math.min(30, w / 3), -Math.min(23, h / 2))
      ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2 - Math.min(30, w / 3), Math.min(23, h / 2))
      ctx.strokeStyle = clip.color; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
    }
    ctx.restore()
  }
  if (!exporting && !active.some(clip => clip.kind !== 'audio' && (clip.kind !== 'karaoke' || clip.karaoke?.main.length || clip.karaoke?.second.length))) {
    ctx.textAlign = 'center'
    label(ctx, 'No video at this position', width / 2, height / 2, 24, '#667079')
    ctx.textAlign = 'left'
  }
  for (const clip of active) {
    if (clip.karaoke) drawKaraoke(ctx, clip.karaoke, clip.offset + (time - clip.start) * clip.speed, opacityAt(clip, time))
  }
}

export const thumbnailTime = (duration: number) => Math.min(3, duration / 5)

function seekVideoFrame(video: HTMLVideoElement, time: number) {
  return new Promise<boolean>(resolve => {
    const finish = (ready: boolean) => {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', check)
      video.removeEventListener('loadeddata', check)
      video.removeEventListener('error', fail)
      resolve(ready)
    }
    const check = () => {
      if (video.readyState >= 2 && !video.seeking && video.videoWidth && video.videoHeight) finish(true)
    }
    const fail = () => finish(false)
    const timeout = window.setTimeout(fail, 2200)
    video.addEventListener('seeked', check)
    video.addEventListener('loadeddata', check)
    video.addEventListener('error', fail)
    try { video.currentTime = time; check() }
    catch { fail() }
  })
}

async function videoThumbnail(video: HTMLVideoElement, duration: number) {
  const start = thumbnailTime(duration)
  if (!(await seekVideoFrame(video, start)) && !(await seekVideoFrame(video, 0))) return
  const thumb = document.createElement('canvas')
  const scale = Math.min(320 / video.videoWidth, 180 / video.videoHeight)
  thumb.width = Math.max(1, Math.round(video.videoWidth * scale))
  thumb.height = Math.max(1, Math.round(video.videoHeight * scale))
  const ctx = thumb.getContext('2d')!
  ctx.drawImage(video, 0, 0, thumb.width, thumb.height)
  const pixels = ctx.getImageData(0, 0, thumb.width, thumb.height).data
  let dark = true
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 16) { dark = false; break }
  }
  const next = Math.min(10, duration / 2)
  if (dark && next - start > 0.15 && await seekVideoFrame(video, next)) {
    ctx.drawImage(video, 0, 0, thumb.width, thumb.height)
  }
  return thumb.toDataURL()
}

export async function importFile(file: File, recordedDuration?: number): Promise<Asset> {
  const ext = file.name.toLowerCase().split('.').at(-1)
  const kind = ext === 'png' ? 'image' : ext === 'mp3' ? 'audio' : ['mp4', 'webm'].includes(ext ?? '') ? 'video' : null
  if (!kind) throw new Error(`Unsupported file type: ${file.name}`)
  const url = URL.createObjectURL(file)
  const asset: Asset = { id: crypto.randomUUID(), name: file.name, kind, duration: 5, url, file }
  try {
    if (kind === 'image') {
      const image = imageFor(asset)
      await image.decode()
      asset.thumb = url
      return asset
    }
    const media = document.createElement(kind === 'audio' ? 'audio' : 'video')
    media.preload = 'auto'
    const metadata = new Promise<void>((resolve, reject) => {
      media.onloadedmetadata = () => resolve()
      media.onerror = () => reject(new Error(`Could not decode ${file.name}`))
    })
    media.src = url
    try {
      await metadata
      let duration = media.duration
      if (!Number.isFinite(duration) && !recordedDuration) {
        media.currentTime = 1e8
        duration = await new Promise<number>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error(`Could not read the duration of ${file.name}`)), 3500)
          media.onseeked = () => { clearTimeout(timeout); resolve(Number.isFinite(media.duration) ? media.duration : media.currentTime) }
        })
      }
      asset.duration = Number.isFinite(duration) && duration > 0 ? duration : recordedDuration ?? 0
      if (!asset.duration) throw new Error(`Could not read the duration of ${file.name}`)
      if (media instanceof HTMLVideoElement) {
        if (media.videoWidth && media.videoHeight) asset.frameSize = { width: media.videoWidth, height: media.videoHeight }
        asset.thumb = await videoThumbnail(media, asset.duration).catch(() => undefined)
      }
      return asset
    } finally {
      media.removeAttribute('src')
      media.load()
    }
  } catch (error) {
    images.delete(asset.id)
    URL.revokeObjectURL(url)
    throw error
  }
}

export async function exportMP4(onProgress: (ratio: number) => void, signal: AbortSignal, bounds?: { start: number; end: number }) {
  const state = useEditor.getState()
  const projectEnd = durationOf(state.clips)
  const start = clamp(bounds?.start ?? 0, 0, projectEnd)
  const duration = clamp(bounds?.end ?? projectEnd, start, projectEnd) - start
  if (!duration) throw new Error('Add a clip to the timeline first.')
  const { width, height } = canvasSizeOf(state)
  const level = Math.ceil(width / 16) * Math.ceil(height / 16) > 3600 ? '33' : '1f'
  const mime = typeof MediaRecorder !== 'undefined' && [`video/mp4;codecs=avc1.4200${level},mp4a.40.2`, 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type))
  if (!mime) throw new Error('MP4 encoding is unavailable in this browser. Open the editor in a current Chrome or Edge release.')
  state.play(false)
  stopMedia()
  enableAudio()
  await audio?.resume()
  if (state.clips.some(clip => clip.karaoke)) await loadKaraokeFont()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })!
  const frameInterval = 1000 / 60
  const videoStream = canvas.captureStream(0)
  const videoTrack = videoStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
  const hasAudio = state.clips.some(clip => (clip.kind === 'video' || clip.kind === 'audio') &&
    clip.start < start + duration && clip.start + clip.duration > start && clip.volume > 0 &&
    state.assets.some(asset => asset.id === clip.assetId && asset.url) &&
    !state.tracks.some(track => track.id === clip.track && (track.hidden || track.muted)))
  const stream = new MediaStream([videoTrack, ...(hasAudio ? capture!.stream.getAudioTracks() : [])])
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  let timer = 0
  let preRoll = 0
  let abort: (() => void) | undefined
  let silence: ConstantSourceNode | undefined
  const originalVolume = speakers!.gain.value
  speakers!.gain.value = 0
  try {
    if (hasAudio) {
      // Keep the muxer supplied with audio samples through gaps between clips.
      silence = audio!.createConstantSource()
      silence.offset.value = 0
      silence.connect(capture!)
      silence.start()
    }
    return await new Promise<Blob>((resolve, reject) => {
      const stopWithError = (error: unknown) => {
        reject(error)
        if (recorder.state !== 'inactive') recorder.stop()
      }
      abort = () => stopWithError(new DOMException('Export canceled', 'AbortError'))
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      const schedule = (callback: (now: number) => void, delay: number) => {
        timer = window.setTimeout(() => {
          try { callback(performance.now()) }
          catch (error) { stopWithError(error) }
        }, delay)
      }
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => reject(new Error('The browser could not encode this project.'))
      recorder.onstop = () => {
        if (chunks.length) resolve(new Blob(chunks, { type: 'video/mp4' }))
        else reject(new Error('The browser returned an empty export.'))
      }
      const prepare = (now: number) => {
        if (!preRoll) preRoll = now
        renderFrame(ctx, start, false, true)
        const ready = visibleClips(start).every(clip => {
          if (!timed(clip.kind) || clip.kind === 'demo') return true
          const media = layers.get(clip.id)?.el
          return media && media.readyState >= 2 && !media.seeking
        })
        if (!ready && now - preRoll < 2000) { schedule(prepare, frameInterval); return }
        recorder.start()
        let previous = now
        const render = (tick: number) => {
          if (document.hidden || tick - previous > 500) {
            stopWithError(new Error('Export paused too long. Keep this tab visible and try again.'))
            return
          }
          previous = tick
          const elapsed = clamp((tick - now) / 1000, 0, duration)
          if (elapsed >= duration) {
            onProgress(1)
            recorder.stop()
            return
          }
          renderFrame(ctx, start + elapsed, true, true)
          videoTrack.requestFrame()
          onProgress(elapsed / duration)
          const next = now + (Math.floor((tick - now) / frameInterval) + 1) * frameInterval
          schedule(render, Math.max(4, next - performance.now()))
        }
        render(now)
      }
      schedule(prepare, 0)
    })
  } finally {
    clearTimeout(timer)
    if (abort) signal.removeEventListener('abort', abort)
    silence?.stop()
    silence?.disconnect()
    videoStream.getTracks().forEach(track => track.stop())
    speakers!.gain.value = originalVolume
    stopMedia()
  }
}

