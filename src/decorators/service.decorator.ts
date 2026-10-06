import { Scope } from '../constants'
import type { ServiceOptions } from '../interfaces'
import { MetadataRegistry } from '../registries'

/**
 * Decorator that marks a class as an injectable service
 * By default a service is a singleton; use `options.scope` for per-request or transient instances
 * @param options - Service options such as the instance scope
 * @returns A class decorator function
 */
export function Service(options: ServiceOptions = {}): ClassDecorator {
	return (target: any) => {
		MetadataRegistry.addService(target, options.scope ?? Scope.DEFAULT)
	}
}
