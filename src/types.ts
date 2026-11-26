export interface Env {
  DB: D1Database; ASSETS: Fetcher; WRITE_LIMITER: RateLimit; READ_LIMITER: RateLimit;
  ENVIRONMENT: string; SITE_ORIGIN: string; LOCAL_DEV_AUTH?: string;
  ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; ADMIN_EMAILS: string;
  TURNSTILE_SITE_KEY: string; TURNSTILE_SECRET_KEY: string; IP_HASH_SECRET: string;
  GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string;
  REGISTRATION_OPEN: string; DAILY_SUBMISSION_LIMIT: string;
  EVENT_LABEL: string; EVENT_TIME: string; LIVESTREAM_URL: string;
  CONTACT_EMAIL: string; ORGANIZER_NAME: string; PRIVACY_DELETE_AFTER: string;
}
