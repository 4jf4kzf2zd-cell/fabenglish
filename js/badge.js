// badge.js — PWA 應用程式圖示上的待複習數字（App Badging API）
// iOS 16.4+ 只有「加到主畫面」之後才支援，而且需要通知權限；桌面 Chrome 也支援。
// 不支援時整個模組安靜地什麼都不做，不要在 UI 上報錯。

import * as store from './store.js';

export function supported() {
  return typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function';
}

/** iOS 需要通知權限才會顯示 badge；桌面通常不需要。 */
export function permission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return 'denied';
  }
}

/**
 * 設定 badge 數字。0 或關閉時清掉。
 * @param {number} count 今日還沒完成的任務數（M5 起；M4 以前是待複習卡數）
 */
export async function update(count) {
  if (!supported()) return false;
  if (!store.settings().badge) { await clear(); return false; }
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
    return true;
  } catch (_) {
    return false;   // 權限未給或系統不允許，安靜略過
  }
}

export async function clear() {
  if (!supported()) return;
  try { await navigator.clearAppBadge(); } catch (_) { /* noop */ }
}

/** 從內容與進度算出今日還沒完成的任務數，然後更新 badge。 */
export async function refresh() {
  if (!supported() || !store.settings().badge) return;
  try {
    const [{ vocab }, daily] = await Promise.all([import('./content.js'), import('./daily.js')]);
    const items = await vocab();
    await update(daily.remaining(items));
  } catch (_) { /* 離線或內容載入失敗就不動 badge */ }
}
