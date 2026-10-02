import 'reflect-metadata'
import { afterEach, describe, expect, test } from 'bun:test'
import type { Context } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { Application } from './application'
import {
	Body,
	Controller,
	Ctx,
	Get,
	Module,
	Post,
	Service,
	UseFilters,
	UseGuards,
	UseMiddleware,
	View
} from './decorators'
import type { IFilter, IGuard, IMiddleware } from './interfaces'
import { MetadataRegistry } from './registries'
import { createOnlyAController, createOnlyBController } from './testing/fixtures/application-test-fixtures'
import { createControllerTestApplication } from './testing'

afterEach(() => {
	MetadataRegistry.clear()
})

describe('Application regressions', () => {
	test('global guards do not leak between sequential Application.create() calls', async () => {
		let guardCalled = false
		const LeakyGuard: IGuard = {
			canActivate() {
				guardCalled = true
				return false
			}
		}

		await createControllerTestApplication({
			controller: createOnlyAController(),
			appOptions: { components: { guards: [LeakyGuard] } }
		})

		expect(guardCalled).toBe(false)
		guardCalled = false

		const testApp = await createControllerTestApplication({ controller: createOnlyBController() })
		const res = await testApp.request('/only-b')

		expect(guardCalled).toBe(false)
		expect(res.status).toBe(200)
	})

	test('shared module imported by two parents is registered only once (deduplication)', async () => {
		@Service()
		class SharedService {
			value = Math.random()
		}

		@Controller('/shared')
		class SharedController {
			@Get()
			index() {
				return { ok: true }
			}
		}

		@Module({ controllers: [SharedController], services: [SharedService] })
		class SharedModule {}

		@Controller('/branch-a')
		class BranchAController {
			@Get()
			index() {
				return { branch: 'a' }
			}
		}

		@Module({ controllers: [BranchAController], imports: [SharedModule] })
		class BranchAModule {}

		@Controller('/branch-b')
		class BranchBController {
			@Get()
			index() {
				return { branch: 'b' }
			}
		}

		@Module({ controllers: [BranchBController], imports: [SharedModule] })
		class BranchBModule {}

		@Module({ imports: [BranchAModule, BranchBModule] })
		class DiamondRootModule {}

		const { app } = await Application.create(DiamondRootModule)
		const routes = app.getRoutes()
		const sharedRoutes = routes.filter((r) => r.fullPath.includes('/shared'))
		expect(sharedRoutes.length).toBe(1)
	})

	test('filter that throws returns a 500 instead of silently swallowing', async () => {
		const BrokenFilter: IFilter = {
			catch(): Response {
				throw new Error('filter exploded')
			}
		}

		@Controller('/filter-err')
		@UseFilters(BrokenFilter)
		class FilterErrorController {
			@Get()
			index() {
				throw new Error('original error')
			}
		}

		const testApp = await createControllerTestApplication({
			controller: FilterErrorController
		})
		const res = await testApp.request('/filter-err')

		expect(res.status).toBe(500)
		const body = await res.json()
		expect(body.message).toContain('filter exploded')
	})
})

const TeapotFilter: IFilter = {
	catch(exception: Error, context: Context): Response {
		return context.json({ filtered: exception.message }, 418)
	}
}

const ThrowingMiddleware: IMiddleware = {
	async use() {
		throw new Error('middleware failed')
	}
}

describe('Request pipeline regressions', () => {
	test('@Ctx() handler returning a plain object responds with JSON', async () => {
		@Controller('/ctx')
		class CtxController {
			@Get()
			index(@Ctx() c: Context) {
				return { path: c.req.path }
			}
		}

		const testApp = await createControllerTestApplication({ controller: CtxController })
		const res = await testApp.request('/ctx')

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ path: '/ctx' })
	})

	test('Hono basicAuth challenge keeps its WWW-Authenticate header', async () => {
		@Controller('/secure')
		@UseMiddleware({ use: basicAuth({ username: 'user', password: 'pass' }) })
		class SecureController {
			@Get()
			index() {
				return 'secret'
			}
		}

		const testApp = await createControllerTestApplication({ controller: SecureController })
		const res = await testApp.request('/secure')

		expect(res.status).toBe(401)
		expect(res.headers.get('WWW-Authenticate')).toContain('Basic')
	})

	test('error with a non-HTTP status property responds 500', async () => {
		@Controller('/upstream')
		class UpstreamController {
			@Get()
			index() {
				throw Object.assign(new Error('upstream failed'), { status: 'failed' })
			}
		}

		const testApp = await createControllerTestApplication({ controller: UpstreamController })
		const res = await testApp.request('/upstream')

		expect(res.status).toBe(500)
	})

	test('@Body() with malformed or missing JSON responds 400', async () => {
		@Controller('/body')
		class BodyController {
			@Post()
			create(@Body() body: unknown) {
				return { body }
			}
		}

		const testApp = await createControllerTestApplication({ controller: BodyController })
		const headers = { 'content-type': 'application/json' }
		const malformed = await testApp.request('/body', { method: 'POST', body: '{bad', headers })
		const missing = await testApp.request('/body', { method: 'POST' })

		expect(malformed.status).toBe(400)
		expect((await malformed.json()).message).toBe('Invalid JSON request body')
		expect(missing.status).toBe(400)
	})

	test('@Body(key) is undefined when the body is not an object', async () => {
		@Controller('/body-key')
		class BodyKeyController {
			@Post()
			create(@Body('name') name: unknown) {
				return { name: name ?? null }
			}
		}

		const testApp = await createControllerTestApplication({ controller: BodyKeyController })
		const res = await testApp.request('/body-key', {
			method: 'POST',
			body: '"hello"',
			headers: { 'content-type': 'application/json' }
		})

		expect(await res.json()).toEqual({ name: null })
	})

	test('handler-level filter runs for a symbol-named handler', async () => {
		const handlerKey = Symbol('symbolHandler')

		@Controller('/symbol')
		class SymbolController {
			@Get()
			@UseFilters(TeapotFilter)
			[handlerKey]() {
				throw new Error('symbol boom')
			}
		}

		const testApp = await createControllerTestApplication({ controller: SymbolController })
		const res = await testApp.request('/symbol')

		expect(res.status).toBe(418)
		expect(await res.json()).toEqual({ filtered: 'symbol boom' })
	})

	test('route middleware errors run through controller filters', async () => {
		@Controller('/mw-filter')
		@UseFilters(TeapotFilter)
		class MiddlewareFilterController {
			@Get()
			@UseMiddleware(ThrowingMiddleware)
			index() {
				return 'unreachable'
			}
		}

		const testApp = await createControllerTestApplication({ controller: MiddlewareFilterController })
		const res = await testApp.request('/mw-filter')

		expect(res.status).toBe(418)
		expect(await res.json()).toEqual({ filtered: 'middleware failed' })
	})

	test('global middleware errors run through global filters', async () => {
		const testApp = await createControllerTestApplication({
			controller: createOnlyAController(),
			appOptions: { components: { middleware: [ThrowingMiddleware], filters: [TeapotFilter] } }
		})
		const res = await testApp.request('/only-a')

		expect(res.status).toBe(418)
	})

	test('custom onError handles handler and middleware errors that no filter handled', async () => {
		@Controller('/on-error')
		class OnErrorController {
			@Get('handler')
			fromHandler() {
				throw new Error('handler failed')
			}

			@Get('middleware')
			@UseMiddleware(ThrowingMiddleware)
			fromMiddleware() {
				return 'unreachable'
			}
		}

		const testApp = await createControllerTestApplication({
			controller: OnErrorController,
			appOptions: { onError: (error, c) => c.text(`custom: ${(error as Error).message}`, 503) }
		})
		const handlerRes = await testApp.request('/on-error/handler')
		const middlewareRes = await testApp.request('/on-error/middleware')

		expect(handlerRes.status).toBe(503)
		expect(await handlerRes.text()).toBe('custom: handler failed')
		expect(middlewareRes.status).toBe(503)
		expect(await middlewareRes.text()).toBe('custom: middleware failed')
	})

	test('guard rejection does not expose guard or handler names', async () => {
		class SecretPolicyGuard implements IGuard {
			canActivate() {
				return false
			}
		}

		@Controller('/guarded')
		@UseGuards(new SecretPolicyGuard())
		class GuardedController {
			@Get()
			internalHandlerName() {
				return 'unreachable'
			}
		}

		const testApp = await createControllerTestApplication({ controller: GuardedController })
		const res = await testApp.request('/guarded')
		const body = await res.json()

		expect(res.status).toBe(403)
		expect(body.message).toBe('Forbidden')
	})
})

describe('Registration regressions', () => {
	test('controller listed by two modules registers its routes once', async () => {
		@Controller('/listed-twice')
		class ListedTwiceController {
			@Get()
			index() {
				return { ok: true }
			}
		}

		@Module({ controllers: [ListedTwiceController] })
		class FirstModule {}

		@Module({ controllers: [ListedTwiceController] })
		class SecondModule {}

		@Module({ imports: [FirstModule, SecondModule] })
		class RootModule {}

		const { app } = await Application.create(RootModule)

		expect(app.getRoutes().map((route) => route.fullPath)).toEqual(['/listed-twice'])
	})

	test('@View() with partial options still opts out of the global version', async () => {
		@View('page', { prefix: 'ui' })
		class PageView {
			@Get()
			index() {
				return 'page'
			}
		}

		const testApp = await createControllerTestApplication({
			controller: PageView,
			appOptions: { routing: { prefix: 'api', version: 1 } }
		})
		const res = await testApp.request('/ui/page')

		expect(res.status).toBe(200)
		expect(testApp.app.getRoutes().map((route) => route.fullPath)).toEqual(['/ui/page'])
	})
})
