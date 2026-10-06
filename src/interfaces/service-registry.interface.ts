import type { Scope } from '../constants'
import type { Constructor } from '../types'

/**
 * Contract for checking whether classes are registered as injectable services.
 */
export interface IServiceRegistry {
	isService(service: Constructor): boolean

	/**
	 * Returns the declared scope of a service. When not implemented, every class is treated as Scope.DEFAULT.
	 */
	getScope?(service: Constructor): Scope
}
