import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { logger } from 'hono/logger'
import { CloudflareBindings, createDbRouter, HonoEnv, Database } from './db'
import { processEmailBatch } from './cron'
import { Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

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
  })(c, () => Promise.resolve())
})

app.post('/register', async (c) => {
  const body = await c.req.parseBody();

  const email = body.email as string

  if (!email || typeof email !== 'string') {
    return c.text('Email is required', 400)
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return c.text('Invalid email format', 400)
  }

  const db = new Kysely<Database>({
    dialect: new D1Dialect({ database: c.env.DB }),
  })

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await db
    .selectFrom('subscribers')
    .select('id')
    .where('email', '=', normalizedEmail)
    .executeTakeFirst()

  if (!existing) {
    await db.insertInto('subscribers').values({ email: normalizedEmail }).execute()
  }

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