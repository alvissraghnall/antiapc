import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { CloudflareBindings, Database } from './db';
import { WorkerMailer } from 'worker-mailer';

function generateEmailHtml(reason: any) {
  const sourceLink = reason.url && reason.url !== '#' 
    ? `<a href="${reason.url}" style="color: #d9534f; text-decoration: none;">${reason.source}</a>` 
    : reason.source;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
      <h2 style="color: #d9534f; border-bottom: 2px solid #eee; padding-bottom: 10px;">Reason #${reason.id}</h2>
      <div style="background: #f9f9f9; padding: 20px; border-left: 4px solid #d9534f; margin: 20px 0;">
        <p style="font-size: 18px; margin-top: 0;">${reason.text}</p>
        <p style="font-size: 14px; color: #555; margin-bottom: 0;">
          <strong>Category:</strong> ${reason.category} &bull; 
          <strong>Impact Level:</strong> <span style="text-transform: uppercase;">${reason.impact_level}</span>
        </p>
      </div>
      ${sourceLink ? `<p><strong>Source:</strong> ${sourceLink}</p>` : ''}
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      <p style="font-size: 12px; color: #999; text-align: center;">
        You are receiving this email because you subscribed to Anti-APC updates.<br/>
        <a href="https://antiapc.com/unsubscribe" style="color: #999; text-decoration: underline;">Unsubscribe</a>
      </p>
    </div>
  `;
}

async function sendEmail(env: CloudflareBindings, to: string, subject: string, html: string) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('SMTP credentials are not set. Skipping actual email dispatch.');
    return;
  }

  const senderEmail = env.FROM_EMAIL || 'updates@antiapc.com'; // Change to your actual verified domain

  try {
    await WorkerMailer.send({
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT || '587', 10),
      credentials: {
        username: env.SMTP_USER,
        password: env.SMTP_PASS
      }
    }, {
      from: `Anti-APC Updates <${senderEmail}>`,
      to: to,
      subject: subject,
      html: html
    });
  } catch (error) {
    console.error(`[SMTP ERROR] Failed to send email to ${to}:`, error);
  }
}

export async function processEmailBatch(env: CloudflareBindings) {
  const db = new Kysely<Database>({
    dialect: new D1Dialect({ database: env.DB }),
  });

  // fetch up to 300 active subscribers who haven't received an email in ~56 hours (approx 3x a week)
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
        
        const html = generateEmailHtml(reason);
        await sendEmail(env, sub.email, `Anti-APC: Reason #${reason.id}`, html);

        await db.insertInto('sent_emails').values({ subscriber_id: sub.id, reason_id: reason.id, sent_at: now }).execute();
        await db.updateTable('subscribers').set({ last_sent_at: now }).where('id', '=', sub.id).execute();
      })
    );
  }
}
