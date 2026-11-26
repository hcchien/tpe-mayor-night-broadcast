PRAGMA foreign_keys = ON;

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT NOT NULL,
  category TEXT NOT NULL,
  address TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 5000),
  screen TEXT NOT NULL,
  opening_time TEXT NOT NULL,
  cost TEXT NOT NULL,
  description TEXT NOT NULL,
  booking_url TEXT NOT NULL DEFAULT '',
  accessible INTEGER NOT NULL CHECK(accessible IN (0,1)),
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
  moderation_note TEXT NOT NULL DEFAULT '',
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX venues_public ON venues(status, created_at DESC, id);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolution TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX reports_status ON reports(status, created_at DESC);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_created ON audit_log(created_at DESC);

CREATE TABLE daily_intake (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, kind)
);
