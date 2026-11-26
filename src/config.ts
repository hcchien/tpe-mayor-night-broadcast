import type { Env } from './types';

export function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value+'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}
export function retentionActive(env: Env) {
  return validDate(env.PRIVACY_DELETE_AFTER) && env.PRIVACY_DELETE_AFTER >= new Date().toISOString().slice(0,10);
}
export function registrationOpen(env: Env) {
  return env.REGISTRATION_OPEN === 'true' && !!env.ORGANIZER_NAME && !!env.CONTACT_EMAIL && retentionActive(env);
}
