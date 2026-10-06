import type { Context } from 'hono'

/**
 * Injectable handle to the current request. Only resolvable while a request is being handled,
 * so any class that injects it becomes request-scoped.
 */
export class RequestContext {
	constructor(readonly context: Context) {}
}
