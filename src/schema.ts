import { z } from 'zod';

export const districts = ['中正區','大同區','中山區','松山區','大安區','萬華區','信義區','士林區','北投區','內湖區','南港區','文山區'] as const;
export const categories = ['餐廳','咖啡廳','酒吧','共享空間','其他場地'] as const;
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), '包含不允許的控制字元');
export const httpsUrl = z.string().trim().max(500).refine(v => {
  if (!v) return true;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}, '請使用完整的 HTTPS 網址');
export const venueSchema = z.object({
  name: text(2, 80), district: z.enum(districts), category: z.enum(categories),
  address: text(5, 200), capacity: z.number().int().min(1).max(5000),
  screen: text(2, 120), opening_time: text(2, 120), cost: text(1, 200),
  description: text(10, 1500), booking_url: httpsUrl,
  accessible: z.boolean(), contact_name: text(1, 80),
  contact_email: z.email().max(254).transform(v => v.toLowerCase()),
  contact_phone: text(6, 30).refine(v => /^[+()\d\s-]+$/.test(v), '電話格式不正確')
}).strict();
export const submissionSchema = venueSchema.extend({
  consent: z.literal(true), website: z.literal(''),
  turnstile_token: text(1, 2048)
});
export const reportSchema = z.object({
  venue_id: z.uuid(), reason: text(10, 1000), website: z.literal(''), turnstile_token: text(1, 2048)
}).strict();
export const reviewSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(['pending','approved','rejected','withdrawn']),
  moderation_note: text(3, 1000), venue: venueSchema.optional()
}).strict();
export type VenueInput = z.infer<typeof venueSchema>;
export const venueColumns = Object.keys(venueSchema.shape) as (keyof VenueInput)[];
export const publicColumns = 'id,name,district,category,address,capacity,screen,opening_time,cost,description,booking_url,accessible,updated_at';
