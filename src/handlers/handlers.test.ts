import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ErrorHandler } from './error.handler'
import { NotFoundHandler } from './not-found.handler'

describe('NotFoundHandler', () => {
	test('returns 404 with path in message', async () => {
		const app = new Hono()
		app.notFound(NotFoundHandler.handle())

		const res = await app.request(new Request('http://localhost/does-not-exist'))
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body.message).toContain('/does-not-exist')
		expect(body.message).toContain('Not Found')
	})
})

describe('ErrorHandler', () => {
	test('returns 500 JSON error response', async () => {
		const app = new Hono()
		app.get('/boom', () => {
			throw new Error('kaboom')
		})
		app.onError(ErrorHandler.handle())

		const res = await app.request(new Request('http://localhost/boom'))
		expect(res.status).toBe(500)
		const body = await res.json()
		expect(body.status).toBe(500)
		expect(body.path).toBe('/boom')
		expect(body.timestamp).toBeDefined()
	})

	test('returns the custom response of an HTTPException unchanged', async () => {
		const app = new Hono()
		app.get('/auth', () => {
			throw new HTTPException(401, {
				res: new Response('Unauthorized', {
					status: 401,
					headers: { 'WWW-Authenticate': 'Basic realm="secure"' }
				})
			})
		})
		app.onError(ErrorHandler.handle())

		const res = await app.request(new Request('http://localhost/auth'))
		expect(res.status).toBe(401)
		expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="secure"')
		expect(await res.text()).toBe('Unauthorized')
	})
})
