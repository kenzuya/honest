import { HTTPException } from 'hono/http-exception'
import { HONEST_PIPELINE_BODY_CACHE_KEY } from '../constants'
import { createParamDecorator } from '../helpers'
import { isObject } from '../utils'

/**
 * Decorator that binds the request body to a parameter
 * @param data - Optional property name to extract from the body
 */
export const Body = createParamDecorator('body', async (data, ctx) => {
	let body = ctx.get(HONEST_PIPELINE_BODY_CACHE_KEY) as unknown
	if (body === undefined) {
		try {
			body = await ctx.req.json()
		} catch (error) {
			// Missing or malformed JSON is a client error, not a server failure
			throw new HTTPException(400, { message: 'Invalid JSON request body', cause: error })
		}
		ctx.set(HONEST_PIPELINE_BODY_CACHE_KEY, body)
	}
	if (data) {
		return isObject(body) ? body[String(data)] : undefined
	}
	return body
})

/**
 * Decorator that binds a route parameter to a parameter
 * @param data - The parameter name in the route
 */
export const Param = createParamDecorator('param', (data, ctx) => {
	return data ? ctx.req.param(String(data)) : ctx.req.param()
})

/**
 * Decorator that binds a query parameter to a parameter
 * @param data - The query parameter name
 */
export const Query = createParamDecorator('query', (data, ctx) => {
	return data ? ctx.req.query(String(data)) : ctx.req.query()
})

/**
 * Decorator that binds a header value to a parameter
 * @param data - The header name
 */
export const Header = createParamDecorator('header', (data, ctx) => {
	return data ? ctx.req.header(String(data)) : ctx.req.header()
})

/**
 * Decorator that binds the request object to a parameter
 */
export const Req = createParamDecorator('request', (_, ctx) => ctx.req)
export const Request = createParamDecorator('request', (_, ctx) => ctx.req)

/**
 * Decorator that binds the response object to a parameter
 */
export const Res = createParamDecorator('response', (_, ctx) => ctx.res)
export const Response = createParamDecorator('response', (_, ctx) => ctx.res)

/**
 * Decorator that binds the context object to a parameter
 */
export const Ctx = createParamDecorator('context', (_, ctx) => ctx)
export const Context = createParamDecorator('context', (_, ctx) => ctx)

/**
 * Decorator that binds a context variable to a parameter
 * @param data - The variable name to retrieve from context
 */
export const Var = createParamDecorator('variable', (data, ctx) =>
	data === undefined ? undefined : ctx.get(String(data))
)
export const Variable = createParamDecorator('variable', (data, ctx) =>
	data === undefined ? undefined : ctx.get(String(data))
)
