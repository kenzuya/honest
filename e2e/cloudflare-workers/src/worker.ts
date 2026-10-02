// Startup pattern A: build the app with top-level await and export the Hono instance
import { Application } from '@kenzuya/honest'
import { AppModule } from './app'
import { options } from './options'

const { hono } = await Application.create(AppModule, options)

export default hono
