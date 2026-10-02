import type { Context } from 'hono'
import type { Constructor } from '../types'

/**
 * Interface for exception filters
 * Filters handle and transform exceptions thrown during request processing (handlers, guards, pipes and middleware).
 * They run handler-level first, then controller-level, then global.
 */
export interface IFilter {
	/**
	 * Method to catch and handle exceptions
	 * @param exception - The exception that was thrown
	 * @param context - The Hono context object
	 * @returns A Response object, or undefined to pass the exception to the next filter
	 * (or to the application's onError handler when no filter is left)
	 */
	catch(exception: Error, context: Context): Promise<Response | undefined> | Response | undefined
}

/**
 * Type for exception filters
 * Can be either a class implementing IFilter or an instance of IFilter
 */
export type FilterType = Constructor<IFilter> | IFilter
