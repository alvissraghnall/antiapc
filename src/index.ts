import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { logger } from 'hono/logger'
import { CloudflareBindings, createDbRouter, HonoEnv } from './db'
import { processEmailBatch } from './cron'

const app = new Hono<HonoEnv>()

app.use(logger())

const dbRouter = createDbRouter()
app.route('/', dbRouter)

app.get('/star', (c) => {
  return c.text('Hello Hono!')
})

app.get('/', async (c) => {
  return serveStatic({
    root: './public',
    manifest: {
      'index.html': 'index.html',
    },
  })
})

app.post('/', async (c) => {
  const body = await c.req.parseBody()

  return c.text('OK')
})

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: CloudflareBindings, ctx: any) {
    // ensures the worker stays alive until the background task completes
    // even if it returns a response immediately.
    ctx.waitUntil(processEmailBatch(env));
  }
}