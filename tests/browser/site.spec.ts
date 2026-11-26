import { test, expect } from '@playwright/test';

test('store registration, approval, search, report, withdrawal and deletion',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:/這一夜，\s*我們\s*一起看。/})).toBeVisible();
  await page.getByRole('button',{name:'本機模擬 Google 登入',exact:true}).click();
  await expect(page.locator('#merchant-identity')).toContainText('merchant@example.com');
  const form=page.locator('#register-form');const name=`測試場地 ${Date.now()}`;
  await form.locator('[name=name]').fill(name);await form.locator('[name=district]').selectOption('中正區');await form.locator('[name=category]').selectOption('咖啡廳');
  await form.locator('[name=address]').fill('台北市中正區測試路 100 號');await form.locator('[name=capacity]').fill('30');await form.locator('[name=screen]').fill('75 吋電視');await form.locator('[name=opening_time]').fill('18:00–22:00');await form.locator('[name=cost]').fill('低消一杯飲料');await form.locator('[name=description]').fill('歡迎到我們的測試場地一起看直播。');await form.locator('[name=booking_url]').fill('https://example.com');
  await form.locator('[name=contact_name]').fill('私人聯絡人');await expect(form.locator('[name=contact_email]')).toHaveValue('merchant@example.com');await expect(form.locator('[name=contact_email]')).toHaveAttribute('readonly','');await form.locator('[name=contact_phone]').fill('02-2345-6789');await form.locator('[name=consent]').check();
  await form.getByRole('button',{name:/送出店家登記/}).click();await expect(page.getByText('已收到，謝謝你打開這扇門。')).toBeVisible();const id=await form.locator('code').innerText();
  await page.goto('/admin/');const card=page.locator('.admin-card').filter({has:page.getByRole('heading',{name,exact:true})});
  await card.locator('[name=review_status]').selectOption('approved');await card.locator('[name=moderation_note]').fill('已確認店家授權與播放設備');await card.getByRole('button',{name:'儲存審核與修改'}).click();await expect(card).toHaveCount(0);
  // A new search key is uncached; public lists can legitimately retain previous values for 30 s.
  await page.goto('/?q='+encodeURIComponent(name));const publicCard=page.locator('.venue-card').filter({has:page.getByRole('heading',{name,exact:true})});await expect(publicCard).toBeVisible();await expect(page.locator('#venue-grid')).not.toContainText('merchant@example.com');
  await publicCard.getByRole('button',{name:'回報問題'}).click();const report=page.locator('#report-dialog');await report.locator('[name=reason]').fill('店家資訊的營業時間有誤，請協助查核。');await report.getByRole('button',{name:'送出回報'}).click();await expect(report.getByText('已收到回報，管理者會查核處理。')).toBeVisible();
  await page.goto('/admin/');await page.getByRole('button',{name:'問題回報',exact:true}).click();const reportCard=page.locator('.admin-card').filter({has:page.getByRole('heading',{name,exact:true})});await reportCard.locator('[name=resolution]').fill('已聯絡店家確認');await reportCard.getByRole('button',{name:'標記已處理'}).click();await expect(reportCard).toHaveCount(0);
  await page.getByRole('button',{name:'已公開',exact:true}).click();await card.locator('[name=review_status]').selectOption('withdrawn');await card.locator('[name=moderation_note]').fill('店家要求取消參與');await card.getByRole('button',{name:'儲存審核與修改'}).click();await expect(card).toHaveCount(0);
  await page.getByRole('button',{name:'已下架',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await card.getByRole('button',{name:'永久刪除'}).click();await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('registration requires login and logout locks the form again',async({page})=>{
  await page.goto('/#register');await expect(page.locator('#register-form [name=name]')).toBeDisabled();
  await page.getByRole('button',{name:'本機模擬 Google 登入',exact:true}).click();await expect(page.locator('#register-form [name=name]')).toBeEnabled();
  await page.getByRole('button',{name:'登出本站',exact:true}).click();await expect(page.locator('#register-form [name=name]')).toBeDisabled();await expect(page.locator('#merchant-message')).toContainText('已登出本站');
});

test('mobile and desktop fit viewport, privacy page and empty search work',async({page})=>{
  await page.goto('/?q=nonexistent-test-venue');await expect(page.getByText('還沒找到符合的場地')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('link',{name:'資料使用說明',exact:true}).last().click();await expect(page.getByRole('heading',{name:'資料使用說明',exact:true})).toBeVisible();await expect(page.locator('#privacy-organizer')).toContainText('本機測試主辦單位');
});

test('untrusted venue text renders literally without executing markup',async({page})=>{
  await page.route('**/api/venues?*',route=>route.fulfill({json:{venues:[{id:'c1e9677f-9d49-4ae2-a14d-af14176e0cb3',name:'<img src=x onerror=alert(1)>',district:'中正區',category:'餐廳',address:'測試地址',capacity:30,screen:'電視',description:'<script>alert(1)</script>',opening_time:'18:00',cost:'免費',booking_url:'javascript:alert(1)',accessible:false}],total:1,page:1,page_size:24}}));
  await page.goto('/');await expect(page.locator('.venue-card h3')).toHaveText('<img src=x onerror=alert(1)>');expect(await page.locator('.venue-card img,.venue-card script').count()).toBe(0);expect(await page.locator('.venue-card a[href^="javascript:"]').count()).toBe(0);
});
