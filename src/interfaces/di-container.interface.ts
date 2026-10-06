import type { Context } from 'hono'
import type { Constructor } from '../types'

/**
 * Interface for dependency injection containers
 * Defines the contract that DI containers must implement to work with the Honest framework
 * Handles the creation and management of dependency instances
 */
export interface DiContainer {
	/**
	 * Resolves a dependency from the container
	 * Creates a new instance or returns an existing one based on the container's configuration
	 * @param target - The class constructor to resolve
	 * @param context - The current request; required for request-scoped classes
	 * @returns An instance of the requested class with all dependencies injected
	 * @throws {Error} If the dependency cannot be resolved
	 */
	resolve<T>(target: Constructor<T>, context?: Context): T

	/**
	 * Whether the class must be resolved per request, either because it is declared with
	 * Scope.REQUEST or because one of its dependencies is. Containers that omit this method
	 * are treated as having no request-scoped classes.
	 * @param target - The class constructor to check
	 */
	isRequestScoped?<T>(target: Constructor<T>): boolean

	/**
	 * Registers a pre-created instance in the container
	 * Used for singleton instances or mocks in testing
	 * @param target - The class constructor to register the instance for
	 * @param instance - The pre-created instance to use
	 * @throws {Error} If registration fails
	 */
	register<T>(target: Constructor<T>, instance: T): void

	/**
	 * Checks whether the container already holds an instance for the given class
	 * @param target - The class constructor to check
	 * @returns true if an instance has been resolved or registered
	 */
	has<T>(target: Constructor<T>): boolean

	/**
	 * Removes all cached instances from the container
	 * Useful for resetting state between tests
	 */
	clear(): void
}
