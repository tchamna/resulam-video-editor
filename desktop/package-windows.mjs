import { cp, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build the x64 Windows portable package on x64 Windows.')
}

const electron = createRequire(import.meta.url)('electron')
const runtime = dirname(electron)
const outputRoot = join(import.meta.dirname, 'out')
await mkdir(outputRoot, { recursive: true })
const output = join(await mkdtemp(join(outputRoot, 'windows-x64-')), 'ReViE')
await mkdir(output)
for (const entry of await readdir(runtime)) {
  if (entry === 'resources' || entry === 'electron.exe') continue
  await cp(join(runtime, entry), join(output, entry), { recursive: true })
}
await cp(join(runtime, 'electron.exe'), join(output, 'ReViE.exe'))

const appFolder = join(output, 'resources', 'app')
await mkdir(appFolder, { recursive: true })
await cp(join(import.meta.dirname, 'main.cjs'), join(appFolder, 'main.cjs'))
const build = join(import.meta.dirname, '..', 'dist')
const bundledBuild = join(appFolder, 'dist')
await mkdir(bundledBuild)
await cp(join(build, 'index.html'), join(bundledBuild, 'index.html'))
await cp(join(build, 'assets'), join(bundledBuild, 'assets'), { recursive: true })
await writeFile(join(appFolder, 'package.json'), JSON.stringify({
  name: 'revie-desktop', productName: 'Resulam Video Editor - ReViE', version: '1.0.0', main: 'main.cjs',
}))
await writeFile(join(output, 'START-HERE.txt'), [
  'Resulam Video Editor - ReViE',
  '',
  'Extract the entire ZIP, then double-click ReViE.exe in this folder.',
  'Keep the other files and folders beside ReViE.exe.',
  'Use an x64 Windows 11 or Windows 10 computer.',
  'Import videos and export MP4s locally. Internet access is not required.',
  '',
].join('\r\n'))
console.log(output)
