import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { logger } from 'hono/logger'
import { CloudflareBindings, createDbRouter, HonoEnv } from './db'

const app = new Hono<HonoEnv>()

app.use(logger())

// Mount database router
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

export default app