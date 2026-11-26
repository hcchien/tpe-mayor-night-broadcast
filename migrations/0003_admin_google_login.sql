ALTER TABLE oauth_states ADD COLUMN admin_login INTEGER NOT NULL DEFAULT 0 CHECK(admin_login IN (0,1));
