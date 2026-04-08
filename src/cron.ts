import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { CloudflareBindings, Database } from './db';
import { console } from '@cloudflare/workers-types';

export async function processEmailBatch(env: CloudflareBindings) {
  const db = new Kysely<Database>({
    dialect: new D1Dialect({ database: env.DB }),
  });

  // 1. Fetch up to 300 active subscribers who haven't received an email in ~56 hours (approx 3x a week)
  const cooldownTarget = new Date(Date.now() - 56 * 60 * 60 * 1000).toISOString();

  const subscribers = await db
    .selectFrom('subscribers')
    .selectAll()
    .where('active', '=', true)
    .where((eb) =>
      eb.or([
        eb('last_sent_at', 'is', null),
        eb('last_sent_at', '<', cooldownTarget)
      ])
    )
    .limit(300)
    .execute();

  if (subscribers.length === 0) {
    console.log('No eligible subscribers for this batch.');
    return;
  }

  const now = new Date().toISOString();

  // 2. Process in small chunks to avoid overwhelming the D1 connection pool concurrently
  for (let i = 0; i < subscribers.length; i += 10) {
    const chunk = subscribers.slice(i, i + 10);

    await Promise.all(
      chunk.map(async (sub) => {
        // Pick a random reason this specific subscriber hasn't received yet
        const reason = await db.selectFrom('reasons')
          .selectAll()
          .where('id', 'not in', (eb: any) => eb.selectFrom('sent_emails').select('reason_id').where('subscriber_id', '=', sub.id))
          .orderBy(sql`RANDOM()`)
          .limit(1)
          .executeTakeFirst();

        if (!reason) return; // This user has seen everything!

        console.log(`[CRON] Sending Reason #${reason.id} to ${sub.email}`);

        await db.insertInto('sent_emails').values({ subscriber_id: sub.id, reason_id: reason.id, sent_at: now }).execute();
        await db.updateTable('subscribers').set({ last_sent_at: now }).where('id', '=', sub.id).execute();
      })
    );
  }
}
