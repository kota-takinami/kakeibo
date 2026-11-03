// -------------------------
// 資産画面
// 現金・預金、投資、ポイント、カードの未払い、資産の推移
// -------------------------

import { getData, update, uid } from '../store.js';
import {
  todayStr, yen, signedYen, formatDate, formatFullDate, formatMonth,
  assetSummary, investmentTotals, pointBalances, unpaidCardBills, snapshotAssets, accountBalances
} from '../calc.js';
import { esc, options, formData, openSheet, toast, drawChart, cssVar, shortYen } from '../ui.js';
import { decodeCsv } from '../cardImport.js';
import { parseHoldingsCsv, planHoldingsImport, BROKER, DEPOSIT_NAME } from '../brokerImport.js';

const INVESTMENT_KINDS = ['投資信託', '日本株', '米国株', 'ETF', '債券', 'その他'];

const parseYen = value => Number(String(value).replace(/[^0-9-]/g, '')) || 0;

export function render(root) {
  const today = todayStr();
  update(d => snapshotAssets(d, today));

  const data = getData();
  const s = assetSummary(data, today);
  const inv = investmentTotals(data);
  const points = pointBalances(data);
  const bills = unpaidCardBills(data, today);
  const balances = accountBalances(data, today);
  const gainRate = inv.principal ? (inv.gain / inv.principal) * 100 : 0;

  root.innerHTML = `
    <section class="page">
      <div class="page-header"><h1>資産</h1></div>

      <div class="hero">
        <div class="label">純資産</div>
        <div class="value num">${yen(s.net)}</div>
        <div class="sub">${s.cardUnpaid > 0 ? `カードの未払い ${yen(s.cardUnpaid)} を差し引いた額` : '現金・預金 ＋ 投資 ＋ ポイント'}</div>
      </div>

      <div class="stat-grid" style="margin-top:8px">
        <div class="stat"><div class="label">現金・預金</div><div class="value">${yen(s.cash)}</div></div>
        <div class="stat"><div class="label">投資</div><div class="value">${yen(s.invest)}</div></div>
        <div class="stat"><div class="label">ポイント</div><div class="value">${yen(s.points)}</div></div>
      </div>

      ${data.settings.needsAccountSetup ? `
        <div class="callout warn" style="margin-top:12px">
          <div class="label">👛 財布と銀行を分けて管理できるようになりました</div>
          <p>今の財布と銀行の残高を入れてください。今までの残高は、いったん銀行に入れてあります。</p>
          <button type="button" class="btn primary block" style="margin-top:10px" data-setup-accounts>残高を入れる</button>
        </div>` : ''}

      <h3 class="section-title"><span>現金・預金</span><span class="num">${yen(s.cash)}</span></h3>
      <div class="list">
        ${balances.map(({ account, balance }) => `
          <button type="button" class="list-row" data-account="${esc(account.id)}">
            <div class="main">
              <div class="title">${account.kind === 'cash' ? '👛' : '🏦'} ${esc(account.name)}</div>
              <div class="sub">${formatFullDate(account.baseDate)}の残高 ${yen(account.baseAmount)} から計算</div>
            </div>
            <div class="amount ${balance < 0 ? 'expense' : ''}">${yen(balance)}</div>
          </button>`).join('')}
      </div>
      <p class="note">財布や通帳の金額とずれてきたら、タップして合わせてください。ATM で引き出したときは「入力」の「移動」で記録します。銀行の追加は設定から。</p>

      ${bills.length ? `
        <h3 class="section-title"><span>カードの引落予定</span></h3>
        <div class="list">
          ${bills.map(b => `
            <div class="list-row">
              <div class="main">
                <div class="title">💳 ${esc(b.card)}</div>
                <div class="sub">${formatDate(b.dueDate)} 引落 ・ ${b.count}件</div>
              </div>
              <div class="amount">${yen(b.total)}</div>
            </div>`).join('')}
        </div>` : ''}

      <h3 class="section-title">
        <span>投資</span>
        <button type="button" class="link-button" data-add-investment>＋ 追加</button>
      </h3>
      ${data.investments.length ? `
        <div class="stat-grid two" style="margin-bottom:8px">
          <div class="stat"><div class="label">評価額</div><div class="value">${yen(inv.value)}</div></div>
          <div class="stat"><div class="label">評価損益</div><div class="value ${inv.gain < 0 ? 'expense' : 'income'}">${signedYen(inv.gain)}<span class="muted" style="font-size:13px;font-weight:500"> ${gainRate >= 0 ? '+' : ''}${gainRate.toFixed(1)}%</span></div></div>
        </div>` : ''}
      <div class="list">
        ${data.investments.length === 0 ? '<div class="empty">株や投資信託を登録できます</div>' : data.investments.map(item => {
          const gain = item.value - item.principal;
          const rate = item.principal ? (gain / item.principal) * 100 : 0;
          return `
            <button type="button" class="list-row" data-investment="${esc(item.id)}">
              <div class="main">
                <div class="title">${esc(item.name)}</div>
                <div class="sub">${[item.kind, item.account, item.broker, item.updatedAt ? `${formatDate(item.updatedAt)}更新` : ''].filter(Boolean).map(esc).join(' ・ ')}</div>
              </div>
              <div class="amount">${yen(item.value)}<div class="sub ${gain < 0 ? 'expense' : 'income'}">${signedYen(gain)}（${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%）</div></div>
            </button>`;
        }).join('')}
      </div>
      <label class="btn block" style="margin-top:10px">
        📄 楽天証券の保有商品（CSV）で更新
        <input type="file" accept=".csv,text/csv" data-holdings-csv hidden>
      </label>
      <p class="note">楽天証券の「保有商品一覧」の CSV を選ぶと、評価額をまとめて更新できます。1つずつ直すときはタップしてください。</p>

      <h3 class="section-title">
        <span>ポイント</span>
        <button type="button" class="link-button" data-add-program>＋ 追加</button>
      </h3>
      <div class="list">
        ${points.length === 0 ? '<div class="empty">ポイントが登録されていません</div>' : points.map(p => `
          <button type="button" class="list-row" data-program="${esc(p.program.id)}">
            <div class="main">
              <div class="title">🪙 ${esc(p.program.name)}</div>
              <div class="sub">1pt＝${p.program.yenPerPoint}円</div>
            </div>
            <div class="amount">${p.balance.toLocaleString('ja-JP')} pt<div class="sub">${yen(p.yen)}相当</div></div>
          </button>`).join('')}
      </div>
      <p class="note">ポイントの獲得・使用は「入力」タブの「ポイント」から記録します。</p>

      <h3 class="section-title"><span>純資産の推移</span></h3>
      <div class="card">
        ${data.assetHistory.length < 2
          ? `<div class="empty">毎月、アプリを開いたときに資産が自動で記録されます。<br>2か月分たまるとグラフになります。</div>`
          : '<div class="chart-box"><canvas id="asset-chart" aria-label="純資産の推移グラフ"></canvas></div>'}
      </div>
    </section>`;

  const section = root.querySelector('section');
  const rerender = () => render(root);

  section.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    const ds = button.dataset;

    if (ds.account) editAccountBalance(ds.account, rerender);
    else if ('setupAccounts' in ds) setupAccounts(rerender);
    else if ('addInvestment' in ds) editInvestment(null, rerender);
    else if (ds.investment) editInvestment(ds.investment, rerender);
    else if ('addProgram' in ds) editProgram(null, rerender);
    else if (ds.program) editProgram(ds.program, rerender);
  });

  section.querySelector('[data-holdings-csv]').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importHoldings(await file.arrayBuffer(), rerender);
  });

  const canvas = section.querySelector('#asset-chart');
  if (canvas) drawAssetChart(canvas, data.assetHistory);
}

function drawAssetChart(canvas, history) {
  const color = cssVar('--series-1');
  drawChart(canvas, {
    type: 'line',
    data: {
      labels: history.map(h => h.month),
      datasets: [{
        label: '純資産',
        data: history.map(h => h.net),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.25
      }]
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => formatMonth(items[0].label),
            label: item => `純資産 ${yen(item.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { callback(value) { return this.getLabelForValue(value).slice(2).replace('-', '/'); } } },
        y: { ticks: { callback: v => shortYen(v) } }
      }
    }
  });
}

// -------------------------
// 現金・預金の残高合わせ
// -------------------------

function editAccountBalance(id, onDone) {
  const data = getData();
  const today = todayStr();
  const account = data.accounts.find(a => a.id === id);
  const current = Math.round(accountBalances(data, today).find(b => b.account.id === id).balance);

  const body = `
    <form id="cash-form">
      <p class="note" style="margin:0 0 12px">${account.kind === 'cash' ? '財布に入っている現金' : '通帳やアプリに表示されている残高'}を入れてください。この日より後の出入りは、記録した内容で自動的に増減します。</p>
      <label class="field"><span>残高（円）</span><input type="text" name="amount" inputmode="numeric" pattern="[0-9]*" value="${current}" required></label>
      <label class="field"><span>この日の終わり時点の残高</span><input type="date" name="date" value="${today}" required></label>
      <p class="note" style="margin:0">ふつうは今日のままで大丈夫です。この後に記録した出入りは、自動で残高に反映されます。</p>
      <div class="btn-row"><button type="submit" class="btn primary">保存</button></div>
    </form>`;

  openSheet(`${account.name}の残高`, body, (sheet, close) => {
    const form = sheet.querySelector('#cash-form');
    form.amount.select();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = formData(form);
      update(d => {
        Object.assign(d.accounts.find(a => a.id === id), { baseAmount: parseYen(v.amount), baseDate: v.date, baseAt: Date.now() });
      });
      close();
      toast('残高を保存しました');
      onDone();
    });
  });
}

// 財布と銀行に分けたあと、最初に全部の残高をまとめて入れてもらう
function setupAccounts(onDone) {
  const data = getData();
  const today = todayStr();
  const balances = accountBalances(data, today);

  const body = `
    <form id="setup-form">
      <p class="note" style="margin:0 0 12px">今の残高を入れてください。この後に記録した出入りは、自動で残高に反映されます。</p>
      ${balances.map(({ account, balance }) => `
        <label class="field"><span>${account.kind === 'cash' ? '👛' : '🏦'} ${esc(account.name)}（円）</span>
          <input type="text" name="${esc(account.id)}" inputmode="numeric" pattern="[0-9]*" value="${Math.max(0, Math.round(balance))}" required>
        </label>`).join('')}
      <p class="note" style="margin:0">銀行がほかにもあるときは、先に「設定 → 財布・銀行」で追加してください。</p>
      <div class="btn-row"><button type="submit" class="btn primary">保存</button></div>
    </form>`;

  openSheet('財布と銀行の残高', body, (sheet, close) => {
    const form = sheet.querySelector('#setup-form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = formData(form);
      update(d => {
        for (const account of d.accounts) {
          if (account.id in v) Object.assign(account, { baseAmount: parseYen(v[account.id]), baseDate: today, baseAt: Date.now() });
        }
        d.settings.needsAccountSetup = false;
      });
      close();
      toast('残高を保存しました');
      onDone();
    });
  });
}

// -------------------------
// 楽天証券の保有商品（CSV）の取り込み
// 一覧で確認してから、評価額の更新・追加・削除をまとめて行う
// -------------------------

const ACTION_LABELS = { update: '更新', add: '新規', remove: 'CSVにない' };

export function importHoldings(buffer, onDone) {
  let parsed;
  try {
    parsed = parseHoldingsCsv(decodeCsv(buffer));
  } catch (e) {
    console.error(e);
  }
  if (!parsed || parsed.holdings.length === 0) {
    toast('保有商品が見つかりませんでした。楽天証券の「保有商品一覧」の CSV か確認してください');
    return;
  }

  const rows = planHoldingsImport(parsed.holdings, getData().investments);
  const holdingTotal = parsed.holdings.filter(h => h.name !== DEPOSIT_NAME).reduce((sum, h) => sum + h.value, 0);

  const rowHtml = (row, i) => {
    const sub = [row.kind, row.account].filter(Boolean).join(' ・ ');
    let detail = `元本 ${yen(row.principal)}`;
    if (row.action === 'update') detail = `評価額 ${yen(row.existing.value)} → ${yen(row.value)} ・ ${detail}`;
    if (row.action === 'remove') detail = '売却済みなら、チェックを入れると削除します';
    return `
      <label class="list-row import-row${row.checked ? '' : ' unchecked'}">
        <input type="checkbox" data-check="${i}"${row.checked ? ' checked' : ''} aria-label="${esc(row.name)}を反映する">
        <div class="main">
          <div class="title">${esc(row.name)} <span class="badge">${ACTION_LABELS[row.action]}</span></div>
          <div class="sub">${esc(sub)}</div>
          <div class="sub wrap">${detail}</div>
        </div>
        <div class="amount ${row.action === 'remove' ? 'muted' : ''}">${yen(row.value)}</div>
      </label>`;
  };

  const body = `
    <form id="holdings-form">
      <p class="note" style="margin:0 0 4px">${BROKER} ・ 保有商品 ${parsed.holdings.filter(h => h.name !== DEPOSIT_NAME).length}件 ・ 評価額の合計 ${yen(holdingTotal)}${parsed.csvTotal !== null ? `（CSV の合計 ${yen(parsed.csvTotal)}）` : ''}</p>
      <p class="note" style="margin:0 0 10px">登録済みの商品は評価額と元本を上書きし、新しい商品は追加します。「CSVにない」商品は、売却済みならチェックを入れると削除します。</p>
      <div class="list import-list" id="holding-rows">${rows.map(rowHtml).join('')}</div>
      <div class="btn-row sheet-actions">
        <button type="submit" class="btn primary" id="holdings-submit"></button>
      </div>
    </form>`;

  openSheet('保有商品の取り込み', body, (sheet, close) => {
    const form = sheet.querySelector('#holdings-form');
    const submit = sheet.querySelector('#holdings-submit');

    const refresh = () => {
      const count = rows.filter(r => r.checked).length;
      submit.textContent = `${count}件を反映する`;
      submit.disabled = count === 0;
    };

    sheet.querySelector('#holding-rows').addEventListener('change', e => {
      const i = e.target.dataset.check;
      if (i === undefined) return;
      rows[i].checked = e.target.checked;
      e.target.closest('.import-row').classList.toggle('unchecked', !e.target.checked);
      refresh();
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const today = todayStr();
      const selected = rows.filter(r => r.checked);

      update(d => {
        for (const row of selected) {
          if (row.action === 'remove') {
            d.investments = d.investments.filter(inv => inv.id !== row.existing.id);
            continue;
          }
          const item = {
            id: row.existing?.id || uid(),
            broker: BROKER,
            name: row.name,
            kind: row.kind,
            code: row.code,
            account: row.account,
            quantity: row.quantity,
            principal: Math.round(row.principal),
            value: Math.round(row.value),
            updatedAt: today
          };
          const index = d.investments.findIndex(inv => inv.id === item.id);
          if (index >= 0) d.investments[index] = item;
          else d.investments.push(item);
        }
        snapshotAssets(d, today);
      });
      close();
      toast(`${selected.length}件を反映しました`);
      onDone();
    });

    refresh();
  });
}

// -------------------------
// 投資
// -------------------------

function editInvestment(id, onDone) {
  const data = getData();
  const existing = data.investments.find(i => i.id === id);
  const item = existing || { broker: data.investments.at(-1)?.broker || '楽天証券', name: '', kind: '投資信託', principal: '', value: '' };

  const body = `
    <form id="investment-form">
      <label class="field"><span>商品名</span><input type="text" name="name" value="${esc(item.name)}" placeholder="例：eMAXIS Slim 米国株式（S&P500）" required></label>
      <div class="field-row">
        <label class="field"><span>種類</span><select name="kind">${options(INVESTMENT_KINDS, item.kind)}</select></label>
        <label class="field"><span>証券会社</span><input type="text" name="broker" value="${esc(item.broker)}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>投資元本（円）</span><input type="text" name="principal" inputmode="numeric" pattern="[0-9]*" value="${esc(item.principal)}" required></label>
        <label class="field"><span>現在の評価額（円）</span><input type="text" name="value" inputmode="numeric" pattern="[0-9]*" value="${esc(item.value)}" required></label>
      </div>
      <div class="btn-row">
        ${existing ? '<button type="button" class="btn danger" data-delete>削除</button>' : ''}
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`;

  openSheet(existing ? '投資を更新' : '投資を追加', body, (sheet, close) => {
    const form = sheet.querySelector('#investment-form');
    // 評価額だけ直すことが多いので、すぐ入力できるようにする
    if (existing) form.value.select();

    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = formData(form);
      const next = {
        ...existing,
        id: existing?.id || uid(),
        broker: v.broker.trim(),
        name: v.name.trim(),
        kind: v.kind,
        principal: parseYen(v.principal),
        value: parseYen(v.value),
        updatedAt: todayStr()
      };
      update(d => {
        const index = d.investments.findIndex(i => i.id === next.id);
        if (index >= 0) d.investments[index] = next;
        else d.investments.push(next);
      });
      close();
      toast('保存しました');
      onDone();
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', () => {
      if (!confirm('この投資を削除しますか？')) return;
      update(d => { d.investments = d.investments.filter(i => i.id !== id); });
      close();
      toast('削除しました');
      onDone();
    });
  });
}

// -------------------------
// ポイントの種類
// -------------------------

function editProgram(id, onDone) {
  const data = getData();
  const existing = data.pointPrograms.find(p => p.id === id);
  const program = existing || { name: '', yenPerPoint: 1, initial: 0 };
  const recordCount = existing ? data.pointRecords.filter(r => r.programId === id).length : 0;

  const body = `
    <form id="program-form">
      <label class="field"><span>名前</span><input type="text" name="name" value="${esc(program.name)}" placeholder="例：Vポイント、dポイント、Ponta" required></label>
      <div class="field-row">
        <label class="field"><span>1ポイントあたりの円</span><input type="number" name="yenPerPoint" step="0.01" min="0" value="${program.yenPerPoint}" required></label>
        <label class="field"><span>使い始める前の残高（pt）</span><input type="text" name="initial" inputmode="numeric" pattern="[0-9]*" value="${program.initial}"></label>
      </div>
      ${existing ? `<p class="note" style="margin:0">記録 ${recordCount}件</p>` : ''}
      <div class="btn-row">
        ${existing ? '<button type="button" class="btn danger" data-delete>削除</button>' : ''}
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`;

  openSheet(existing ? 'ポイントを編集' : 'ポイントを追加', body, (sheet, close) => {
    const form = sheet.querySelector('#program-form');

    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = formData(form);
      const next = {
        id: existing?.id || uid(),
        name: v.name.trim(),
        yenPerPoint: Number(v.yenPerPoint) || 0,
        initial: parseYen(v.initial)
      };
      update(d => {
        const index = d.pointPrograms.findIndex(p => p.id === next.id);
        if (index >= 0) d.pointPrograms[index] = next;
        else d.pointPrograms.push(next);
      });
      close();
      toast('保存しました');
      onDone();
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', () => {
      const message = recordCount
        ? `このポイントと記録${recordCount}件を削除しますか？`
        : 'このポイントを削除しますか？';
      if (!confirm(message)) return;
      update(d => {
        d.pointPrograms = d.pointPrograms.filter(p => p.id !== id);
        d.pointRecords = d.pointRecords.filter(r => r.programId !== id);
      });
      close();
      toast('削除しました');
      onDone();
    });
  });
}
