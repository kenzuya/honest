// Bundles the fixture app with wrangler (exactly what `wrangler deploy` would upload) and runs it inside
// workerd via Miniflare, asserting behaviour over HTTP. Requires the package to be built first (`bun run build`).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'

const root = dirname(fileURLToPath(import.meta.url))
const wrangler = join(root, 'node_modules', '.bin', 'wrangler')
const bindings = { GREETING: 'hello from env', API_TOKEN: 'secret' }
const auth = { authorization: 'Bearer secret' }

if (!existsSync(join(root, '../../dist/index.js'))) {
	throw new Error('dist/index.js not found: run `bun run build` in the repository root first')
}

/** Bundles an entry point with `wrangler deploy --dry-run` and returns the path of the emitted module */
function bundle(name, entry) {
	const outdir = join(root, 'dist', 'bundles', name)
	execFileSync(wrangler, ['deploy', '--dry-run', '--outdir', outdir, entry], {
		cwd: root,
		stdio: 'pipe',
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
	})
	return join(
		outdir,
		readdirSync(outdir).find((file) => file.endsWith('.js'))
	)
}

function startWorker(scriptPath) {
	return new Miniflare({
		modules: true,
		scriptPath,
		compatibilityDate: '2026-08-01',
		bindings,
		// Keep expected worker errors (e.g. the 500 test) out of the test output
		handleRuntimeStdio: (stdout, stderr) => {
			stdout.resume()
			stderr.resume()
		}
	})
}

async function request(mf, path, { method = 'GET', headers = {}, body } = {}) {
	const res = await mf.dispatchFetch(`http://worker${path}`, {
		method,
		body,
		headers: { 'content-type': 'application/json', ...headers }
	})
	const text = await res.text()
	let json
	try {
		json = JSON.parse(text)
	} catch {
		json = undefined
	}
	return { status: res.status, headers: res.headers, text, json }
}

const supportedBuilds = [
	{ name: 'tsc + wrangler bundle, top-level await entry', id: 'tsc', entry: 'dist/tsc/worker.js' },
	{ name: 'tsc + wrangler bundle, lazy entry', id: 'tsc-lazy', entry: 'dist/tsc/worker-lazy.js' }
]

for (const build of supportedBuilds) {
	describe(build.name, () => {
		let mf

		before(async () => {
			mf = startWorker(bundle(build.id, build.entry))
			await mf.ready
		})

		after(async () => {
			await mf?.dispose()
		})

		test('resolves a constructor DI chain and converts @Param via pipe metatype', async () => {
			const res = await request(mf, '/api/v1/users/1')
			assert.equal(res.status, 200)
			assert.deepEqual(res.json, { user: { id: 1, name: 'Ada' }, idType: 'number' })
		})

		test('runs controller middleware', async () => {
			const res = await request(mf, '/api/v1/users/1')
			assert.equal(res.headers.get('x-honest-mw'), 'ran')
		})

		test('pipe rejects an invalid value with 400', async () => {
			const res = await request(mf, '/api/v1/users/abc')
			assert.equal(res.status, 400)
		})

		test('maps an HTTPException thrown from a service', async () => {
			const res = await request(mf, '/api/v1/users/999')
			assert.equal(res.status, 404)
			assert.match(res.text, /User 999 not found/)
		})

		test('guard denies requests without a valid token', async () => {
			const res = await request(mf, '/api/v1/users', { method: 'POST', body: '{"name":"Bob"}' })
			assert.equal(res.status, 403)
		})

		test('guard reads env bindings and @Body binds the payload', async () => {
			const res = await request(mf, '/api/v1/users', { method: 'POST', headers: auth, body: '{"name":"Bob"}' })
			assert.equal(res.status, 200)
			assert.deepEqual(res.json, { id: 2, name: 'Bob' })
		})

		test('keeps singleton service state for the isolate lifetime', async () => {
			const res = await request(mf, '/api/v1/users/2')
			assert.equal(res.status, 200)
			assert.equal(res.json.user.name, 'Bob')
		})

		test('handles @Delete routes', async () => {
			const res = await request(mf, '/api/v1/users/2', { method: 'DELETE', headers: auth })
			assert.deepEqual(res.json, { deleted: true })
		})

		test('responds 400 to a malformed JSON body', async () => {
			const res = await request(mf, '/api/v1/users', { method: 'POST', headers: auth, body: '{oops' })
			assert.equal(res.status, 400)
		})

		test('exposes env bindings through @Ctx()', async () => {
			const res = await request(mf, '/api/v1/meta/env')
			assert.deepEqual(res.json, { greeting: 'hello from env' })
		})

		test('binds @Query and @Header', async () => {
			const res = await request(mf, '/api/v1/meta/echo?q=hi', { headers: { 'x-client': 'cli' } })
			assert.deepEqual(res.json, { q: 'hi', client: 'cli' })
		})

		test('injects the same singleton instance everywhere', async () => {
			const res = await request(mf, '/api/v1/meta/singleton')
			assert.deepEqual(res.json, { sameClock: true })
		})

		test('applies controller exception filters', async () => {
			const res = await request(mf, '/api/v1/meta/teapot')
			assert.equal(res.status, 418)
			assert.deepEqual(res.json, { filtered: true, message: 'short and stout' })
		})

		test('maps an unexpected error to 500', async () => {
			const res = await request(mf, '/api/v1/meta/boom')
			assert.equal(res.status, 500)
		})

		test('supports async handlers and timers', async () => {
			const res = await request(mf, '/api/v1/meta/async')
			assert.deepEqual(res.json, { async: true })
		})

		test('uses the not-found handler for unknown routes', async () => {
			const res = await request(mf, '/api/v1/nope')
			assert.equal(res.status, 404)
		})

		test('renders a JSX view with Layout outside the global prefix', async () => {
			const res = await request(mf, '/')
			assert.equal(res.status, 200)
			assert.match(res.headers.get('content-type'), /text\/html/)
			assert.match(res.text, /<title>Honest on Workers<\/title>/)
			assert.match(res.text, /<h1>Hello from Honest<\/h1>/)
		})
	})
}

describe("wrangler's built-in esbuild bundling of TypeScript sources (known limitation)", () => {
	test('fails fast at startup because esbuild does not emit decorator metadata', async () => {
		const mf = startWorker(bundle('esbuild', 'src/worker.ts'))
		try {
			await assert.rejects(
				mf.ready,
				/Cannot resolve dependencies for UsersService: constructor metadata is missing/
			)
		} finally {
			await mf.dispose().catch(() => {})
		}
	})
})
