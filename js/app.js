// -------------------------
// アプリの起動とタブの切り替え
// -------------------------

import { getData, update } from './store.js';
import { todayStr, daysUntil, generateFixedCosts, snapshotAssets } from './calc.js';
import { toast } from './ui.js';

import * as addView from './views/add.js';
import * as historyView from './views/history.js';
import * as assetsView from './views/assets.js';
import * as gradView from './views/grad.js';
import * as settingsView from './views/settings.js';

const routes = {
  add: addView,
  history: historyView,
  assets: assetsView,
  grad: gradView,
  settings: settingsView
};

const BACKUP_REMIND_DAYS = 14;

function currentRoute() {
  const match = location.hash.match(/^#\/(\w+)/);
  return match && routes[match[1]] ? match[1] : 'add';
}

export function render() {
  const name = currentRoute();

  document.querySelectorAll('.tabbar a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === name);
  });

  renderBanner(name);

  // 前の画面のイベントが残らないよう、入れ物ごと作り直す
  const old = document.getElementById('view');
  const root = old.cloneNode(false);
  old.replaceWith(root);
  window.scrollTo(0, 0);
  routes[name].render(root);
}

// しばらくバックアップしていなければお知らせを出す
function renderBanner(routeName) {
  const banner = document.getElementById('banner');
  const data = getData();
  const last = data.settings.lastBackup;
  const days = last ? daysUntil(last, todayStr()) : null;
  const needed = data.transactions.length > 0 && (days === null || days >= BACKUP_REMIND_DAYS);

  if (!needed || routeName === 'settings') {
    banner.innerHTML = '';
    return;
  }
  const text = days === null
    ? 'まだバックアップしていません'
    : `最後のバックアップから${days}日たちました`;
  banner.innerHTML = `
    <div class="banner">
      <span>💾 ${text}</span>
      <a class="btn small" href="#/settings">バックアップ</a>
    </div>`;
}

// 固定費の記帳と、今月の資産の記録
// アプリを開いたときと、日付が変わってから戻ってきたときに行う
let lastCheckedDay = null;

function dailyTasks() {
  const today = todayStr();
  if (lastCheckedDay === today) return 0;
  lastCheckedDay = today;

  let created = 0;
  update(d => {
    created = generateFixedCosts(d, today);
    snapshotAssets(d, today);
  });
  if (created > 0) toast(`固定費を${created}件記帳しました`);
  return created;
}

function start() {
  dailyTasks();
  window.addEventListener('hashchange', render);
  render();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dailyTasks() > 0) render();
  });

  // ストレージを消されにくくする（対応しているブラウザのみ）
  navigator.storage?.persist?.();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker の登録に失敗しました', e));
  }
}

start();
