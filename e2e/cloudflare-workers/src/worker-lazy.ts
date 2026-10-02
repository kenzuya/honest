// Startup pattern B: build the app on the first request and reuse it for the isolate's lifetime
import type { Hono } from 'hono'
import { Application } from '@kenzuya/honest'
import { AppModule, type Env } from './app'
import { options } from './options'

let app: Promise<Hono> | undefined

export default {
	async fetch(request, env, ctx) {
		app ??= Application.create(AppModule, options).then(({ hono }) => hono)
		return (await app).fetch(request, env, ctx)
	}
} satisfies ExportedHandler<Env>
