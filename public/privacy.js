import { $, api } from './shared.js';
try {
  const c = await api('/api/config');
  const organizer = [c.organizerName ? `資料管理者：${c.organizerName}` : '', c.contactEmail ? `聯絡方式：${c.contactEmail}` : ''].filter(Boolean).join('。');
  $('#privacy-organizer').textContent = organizer;
  $('#privacy-organizer').hidden = !organizer;
  $('#privacy-retention').textContent = c.deleteAfter
    ? `資料預計保存至 ${c.deleteAfter}（UTC 日期）。日期結束後的每日排程會刪除活動場地、聯絡資料、回報與審核紀錄。`
    : '本站目前未設定活動資料的自動刪除日期；場地、聯絡資料、回報與審核紀錄會保留至管理者刪除。過期登入狀態與防濫用計數仍依上述期限自動清理。';
} catch {
  $('#privacy-organizer').textContent = '設定暫時無法載入，請稍後再試。';
  $('#privacy-retention').textContent = '資料保存設定暫時無法載入。';
}
