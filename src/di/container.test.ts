import 'reflect-metadata'
import { describe, expect, test } from 'bun:test'
import type { Context } from 'hono'
import { Scope } from '../constants'
import { Service } from '../decorators'
import type { LogEvent, ILogger, IServiceRegistry } from '../interfaces'
import { Container } from './container'
import { RequestContext } from './request-context'

// The container only uses the context as a cache key, so any object stands in for a request
const fakeContext = () => ({}) as Context

describe('Container', () => {
	test('resolve() returns same instance for class with no deps (singleton)', () => {
		class NoDeps {}
		const container = new Container()
		const a = container.resolve(NoDeps)
		const b = container.resolve(NoDeps)
		expect(a).toBe(b)
		expect(a).toBeInstanceOf(NoDeps)
	})

	test('resolve() injects dependency when constructor has one param', () => {
		class Dep {}
		class WithDep {
			constructor(public dep: Dep) {}
		}
		Reflect.defineMetadata('design:paramtypes', [Dep], WithDep)

		const container = new Container()
		const instance = container.resolve(WithDep)
		expect(instance).toBeInstanceOf(WithDep)
		expect(instance.dep).toBeInstanceOf(Dep)
		expect(instance.dep).toBe(container.resolve(Dep))
	})

	test('resolve() throws when circular dependency is detected', () => {
		class CircularA {
			constructor(_b: CircularB) {}
		}
		class CircularB {
			constructor(_a: CircularA) {}
		}
		Reflect.defineMetadata('design:paramtypes', [CircularB], CircularA)
		Reflect.defineMetadata('design:paramtypes', [CircularA], CircularB)

		const container = new Container()
		expect(() => container.resolve(CircularA)).toThrow('Circular dependency detected')
	})

	test('register() allows pre-created instance; resolve() returns it', () => {
		class Service {}
		const container = new Container()
		const instance = new Service()
		container.register(Service, instance)
		expect(container.resolve(Service)).toBe(instance)
	})

	test('resolve() tells you to add @Service() when decorator is missing', () => {
		class NeedsDep {
			constructor(_dep: unknown) {}
		}

		const container = new Container()
		expect(() => container.resolve(NeedsDep)).toThrow('not decorated with @Service()')
	})

	test('resolve() shows metadata error for decorated class with missing reflect-metadata', () => {
		@Service()
		class DecoratedButNoMeta {
			constructor(_dep: unknown) {}
		}
		// Clear the paramtypes that TypeScript might have emitted
		Reflect.deleteMetadata('design:paramtypes', DecoratedButNoMeta)

		const container = new Container()
		expect(() => container.resolve(DecoratedButNoMeta)).toThrow('constructor metadata is missing')
	})

	test('resolve() throws clear error for non-class dependency metadata', () => {
		class BadDepController {
			constructor(_dep: unknown) {}
		}
		Reflect.defineMetadata('design:paramtypes', [Object], BadDepController)

		const container = new Container()
		expect(() => container.resolve(BadDepController)).toThrow('Cannot resolve dependency at index 0')
	})

	test('resolve() uses injected service registry contract', () => {
		class NeedsDep {
			constructor(_dep: unknown) {}
		}

		const serviceRegistry: IServiceRegistry = {
			isService() {
				return true
			}
		}

		const container = new Container(serviceRegistry)
		expect(() => container.resolve(NeedsDep)).toThrow('constructor metadata is missing')
	})

	test('resolve() emits DI diagnostics when debug mode is enabled', () => {
		class Dependency {}
		class Consumer {
			constructor(public readonly dependency: Dependency) {}
		}
		Reflect.defineMetadata('design:paramtypes', [Dependency], Consumer)

		const events: LogEvent[] = []
		const logger: ILogger = {
			emit(event) {
				events.push(event)
			}
		}

		const container = new Container(undefined, logger, true)
		container.resolve(Consumer)
		container.resolve(Consumer)

		expect(events.some((event) => event.category === 'di' && event.message.includes('Resolving Consumer'))).toBe(
			true
		)
		expect(
			events.some((event) => event.category === 'di' && event.message.includes('Resolved Consumer from DI cache'))
		).toBe(true)
	})
})

describe('Container scopes', () => {
	test('Scope.DEFAULT services are singletons', () => {
		@Service({ scope: Scope.DEFAULT })
		class DefaultService {}

		const container = new Container()
		expect(container.resolve(DefaultService)).toBe(container.resolve(DefaultService))
	})

	test('Scope.TRANSIENT services are created for every resolve and every injection', () => {
		@Service({ scope: Scope.TRANSIENT })
		class TransientService {}

		@Service()
		class Consumer {
			constructor(
				public readonly first: TransientService,
				public readonly second: TransientService
			) {}
		}

		const container = new Container()
		expect(container.resolve(TransientService)).not.toBe(container.resolve(TransientService))

		const consumer = container.resolve(Consumer)
		expect(consumer.first).toBeInstanceOf(TransientService)
		expect(consumer.first).not.toBe(consumer.second)
	})

	test('Scope.REQUEST services are shared within a request and separate across requests', () => {
		@Service({ scope: Scope.REQUEST })
		class RequestService {}

		const container = new Container()
		const requestA = fakeContext()
		const requestB = fakeContext()

		expect(container.resolve(RequestService, requestA)).toBe(container.resolve(RequestService, requestA))
		expect(container.resolve(RequestService, requestA)).not.toBe(container.resolve(RequestService, requestB))
		expect(container.has(RequestService)).toBe(false)
	})

	test('Scope.REQUEST services cannot be resolved outside a request', () => {
		@Service({ scope: Scope.REQUEST })
		class RequestOnly {}

		const container = new Container()
		expect(() => container.resolve(RequestOnly)).toThrow('Cannot resolve RequestOnly outside a request')
	})

	test('a service depending on a request-scoped service becomes request-scoped', () => {
		@Service({ scope: Scope.REQUEST })
		class RequestService {}

		@Service()
		class Middle {
			constructor(public readonly requestService: RequestService) {}
		}

		@Service()
		class Top {
			constructor(public readonly middle: Middle) {}
		}

		@Service()
		class Unrelated {}

		const container = new Container()
		expect(container.isRequestScoped(Top)).toBe(true)
		expect(container.isRequestScoped(Unrelated)).toBe(false)

		const request = fakeContext()
		const top = container.resolve(Top, request)
		expect(top).toBe(container.resolve(Top, request))
		expect(top.middle.requestService).toBe(container.resolve(RequestService, request))
		expect(top).not.toBe(container.resolve(Top, fakeContext()))
		expect(() => container.resolve(Top)).toThrow('outside a request')
	})

	test('a transient service with a request-scoped dependency stays transient within the request', () => {
		@Service({ scope: Scope.REQUEST })
		class RequestService {}

		@Service({ scope: Scope.TRANSIENT })
		class TransientConsumer {
			constructor(public readonly requestService: RequestService) {}
		}

		const container = new Container()
		const request = fakeContext()
		const first = container.resolve(TransientConsumer, request)
		const second = container.resolve(TransientConsumer, request)
		expect(first).not.toBe(second)
		expect(first.requestService).toBe(second.requestService)
	})

	test('RequestContext injection exposes the current request', () => {
		@Service({ scope: Scope.REQUEST })
		class ReadsRequest {
			constructor(public readonly request: RequestContext) {}
		}

		const container = new Container()
		const request = fakeContext()
		expect(container.resolve(ReadsRequest, request).request.context).toBe(request)
		expect(() => container.resolve(RequestContext)).toThrow('outside a request')
	})

	test('register() overrides take priority over request scope', () => {
		@Service({ scope: Scope.REQUEST })
		class RequestService {}

		const container = new Container()
		const override = new RequestService()
		container.register(RequestService, override)
		expect(container.resolve(RequestService)).toBe(override)
		expect(container.resolve(RequestService, fakeContext())).toBe(override)
	})

	test('a service registry without getScope treats every class as Scope.DEFAULT', () => {
		@Service({ scope: Scope.REQUEST })
		class DeclaredRequest {}

		const container = new Container({ isService: () => true })
		expect(container.isRequestScoped(DeclaredRequest)).toBe(false)
		expect(container.resolve(DeclaredRequest)).toBe(container.resolve(DeclaredRequest))
	})
})
