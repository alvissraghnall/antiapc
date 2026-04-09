import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { CloudflareBindings, Database, generateUnsubscribeToken } from './db';
import { WorkerMailer } from 'worker-mailer';

function generateEmailHtml(reason: any, email: string, token: string) {
  const sourceLink = reason.url && reason.url !== '#' 
    ? `<a href="${reason.url}" style="color: #003ec7; text-decoration: underline; font-weight: bold;">${reason.source}</a>` 
    : reason.source;

  return `
    <div style="background-color: #f4f4f5; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1b1b1c;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        
        <div style="background-color: #003ec7; color: #ffffff; padding: 30px 40px; text-align: center;">
          <p style="margin: 0; font-size: 12px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: #dde1ff;">Never Forget</p>
          <h1 style="margin: 10px 0 0; font-size: 28px; font-weight: 900; letter-spacing: -1px;">1000 REASONS</h1>
        </div>

        <div style="padding: 40px;">
          <p style="font-size: 16px; line-height: 1.6; color: #434656; margin-top: 0;">
            Here is your scheduled reminder of the documented failures and actions of the current administration on record. We must not let political amnesia win.
          </p>

          <div style="margin: 30px 0; background-color: #fcf8f9; border-left: 4px solid #d9534f; padding: 25px; border-radius: 0 8px 8px 0;">
            <div style="margin-bottom: 15px;">
              <span style="display: inline-block; background-color: #f0edee; color: #d9534f; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; padding: 4px 8px; border-radius: 4px; margin-right: 8px;">#${reason.id}</span>
              <span style="display: inline-block; background-color: #f0edee; color: #434656; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; padding: 4px 8px; border-radius: 4px; margin-right: 8px;">${reason.category}</span>
              <span style="display: inline-block; background-color: #f0edee; color: #434656; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; padding: 4px 8px; border-radius: 4px;">IMPACT: ${reason.impact_level}</span>
            </div>
            <h2 style="font-size: 22px; line-height: 1.4; margin: 0 0 15px 0; font-weight: 800; color: #1b1b1c;">${reason.text}</h2>
            ${sourceLink ? `<p style="margin: 0; font-size: 14px; color: #737688;"><strong>Source Verification:</strong> ${sourceLink}</p>` : ''}
          </div>

          <p style="font-size: 16px; line-height: 1.6; color: #434656; margin-bottom: 0;">
            Stay informed and share the truth. View all 1,000 reasons on the <a href="https://1000reasons.vote" style="color: #003ec7; text-decoration: none; font-weight: bold;">official database</a>.
          </p>
        </div>

        <div style="background-color: #f6f3f4; padding: 30px 40px; text-align: center; border-top: 1px solid #eae7e8;">
          <p style="margin: 0 0 10px; font-size: 12px; color: #737688; line-height: 1.5;">
            You are receiving this email because you subscribed to the Unofficial 1000 Reasons Newsletter. This project is independent and uses publicly available data.
          </p>
          <a href="https://antiapc.xyz/unsubscribe?email=${encodeURIComponent(email)}&token=${token}" style="font-size: 12px; color: #d9534f; text-decoration: underline; font-weight: bold;">Unsubscribe from these reminders</a>
        </div>

      </div>
    </div>
  `;
}

async function sendEmail(env: CloudflareBindings, to: string, subject: string, html: string) {
  if (env.SMTP_PORT != '1025' && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS)) {
    console.warn('SMTP credentials are not set. Skipping actual email dispatch.');
    return;
  }

  const senderEmail = env.FROM_EMAIL || 'updates@antiapc.xyz';

  try {
    await WorkerMailer.send({
      host: env.SMTP_HOST ?? "",
      port: parseInt(env.SMTP_PORT || '587', 10),
      credentials: {
        username: env.SMTP_USER ?? "", 
        password: env.SMTP_PASS ?? ""
      },
      secure: env.SMTP_PORT !== '1025' // non-local SMTP requires secure connection
    }, {
      from: senderEmail,
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
        
        const token = await generateUnsubscribeToken(sub.email, env.UNSUBSCRIBE_SECRET || 'default_dev_secret');
        const html = generateEmailHtml(reason, sub.email, token);
        await sendEmail(env, sub.email, `Anti-APC: Reason #${reason.id}`, html);

        await db.insertInto('sent_emails').values({ subscriber_id: sub.id, reason_id: reason.id, sent_at: now }).execute();
        await db.updateTable('subscribers').set({ last_sent_at: now }).where('id', '=', sub.id).execute();
      })
    );
  }
}
