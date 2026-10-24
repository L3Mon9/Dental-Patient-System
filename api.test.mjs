import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api } from './src/api.js'

test('API responses preserve sign-in errors and explain connection failures', async t => {
 const original = globalThis.fetch
 t.after(() => { globalThis.fetch = original })
 globalThis.fetch = async () => new Response(JSON.stringify({ user: { id: 'test' } }))
 assert.deepEqual(await api('login', {}), { user: { id: 'test' } })
 globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401 })
 await assert.rejects(api('login', {}), /Invalid email or password/)
 for (const body of ['', '<html>Frontend fallback</html>', '{']) {
  globalThis.fetch = async () => new Response(body, { status: 502 })
  await assert.rejects(api('login', {}), /invalid or empty response/)
 }
 globalThis.fetch = async () => new Response('null')
 await assert.rejects(api('login', {}), /unexpected response/)
 globalThis.fetch = async () => { throw new TypeError('fetch failed') }
 await assert.rejects(api('login', {}), /Cannot reach the server/)
})
