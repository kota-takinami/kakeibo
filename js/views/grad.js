// -------------------------
// 大学院計画の画面
// 「いつまでに・いくら必要か」と「毎月いくら貯めれば間に合うか」を出す
// -------------------------

import { getData, update, uid } from '../store.js';
import {
  todayStr, yen, signedYen, formatMonth, formatFullDate, formatDate, daysUntil, monthsUntil,
  assetSummary, averageMonthlyNet, gradTimeline
} from '../calc.js';
import { esc, drawChart, cssVar, shortYen } from '../ui.js';

const parseYen = value => Number(String(value).replace(/[^0-9]/g, '')) || 0;

const sumOf = list => list.reduce((total, x) => total + (Number(x.amount) || 0), 0);

// 今使えるお金と、毎月のペースを計算する
function inputs(data, today) {
  const plan = data.gradPlan;
  const s = assetSummary(data, today);
  const startAssets = s.cash - s.cardUnpaid
    + (plan.includeInvestments ? s.invest : 0)
    + (plan.includePoints ? s.points : 0);

  const actual = averageMonthlyNet(data, today, plan.includeInvestments);
  const pace = plan.paceMode === 'manual' ? Number(plan.manualPace) || 0 : actual.value ?? 0;
  return { startAssets, pace, actual };
}

export function render(root) {
  root.innerHTML = `
    <section class="page">
      <div class="page-header"><h1>大学院の資金計画</h1></div>
      <div id="grad-result"></div>
      <h3 class="section-title"><span>計画の設定</span></h3>
      <div id="grad-form"></div>
    </section>`;

  renderForm(root.querySelector('#grad-form'), () => renderResult(root.querySelector('#grad-result')));
  renderResult(root.querySelector('#grad-result'));
}

// -------------------------
// 結果
// -------------------------

function renderResult(el) {
  const data = getData();
  const today = todayStr();
  const plan = data.gradPlan;
  const { startAssets, pace, actual } = inputs(data, today);
  const t = gradTimeline(plan, startAssets, pace, today);

  const monthsToEnroll = Math.max(0, monthsUntil(today, t.enrollDate));
  const onTrack = t.requiredPace <= pace && t.shortNow.length === 0;
  const nextPayment = t.rows.find(r => r.kind === 'payment');
  const showNeeded = t.requiredPace > pace;

  // 期日のある支払いと予備費だけを一覧にする（毎月の生活費はまとめて1行）
  const keyRows = t.rows.filter(r => r.kind !== 'living');
  const livingRows = t.rows.filter(r => r.kind === 'living');

  const paceBasis = plan.paceMode === 'manual'
    ? '手入力した金額'
    : actual.value === null
      ? 'まだ先月以前の記録がないため 0円 として計算'
      : `直近${actual.months.length}か月の実績の平均（${actual.months.map(m => `${Number(m.ym.slice(5))}月 ${signedYen(m.net)}`).join('、')}）`;

  el.innerHTML = `
    ${onTrack ? `
      <div class="callout">
        <div class="label">✅ 今のペースで間に合います</div>
        <div class="big num">毎月 ${signedYen(pace)} のペース</div>
        <p>入学（${formatMonth(plan.enrollMonth)}）までに、すべての支払いをまかなえる計算です。</p>
      </div>` : `
      <div class="callout warn">
        <div class="label">⚠️ 間に合わせるには、入学まで毎月</div>
        <div class="big num">${yen(t.requiredPace)} 貯める</div>
        <p>今のペースは毎月 ${signedYen(pace)}。あと毎月 <strong>${yen(t.requiredPace - pace)}</strong> 増やす必要があります。</p>
      </div>`}

    ${t.shortNow.map(e => `
      <div class="callout warn" style="margin-top:8px">
        <div class="label">⚠️ ${esc(e.name)}（${formatDate(e.date)}まで）</div>
        <p>期日まで1か月を切っていて、<strong>${yen(e.shortage)}</strong> 足りません。</p>
      </div>`).join('')}

    <div class="stat-grid" style="margin-top:8px">
      <div class="stat"><div class="label">今使えるお金</div><div class="value">${yen(startAssets)}</div></div>
      <div class="stat"><div class="label">必要な自己資金</div><div class="value">${yen(t.peak)}</div></div>
      <div class="stat"><div class="label">入学まで</div><div class="value">${monthsToEnroll.toFixed(1)}か月</div></div>
    </div>

    ${nextPayment ? `
      <div class="card" style="margin-top:8px">
        <div class="muted" style="font-size:13px">次の支払い</div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <strong>${esc(nextPayment.name)}</strong>
          <strong class="num">${yen(nextPayment.amount)}</strong>
        </div>
        <div class="muted" style="font-size:13px">${formatFullDate(nextPayment.date)}まで（あと${daysUntil(today, nextPayment.date)}日）</div>
      </div>` : ''}

    <h3 class="section-title"><span>必要な累計額と、予想の貯金</span></h3>
    <div class="card">
      <div class="legend">
        <span><i style="background:var(--series-2)"></i>必要な累計額</span>
        <span><i style="background:var(--series-1)"></i>今のペースの予想</span>
        ${showNeeded ? '<span><i class="dashed" style="border-color:var(--series-1)"></i>必要なペースの場合</span>' : ''}
      </div>
      <div class="chart-box" style="height:240px"><canvas id="grad-chart" aria-label="必要な累計額と予想の貯金のグラフ"></canvas></div>
      <p class="note" style="margin:8px 0 0">予想の貯金が必要額の線より上にあれば間に合います。入学後は今の収入がなくなる前提で、貯金は増えない計算です。</p>
    </div>

    <h3 class="section-title"><span>いつまでに、いくら必要か</span></h3>
    <div class="list">
      ${keyRows.length === 0 && livingRows.length === 0 ? '<div class="empty">今後の支払いはありません</div>' : ''}
      ${keyRows.map(r => `
        <div class="list-row">
          <div class="main">
            <div class="title">${esc(r.name)} <span class="muted num" style="font-size:14px">${yen(r.amount)}</span></div>
            <div class="sub wrap">${formatFullDate(r.date)}までに<br>累計 ${yen(r.cumulative)}</div>
          </div>
          <div class="amount" style="font-weight:400">
            <span class="status ${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓ 間に合う' : '⚠ 不足'}</span>
            <div class="sub">予想 ${yen(r.projected)}</div>
          </div>
        </div>`).join('')}
      ${livingRows.length ? `
        <div class="list-row">
          <div class="main">
            <div class="title">在学中の生活費の${t.monthlyGap >= 0 ? '不足' : '余り'}</div>
            <div class="sub">毎月 ${yen(Math.abs(t.monthlyGap))} × ${livingRows.length}か月（生活費 − 在学中の収入 − 借入）</div>
          </div>
          <div class="amount">${t.monthlyGap >= 0 ? '' : '+'}${yen(Math.abs(t.monthlyGap * livingRows.length))}</div>
        </div>` : ''}
    </div>
    ${t.loanTotal > 0 ? `<p class="note">卒業時の借入（貸与奨学金）の合計：${yen(t.loanTotal)}</p>` : ''}
    <p class="note">毎月のペースの根拠：${esc(paceBasis)}</p>`;

  drawGradChart(el.querySelector('#grad-chart'), t.chart, showNeeded);
}

function drawGradChart(canvas, chart, showNeeded) {
  const required = cssVar('--series-2');
  const projected = cssVar('--series-1');

  const datasets = [
    {
      label: '必要な累計額',
      data: chart.required,
      borderColor: required,
      backgroundColor: required,
      borderWidth: 2,
      stepped: true,
      pointRadius: 0,
      pointHoverRadius: 5
    },
    {
      label: '今のペースの予想',
      data: chart.projected,
      borderColor: projected,
      backgroundColor: projected,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5
    }
  ];
  if (showNeeded) {
    datasets.push({
      label: '必要なペースの場合',
      data: chart.needed,
      borderColor: projected,
      backgroundColor: projected,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 5
    });
  }

  drawChart(canvas, {
    type: 'line',
    data: { labels: chart.labels, datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => `${formatMonth(items[0].label)}末`,
            label: item => `${item.dataset.label} ${yen(item.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            callback(value) { return this.getLabelForValue(value).slice(2).replace('-', '/'); }
          }
        },
        y: { beginAtZero: true, ticks: { callback: v => shortYen(v) } }
      }
    }
  });
}

// -------------------------
// 設定フォーム
// 入力するたびに保存して、結果だけを描き直す
// -------------------------

function renderForm(el, onChange) {
  const plan = getData().gradPlan;

  const listRows = (list, key, withDate) => list.map(item => `
    <div class="edit-row" data-list="${key}" data-id="${esc(item.id)}">
      <input type="text" data-field="name" value="${esc(item.name)}" aria-label="項目名">
      <input type="text" data-field="amount" inputmode="numeric" pattern="[0-9]*" value="${item.amount}" aria-label="金額">
      <button type="button" class="icon-button" data-remove aria-label="削除">✕</button>
      ${withDate ? `<input type="date" class="date-line" data-field="due" value="${esc(item.due)}" aria-label="支払期日">` : ''}
    </div>`).join('');

  el.innerHTML = `
    <div class="card">
      <div class="field-row">
        <label class="field"><span>入学年月</span><input type="month" data-plan="enrollMonth" value="${esc(plan.enrollMonth)}"></label>
        <label class="field"><span>在学年数</span><input type="number" data-plan="years" min="1" max="6" step="0.5" value="${plan.years}"></label>
      </div>

      <div class="subhead"><span>支払い（期日があるもの）</span><span class="muted num" data-total="payments">${yen(sumOf(plan.payments))}</span></div>
      ${listRows(plan.payments, 'payments', true)}
      <button type="button" class="link-button" data-add="payments">＋ 支払いを追加</button>
      <p class="note" style="margin:2px 0 0">検定料・入学金・授業料・引越し代など。金額と期日（その日までに払う）を入れます。</p>

      <div class="subhead"><span>在学中の毎月の生活費</span><span class="muted num" data-total="living">${yen(sumOf(plan.living))}／月</span></div>
      ${listRows(plan.living, 'living', false)}
      <button type="button" class="link-button" data-add="living">＋ 項目を追加</button>

      <div class="subhead"><span>在学中の毎月の収入（返済不要）</span><span class="muted num" data-total="income">${yen(sumOf(plan.income))}／月</span></div>
      ${listRows(plan.income, 'income', false)}
      <button type="button" class="link-button" data-add="income">＋ 項目を追加</button>

      <div class="field-row" style="margin-top:14px">
        <label class="field"><span>貸与奨学金（月額）</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-plan="loanMonthly" value="${plan.loanMonthly}"></label>
        <label class="field"><span>予備費（入学時に確保）</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-plan="buffer" value="${plan.buffer}"></label>
      </div>

      <div class="subhead"><span>今使えるお金に含めるもの</span></div>
      <p class="note" style="margin:-4px 0 8px">現金・預金（カードの未払いを除く）は必ず含めます。</p>
      <label class="check-field"><input type="checkbox" data-plan="includeInvestments"${plan.includeInvestments ? ' checked' : ''}> 投資（売れば使えるお金として数える）</label>
      <label class="check-field"><input type="checkbox" data-plan="includePoints"${plan.includePoints ? ' checked' : ''}> ポイント</label>

      <div class="subhead"><span>入学までの毎月の貯金ペース</span></div>
      <div class="seg" style="margin-bottom:10px">
        <button type="button" data-pace="actual" class="${plan.paceMode === 'actual' ? 'active' : ''}">家計簿の実績</button>
        <button type="button" data-pace="manual" class="${plan.paceMode === 'manual' ? 'active' : ''}">金額を決める</button>
      </div>
      <label class="field" ${plan.paceMode === 'manual' ? '' : 'hidden'}>
        <span>毎月貯める額（円）</span>
        <input type="text" inputmode="numeric" pattern="[0-9]*" data-plan="manualPace" value="${plan.manualPace}">
      </label>
    </div>`;

  const rerenderAll = () => {
    renderForm(el, onChange);
    onChange();
  };

  // 描き直すと card ごと作り直されるので、イベントも card に付ける
  const card = el.firstElementChild;

  card.addEventListener('input', e => {
    const input = e.target;

    if (input.dataset.plan) {
      const key = input.dataset.plan;
      update(d => {
        if (input.type === 'checkbox') d.gradPlan[key] = input.checked;
        else if (key === 'enrollMonth') { if (input.value) d.gradPlan.enrollMonth = input.value; }
        else if (key === 'years') d.gradPlan.years = Math.max(0.5, Number(input.value) || 1);
        else d.gradPlan[key] = parseYen(input.value);
      });
      onChange();
      return;
    }

    const row = input.closest('[data-list]');
    if (row && input.dataset.field) {
      const field = input.dataset.field;
      update(d => {
        const item = d.gradPlan[row.dataset.list].find(x => x.id === row.dataset.id);
        if (!item) return;
        item[field] = field === 'amount' ? parseYen(input.value) : input.value;
      });

      // 見出しの合計だけ書き換える（フォームを描き直すと入力中の欄が外れるため）
      const key = row.dataset.list;
      const total = card.querySelector(`[data-total="${key}"]`);
      total.textContent = yen(sumOf(getData().gradPlan[key])) + (key === 'payments' ? '' : '／月');
      onChange();
    }
  });

  card.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;

    if (button.dataset.add) {
      const key = button.dataset.add;
      update(d => {
        const item = { id: uid(), name: '', amount: 0 };
        if (key === 'payments') item.due = `${d.gradPlan.enrollMonth}-01`;
        d.gradPlan[key].push(item);
      });
      rerenderAll();
      const rows = el.querySelectorAll(`[data-list="${key}"]`);
      rows[rows.length - 1]?.querySelector('input')?.focus();
    } else if ('remove' in button.dataset) {
      const row = button.closest('[data-list]');
      update(d => {
        d.gradPlan[row.dataset.list] = d.gradPlan[row.dataset.list].filter(x => x.id !== row.dataset.id);
      });
      rerenderAll();
    } else if (button.dataset.pace) {
      update(d => { d.gradPlan.paceMode = button.dataset.pace; });
      rerenderAll();
    }
  });
}
