/**
 * Lifetime of a service instance managed by the DI container
 */
export enum Scope {
	/**
	 * One instance per container, shared by every consumer
	 */
	DEFAULT = 'DEFAULT',

	/**
	 * One instance per HTTP request, shared by everything resolved while handling that request
	 */
	REQUEST = 'REQUEST',

	/**
	 * A new instance for every injection and every resolve call, never cached
	 */
	TRANSIENT = 'TRANSIENT'
}
