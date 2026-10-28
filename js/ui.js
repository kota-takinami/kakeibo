// -------------------------
// 画面づくりの共通部品
// -------------------------

// HTML に文字を埋め込むときは必ずこれを通す
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function options(values, selected) {
  return values
    .map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`)
    .join('');
}

export function formData(form) {
  return Object.fromEntries(new FormData(form));
}

// -------------------------
// トースト（画面下に出る短いお知らせ）
// action を渡すと「取り消し」などのボタンが付く
// -------------------------

let toastTimer = null;

export function toast(message, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');

  const hide = () => el.classList.remove('show');
  if (action) {
    el.querySelector('button').onclick = () => {
      action.run();
      hide();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 5000 : 2200);
}

// -------------------------
// 下から出てくる編集シート
// -------------------------

export function openSheet(title, bodyHtml, onMount) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-header">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-button" data-close aria-label="閉じる">✕</button>
      </header>
      <div class="sheet-body">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');

  const close = () => {
    backdrop.remove();
    document.body.classList.remove('sheet-open');
  };
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });

  onMount?.(backdrop.querySelector('.sheet'), close);
  return close;
}

// -------------------------
// グラフ（Chart.js）
// -------------------------

const charts = new WeakMap();

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function drawChart(canvas, config) {
  const Chart = window.Chart;
  if (!Chart) return null;

  charts.get(canvas)?.destroy();

  Chart.defaults.font.family = cssVar('--font');
  Chart.defaults.font.size = 12;
  Chart.defaults.color = cssVar('--text-muted');
  Chart.defaults.borderColor = cssVar('--grid');

  const chart = new Chart(canvas, config);
  charts.set(canvas, chart);
  return chart;
}

// 金額の軸ラベルを「12万」のように短くする
export function shortYen(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 10000) return `${sign}${Math.round(abs / 1000) / 10}万`;
  return `${sign}${Math.round(abs).toLocaleString('ja-JP')}`;
}
