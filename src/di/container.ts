import type { Context } from 'hono'
import { Scope } from '../constants'
import { NoopLogger } from '../loggers'
import type { LogEvent, DiContainer, ILogger, IServiceRegistry } from '../interfaces'
import { StaticServiceRegistry } from '../registries'
import type { Constructor } from '../types'
import { RequestContext } from './request-context'

/**
 * Dependency Injection container that manages class instances and their dependencies
 */
export class Container implements DiContainer {
	constructor(
		private readonly serviceRegistry: IServiceRegistry = new StaticServiceRegistry(),
		private readonly logger: ILogger = new NoopLogger(),
		private readonly debugDi = false
	) {}

	/**
	 * Map of class constructors to their singleton or registered instances
	 */
	private instances = new Map<Constructor, any>()

	/**
	 * Request-scoped instances, keyed by the request they belong to.
	 * Entries are released together with the Hono Context.
	 */
	private requestInstances = new WeakMap<Context, Map<Constructor, any>>()

	/**
	 * Memoized results of {@link isRequestScoped}
	 */
	private requestScopeCache = new Map<Constructor, boolean>()

	private emitLog(event: LogEvent): void {
		if (!this.debugDi) {
			return
		}
		this.logger.emit(event)
	}

	/**
	 * Resolves a class instance, creating it if necessary and injecting its dependencies
	 * @param target - The class constructor to resolve
	 * @param context - The current request; required for request-scoped classes
	 * @returns An instance of the target class
	 */
	resolve<T>(target: Constructor<T>, context?: Context): T {
		return this.resolveWithTracking(target, new Set<Constructor>(), context)
	}

	/**
	 * Whether the class must be resolved per request: it is declared with Scope.REQUEST,
	 * it is RequestContext, or one of its dependencies is request-scoped.
	 */
	isRequestScoped<T>(target: Constructor<T>): boolean {
		return this.computeRequestScoped(target, new Set<Constructor>())
	}

	private computeRequestScoped(target: Constructor, visiting: Set<Constructor>): boolean {
		const cached = this.requestScopeCache.get(target)
		if (cached !== undefined) {
			return cached
		}
		// A cycle is reported by resolve(); here it only needs to terminate
		if (visiting.has(target)) {
			return false
		}

		let requestScoped = target === RequestContext || this.getScope(target) === Scope.REQUEST
		if (!requestScoped) {
			visiting.add(target)
			const paramTypes: Constructor[] = Reflect.getMetadata('design:paramtypes', target) || []
			requestScoped = paramTypes.some(
				(paramType) => this.isClassDependency(paramType) && this.computeRequestScoped(paramType, visiting)
			)
			visiting.delete(target)
		}

		// A false result reached while a cycle was cut short may be incomplete, so only the
		// outermost call records it
		if (requestScoped || visiting.size === 0) {
			this.requestScopeCache.set(target, requestScoped)
		}
		return requestScoped
	}

	private getScope(target: Constructor): Scope {
		return this.serviceRegistry.getScope?.(target) ?? Scope.DEFAULT
	}

	private isClassDependency(paramType: unknown): paramType is Constructor {
		return Boolean(paramType) && paramType !== Object && paramType !== Array && paramType !== Function
	}

	private getRequestInstances(context: Context): Map<Constructor, any> {
		let instances = this.requestInstances.get(context)
		if (!instances) {
			instances = new Map<Constructor, any>([[RequestContext, new RequestContext(context)]])
			this.requestInstances.set(context, instances)
		}
		return instances
	}

	/**
	 * Internal recursive resolver with circular dependency tracking
	 */
	private resolveWithTracking<T>(target: Constructor<T>, resolving: Set<Constructor>, context?: Context): T {
		if (this.instances.has(target)) {
			this.emitLog({
				level: 'debug',
				category: 'di',
				message: `Resolved ${target.name} from DI cache`
			})
			return this.instances.get(target)
		}

		const scope = this.getScope(target)
		let requestInstances: Map<Constructor, any> | undefined

		if (this.isRequestScoped(target)) {
			if (!context) {
				this.emitLog({
					level: 'error',
					category: 'di',
					message: `Cannot resolve ${target.name} outside a request`
				})
				throw new Error(
					`Cannot resolve ${target.name} outside a request: it is request-scoped (Scope.REQUEST, directly or through a dependency).`
				)
			}
			requestInstances = this.getRequestInstances(context)
			if (scope !== Scope.TRANSIENT && requestInstances.has(target)) {
				this.emitLog({
					level: 'debug',
					category: 'di',
					message: `Resolved ${target.name} from request cache`
				})
				return requestInstances.get(target)
			}
		}

		if (resolving.has(target)) {
			const cycle = [...resolving.keys(), target].map((t) => t.name).join(' -> ')
			this.emitLog({
				level: 'error',
				category: 'di',
				message: `Circular dependency detected while resolving ${target.name}`,
				details: { cycle }
			})
			throw new Error(`Circular dependency detected: ${cycle}`)
		}
		resolving.add(target)

		this.emitLog({
			level: 'debug',
			category: 'di',
			message: `Resolving ${target.name}`,
			details: { resolving: [...resolving].map((constructor) => constructor.name) }
		})

		const paramTypes = Reflect.getMetadata('design:paramtypes', target) || []
		if (target.length > 0 && paramTypes.length === 0) {
			if (!this.serviceRegistry.isService(target)) {
				this.emitLog({
					level: 'error',
					category: 'di',
					message: `Cannot resolve ${target.name}: missing @Service() decorator`
				})
				throw new Error(
					`Cannot resolve ${target.name}: it is not decorated with @Service(). Did you forget to add @Service() to the class?`
				)
			}
			this.emitLog({
				level: 'error',
				category: 'di',
				message: `Cannot resolve ${target.name}: missing constructor metadata`
			})
			throw new Error(
				`Cannot resolve dependencies for ${target.name}: constructor metadata is missing. Ensure 'reflect-metadata' is imported and 'emitDecoratorMetadata' is enabled.`
			)
		}

		const dependencies = paramTypes.map((paramType: Constructor, index: number) => {
			if (!this.isClassDependency(paramType)) {
				this.emitLog({
					level: 'error',
					category: 'di',
					message: `Cannot resolve dependency at index ${index} of ${target.name}`
				})
				throw new Error(
					`Cannot resolve dependency at index ${index} of ${target.name}. Use concrete class types for constructor dependencies.`
				)
			}
			return this.resolveWithTracking(paramType, new Set(resolving), context)
		})

		const instance = new target(...dependencies)

		let kind = 'singleton'
		if (scope === Scope.TRANSIENT) {
			kind = 'transient'
		} else if (requestInstances) {
			kind = 'request-scoped'
			requestInstances.set(target, instance)
		} else {
			this.instances.set(target, instance)
		}

		this.emitLog({
			level: 'debug',
			category: 'di',
			message: `Created ${kind} ${target.name} instance`,
			details: { dependencyCount: dependencies.length }
		})

		return instance
	}

	/**
	 * Registers a pre-created instance for a class
	 * @param target - The class constructor to register
	 * @param instance - The instance to register
	 */
	register<T>(target: Constructor<T>, instance: T): void {
		this.instances.set(target, instance)
	}

	has<T>(target: Constructor<T>): boolean {
		return this.instances.has(target)
	}

	clear(): void {
		this.instances.clear()
		this.requestScopeCache.clear()
	}
}
