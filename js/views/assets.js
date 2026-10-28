// -------------------------
// 資産画面
// 現金・預金、投資、ポイント、カードの未払い、資産の推移
// -------------------------

import { getData, update, uid } from '../store.js';
import {
  todayStr, yen, signedYen, formatDate, formatFullDate, formatMonth,
  assetSummary, investmentTotals, pointBalances, unpaidCardBills, snapshotAssets
} from '../calc.js';
import { esc, options, formData, openSheet, toast, drawChart, cssVar, shortYen } from '../ui.js';

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

      <h3 class="section-title"><span>現金・預金</span></h3>
      <div class="list">
        <button type="button" class="list-row" data-cash>
          <div class="main">
            <div class="title">今の残高</div>
            <div class="sub">${formatFullDate(data.cash.baseDate)}の残高 ${yen(data.cash.baseAmount)} から、記録した収支で計算</div>
          </div>
          <div class="amount">${yen(s.cash)}</div>
        </button>
      </div>
      <p class="note">通帳やお財布の金額とずれてきたら、タップして合わせてください。</p>

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
                <div class="sub">${esc(item.kind)} ・ ${esc(item.broker)} ・ ${item.updatedAt ? `${formatDate(item.updatedAt)}更新` : ''}</div>
              </div>
              <div class="amount">${yen(item.value)}<div class="sub ${gain < 0 ? 'expense' : 'income'}">${signedYen(gain)}（${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%）</div></div>
            </button>`;
        }).join('')}
      </div>
      <p class="note">証券アプリを見て、タップで評価額を更新してください。</p>

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

    if ('cash' in ds) editCash(rerender);
    else if ('addInvestment' in ds) editInvestment(null, rerender);
    else if (ds.investment) editInvestment(ds.investment, rerender);
    else if ('addProgram' in ds) editProgram(null, rerender);
    else if (ds.program) editProgram(ds.program, rerender);
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

function editCash(onDone) {
  const data = getData();
  const today = todayStr();
  const current = Math.round(assetSummary(data, today).cash);

  const body = `
    <form id="cash-form">
      <p class="note" style="margin:0 0 12px">銀行口座とお財布の合計を入れてください。この日より後の収入・支出は、記録した内容で自動的に増減します。</p>
      <label class="field"><span>残高（円）</span><input type="text" name="amount" inputmode="numeric" pattern="[0-9]*" value="${current}" required></label>
      <label class="field"><span>この日の終わり時点の残高</span><input type="date" name="date" value="${today}" required></label>
      <p class="note" style="margin:0">今日の記録がすべて入っているなら今日のまま、まだ入れていない記録があるなら昨日の日付にします。</p>
      <div class="btn-row"><button type="submit" class="btn primary">保存</button></div>
    </form>`;

  openSheet('現金・預金の残高', body, (sheet, close) => {
    sheet.querySelector('#cash-form').addEventListener('submit', e => {
      e.preventDefault();
      const v = formData(e.target);
      update(d => { d.cash = { baseAmount: parseYen(v.amount), baseDate: v.date }; });
      close();
      toast('残高を保存しました');
      onDone();
    });
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
