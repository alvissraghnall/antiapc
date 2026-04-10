import { Hono } from 'hono';
import { Kysely, Generated, Selectable, Updateable } from 'kysely';
import { D1Dialect } from 'kysely-d1';

interface ReasonsTable {
  id: Generated<number>;
  category: string;
  text: string;
  source: string;
  url: string;
  region?: string;
  impact_level: 'high' | 'medium' | 'low';
  priority: number;
  tags?: string | null; // JSON string of tags array
  verified: boolean;
  status: 'active' | 'archived' | 'pending';
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface SubscribersTable {
  id: Generated<number>;
  email: string;
  active: Generated<boolean>;
  last_sent_at: string | null;
  created_at: Generated<string>;
}

export interface SentEmailsTable {
  subscriber_id: number;
  reason_id: number;
  sent_at: Generated<string>;
}

interface ReasonResponse {
  id: number;
  category: string;
  text: string;
  source: string;
  url: string;
  region?: string;
  impact_level: 'high' | 'medium' | 'low';
  priority: number;
  tags?: string[]; // Array of tag strings for API
  verified: boolean;
  status: 'active' | 'archived' | 'pending';
  created_at: string;
  updated_at: string;
}

interface ReasonCreateRequest {
  category: string;
  text: string;
  source: string;
  url?: string;
  region?: string;
  impact_level: 'high' | 'medium' | 'low';
  priority?: number;
  tags?: string[];
  verified?: boolean;
  status?: 'active' | 'archived' | 'pending';
}

function dbToApi(reason: Selectable<ReasonsTable>): ReasonResponse {
  return {
    ...reason,
    tags: reason.tags ? (JSON.parse(reason.tags) as string[]) : undefined
  };
}

function apiToDb(reason: ReasonCreateRequest): Omit<ReasonsTable, 'id' | 'created_at' | 'updated_at'> {
  return {
    ...reason,
    tags: reason.tags ? JSON.stringify(reason.tags) : undefined,
    url: reason.url || "",
    priority: reason.priority || 0,
    verified: reason.verified ?? false,
    status: reason.status ?? "pending"
  };
}

export async function generateUnsubscribeToken(email: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(email.toLowerCase().trim()));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface Database {
  reasons: ReasonsTable;
  subscribers: SubscribersTable;
  sent_emails: SentEmailsTable;
}

export type HonoEnv = {
  Bindings: CloudflareBindings;
};

export const createDbRouter = () => {
  const router = new Hono<HonoEnv>();

  // Protect mutating operations on /reasons endpoints
  router.use('*', async (c, next) => {
    if (c.req.path.startsWith('/reasons') && c.req.method !== 'GET') {
      const secret = c.env.ADMIN_SECRET;
      if (!secret) return c.text('Admin not configured properly.', 500);
      const auth = c.req.header('Authorization');
      if (auth !== `Bearer ${secret}`) return c.text('Unauthorized', 401);
    }
    await next();
  });

  // GET /reasons - List reasons with optional filtering
  router.get('/reasons', async (c) => {
    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const category = c.req.query('category');
    const region = c.req.query('region');
    const impactLevel = c.req.query('impact_level');
    const status = c.req.query('status');
    const verified = c.req.query('verified');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    let query = db.selectFrom('reasons').selectAll();

    if (category) query = query.where('category', '=', category);
    if (region) query = query.where('region', '=', region);
    if (impactLevel) query = query.where('impact_level', '=', impactLevel as any);
    if (status) query = query.where('status', '=', status as any);
    if (verified !== undefined) query = query.where('verified', '=', verified === 'true');

    const results = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return c.json(results.map(dbToApi));
  });

  // GET /reasons/:id - Get specific reason
  router.get('/reasons/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.text('Invalid ID', 400);
    }

    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const result = await db
      .selectFrom('reasons')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!result) {
      return c.text('Reason not found', 404);
    }

    return c.json(dbToApi(result));
  });

  // POST /reasons - Create new reason
  router.post('/reasons', async (c) => {
    const body = await c.req.json() as ReasonCreateRequest;
    const {
      category,
      text,
      source,
      url,
      region,
      impact_level = 'medium',
      priority = 1,
      tags,
      verified = false,
      status = 'active'
    } = apiToDb(body);

    if (!category || !text || !source) {
      return c.text('Category, text, and source are required', 400);
    }

    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const now = new Date().toISOString();

    const existingReason = await db
      .selectFrom('reasons')
      .select('id')
      .where('text', '=', text)
      .executeTakeFirst();

    if (existingReason) {
      return c.json({ message: 'A reason with this text already exists', id: existingReason.id }, 409);
    }

    const result = await db
      .insertInto('reasons')
      .values({
        category,
        text,
        source,
        url,
        region,
        impact_level,
        priority,
        tags: tags ? JSON.stringify(tags) : null,
        verified,
        status,
        created_at: now,
        updated_at: now
      })
      .returning('id')
      .executeTakeFirst();

    return c.json({ id: result?.id, message: 'Reason created successfully' }, 201);
  });

  // PUT /reasons/:id - Update reason
  router.put('/reasons/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.text('Invalid ID', 400);
    }

    const body = await c.req.json() as Partial<ReasonCreateRequest>;
    const {
      category,
      text,
      source,
      url,
      region,
      impact_level,
      priority,
      tags,
      verified,
      status
    } = body;

    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const updateData: Updateable<ReasonsTable> = {
      updated_at: new Date().toISOString()
    };

    if (category !== undefined) updateData.category = category;
    if (text !== undefined) updateData.text = text;
    if (source !== undefined) updateData.source = source;
    if (url !== undefined) updateData.url = url;
    if (region !== undefined) updateData.region = region;
    if (impact_level !== undefined) updateData.impact_level = impact_level;
    if (priority !== undefined) updateData.priority = priority;
    if (tags !== undefined) updateData.tags = tags ? JSON.stringify(tags) : null;
    if (verified !== undefined) updateData.verified = verified;
    if (status !== undefined) updateData.status = status;

    const result = await db
      .updateTable('reasons')
      .set(updateData)
      .where('id', '=', id)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      return c.text('Reason not found', 404);
    }

    return c.json({ message: 'Reason updated successfully' });
  });

  // DELETE /reasons/:id - Delete reason
  router.delete('/reasons/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.text('Invalid ID', 400);
    }

    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const result = await db
      .deleteFrom('reasons')
      .where('id', '=', id)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      return c.text('Reason not found', 404);
    }

    return c.json({ message: 'Reason deleted successfully' });
  });

  return router;
};