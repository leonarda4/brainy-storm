import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

test('live defaults disable browser reloads while runtime and backend env files stay unwatched', () => {
  const previous = process.env.FRONTEND_HMR
  try {
    delete process.env.FRONTEND_HMR
    const config = viteConfig({ command: 'serve', mode: 'development' })
    assert.equal(config.server.hmr, false)
    assert.equal(config.server.ws, false)
    for (const path of ['data/ideas.json', 'data/storms/test/transcript.txt', 'pubsub/classified-chunks.jsonl', '.runtime/transcriber.log', '.env', '.env.development.local']) {
      assert.equal(config.server.watch.ignored(resolve('..', path)), true, path)
    }
    assert.equal(config.server.watch.ignored(resolve('src/App.tsx')), false)
    assert.equal(config.server.proxy['/api/transcriber'].ws, true)
    process.env.FRONTEND_HMR = 'true'
    const development = viteConfig({ command: 'serve', mode: 'development' })
    assert.equal(development.server.hmr, true)
    assert.equal(development.server.ws, undefined)
    assert.equal(development.server.watch.ignored(resolve('../data/ideas.json')), true)
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_HMR
    else process.env.FRONTEND_HMR = previous
  }
})

test('idea and source updates keep the recording proxy connected and deliver speaker updates without reloads', { timeout: 15000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'brainstorm-live-updates-')))
  const root = join(directory, 'frontend')
  await mkdir(root)
  const dataFile = join(directory, 'ideas.json')
  const sourceFile = join(root, 'probe.js')
  await writeFile(dataFile, '[]')
  await writeFile(sourceFile, 'export const version = 1')
  let ideas = []
  let recordingSocket
  const backend = createHttpServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(ideas))
  })
  // Minimal local WebSocket fixture: no microphone or external service is used.
  backend.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    recordingSocket = socket
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  let server
  let client
  try {
    const config = viteConfig({ command: 'serve', mode: 'test' })
    const target = `http://127.0.0.1:${backend.address().port}`
    server = await createServer({
      ...config, configFile: false, root, envDir: false, logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { ...config.server, host: '127.0.0.1', port: 0, fs: { allow: [directory] },
        proxy: { '/api/transcriber': { target, ws: true }, '/api/enrichment': { target } },
      },
    })
    const reloads = []
    server.environments.client.hot.send = message => reloads.push(message)
    await server.listen()
    const port = server.httpServer.address().port
    client = new WebSocket(`ws://127.0.0.1:${port}/api/transcriber/ws/transcribe`)
    await once(client, 'open')
    await server.transformRequest('/probe.js')
    await server.transformRequest(`/@fs${dataFile}`)
    // Reproduce updates to a watched JSON module as well as React/source changes.
    ideas = [{ id: 'idea-a', title: 'Updated idea', summary: 'Fresh speech', is_currently_discussed: true }]
    await writeFile(dataFile, JSON.stringify(ideas))
    const changed = once(server.watcher, 'change')
    await writeFile(sourceFile, 'export const version = 2')
    await changed
    await delay(200)
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/enrichment/ideas`)).json(), ideas)
    assert.equal(client.readyState, WebSocket.OPEN)
    assert.deepEqual(reloads, [])
    const message = once(client, 'message')
    const update = Buffer.from(JSON.stringify({ type: 'speakers', lines: [{ person: 'Maya', text: 'The updated idea.' }] }))
    assert.ok(update.length < 126)
    recordingSocket.write(Buffer.concat([Buffer.from([0x81, update.length]), update]))
    assert.equal(JSON.parse((await message)[0].data).lines[0].person, 'Maya')
    assert.equal(client.readyState, WebSocket.OPEN)
  } finally {
    recordingSocket?.destroy()
    client?.close()
    await server?.close()
    backend.closeAllConnections()
    await new Promise(resolve => backend.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
