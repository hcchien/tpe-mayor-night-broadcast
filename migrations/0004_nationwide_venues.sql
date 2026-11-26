-- Existing venues were restricted to Taipei before this migration.
ALTER TABLE venues ADD COLUMN city TEXT NOT NULL DEFAULT '臺北市';
CREATE INDEX venues_public_location ON venues(status, city, district, created_at DESC, id);
