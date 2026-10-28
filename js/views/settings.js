// -------------------------
// 設定画面
// 固定費・クレジットカード・カテゴリ・バックアップ
// -------------------------

import { getData, update, uid, exportJSON, importJSON, METHODS } from '../store.js';
import {
  todayStr, monthOf, addMonths, yen, formatFullDate, daysUntil,
  generateFixedCosts, fixedMonthlyTotal, applyDueDate, isCardPaid, CARD_METHOD
} from '../calc.js';
import { esc, options, formData, openSheet, toast } from '../ui.js';

export function render(root) {
  const data = getData();
  const totals = fixedMonthlyTotal(data);
  const last = data.settings.lastBackup;

  root.innerHTML = `
    <section class="page">
      <div class="page-header"><h1>設定</h1></div>

      <h3 class="section-title">
        <span>固定費（毎月 自動で記帳）</span>
        <button type="button" class="link-button" data-add-fixed>＋ 追加</button>
      </h3>
      <div class="list">
        ${data.fixedCosts.length === 0 ? '<div class="empty">家賃・サブスク・通信費などを登録すると、<br>毎月の支払日に自動で記帳されます</div>' : data.fixedCosts.map(fc => `
          <button type="button" class="list-row" data-fixed="${esc(fc.id)}">
            <div class="main">
              <div class="title">${esc(fc.name)}${fc.active ? '' : '<span class="badge">停止中</span>'}${fc.type === 'income' ? '<span class="badge">収入</span>' : ''}</div>
              <div class="sub">毎月${fc.day >= 31 ? '末' : `${fc.day}日`} ・ ${esc(fc.category)}${fc.type === 'income' ? '' : ` ・ ${esc(fc.card || fc.method)}`}</div>
            </div>
            <div class="amount ${fc.type === 'income' ? 'income' : ''}">${yen(fc.amount)}</div>
          </button>`).join('')}
      </div>
      ${data.fixedCosts.length ? `<p class="note">固定費の合計：支出 ${yen(totals.expense)}／月${totals.income ? `、収入 ${yen(totals.income)}／月` : ''}</p>` : ''}

      <h3 class="section-title">
        <span>クレジットカード</span>
        <button type="button" class="link-button" data-add-card>＋ 追加</button>
      </h3>
      <div class="list">
        ${data.cards.length === 0 ? '<div class="empty">カードが登録されていません</div>' : data.cards.map(card => `
          <button type="button" class="list-row" data-card="${esc(card.id)}">
            <div class="main">
              <div class="title">💳 ${esc(card.name)}</div>
              <div class="sub">${card.closingDay >= 31 ? '月末' : `毎月${card.closingDay}日`}締め ・ 翌月${card.paymentDay >= 31 ? '末' : `${card.paymentDay}日`}引落</div>
            </div>
          </button>`).join('')}
      </div>

      <h3 class="section-title"><span>カテゴリ</span></h3>
      <div class="list">
        <button type="button" class="list-row" data-categories="expense">
          <div class="main"><div class="title">支出のカテゴリ</div><div class="sub">${esc(data.categories.expense.join('、'))}</div></div>
        </button>
        <button type="button" class="list-row" data-categories="income">
          <div class="main"><div class="title">収入のカテゴリ</div><div class="sub">${esc(data.categories.income.join('、'))}</div></div>
        </button>
      </div>

      <h3 class="section-title"><span>バックアップ</span></h3>
      <div class="card">
        <p style="margin:0 0 4px">データはこの iPhone の中だけに保存されています。機種変更やアプリの削除に備えて、ときどきバックアップしてください。</p>
        <p class="note" style="margin:0 0 12px">前回のバックアップ：${last ? `${formatFullDate(last)}（${daysUntil(last, todayStr())}日前）` : 'まだありません'}</p>
        <button type="button" class="btn primary block" data-export>バックアップを保存</button>
        <label class="btn block" style="margin-top:10px">
          バックアップから復元
          <input type="file" accept="application/json,.json" data-import hidden>
        </label>
      </div>

      <h3 class="section-title"><span>このアプリについて</span></h3>
      <div class="card">
        <div class="note" style="margin:0">
          取引 ${data.transactions.length}件 ・ ポイント記録 ${data.pointRecords.length}件 ・ 投資 ${data.investments.length}件<br>
          <span id="persist-status"></span>
        </div>
      </div>
    </section>`;

  const section = root.querySelector('section');
  const rerender = () => render(root);

  section.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    const ds = button.dataset;

    if ('addFixed' in ds) editFixedCost(null, rerender);
    else if (ds.fixed) editFixedCost(ds.fixed, rerender);
    else if ('addCard' in ds) editCard(null, rerender);
    else if (ds.card) editCard(ds.card, rerender);
    else if (ds.categories) editCategories(ds.categories, rerender);
    else if ('export' in ds) exportBackup(rerender);
  });

  section.querySelector('[data-import]').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importBackup(file);
  });

  navigator.storage?.persisted?.().then(persisted => {
    const el = section.querySelector('#persist-status');
    if (el) el.textContent = persisted ? '保存領域：保護されています' : '';
  });
}

// -------------------------
// 固定費
// -------------------------

function editFixedCost(id, onDone) {
  const data = getData();
  const today = todayStr();
  const existing = data.fixedCosts.find(fc => fc.id === id);

  // 新規のときの初期値
  const fc = existing || {
    type: 'expense',
    name: '',
    amount: '',
    category: '家賃',
    method: '口座振替',
    card: data.cards[0]?.name || '',
    day: 27,
    startMonth: monthOf(today),
    endMonth: '',
    active: true
  };

  const categoryOptions = type => options(data.categories[type], fc.category);

  const body = `
    <form id="fixed-form">
      <div class="seg" style="margin-bottom:14px">
        <button type="button" data-type="expense">支出</button>
        <button type="button" data-type="income">収入（仕送りなど）</button>
      </div>
      <input type="hidden" name="type" value="${fc.type || 'expense'}">
      <label class="field"><span>名前</span><input type="text" name="name" value="${esc(fc.name)}" placeholder="例：家賃、Netflix、スマホ代" required></label>
      <div class="field-row">
        <label class="field"><span>金額（円）</span><input type="text" name="amount" inputmode="numeric" pattern="[0-9]*" value="${esc(fc.amount)}" required></label>
        <label class="field"><span>毎月の日（31＝月末）</span><input type="number" name="day" min="1" max="31" value="${fc.day}" required></label>
      </div>
      <label class="field"><span>カテゴリ</span><select name="category">${categoryOptions(fc.type || 'expense')}</select></label>
      <div class="field-row" id="method-fields">
        <label class="field"><span>支払方法</span><select name="method">${options(METHODS, fc.method)}</select></label>
        <label class="field" id="card-field"><span>カード</span><select name="card">${options(data.cards.map(c => c.name), fc.card)}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>開始月</span><input type="month" name="startMonth" value="${esc(fc.startMonth)}" required></label>
        <label class="field"><span>終了月（任意）</span><input type="month" name="endMonth" value="${esc(fc.endMonth || '')}"></label>
      </div>
      <label class="check-field"><input type="checkbox" name="active"${fc.active ? ' checked' : ''}> 自動で記帳する</label>
      <p class="note" style="margin:0">開始月から今日までの分で、支払日を過ぎた月はすぐに記帳されます。すでに手入力した月がある場合は、開始月を来月にしてください。</p>
      <div class="btn-row">
        ${existing ? '<button type="button" class="btn danger" data-delete>削除</button>' : ''}
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`;

  openSheet(existing ? '固定費を編集' : '固定費を追加', body, (sheet, close) => {
    const form = sheet.querySelector('#fixed-form');

    const refresh = () => {
      const type = form.type.value;
      sheet.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === type));
      sheet.querySelector('#method-fields').hidden = type !== 'expense';
      sheet.querySelector('#card-field').hidden = form.method.value !== CARD_METHOD;
    };

    sheet.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
      form.type.value = b.dataset.type;
      form.category.innerHTML = categoryOptions(b.dataset.type);
      refresh();
    }));
    form.method.addEventListener('change', refresh);
    refresh();

    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = formData(form);
      const amount = Number(String(v.amount).replace(/[^0-9]/g, ''));
      if (!amount) {
        toast('金額を入力してください');
        return;
      }
      const item = {
        id: existing?.id || uid(),
        type: v.type,
        name: v.name.trim(),
        amount,
        category: v.category,
        method: v.type === 'expense' ? v.method : '',
        card: v.type === 'expense' && v.method === CARD_METHOD ? v.card : '',
        day: Math.min(31, Math.max(1, Number(v.day) || 1)),
        startMonth: v.startMonth,
        endMonth: v.endMonth || '',
        active: form.active.checked
      };

      let created = 0;
      update(d => {
        const index = d.fixedCosts.findIndex(x => x.id === item.id);
        if (index >= 0) d.fixedCosts[index] = item;
        else d.fixedCosts.push(item);

        // 停止していたものを再開したときは、停止中だった先月までの分をさかのぼって記帳しない
        if (existing && !existing.active && item.active) {
          const done = new Set(d.fixedGenerated);
          for (let ym = item.startMonth; ym < monthOf(today); ym = addMonths(ym, 1)) {
            done.add(`${item.id}|${ym}`);
          }
          d.fixedGenerated = [...done];
        }
        created = generateFixedCosts(d, today);
      });
      close();
      toast(created > 0 ? `保存して、${created}件記帳しました` : '保存しました');
      onDone();
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', () => {
      if (!confirm('この固定費を削除しますか？（記帳済みの取引は残ります）')) return;
      update(d => { d.fixedCosts = d.fixedCosts.filter(x => x.id !== id); });
      close();
      toast('削除しました');
      onDone();
    });
  });
}

// -------------------------
// クレジットカード
// -------------------------

function editCard(id, onDone) {
  const data = getData();
  const existing = data.cards.find(c => c.id === id);
  const card = existing || { name: '', closingDay: 31, paymentDay: 26 };

  const body = `
    <form id="card-form">
      <label class="field"><span>カード名</span><input type="text" name="name" value="${esc(card.name)}" placeholder="例：楽天カード" required></label>
      <div class="field-row">
        <label class="field"><span>締め日（31＝月末）</span><input type="number" name="closingDay" min="1" max="31" value="${card.closingDay}" required></label>
        <label class="field"><span>翌月の引落日</span><input type="number" name="paymentDay" min="1" max="31" value="${card.paymentDay}" required></label>
      </div>
      <p class="note" style="margin:0">締め日までの利用は翌月、締め日より後の利用は翌々月に引き落とされる計算です。引落日を過ぎると、現金・預金から自動で差し引きます。</p>
      <div class="btn-row">
        ${existing ? '<button type="button" class="btn danger" data-delete>削除</button>' : ''}
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`;

  openSheet(existing ? 'カードを編集' : 'カードを追加', body, (sheet, close) => {
    const form = sheet.querySelector('#card-form');

    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = formData(form);
      const item = {
        id: existing?.id || uid(),
        name: v.name.trim(),
        closingDay: Math.min(31, Math.max(1, Number(v.closingDay) || 31)),
        paymentDay: Math.min(31, Math.max(1, Number(v.paymentDay) || 26))
      };
      const today = todayStr();

      update(d => {
        const index = d.cards.findIndex(c => c.id === item.id);
        if (index >= 0) d.cards[index] = item;
        else d.cards.push(item);

        // まだ引き落とされていない利用分は、新しい名前・締め日で計算し直す
        if (existing) {
          for (const tx of d.transactions) {
            if (tx.method === CARD_METHOD && tx.card === existing.name && !isCardPaid(tx, today)) {
              tx.card = item.name;
              applyDueDate(tx, d.cards);
            }
          }
          for (const fc of d.fixedCosts) {
            if (fc.card === existing.name) fc.card = item.name;
          }
        }
      });
      close();
      toast('保存しました');
      onDone();
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', () => {
      if (!confirm('このカードを削除しますか？（記録済みの取引は残ります）')) return;
      update(d => { d.cards = d.cards.filter(c => c.id !== id); });
      close();
      toast('削除しました');
      onDone();
    });
  });
}

// -------------------------
// カテゴリ
// -------------------------

function editCategories(type, onDone) {
  const data = getData();
  const body = `
    <form id="category-form">
      <label class="field"><span>1行に1つずつ書きます（上から順に表示）</span>
        <textarea name="list" rows="12">${esc(data.categories[type].join('\n'))}</textarea>
      </label>
      <p class="note" style="margin:0">「投資・積立」は支出に含めず、資産の移動として扱います。</p>
      <div class="btn-row"><button type="submit" class="btn primary">保存</button></div>
    </form>`;

  openSheet(type === 'expense' ? '支出のカテゴリ' : '収入のカテゴリ', body, (sheet, close) => {
    sheet.querySelector('#category-form').addEventListener('submit', e => {
      e.preventDefault();
      const list = [...new Set(e.target.list.value.split('\n').map(s => s.trim()).filter(Boolean))];
      if (list.length === 0) {
        toast('カテゴリを1つ以上入力してください');
        return;
      }
      update(d => { d.categories[type] = list; });
      close();
      toast('保存しました');
      onDone();
    });
  });
}

// -------------------------
// バックアップ
// -------------------------

async function exportBackup(onDone) {
  const json = exportJSON();
  const fileName = `kakeibo_backup_${todayStr()}.json`;
  const file = new File([json], fileName, { type: 'application/json' });

  try {
    // iPhone では共有シートから「ファイルに保存」や AirDrop を選べる
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '家計簿のバックアップ' });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) {
    // 共有シートを閉じただけのときは何もしない
    if (e.name === 'AbortError') return;
    toast('バックアップに失敗しました');
    console.error(e);
    return;
  }

  update(d => { d.settings.lastBackup = todayStr(); });
  toast('バックアップを保存しました');
  onDone();
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    if (!confirm('今のデータをバックアップの内容で置き換えます。よろしいですか？')) return;
    try {
      importJSON(reader.result);
      toast('復元しました');
      setTimeout(() => {
        location.hash = '#/assets';
        location.reload();
      }, 600);
    } catch (e) {
      toast(e.message || '読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
}
