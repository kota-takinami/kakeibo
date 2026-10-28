// -------------------------
// 履歴画面
// 月ごとの一覧・集計と、取引の修正・削除
// -------------------------

import { getData, update, METHODS } from '../store.js';
import {
  todayStr, monthOf, addMonths, yen, signedYen, formatMonth, formatDate,
  monthSummary, applyDueDate, isCardPaid, CARD_METHOD
} from '../calc.js';
import { esc, options, formData, openSheet, toast } from '../ui.js';

let currentMonth = monthOf(todayStr());

export function render(root) {
  const data = getData();
  const today = todayStr();
  const summary = monthSummary(data, currentMonth);

  const transactions = data.transactions
    .filter(tx => monthOf(tx.date) === currentMonth)
    .map(tx => ({ kind: 'tx', date: tx.date, item: tx }));
  const points = data.pointRecords
    .filter(r => monthOf(r.date) === currentMonth)
    .map(r => ({ kind: 'point', date: r.date, item: r }));
  const entries = [...transactions, ...points].sort((a, b) => b.date.localeCompare(a.date));

  // 日付ごとにまとめる
  const byDate = new Map();
  for (const entry of entries) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }

  const maxCategory = summary.categories[0]?.amount || 1;

  root.innerHTML = `
    <section class="page">
      <div class="page-header"><h1>履歴</h1></div>

      <div class="month-nav">
        <button type="button" class="icon-button" data-month="-1" aria-label="前の月">‹</button>
        <h2>${formatMonth(currentMonth)}</h2>
        <button type="button" class="icon-button" data-month="1" aria-label="次の月">›</button>
      </div>

      <div class="stat-grid">
        <div class="stat"><div class="label">収入</div><div class="value income">${yen(summary.income)}</div></div>
        <div class="stat"><div class="label">支出</div><div class="value">${yen(summary.expense)}</div></div>
        <div class="stat"><div class="label">収支</div><div class="value ${summary.net < 0 ? 'expense' : 'income'}">${signedYen(summary.net)}</div></div>
      </div>
      ${summary.invest > 0 ? `<p class="note">投資・積立 ${yen(summary.invest)} は支出に含めず、収支からは差し引いています。</p>` : ''}

      <h3 class="section-title">カテゴリ別の支出</h3>
      <div class="card">
        ${summary.categories.length === 0 ? '<div class="empty">この月の支出はまだありません</div>' : summary.categories.map(c => `
          <div class="bar-row">
            <div class="top"><span>${esc(c.category)}</span><span class="num">${yen(c.amount)}<span class="muted"> ・${Math.round(c.amount / summary.expense * 100)}%</span></span></div>
            <div class="track"><div class="fill" style="width:${(c.amount / maxCategory * 100).toFixed(1)}%"></div></div>
          </div>`).join('')}
      </div>

      <h3 class="section-title"><span>明細（${entries.length}件）</span></h3>
      <div class="list">
        ${entries.length === 0 ? '<div class="empty">記録がありません</div>' : [...byDate.entries()].map(([date, list]) => `
          <div class="date-heading"><span>${formatDate(date)}</span></div>
          ${list.map(entry => entry.kind === 'tx' ? txRow(entry.item, today) : pointRow(entry.item, data)).join('')}
        `).join('')}
      </div>
      <p class="note">タップすると修正・削除できます。</p>
    </section>`;

  // 再描画すると section ごと作り直されるので、イベントも section に付ける
  root.querySelector('section').addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;

    if (button.dataset.month) {
      currentMonth = addMonths(currentMonth, Number(button.dataset.month));
      render(root);
    } else if (button.dataset.tx) {
      editTransaction(button.dataset.tx, () => render(root));
    } else if (button.dataset.point) {
      editPoint(button.dataset.point, () => render(root));
    }
  });
}

function txRow(tx, today) {
  const badges = [];
  if (tx.fixedId) badges.push('<span class="badge">固定費</span>');
  if (tx.method === CARD_METHOD) {
    badges.push(`<span class="badge">${isCardPaid(tx, today) ? '引落済' : `${formatDate(tx.dueDate)}引落`}</span>`);
  }
  const sub = [tx.type === 'expense' ? (tx.card || tx.method) : '', tx.memo].filter(Boolean).join(' ・ ');

  return `
    <button type="button" class="list-row" data-tx="${esc(tx.id)}">
      <div class="main">
        <div class="title">${esc(tx.category)}${badges.join('')}</div>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      </div>
      <div class="amount ${tx.type === 'income' ? 'income' : ''}">${tx.type === 'income' ? '+' : ''}${yen(tx.amount)}</div>
    </button>`;
}

function pointRow(record, data) {
  const program = data.pointPrograms.find(p => p.id === record.programId);
  return `
    <button type="button" class="list-row" data-point="${esc(record.id)}">
      <div class="main">
        <div class="title">🪙 ${esc(program?.name || '削除したポイント')}</div>
        ${record.memo ? `<div class="sub">${esc(record.memo)}</div>` : ''}
      </div>
      <div class="amount ${record.delta > 0 ? 'income' : ''}">${record.delta > 0 ? '+' : '−'}${Math.abs(record.delta).toLocaleString('ja-JP')} pt</div>
    </button>`;
}

// -------------------------
// 取引の修正・削除
// -------------------------

function editTransaction(id, onDone) {
  const data = getData();
  const tx = data.transactions.find(t => t.id === id);
  if (!tx) return;

  const categoryOptions = type => {
    const list = [...data.categories[type]];
    if (tx.type === type && !list.includes(tx.category)) list.push(tx.category);
    return options(list, tx.category);
  };

  const body = `
    <form id="tx-form">
      ${tx.fixedId ? '<p class="note" style="margin:0 0 12px">固定費から自動で記帳された取引です。</p>' : ''}
      <div class="field-row">
        <label class="field"><span>種類</span>
          <select name="type">
            <option value="expense"${tx.type === 'expense' ? ' selected' : ''}>支出</option>
            <option value="income"${tx.type === 'income' ? ' selected' : ''}>収入</option>
          </select>
        </label>
        <label class="field"><span>日付</span><input type="date" name="date" value="${esc(tx.date)}" required></label>
      </div>
      <label class="field"><span>金額（円）</span>
        <input type="text" name="amount" inputmode="numeric" pattern="[0-9]*" value="${tx.amount}" required>
      </label>
      <label class="field"><span>カテゴリ</span><select name="category">${categoryOptions(tx.type)}</select></label>
      <div class="field-row" id="method-fields">
        <label class="field"><span>支払方法</span><select name="method">${options(METHODS, tx.method)}</select></label>
        <label class="field" id="card-field"><span>カード</span><select name="card">${options(data.cards.map(c => c.name), tx.card)}</select></label>
      </div>
      <label class="field"><span>メモ</span><input type="text" name="memo" value="${esc(tx.memo)}"></label>
      <div class="btn-row">
        <button type="button" class="btn danger" data-delete>削除</button>
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`;

  openSheet('取引を修正', body, (sheet, close) => {
    const form = sheet.querySelector('#tx-form');

    const refresh = () => {
      const type = form.type.value;
      sheet.querySelector('#method-fields').hidden = type !== 'expense';
      sheet.querySelector('#card-field').hidden = form.method.value !== CARD_METHOD;
    };
    form.type.addEventListener('change', () => {
      form.category.innerHTML = categoryOptions(form.type.value);
      refresh();
    });
    form.method.addEventListener('change', refresh);
    refresh();

    form.addEventListener('submit', e => {
      e.preventDefault();
      const values = formData(form);
      const amount = Number(String(values.amount).replace(/[^0-9]/g, ''));
      if (!amount) {
        toast('金額を入力してください');
        return;
      }
      update(d => {
        const target = d.transactions.find(t => t.id === id);
        Object.assign(target, {
          type: values.type,
          date: values.date,
          amount,
          category: values.category,
          method: values.type === 'expense' ? values.method : '',
          card: values.type === 'expense' && values.method === CARD_METHOD ? values.card : '',
          memo: values.memo.trim()
        });
        applyDueDate(target, d.cards);
      });
      close();
      toast('修正しました');
      onDone();
    });

    sheet.querySelector('[data-delete]').addEventListener('click', () => {
      if (!confirm('この取引を削除しますか？')) return;
      update(d => { d.transactions = d.transactions.filter(t => t.id !== id); });
      close();
      toast('削除しました');
      onDone();
    });
  });
}

function editPoint(id, onDone) {
  const data = getData();
  const record = data.pointRecords.find(r => r.id === id);
  if (!record) return;

  const programOptions = data.pointPrograms
    .map(p => `<option value="${esc(p.id)}"${p.id === record.programId ? ' selected' : ''}>${esc(p.name)}</option>`)
    .join('');

  const body = `
    <form id="point-form">
      <div class="field-row">
        <label class="field"><span>ポイント</span><select name="programId">${programOptions}</select></label>
        <label class="field"><span>日付</span><input type="date" name="date" value="${esc(record.date)}" required></label>
      </div>
      <div class="field-row">
        <label class="field"><span>種類</span>
          <select name="sign">
            <option value="1"${record.delta > 0 ? ' selected' : ''}>獲得</option>
            <option value="-1"${record.delta < 0 ? ' selected' : ''}>使用</option>
          </select>
        </label>
        <label class="field"><span>ポイント数</span>
          <input type="text" name="points" inputmode="numeric" pattern="[0-9]*" value="${Math.abs(record.delta)}" required>
        </label>
      </div>
      <label class="field"><span>メモ</span><input type="text" name="memo" value="${esc(record.memo)}"></label>
      <div class="btn-row">
        <button type="button" class="btn danger" data-delete>削除</button>
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`;

  openSheet('ポイントの記録を修正', body, (sheet, close) => {
    const form = sheet.querySelector('#point-form');

    form.addEventListener('submit', e => {
      e.preventDefault();
      const values = formData(form);
      const points = Number(String(values.points).replace(/[^0-9]/g, ''));
      update(d => {
        const target = d.pointRecords.find(r => r.id === id);
        Object.assign(target, {
          programId: values.programId,
          date: values.date,
          delta: points * Number(values.sign),
          memo: values.memo.trim()
        });
      });
      close();
      toast('修正しました');
      onDone();
    });

    sheet.querySelector('[data-delete]').addEventListener('click', () => {
      if (!confirm('この記録を削除しますか？')) return;
      update(d => { d.pointRecords = d.pointRecords.filter(r => r.id !== id); });
      close();
      toast('削除しました');
      onDone();
    });
  });
}
