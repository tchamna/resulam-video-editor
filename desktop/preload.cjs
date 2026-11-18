const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('revieDesktop', {
  beginSave: (name, reuse) => ipcRenderer.invoke('project:begin-save', name, reuse),
  beginExport: name => ipcRenderer.invoke('project:begin-save', name, false, 'mp4'),
  beginCaptionExport: name => ipcRenderer.invoke('project:begin-save', name, false, 'srt'),
  writeChunk: bytes => ipcRenderer.invoke('project:write-chunk', bytes),
  finishSave: commit => ipcRenderer.invoke('project:finish-save', commit),
  onCloseRequest: handle => {
    const listener = () => handle()
    ipcRenderer.on('project:request-close', listener)
    return () => ipcRenderer.removeListener('project:request-close', listener)
  },
  closeWindow: () => ipcRenderer.send('project:close-window'),
})
