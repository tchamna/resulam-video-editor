const { dialog, ipcMain } = require('electron')
const { mkdtemp, open, rename, rmdir, unlink } = require('node:fs/promises')
const { basename, dirname, join } = require('node:path')

function registerProjectFiles(window) {
  let transfer
  let opening = false
  let lastPath
  let mayClose = false
  let ready = false
  const ownWindow = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame

  async function finish(commit) {
    if (!transfer) return
    const { file, temporary, folder, destination } = transfer
    try {
      if (commit) await file.sync()
      await file.close()
      if (commit) {
        await rename(temporary, destination)
        lastPath = destination
      }
    } finally {
      await file.close().catch(() => {})
      await unlink(temporary).catch(() => {})
      await rmdir(folder).catch(() => {})
      transfer = undefined
    }
  }

  ipcMain.handle('project:begin-save', async (event, name, reuse) => {
    if (!ownWindow(event) || opening || transfer || typeof name !== 'string' || name !== basename(name) || !name.endsWith('.revie')) return false
    opening = true
    try {
      let destination = reuse === true ? lastPath : undefined
      if (!destination) {
        const choice = await dialog.showSaveDialog(window, {
          title: 'Save ReViE project', defaultPath: name, filters: [{ name: 'ReViE project', extensions: ['revie'] }],
        })
        if (choice.canceled || !choice.filePath) return false
        destination = choice.filePath
      }
      const folder = await mkdtemp(join(dirname(destination), '.revie-save-'))
      const temporary = join(folder, 'project.tmp')
      try {
        transfer = { destination, folder, temporary, file: await open(temporary, 'wx') }
      } catch (error) {
        await rmdir(folder).catch(() => {})
        throw error
      }
      return true
    } finally { opening = false }
  })
  ipcMain.handle('project:write-chunk', async (event, bytes) => {
    if (!ownWindow(event) || !transfer || !(bytes instanceof ArrayBuffer) || bytes.byteLength > 4 * 1024 * 1024) throw new Error('Invalid project save.')
    await transfer.file.writeFile(Buffer.from(bytes))
  })
  ipcMain.handle('project:finish-save', async (event, commit) => {
    if (!ownWindow(event) || !transfer) throw new Error('No project save is active.')
    await finish(commit === true)
  })

  window.webContents.once('did-finish-load', () => { ready = true })
  window.on('close', event => {
    if (mayClose || !ready) return
    event.preventDefault()
    window.webContents.send('project:request-close')
  })
  ipcMain.on('project:close-window', event => {
    if (!ownWindow(event) || opening || transfer) return
    mayClose = true
    window.close()
  })
  window.once('closed', () => { void finish(false).catch(() => {}) })
}

module.exports = { registerProjectFiles }
