// config.js — 部署相關的公開設定
// 這裡沒有密鑰。網頁前端的任何字串都會出現在原始碼裡，所以只放本來就公開的東西。

/** 同步後端（Cloudflare Worker，程式在 worker/）。空字串 = 整個同步功能關閉。 */
export const SYNC_API = 'https://fabenglish-sync.jerrywu0800.workers.dev';

/** 擋隨機掃網址的機器人用，不是安全機制（見 worker/README.md）。 */
export const APP_KEY = '25cc6a1438dc3a9dd1291b48c7f74697';

/**
 * Google OAuth 用戶端 ID（公開資訊）。空字串 = Google 登入按鈕不出現，
 * 其他同步方式照常。要開通請照 worker/README.md 的步驟建一組貼進來。
 */
export const GOOGLE_CLIENT_ID = '';
