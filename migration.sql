-- Migration to create comprehensive reasons table
-- Run this in your Cloudflare D1 database

CREATE TABLE IF NOT EXISTS reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  region TEXT,
  impact_level TEXT CHECK(impact_level IN ('high', 'medium', 'low')) DEFAULT 'medium',
  priority INTEGER DEFAULT 1,
  tags TEXT, -- JSON string containing array of tag strings
  verified BOOLEAN DEFAULT FALSE,
  status TEXT CHECK(status IN ('active', 'archived', 'pending')) DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reasons_category ON reasons(category);
CREATE INDEX IF NOT EXISTS idx_reasons_region ON reasons(region);
CREATE INDEX IF NOT EXISTS idx_reasons_impact_level ON reasons(impact_level);
CREATE INDEX IF NOT EXISTS idx_reasons_status ON reasons(status);
CREATE INDEX IF NOT EXISTS idx_reasons_verified ON reasons(verified);
CREATE INDEX IF NOT EXISTS idx_reasons_created_at ON reasons(created_at);
