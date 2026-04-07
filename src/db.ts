import { Hono } from 'hono';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';

export interface CloudflareBindings {
  DB: Database;
}

interface KvTable {
  key: string;
  value: string;
}

interface Database {
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

  return router;
};