// -------------------------
// 入力画面（アプリを開いたら最初に出る画面）
// 金額 → カテゴリ → 支払方法 を選んで保存するだけで記録できる
// -------------------------

import { getData, update, uid, METHODS } from '../store.js';
import { todayStr, addMonths, monthOf, yen, applyDueDate, CARD_METHOD } from '../calc.js';
import { esc, toast } from '../ui.js';

const MAX_DIGITS = 8;

// 画面を切り替えても入力途中の状態を覚えておく
const state = {
  mode: 'expense',      // 'expense' | 'income' | 'point'
  amount: '',
  category: null,
  method: null,
  card: null,
  date: todayStr(),
  dateChosen: false,
  memo: '',
  programId: null,
  pointSign: 1          // 1: 獲得, -1: 使用
};

// 直近90日でよく使った順に並べる
function sortedCategories(type) {
  const data = getData();
  const since = `${addMonths(monthOf(todayStr()), -3)}-01`;
  const counts = new Map();
  for (const tx of data.transactions) {
    if (tx.type === type && tx.date >= since) {
      counts.set(tx.category, (counts.get(tx.category) || 0) + 1);
    }
  }
  return [...data.categories[type]].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
}

function chipsHtml(values, selected, attr) {
  return values
    .map(v => `<button type="button" class="chip${v.value === selected ? ' active' : ''}" data-${attr}="${esc(v.value)}">${esc(v.label)}</button>`)
    .join('');
}

export function render(root) {
  const data = getData();

  // 日付を自分で選んでいなければ、開くたびに今日にする
  if (!state.dateChosen) state.date = todayStr();

  // 前回の選択を初期値にする
  if (!state.method) state.method = data.settings.lastMethod || '現金';
  if (!state.card) state.card = data.settings.lastCard || data.cards[0]?.name || '';
  if (!state.programId || !data.pointPrograms.some(p => p.id === state.programId)) {
    state.programId = data.pointPrograms[0]?.id || null;
  }

  root.innerHTML = `
    <section class="page add">
      <div class="seg" role="tablist" aria-label="記録の種類">
        <button type="button" data-mode="expense">支出</button>
        <button type="button" data-mode="income">収入</button>
        <button type="button" data-mode="point">ポイント</button>
      </div>

      <div class="amount-display" id="amount-display" aria-live="polite"></div>

      <div class="chips two-rows" id="primary-chips"></div>
      <div class="chips scroll" id="secondary-chips"></div>
      <div class="chips scroll" id="card-chips"></div>

      <div class="inline-fields">
        <input type="date" id="date" aria-label="日付">
        <input type="text" id="memo" placeholder="メモ（任意）" aria-label="メモ" enterkeyhint="done">
      </div>

      <div class="keypad" id="keypad">
        <button type="button" class="key" data-key="7">7</button>
        <button type="button" class="key" data-key="8">8</button>
        <button type="button" class="key" data-key="9">9</button>
        <button type="button" class="key fn" data-key="back" aria-label="1文字消す">⌫</button>
        <button type="button" class="key" data-key="4">4</button>
        <button type="button" class="key" data-key="5">5</button>
        <button type="button" class="key" data-key="6">6</button>
        <button type="button" class="key fn" data-key="clear" aria-label="クリア">C</button>
        <button type="button" class="key" data-key="1">1</button>
        <button type="button" class="key" data-key="2">2</button>
        <button type="button" class="key" data-key="3">3</button>
        <button type="button" class="key save" id="save-button">保存</button>
        <button type="button" class="key zero" data-key="0">0</button>
        <button type="button" class="key" data-key="00">00</button>
      </div>
    </section>`;

  const $ = sel => root.querySelector(sel);

  // -------------------------
  // 表示の更新
  // -------------------------

  function refreshAmount() {
    const value = Number(state.amount || 0);
    const display = $('#amount-display');
    display.className = `amount-display ${state.mode}`;

    if (state.mode === 'point') {
      const program = data.pointPrograms.find(p => p.id === state.programId);
      const yenValue = value * (program?.yenPerPoint || 0);
      display.innerHTML = `
        <span class="label">${state.pointSign > 0 ? '獲得' : '使用'}ポイント</span>
        <span class="sub">${yen(yenValue)}相当</span>
        <span class="value num">${value.toLocaleString('ja-JP')}<small style="font-size:20px"> pt</small></span>`;
    } else {
      display.innerHTML = `
        <span class="label">${state.mode === 'expense' ? '支出' : '収入'}</span>
        <span class="value num">${yen(value)}</span>`;
    }
    $('#save-button').disabled = value <= 0;
  }

  function refreshChips() {
    root.querySelectorAll('.seg button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });

    const primary = $('#primary-chips');
    const secondary = $('#secondary-chips');
    const cards = $('#card-chips');

    if (state.mode === 'point') {
      primary.innerHTML = chipsHtml(
        data.pointPrograms.map(p => ({ value: p.id, label: p.name })), state.programId, 'program');
      secondary.innerHTML = chipsHtml(
        [{ value: '1', label: '＋ 獲得' }, { value: '-1', label: '− 使用' }], String(state.pointSign), 'sign');
      cards.innerHTML = '';
      $('#memo').placeholder = 'メモ（例：コンビニで還元）';
      return;
    }

    const categories = sortedCategories(state.mode);
    if (!categories.includes(state.category)) state.category = categories[0];
    primary.innerHTML = chipsHtml(categories.map(c => ({ value: c, label: c })), state.category, 'category');

    if (state.mode === 'expense') {
      secondary.innerHTML = chipsHtml(METHODS.map(m => ({ value: m, label: m })), state.method, 'method');
      cards.innerHTML = state.method === CARD_METHOD && data.cards.length > 1
        ? chipsHtml(data.cards.map(c => ({ value: c.name, label: `💳 ${c.name}` })), state.card, 'card')
        : '';
    } else {
      secondary.innerHTML = '';
      cards.innerHTML = '';
    }
    $('#memo').placeholder = 'メモ（任意）';
  }

  function refreshDate() {
    const input = $('#date');
    input.value = state.date;
    input.classList.toggle('not-today', state.date !== todayStr());
  }

  function refreshAll() {
    refreshChips();
    refreshAmount();
    refreshDate();
    $('#memo').value = state.memo;
  }

  // -------------------------
  // 操作
  // -------------------------

  function pressKey(key) {
    if (key === 'back') state.amount = state.amount.slice(0, -1);
    else if (key === 'clear') state.amount = '';
    else if (state.amount.length + key.length <= MAX_DIGITS) {
      state.amount = (state.amount + key).replace(/^0+/, '');
    }
    refreshAmount();
  }

  function saveEntry() {
    const amount = Number(state.amount || 0);
    if (amount <= 0) return;

    state.memo = $('#memo').value.trim();
    const date = state.date || todayStr();

    if (state.mode === 'point') {
      const program = data.pointPrograms.find(p => p.id === state.programId);
      if (!program) {
        toast('設定画面でポイントを追加してください');
        return;
      }
      const record = { id: uid(), date, programId: program.id, delta: amount * state.pointSign, memo: state.memo };
      update(d => d.pointRecords.push(record));
      toast(`${program.name} ${state.pointSign > 0 ? '+' : '−'}${amount.toLocaleString('ja-JP')}pt`, {
        label: '取り消し',
        run: () => update(d => { d.pointRecords = d.pointRecords.filter(r => r.id !== record.id); })
      });
    } else {
      const tx = {
        id: uid(),
        date,
        type: state.mode,
        amount,
        category: state.category,
        method: state.mode === 'expense' ? state.method : '',
        card: state.mode === 'expense' && state.method === CARD_METHOD ? state.card : '',
        memo: state.memo
      };
      update(d => {
        d.transactions.push(applyDueDate(tx, d.cards));
        if (tx.type === 'expense') {
          d.settings.lastMethod = tx.method;
          if (tx.card) d.settings.lastCard = tx.card;
        }
      });
      toast(`${tx.category} ${yen(amount)} を保存しました`, {
        label: '取り消し',
        run: () => update(d => { d.transactions = d.transactions.filter(t => t.id !== tx.id); })
      });
    }

    // 続けて入力できるよう、金額とメモだけ消す（日付と選択は残す）
    state.amount = '';
    state.memo = '';
    $('#memo').value = '';
    refreshAmount();
  }

  root.querySelector('section').addEventListener('click', e => {
    const target = e.target.closest('button');
    if (!target) return;
    const ds = target.dataset;

    if (ds.mode) {
      state.mode = ds.mode;
      refreshAll();
    } else if (ds.key) {
      pressKey(ds.key);
    } else if (target.id === 'save-button') {
      saveEntry();
    } else if (ds.category) {
      state.category = ds.category;
      refreshChips();
    } else if (ds.method) {
      state.method = ds.method;
      refreshChips();
    } else if (ds.card) {
      state.card = ds.card;
      refreshChips();
    } else if (ds.program) {
      state.programId = ds.program;
      refreshChips();
      refreshAmount();
    } else if (ds.sign) {
      state.pointSign = Number(ds.sign);
      refreshChips();
      refreshAmount();
    }
  });

  $('#date').addEventListener('change', e => {
    state.date = e.target.value || todayStr();
    state.dateChosen = state.date !== todayStr();
    refreshDate();
  });

  $('#memo').addEventListener('input', e => { state.memo = e.target.value; });
  $('#memo').addEventListener('keydown', e => {
    if (e.key === 'Enter') e.target.blur();
  });

  // PC のキーボードでも入力できるようにする
  const onKey = e => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.target.matches('input, select, textarea') || document.body.classList.contains('sheet-open')) return;
    if (/^[0-9]$/.test(e.key)) pressKey(e.key);
    else if (e.key === 'Backspace') pressKey('back');
    else if (e.key === 'Enter') saveEntry();
  };
  document.addEventListener('keydown', onKey);

  refreshAll();
}
