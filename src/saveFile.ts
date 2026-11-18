type Desktop = {
  beginSave: (name: string, reuse: boolean) => Promise<boolean>
  beginExport: (name: string) => Promise<boolean>
  beginCaptionExport: (name: string) => Promise<boolean>
  writeChunk: (data: ArrayBuffer) => Promise<void>
  finishSave: (commit: boolean) => Promise<void>
  onCloseRequest: (handle: () => void) => () => void
  closeWindow: () => void
}

export async function saveCaptionFile(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/x-subrip;charset=utf-8' })
  const desktop = window.revieDesktop
  if (desktop) {
    if (!await desktop.beginCaptionExport(filename)) return false
    try {
      await writeDesktopFile(desktop, blob)
      await desktop.finishSave(true)
    } catch (error) {
      await desktop.finishSave(false).catch(() => {})
      throw error
    }
    return true
  }
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'SubRip subtitles', accept: { 'application/x-subrip': ['.srt'] } }],
    })
    const stream = await handle.createWritable()
    try {
      await stream.write(blob)
      await stream.close()
    } catch (error) {
      await stream.abort().catch(() => {})
      throw error
    }
  } else downloadFile(blob, filename)
  return true
}

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

type SavePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

declare global {
  interface Window {
    revieDesktop?: Desktop
    showSaveFilePicker?: SavePicker
  }
}

export async function writeDesktopFile(desktop: Desktop, blob: Blob, signal?: AbortSignal) {
  const chunkSize = 4 * 1024 * 1024
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const bytes = await blob.slice(offset, offset + chunkSize).arrayBuffer()
    signal?.throwIfAborted()
    await desktop.writeChunk(bytes)
  }
}
