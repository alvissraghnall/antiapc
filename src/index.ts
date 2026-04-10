import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { logger } from 'hono/logger'
import { CloudflareBindings, createDbRouter, HonoEnv, Database, generateUnsubscribeToken } from './db'
import { processEmailBatch } from './cron'
import { Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

const app = new Hono<HonoEnv>()

app.use(logger());

const dbRouter = createDbRouter()
app.route('/', dbRouter)

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

  // Verify Turnstile CAPTCHA token (covers standard form or custom JSON payload)
  const token = (body['cf-turnstile-response'] || body['turnstileToken']) as string;
  if (!token) {
    return c.text('CAPTCHA token is required', 400);
  }

  const ip =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For") ||
    "unknown";

  if (c.env.TURNSTILE_SECRET_KEY) {
    const formData = new FormData();
    formData.append('secret', c.env.TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    formData.append('remoteip', ip);

    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });
    const outcome = await verifyRes.json() as any;
    if (!outcome.success) {

      console.log("Invalid token:", outcome["error-codes"]);
      return c.text('CAPTCHA verification failed. Are you a bot?', 403);
    }
  }

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

app.get('/unsubscribe', async (c) => {
  const email = c.req.query('email')
  const token = c.req.query('token')

  if (!email || !token) {
    return c.text('Invalid unsubscribe link: missing parameters', 400)
  }

  const secret = c.env.UNSUBSCRIBE_SECRET;
  if (!secret) {
    return c.text('Unsubscribe functionality is not configured properly.', 500)
  }
  const expectedToken = await generateUnsubscribeToken(email, secret);

  if (token !== expectedToken) {
    return c.text('Invalid or expired unsubscribe link.', 403)
  }

  const db = new Kysely<Database>({
    dialect: new D1Dialect({ database: c.env.DB }),
  })

  const result = await db.updateTable('subscribers')
    .set({ active: false })
    .where('email', '=', email.toLowerCase().trim())
    .executeTakeFirst()

  if (result.numUpdatedRows > 0n) {
    return c.html(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h1>Unsubscribed</h1>
        <p>You have been successfully removed from our mailing list. You will not receive any more emails.</p>
      </div>
    `)
  } else {
    return c.html(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h1>Already Unsubscribed</h1>
        <p>Your email was not found or is already unsubscribed.</p>
      </div>
    `, 404)
  }
})

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {
    try {
      await processEmailBatch(env);
      console.log("[CRON] Scheduled batch processed successfully.");
    } catch (error) {
      console.error("[CRON ERROR] Failed to process scheduled event:", error);
    }
  }
}