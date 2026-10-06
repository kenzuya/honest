import type { Scope } from '../constants'

/**
 * Options accepted by the @Service() decorator
 */
export interface ServiceOptions {
	/**
	 * Instance lifetime. Defaults to Scope.DEFAULT (singleton).
	 * A service that depends on a Scope.REQUEST service becomes request-scoped as well.
	 */
	scope?: Scope
}
