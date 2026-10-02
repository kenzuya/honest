# Cloudflare Workers end-to-end test

Runs the built `@kenzuya/honest` package inside **workerd** (the Cloudflare Workers runtime) and checks its behaviour
over HTTP.

```bash
bun run test:workers   # from the repository root: builds dist, installs deps here, runs the suite
```

How it works:

1. `tsc` compiles `src/` (with `emitDecoratorMetadata`), then `wrangler deploy --dry-run` bundles it, which is the same
   bundle `wrangler deploy` would upload. Nothing is deployed.
2. Miniflare loads each bundle into workerd, and `workers.e2e.mjs` sends requests that cover constructor DI, parameter
   decorators, guards, pipes, middleware, filters, env bindings, error handling and a JSX view with `Layout`.

Wrangler, Miniflare and workerd stay in this package so the root install stays small. `hono` and `reflect-metadata`
resolve from the root `node_modules`, so the bundle has a single copy of `hono`.

## Known limitation: wrangler's default build

When wrangler bundles TypeScript sources itself, it uses esbuild, which does not support `emitDecoratorMetadata`.
Without `design:paramtypes` metadata, constructor injection fails at startup with `constructor metadata is missing`. The
last test in the suite asserts this behaviour.

The fix is to compile with a tool that emits decorator metadata (`tsc` or `bun build`) and point wrangler at the output,
as `wrangler.jsonc` does:

```jsonc
{
	"main": "dist/tsc/worker.js",
	"build": { "command": "npx tsc -p tsconfig.json", "watch_dir": "src" }
}
```

`wrangler dev` runs the same build command, so local development works the same way.
