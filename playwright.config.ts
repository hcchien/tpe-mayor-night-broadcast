import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser', fullyParallel:false, workers:1,
  use:{baseURL:'http://127.0.0.1:8787',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
  webServer:{command:'npm run db:local && npm run dev',url:'http://127.0.0.1:8787/api/config',reuseExistingServer:false,timeout:120000},
});
