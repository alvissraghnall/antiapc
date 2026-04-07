import { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';

export interface CloudflareBindings {
  DB: D1Database;
}

interface ReasonsTable {
  id: number;
  category: string;
  text: string;
  source: string;
  url: string;
  region?: string;
  impact_level: 'high' | 'medium' | 'low';
  priority: number;
  tags?: string; // JSON string of tags array
  verified: boolean;
  status: 'active' | 'archived' | 'pending';
  created_at: string;
  updated_at: string;
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

// Helper functions
function dbToApi(reason: ReasonsTable): ReasonResponse {
  return {
    ...reason,
    tags: reason.tags ? JSON.parse(reason.tags) : undefined
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

interface KvTable {
  key: string;
  value: string;
}

interface Database {
  reasons: ReasonsTable;
  kv: KvTable;
}

export type HonoEnv = {
  Bindings: CloudflareBindings;
};

export const createDbRouter = () => {
  const router = new Hono<HonoEnv>();

  // GET /api/kv?key=foo
  router.get('/api/kv', async (c) => {
    const key = c.req.query('key');
    if (!key) {
      return c.text('Key is not defined.', 400);
    }

    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const result = await db.selectFrom('kv').selectAll().where('key', '=', key).executeTakeFirst();
    if (!result) {
      return c.text('', 404);
    }
    return c.text(result.value);
  });

  // POST /api/kv with body { key, value }
  router.post('/api/kv', async (c) => {
    const body = await c.req.json();
    const { key, value } = body;

    if (!(key && value)) {
      return c.text('Key and value must be defined.', 400);
    }

    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    try {
      await db
        .insertInto('kv')
        .values([{ key, value }])
        .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
        .execute();
    } catch (err) {
      throw err;
    }
    return c.text(value, 200);
  });

  // DELETE /api/kv?key=foo
  router.delete('/api/kv', async (c) => {
    const key = c.req.query('key');
    if (!key) {
      return c.text('Key is not defined.', 400);
    }

    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    await db.deleteFrom('kv').where('key', '=', key).execute();
    return c.text('', 200);
  });

  // Comprehensive Reasons API
  // GET /api/reasons - List reasons with optional filtering
  router.get('/api/reasons', async (c) => {
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

  // GET /api/reasons/:id - Get specific reason
  router.get('/api/reasons/:id', async (c) => {
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

  // POST /api/reasons - Create new reason
  router.post('/api/reasons', async (c) => {
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
        tags: tags ? JSON.stringify(tags) : [],
        verified,
        status,
        created_at: now,
        updated_at: now
      })
      .returning('id')
      .executeTakeFirst();

    return c.json({ id: result?.id, message: 'Reason created successfully' }, 201);
  });

  // PUT /api/reasons/:id - Update reason
  router.put('/api/reasons/:id', async (c) => {
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

    const updateData: Partial<Omit<ReasonsTable, 'id' | 'created_at'>> = {
      updated_at: new Date().toISOString()
    };

    if (category !== undefined) updateData.category = category;
    if (text !== undefined) updateData.text = text;
    if (source !== undefined) updateData.source = source;
    if (url !== undefined) updateData.url = url;
    if (region !== undefined) updateData.region = region;
    if (impact_level !== undefined) updateData.impact_level = impact_level;
    if (priority !== undefined) updateData.priority = priority;
    if (tags !== undefined) (updateData as any).tags = tags ? JSON.stringify(tags) : null;
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

  // DELETE /api/reasons/:id - Delete reason
  router.delete('/api/reasons/:id', async (c) => {
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