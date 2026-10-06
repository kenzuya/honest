import 'reflect-metadata'
import { afterEach, describe, expect, test } from 'bun:test'
import type { Context, Next } from 'hono'
import { Scope } from './constants'
import { Controller, Get, Service, UseGuards, UseMiddleware, UsePipes } from './decorators'
import { RequestContext } from './di'
import type { IGuard, IMiddleware, IPipe } from './interfaces'
import { NoopLogger } from './loggers'
import { MetadataRegistry } from './registries'
import { createTestApplication } from './testing'

afterEach(() => {
	MetadataRegistry.clear()
})

const appOptions = { logger: new NoopLogger() }

describe('service scopes in an application', () => {
	test('a controller injecting a request-scoped service gets a new instance per request', async () => {
		let created = 0

		@Service({ scope: Scope.REQUEST })
		class RequestCounter {
			readonly id = ++created
		}

		@Controller('scoped')
		class ScopedController {
			constructor(private readonly counter: RequestCounter) {}

			@Get()
			read() {
				return { id: this.counter.id }
			}
		}

		const { request } = await createTestApplication({ controllers: [ScopedController], appOptions })

		expect(await (await request('/scoped')).json()).toEqual({ id: 1 })
		expect(await (await request('/scoped')).json()).toEqual({ id: 2 })
	})

	test('a guard and the controller share the request-scoped instance of one request', async () => {
		@Service({ scope: Scope.REQUEST })
		class RequestState {
			checkedByGuard = false
		}

		@Service()
		class MarkingGuard implements IGuard {
			constructor(private readonly state: RequestState) {}

			canActivate() {
				this.state.checkedByGuard = true
				return true
			}
		}

		@Controller('shared')
		@UseGuards(MarkingGuard)
		class SharedController {
			constructor(private readonly state: RequestState) {}

			@Get()
			read() {
				return { checkedByGuard: this.state.checkedByGuard }
			}
		}

		const { request } = await createTestApplication({ controllers: [SharedController], appOptions })

		expect(await (await request('/shared')).json()).toEqual({ checkedByGuard: true })
	})

	test('a request-scoped service reads the request through RequestContext', async () => {
		@Service({ scope: Scope.REQUEST })
		class CurrentTenant {
			constructor(private readonly request: RequestContext) {}

			get name() {
				return this.request.context.req.header('x-tenant') ?? 'none'
			}
		}

		@Controller('tenant')
		class TenantController {
			constructor(private readonly tenant: CurrentTenant) {}

			@Get()
			read() {
				return { tenant: this.tenant.name }
			}
		}

		const { request } = await createTestApplication({
			controllers: [TenantController],
			services: [CurrentTenant],
			appOptions
		})

		expect(await (await request('/tenant', { headers: { 'x-tenant': 'acme' } })).json()).toEqual({ tenant: 'acme' })
		expect(await (await request('/tenant')).json()).toEqual({ tenant: 'none' })
	})

	test('a controller without request-scoped dependencies is constructed once', async () => {
		let constructed = 0

		@Service()
		class SingletonService {}

		@Controller('singleton')
		class SingletonController {
			constructor(private readonly service: SingletonService) {
				constructed++
			}

			@Get()
			read() {
				return { ok: this.service instanceof SingletonService }
			}
		}

		const { request } = await createTestApplication({ controllers: [SingletonController], appOptions })

		await request('/singleton')
		await request('/singleton')
		expect(constructed).toBe(1)
	})

	test('request-scoped middleware is created for each request', async () => {
		let created = 0

		@Service({ scope: Scope.REQUEST })
		class StampMiddleware implements IMiddleware {
			private readonly id = ++created

			async use(c: Context, next: Next) {
				c.header('x-middleware-id', String(this.id))
				await next()
			}
		}

		@Controller('stamped')
		@UseMiddleware(StampMiddleware)
		class StampedController {
			@Get()
			read() {
				return { ok: true }
			}
		}

		const { request } = await createTestApplication({ controllers: [StampedController], appOptions })

		expect((await request('/stamped')).headers.get('x-middleware-id')).toBe('1')
		expect((await request('/stamped')).headers.get('x-middleware-id')).toBe('2')
	})

	test('a request-scoped pipe fails at startup with a clear error', async () => {
		@Service({ scope: Scope.REQUEST })
		class RequestPipe implements IPipe {
			transform(value: unknown) {
				return value
			}
		}

		@Controller('piped')
		@UsePipes(RequestPipe)
		class PipedController {
			@Get()
			read() {
				return { ok: true }
			}
		}

		await expect(createTestApplication({ controllers: [PipedController], appOptions })).rejects.toThrow(
			'Pipe RequestPipe cannot be request-scoped'
		)
	})
})
