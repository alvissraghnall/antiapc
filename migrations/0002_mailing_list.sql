CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  last_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sent_emails (
  subscriber_id INTEGER,
  reason_id INTEGER,
  sent_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (subscriber_id, reason_id)
);