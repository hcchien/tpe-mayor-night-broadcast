-- Existing registrations remain explicitly unverified; do not backfill from contact_email.
ALTER TABLE venues ADD COLUMN owner_google_sub TEXT;
ALTER TABLE venues ADD COLUMN owner_google_email TEXT;
ALTER TABLE venues ADD COLUMN owner_email_authoritative INTEGER CHECK(owner_email_authoritative IN (0,1));
ALTER TABLE venues ADD COLUMN owner_verified_at TEXT;
ALTER TABLE venues ADD COLUMN owner_identity_provider TEXT CHECK(owner_identity_provider IN ('google','local'));
CREATE INDEX venues_owner ON venues(owner_google_sub);

CREATE TABLE merchant_sessions (
  token_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  email_authoritative INTEGER NOT NULL CHECK(email_authoritative IN (0,1)),
  identity_provider TEXT NOT NULL CHECK(identity_provider IN ('google','local')),
  authenticated_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX merchant_sessions_expiry ON merchant_sessions(expires_at);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX oauth_states_browser ON oauth_states(browser_hash);
