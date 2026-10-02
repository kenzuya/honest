// Fixture app exercising the framework surface that must work inside workerd:
// constructor DI, parameter decorators, the request pipeline, env bindings and JSX views.
import 'reflect-metadata'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
	Body,
	Controller,
	Ctx,
	Delete,
	Get,
	Header,
	Layout,
	Module,
	MvcModule,
	Page,
	Param,
	Post,
	Query,
	Service,
	UseFilters,
	UseGuards,
	UseMiddleware,
	UsePipes,
	View,
	type ArgumentMetadata,
	type IFilter,
	type IGuard,
	type IMiddleware,
	type IPipe
} from 'honestjs'

export type Env = { GREETING: string; API_TOKEN: string }

// ---------- services: a 3-level constructor-injection chain ----------

@Service()
export class ClockService {}

@Service()
export class UsersRepository {
	private users = new Map<number, { id: number; name: string }>([[1, { id: 1, name: 'Ada' }]])
	private nextId = 2

	constructor(readonly clock: ClockService) {}

	find(id: number) {
		return this.users.get(id)
	}
	create(name: string) {
		const user = { id: this.nextId++, name }
		this.users.set(user.id, user)
		return user
	}
	remove(id: number) {
		return this.users.delete(id)
	}
}

@Service()
export class UsersService {
	constructor(
		readonly repo: UsersRepository,
		readonly clock: ClockService
	) {}

	get(id: number) {
		const user = this.repo.find(id)
		if (!user) throw new HTTPException(404, { message: `User ${id} not found` })
		return user
	}
}

// ---------- pipeline components ----------

class TokenGuard implements IGuard {
	canActivate(c: Context) {
		return c.req.header('authorization') === `Bearer ${(c.env as Env).API_TOKEN}`
	}
}

class TimingMiddleware implements IMiddleware {
	async use(c: Context, next: Next) {
		await next()
		c.res.headers.set('x-honest-mw', 'ran')
	}
}

/** Converts to number based on the reflected param type (needs design:paramtypes) */
class AutoNumberPipe implements IPipe {
	transform(value: unknown, meta: ArgumentMetadata) {
		if (meta.metatype === Number) {
			const n = Number(value)
			if (Number.isNaN(n)) throw new HTTPException(400, { message: `"${value}" is not a number` })
			return n
		}
		return value
	}
}

class TeapotError extends Error {}

class TeapotFilter implements IFilter {
	catch(err: Error, c: Context) {
		if (err instanceof TeapotError) return c.json({ filtered: true, message: err.message }, 418)
		return undefined
	}
}

// ---------- controllers ----------

@Controller('users')
@UseMiddleware(TimingMiddleware)
@UsePipes(AutoNumberPipe)
export class UsersController {
	constructor(private readonly users: UsersService) {}

	@Get(':id')
	getOne(@Param('id') id: number) {
		return { user: this.users.get(id), idType: typeof id }
	}

	@Post()
	@UseGuards(TokenGuard)
	create(@Body('name') name: string) {
		return this.users.repo.create(name)
	}

	@Delete(':id')
	@UseGuards(TokenGuard)
	remove(@Param('id') id: number) {
		return { deleted: this.users.repo.remove(id) }
	}
}

@Controller('meta')
@UseFilters(TeapotFilter)
export class MetaController {
	constructor(
		private readonly users: UsersService,
		private readonly clock: ClockService
	) {}

	@Get('env')
	env(@Ctx() c: Context<{ Bindings: Env }>) {
		return { greeting: c.env.GREETING }
	}

	@Get('echo')
	echo(@Query('q') q: string, @Header('x-client') client: string) {
		return { q, client }
	}

	@Get('singleton')
	singleton() {
		// Services are singletons: the controller and the service should share one ClockService
		return { sameClock: this.users.clock === this.clock && this.users.repo.clock === this.clock }
	}

	@Get('teapot')
	teapot() {
		throw new TeapotError('short and stout')
	}

	@Get('boom')
	boom() {
		throw new Error('unexpected failure')
	}

	@Get('async')
	async later() {
		await new Promise((r) => setTimeout(r, 5))
		return { async: true }
	}
}

@View('')
export class HomeView {
	@Page()
	index(@Ctx() c: Context) {
		return c.html(
			<Layout title="Honest on Workers">
				<h1>Hello from Honest</h1>
			</Layout>
		)
	}
}

@Module({ controllers: [UsersController, MetaController], services: [UsersService, UsersRepository, ClockService] })
export class ApiModule {}

@MvcModule({ imports: [ApiModule], views: [HomeView] })
export class AppModule {}
