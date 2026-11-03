// -------------------------
// 入力画面（アプリを開いたら最初に出る画面）
// 金額 → カテゴリ → 支払方法 を選んで保存するだけで記録できる
// 「移動」は ATM での引き出しなど、銀行と財布の間でお金を動かしたときに使う
// -------------------------

import { getData, update, uid, METHODS } from '../store.js';
import {
  todayStr, addMonths, monthOf, yen, applyDueDate, categoryLabel, recentDetails, bankAccounts, defaultBankId,
  CARD_METHOD, CASH_METHOD, OTHER_CATEGORY, WALLET_ID
} from '../calc.js';
import { esc, toast } from '../ui.js';

const MAX_DIGITS = 8;

// 画面を切り替えても入力途中の状態を覚えておく
const state = {
  mode: 'expense',      // 'expense' | 'income' | 'transfer' | 'point'
  amount: '',
  category: null,
  method: null,
  card: null,
  bank: null,           // 口座振替・QR決済などで使う銀行（銀行が2つ以上あるとき選ぶ）
  incomeAccount: null,  // 収入が入る口座
  from: null,           // 移動：出金元
  to: null,             // 移動：入金先
  date: todayStr(),
  dateChosen: false,
  memo: '',
  detail: '',           // カテゴリが「その他」のときの内容（例：美容院）
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

function chipsHtml(values, selected, attr, label = '') {
  const head = label ? `<span class="chip-label">${esc(label)}</span>` : '';
  return head + values
    .map(v => `<button type="button" class="chip${v.value === selected ? ' active' : ''}" data-${attr}="${esc(v.value)}">${esc(v.label)}</button>`)
    .join('');
}

// 財布・銀行のチップ用
const accountChips = data => data.accounts.map(a => ({ value: a.id, label: a.kind === 'cash' ? `👛 ${a.name}` : `🏦 ${a.name}` }));

export function render(root) {
  const data = getData();

  // 日付を自分で選んでいなければ、開くたびに今日にする
  if (!state.dateChosen) state.date = todayStr();

  // 前回の選択を初期値にする
  if (!state.method) state.method = data.settings.lastMethod || '現金';
  if (!state.card) state.card = data.settings.lastCard || data.cards[0]?.name || '';
  const hasAccount = id => data.accounts.some(a => a.id === id);
  if (!hasAccount(state.bank)) state.bank = hasAccount(data.settings.lastBank) ? data.settings.lastBank : defaultBankId(data);
  if (!hasAccount(state.incomeAccount)) state.incomeAccount = defaultBankId(data);
  if (!hasAccount(state.from)) state.from = defaultBankId(data);
  if (!hasAccount(state.to)) state.to = WALLET_ID;
  if (!state.programId || !data.pointPrograms.some(p => p.id === state.programId)) {
    state.programId = data.pointPrograms[0]?.id || null;
  }

  root.innerHTML = `
    <section class="page add">
      <div class="seg" role="tablist" aria-label="記録の種類">
        <button type="button" data-mode="expense">支出</button>
        <button type="button" data-mode="income">収入</button>
        <button type="button" data-mode="transfer">移動</button>
        <button type="button" data-mode="point">ポイント</button>
      </div>

      <div class="amount-display" id="amount-display" aria-live="polite"></div>

      <div class="chips two-rows" id="primary-chips"></div>
      <div class="chips scroll" id="secondary-chips"></div>
      <div class="chips scroll" id="card-chips"></div>

      <div id="detail-row" hidden>
        <input type="text" id="detail" list="detail-options" placeholder="「その他」の内容（例：美容院）" aria-label="「その他」の内容" enterkeyhint="done">
        <datalist id="detail-options"></datalist>
      </div>

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
      const label = { expense: '支出', income: '収入', transfer: '移動' }[state.mode];
      display.innerHTML = `
        <span class="label">${label}</span>
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
    primary.classList.toggle('two-rows', state.mode !== 'transfer');
    primary.classList.toggle('scroll', state.mode === 'transfer');

    if (state.mode === 'transfer') {
      primary.innerHTML = chipsHtml(accountChips(data), state.from, 'from', '出金元');
      secondary.innerHTML = chipsHtml(accountChips(data), state.to, 'to', '入金先');
      cards.innerHTML = '';
      $('#detail-row').hidden = true;
      $('#memo').placeholder = 'メモ（例：ATMで引き出し）';
      return;
    }

    if (state.mode === 'point') {
      primary.innerHTML = chipsHtml(
        data.pointPrograms.map(p => ({ value: p.id, label: p.name })), state.programId, 'program');
      secondary.innerHTML = chipsHtml(
        [{ value: '1', label: '＋ 獲得' }, { value: '-1', label: '− 使用' }], String(state.pointSign), 'sign');
      cards.innerHTML = '';
      $('#detail-row').hidden = true;
      $('#memo').placeholder = 'メモ（例：コンビニで還元）';
      return;
    }

    const categories = sortedCategories(state.mode);
    if (!categories.includes(state.category)) state.category = categories[0];
    primary.innerHTML = chipsHtml(categories.map(c => ({ value: c, label: c })), state.category, 'category');

    if (state.mode === 'expense') {
      secondary.innerHTML = chipsHtml(METHODS.map(m => ({ value: m, label: m })), state.method, 'method');
      // カードが2枚以上ならカードを、口座振替などで銀行が2つ以上なら銀行を選ぶ
      const banks = bankAccounts(data);
      if (state.method === CARD_METHOD && data.cards.length > 1) {
        cards.innerHTML = chipsHtml(data.cards.map(c => ({ value: c.name, label: `💳 ${c.name}` })), state.card, 'card');
      } else if (state.method !== CARD_METHOD && state.method !== CASH_METHOD && banks.length > 1) {
        cards.innerHTML = chipsHtml(banks.map(a => ({ value: a.id, label: `🏦 ${a.name}` })), state.bank, 'bank');
      } else {
        cards.innerHTML = '';
      }
    } else {
      secondary.innerHTML = chipsHtml(accountChips(data), state.incomeAccount, 'account', '入金先');
      cards.innerHTML = '';
    }

    // 「その他」のときだけ、内容の入力欄を出す（前に使った内容が候補に出る）
    const showDetail = state.category === OTHER_CATEGORY;
    $('#detail-row').hidden = !showDetail;
    if (showDetail) {
      $('#detail-options').innerHTML = recentDetails(data, state.mode)
        .map(v => `<option value="${esc(v)}">`).join('');
      $('#detail').value = state.detail;
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
    } else if (state.mode === 'transfer') {
      if (state.from === state.to) {
        toast('出金元と入金先を別の場所にしてください');
        return;
      }
      const name = id => data.accounts.find(a => a.id === id)?.name || '';
      const tx = { id: uid(), date, type: 'transfer', amount, fromAccount: state.from, toAccount: state.to, memo: state.memo, createdAt: Date.now() };
      update(d => d.transactions.push(tx));
      toast(`${name(tx.fromAccount)} → ${name(tx.toAccount)} ${yen(amount)}`, {
        label: '取り消し',
        run: () => update(d => { d.transactions = d.transactions.filter(t => t.id !== tx.id); })
      });
    } else {
      // お金が出入りする口座（現金なら財布、カードならカードの引落口座）
      let account = '';
      if (state.mode === 'income') account = state.incomeAccount;
      else if (state.method === CASH_METHOD) account = WALLET_ID;
      else if (state.method !== CARD_METHOD) account = state.bank;

      const tx = {
        id: uid(),
        date,
        type: state.mode,
        amount,
        category: state.category,
        method: state.mode === 'expense' ? state.method : '',
        card: state.mode === 'expense' && state.method === CARD_METHOD ? state.card : '',
        account,
        detail: state.category === OTHER_CATEGORY ? $('#detail').value.trim() : '',
        memo: state.memo,
        createdAt: Date.now()
      };
      update(d => {
        d.transactions.push(applyDueDate(tx, d.cards));
        if (tx.type === 'expense') {
          d.settings.lastMethod = tx.method;
          if (tx.card) d.settings.lastCard = tx.card;
          if (account && account !== WALLET_ID) d.settings.lastBank = account;
        }
      });
      toast(`${categoryLabel(tx)} ${yen(amount)} を保存しました`, {
        label: '取り消し',
        run: () => update(d => { d.transactions = d.transactions.filter(t => t.id !== tx.id); })
      });
    }

    // 続けて入力できるよう、金額とメモと内容だけ消す（日付と選択は残す）
    state.amount = '';
    state.memo = '';
    state.detail = '';
    $('#memo').value = '';
    $('#detail').value = '';
    // いま入れた内容も、次から候補に出るようにする
    if (state.mode === 'expense' || state.mode === 'income') {
      $('#detail-options').innerHTML = recentDetails(data, state.mode)
        .map(v => `<option value="${esc(v)}">`).join('');
    }
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
    } else if (ds.bank) {
      state.bank = ds.bank;
      refreshChips();
    } else if (ds.account) {
      state.incomeAccount = ds.account;
      refreshChips();
    } else if (ds.from) {
      state.from = ds.from;
      refreshChips();
    } else if (ds.to) {
      state.to = ds.to;
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
  $('#detail').addEventListener('input', e => { state.detail = e.target.value; });
  $('#detail').addEventListener('keydown', e => {
    if (e.key === 'Enter') e.target.blur();
  });
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
