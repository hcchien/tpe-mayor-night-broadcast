import { z } from 'zod';
import { allDistricts, validLocation } from './locations';

export const cities = ['臺北市','新北市','桃園市','臺中市','臺南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣'] as const;
export const citySchema = z.preprocess(v => typeof v === 'string' ? v.trim().replace(/^台/, '臺') : v, z.enum(cities));
export const districtSchema = z.string().trim().max(10).transform(v => v.replace(/台/g,'臺')).refine(v => allDistricts.has(v), '請選擇有效的鄉鎮市區');
export const eventIds = ['election_eve','counting_night'] as const;
export const eventOptions = [{id:'election_eve',label:'市民（選前）之夜'},{id:'counting_night',label:'開票之夜'}] as const;
const eventsSchema = z.array(z.enum(eventIds)).min(1,'請至少選擇一場活動').max(2).refine(v=>new Set(v).size===v.length,'活動不可重複').transform(v=>eventIds.filter(id=>v.includes(id)));
export const categories = ['餐廳','咖啡廳','酒吧','共享空間','其他場地'] as const;
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), '包含不允許的控制字元');
export const httpsUrl = z.string().trim().max(500).refine(v => {
  if (!v) return true;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}, '請使用完整的 HTTPS 網址');
export const venueSchema = z.object({
  name: text(2, 80), events: eventsSchema, city: citySchema, district: districtSchema, category: z.enum(categories),
  address: text(5, 200), capacity: z.number().int().min(1).max(5000),
  screen: text(2, 120), opening_time: text(2, 120), cost: text(1, 200),
  description: text(10, 1500), booking_url: httpsUrl,
  accessible: z.boolean(), contact_name: text(1, 80),
  contact_email: z.email().max(254).transform(v => v.toLowerCase()),
  contact_phone: text(6, 30).refine(v => /^[+()\d\s-]+$/.test(v), '電話格式不正確')
}).strict().refine(v => validLocation(v.city,v.district), {path:['district'],message:'鄉鎮市區不屬於所選縣市，請重新選擇'});
export const submissionSchema = venueSchema.safeExtend({
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
export const publicColumns = 'id,name,events,city,district,category,address,capacity,screen,opening_time,cost,description,booking_url,accessible,updated_at';
