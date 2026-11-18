const { app, BrowserWindow, desktopCapturer, dialog, Menu, net, protocol, session } = require('electron')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const origin = 'revie://editor'
const title = 'Resulam Video Editor - ReViE'

protocol.registerSchemesAsPrivileged([{ scheme: 'revie', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

app.whenReady().then(() => {
  protocol.handle('revie', request => {
    const url = new URL(request.url)
    const path = url.pathname === '/' ? '/index.html' : url.pathname
    if (url.hostname !== 'editor' || !/^\/(index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(path)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(join(__dirname, 'dist', path.slice(1))).href)
  })

  const editor = new BrowserWindow({
    title, width: 1440, height: 900, minWidth: 700, minHeight: 580, backgroundColor: '#101216',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  editor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  editor.webContents.on('will-navigate', event => event.preventDefault())
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === editor.webContents && permission === 'display-capture')
  })
  session.defaultSession.setDisplayMediaRequestHandler(async (request, choose) => {
    if (!request.userGesture || request.frame !== editor.webContents.mainFrame || !request.videoRequested) {
      choose({})
      return
    }

    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      if (editor.isDestroyed() || !sources.length) {
        choose({})
        return
      }
      let chosen
      let includeAudio = false
      const menu = Menu.buildFromTemplate([
        ...sources.map(source => ({
          label: source.name.replaceAll('&', '&&'),
          submenu: [
            { label: 'Record video only', click: () => { chosen = source } },
            ...(request.audioRequested ? [{
              label: 'Record with system audio',
              click: () => { chosen = source; includeAudio = true },
            }] : []),
          ],
        })),
        { type: 'separator' },
        { label: 'Cancel' },
      ])
      menu.popup({ window: editor, callback: () => choose(chosen ? { video: chosen, ...(includeAudio ? { audio: 'loopback' } : {}) } : {}) })
    } catch {
      choose({})
      if (!editor.isDestroyed()) dialog.showErrorBox(title, 'No screen or window could be opened for recording.')
    }
  })
  editor.loadURL(origin)
})

app.on('window-all-closed', () => app.quit())
