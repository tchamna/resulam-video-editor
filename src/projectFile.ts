import { audioTrack, type Asset, type Clip, type Project } from './store.ts'

const signature = new TextEncoder().encode('REVIE001')
const headerLength = signature.length + 4
const maxManifest = 32 * 1024 * 1024
const requiredTracks = ['annotations', 'overlay', 'main']
const trackIds = [...requiredTracks, audioTrack.id]
const clipKinds = ['video', 'audio', 'image', 'demo', 'text', 'arrow', 'highlight', 'blur', 'karaoke']
const mediaTypes = ['video/mp4', 'video/webm', 'audio/mpeg', 'image/png']

export function projectSnapshot({ title, assets, clips, tracks, markers }: Project): Project {
  return { title, assets, clips, tracks, markers }
}

export function sameProject(left: Project, right: Project) {
  return left.title === right.title && left.assets === right.assets && left.clips === right.clips &&
    left.tracks === right.tracks && left.markers === right.markers
}

type StoredAsset = Omit<Asset, 'url' | 'file'> & { size: number; type: string }
type Manifest = Omit<Project, 'assets'> & { assets: StoredAsset[] }

export async function encodeProject(project: Project) {
  const payloads: Blob[] = []
  const assets: StoredAsset[] = []
  for (const { url, file, thumb, ...asset } of project.assets) {
    const thumbnail = thumb?.startsWith('data:image/') ? thumb : undefined
    if (!url) {
      assets.push({ ...asset, thumb: thumbnail, size: 0, type: '' })
      continue
    }
    if (!url.startsWith('blob:')) throw new Error(`Could not save local media for ${asset.name}.`)
    const media = file ?? await fetch(url).then(response => {
      if (!response.ok) throw new Error(`Could not read ${asset.name}.`)
      return response.blob()
    })
    if (!media?.size) throw new Error(`The media file ${asset.name} is empty.`)
    const type = asset.kind === 'image' ? 'image/png' : asset.kind === 'audio' ? 'audio/mpeg' :
      asset.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'
    assets.push({ ...asset, thumb: thumbnail, size: media.size, type })
    payloads.push(media)
  }
  const body = new TextEncoder().encode(JSON.stringify({ ...projectSnapshot(project), assets }))
  if (body.length > maxManifest) throw new Error('This project contains too much metadata to save.')
  const header = new Uint8Array(headerLength)
  header.set(signature)
  new DataView(header.buffer).setUint32(signature.length, body.length, true)
  return new Blob([header, body, ...payloads], { type: 'application/octet-stream' })
}

function invalidFile(): never {
  throw new Error('This ReViE project file is invalid or incomplete.')
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validClip(clip: Clip) {
  return typeof clip?.id === 'string' && typeof clip.name === 'string' && clipKinds.includes(clip.kind) &&
    trackIds.includes(clip.track) && [clip.start, clip.duration, clip.offset, clip.speed, clip.x, clip.y, clip.w, clip.h,
      clip.scale, clip.rotation, clip.opacity, clip.volume, clip.fontSize, clip.blur, clip.fadeIn, clip.fadeOut].every(finite) &&
    clip.start >= 0 && clip.duration > 0 && clip.offset >= 0 && clip.speed > 0 &&
    typeof clip.text === 'string' && typeof clip.color === 'string' &&
    (!clip.silentRanges || Array.isArray(clip.silentRanges)) &&
    (!clip.karaoke || (Array.isArray(clip.karaoke.main) && Array.isArray(clip.karaoke.second) && clip.karaoke.style &&
      [...clip.karaoke.main, ...clip.karaoke.second].every(line => line && finite(line.start) && finite(line.end) &&
        Array.isArray(line.words) && line.words.every(word => word && finite(word.start) && finite(word.end) && typeof word.text === 'string'))))
}

export async function decodeProject(file: Blob): Promise<Project> {
  const header = await file.slice(0, headerLength).arrayBuffer()
  const bytes = new Uint8Array(header)
  if (header.byteLength !== headerLength || signature.some((byte, index) => byte !== bytes[index])) invalidFile()
  const length = new DataView(header).getUint32(signature.length, true)
  let position = headerLength + length
  if (!length || length > maxManifest || position > file.size) invalidFile()
  let project: Manifest
  try { project = JSON.parse(await file.slice(headerLength, position).text()) }
  catch { invalidFile() }
  if (!project || typeof project.title !== 'string' || !Array.isArray(project.assets) ||
      !Array.isArray(project.clips) || !project.clips.every(validClip) || !Array.isArray(project.markers) ||
      !project.markers.every(marker => typeof marker?.id === 'string' && typeof marker.name === 'string' && finite(marker.time)) ||
      !Array.isArray(project.tracks) || !project.tracks.every(track => trackIds.includes(track?.id) && typeof track.name === 'string') ||
      new Set(project.tracks.map(track => track.id)).size !== project.tracks.length ||
      !requiredTracks.every(id => project.tracks.some(track => track.id === id))) invalidFile()
  let size = position
  const assetIds = new Set<string>()
  for (const asset of project.assets) {
    if (!asset || typeof asset.id !== 'string' || assetIds.has(asset.id) || typeof asset.name !== 'string' ||
        !['image', 'video', 'audio', 'demo'].includes(asset.kind) || !finite(asset.duration) || asset.duration <= 0 ||
        !Number.isSafeInteger(asset.size) || asset.size < 0 || (asset.size > 0 && !mediaTypes.includes(asset.type)) ||
        (asset.frameSize && (!Number.isInteger(asset.frameSize.width) || !Number.isInteger(asset.frameSize.height) ||
          asset.frameSize.width <= 0 || asset.frameSize.height <= 0 || Math.max(asset.frameSize.width, asset.frameSize.height) > 16384))) invalidFile()
    assetIds.add(asset.id)
    size += asset.size
  }
  if (size !== file.size || project.clips.some(clip => clip.assetId && !assetIds.has(clip.assetId))) invalidFile()
  const assets = project.assets.map(({ id, name, kind, duration, frameSize, thumb, type, size }): Asset => {
    const media = size ? file.slice(position, position + size, type) : undefined
    const url = media ? URL.createObjectURL(media) : undefined
    position += size
    return { id, name, kind, duration, frameSize, url, file: media, thumb: url && kind === 'image' ? url :
      typeof thumb === 'string' && thumb.startsWith('data:image/') ? thumb : undefined }
  })
  const tracks = project.tracks.some(track => track.id === 'audio') ? project.tracks : [...project.tracks, audioTrack]
  return { title: project.title, clips: project.clips, tracks, markers: project.markers, assets }
}
