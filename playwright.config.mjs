import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser', use:{baseURL:'http://127.0.0.1:3101', launchOptions:{args:['--autoplay-policy=no-user-gesture-required']}}, webServer:{command:'node server/index.mjs',env:{PORT:'3101'},url:'http://127.0.0.1:3101',reuseExistingServer:false},workers:1});
