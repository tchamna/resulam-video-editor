type Desktop = {
  beginSave: (name: string, reuse: boolean) => Promise<boolean>
  beginExport: (name: string) => Promise<boolean>
  writeChunk: (data: ArrayBuffer) => Promise<void>
  finishSave: (commit: boolean) => Promise<void>
  onCloseRequest: (handle: () => void) => () => void
  closeWindow: () => void
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
