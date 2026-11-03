// -------------------------
// 集計と計算
// 画面には依存しない関数だけを置く（どれもデータを受け取って結果を返す）
// -------------------------

export const CARD_METHOD = 'クレジットカード';
export const INVEST_CATEGORY = '投資・積立';
// このカテゴリを選んだときだけ、内容（detail）を入力できる
export const OTHER_CATEGORY = 'その他';

// 「その他（美容院）」のように、内容があれば付けて表示する
export function categoryLabel(tx) {
  return tx.category === OTHER_CATEGORY && tx.detail ? `${tx.category}（${tx.detail}）` : tx.category;
}

// 「その他」の内容として最近使ったもの（新しい順、重複なし）
export function recentDetails(data, type, limit = 12) {
  const list = data.transactions
    .filter(tx => tx.type === type && tx.detail)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(tx => tx.detail);
  return [...new Set(list)].slice(0, limit);
}

// -------------------------
// 日付
// 日付は "2026-10-28" のような文字列で扱う（タイムゾーンのずれを防ぐため）
// -------------------------

const pad = n => String(n).padStart(2, '0');

export function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayStr() {
  return ymd(new Date());
}

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

// "2026-10" に n か月足す
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// 31日指定でも、その月の最終日に合わせる
export function dayInMonth(ym, day) {
  return `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;
}

export function daysUntil(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

// 月数（小数あり）
export function monthsUntil(from, to) {
  return daysUntil(from, to) / 30.4375;
}

// -------------------------
// 表示用の書式
// -------------------------

export function yen(n) {
  const sign = n < 0 ? '−' : '';
  return `${sign}¥${Math.round(Math.abs(n)).toLocaleString('ja-JP')}`;
}

export function signedYen(n) {
  return (n > 0 ? '+' : '') + yen(n);
}

export function formatMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDate(dateStr) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

export function formatFullDate(dateStr) {
  const d = parseDate(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const sum = list => list.reduce((total, x) => total + (Number(x) || 0), 0);

// -------------------------
// クレジットカード
// -------------------------

// 利用日から引落予定日を計算する
// 締め日までの利用は翌月、締め日より後の利用は翌々月の引落
export function cardDueDate(card, dateStr) {
  const ym = monthOf(dateStr);
  const day = Number(dateStr.slice(8, 10));
  const closing = Math.min(card.closingDay, daysInMonth(ym));
  const billMonth = addMonths(ym, day <= closing ? 1 : 2);
  return dayInMonth(billMonth, card.paymentDay);
}

// 取引の支払方法に合わせて引落予定日を付け直す
export function applyDueDate(tx, cards) {
  if (tx.type === 'expense' && tx.method === CARD_METHOD) {
    const card = cards.find(c => c.name === tx.card) || cards[0];
    if (card) {
      tx.card = card.name;
      tx.dueDate = cardDueDate(card, tx.date);
      return tx;
    }
  }
  delete tx.dueDate;
  return tx;
}

// 引落予定日を過ぎたカード払いは、口座から引き落とされたものとみなす
export function isCardPaid(tx, today) {
  return !tx.dueDate || tx.dueDate <= today;
}

// まだ引き落とされていないカード利用を、カードと引落日ごとにまとめる
export function unpaidCardBills(data, today) {
  const groups = new Map();
  for (const tx of data.transactions) {
    if (tx.type !== 'expense' || tx.method !== CARD_METHOD) continue;
    if (isCardPaid(tx, today)) continue;
    const key = `${tx.card}|${tx.dueDate}`;
    if (!groups.has(key)) {
      groups.set(key, { card: tx.card, dueDate: tx.dueDate, total: 0, count: 0 });
    }
    const group = groups.get(key);
    group.total += tx.amount;
    group.count += 1;
  }
  return [...groups.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// -------------------------
// 資産
// -------------------------

// -------------------------
// 口座（財布・銀行）
// お金がある場所ごとに、基準日の残高 + 基準日より後の出入り で残高を出す
// -------------------------

export const WALLET_ID = 'wallet';
export const CASH_METHOD = '現金';

export const bankAccounts = data => data.accounts.filter(a => a.kind === 'bank');

// 銀行を選ばなかったときに使う銀行（最初に登録した銀行）
export function defaultBankId(data) {
  return bankAccounts(data)[0]?.id || WALLET_ID;
}

// 支出・収入のお金が出入りする口座
// 現金払いは財布、それ以外（口座振替・QR決済など）は銀行。取引に口座が保存されていればそれを使う
export function accountOf(tx, data) {
  if (tx.type === 'expense' && tx.method === CARD_METHOD) {
    const card = data.cards.find(c => c.name === tx.card);
    return card?.accountId || defaultBankId(data);
  }
  if (tx.account && data.accounts.some(a => a.id === tx.account)) return tx.account;
  if (tx.type === 'expense' && tx.method === CASH_METHOD) return WALLET_ID;
  return defaultBankId(data);
}

// 残高を入れた日（baseDate）の取引は、残高を入れた時刻（baseAt）より後に記録したものだけ数える
// （残高を入れたあとに ATM で引き出した、などを反映するため）
export function accountBalances(data, today) {
  const balances = new Map(data.accounts.map(a => [a.id, Number(a.baseAmount) || 0]));
  const accounts = new Map(data.accounts.map(a => [a.id, a]));
  const add = (id, date, amount, tx) => {
    const account = accounts.get(id);
    if (!account || date > today) return;
    const after = date > account.baseDate ||
      (date === account.baseDate && (tx.createdAt || 0) > (account.baseAt || 0));
    if (after) balances.set(id, balances.get(id) + amount);
  };

  for (const tx of data.transactions) {
    if (tx.type === 'transfer') {
      add(tx.fromAccount, tx.date, -tx.amount, tx);
      add(tx.toAccount, tx.date, tx.amount, tx);
    } else if (tx.type === 'income') {
      add(accountOf(tx, data), tx.date, tx.amount, tx);
    } else if (tx.method === CARD_METHOD && tx.dueDate) {
      // カード払いは引落日に、カードの引落口座から減らす
      add(accountOf(tx, data), tx.dueDate, -tx.amount, tx);
    } else {
      add(accountOf(tx, data), tx.date, -tx.amount, tx);
    }
  }

  return data.accounts.map(account => ({ account, balance: balances.get(account.id) }));
}

// 現金・預金の合計（財布と銀行をすべて足したもの）
export function cashBalance(data, today) {
  return sum(accountBalances(data, today).map(a => a.balance));
}

export function investmentTotals(data) {
  const principal = sum(data.investments.map(i => i.principal));
  const value = sum(data.investments.map(i => i.value));
  return { principal, value, gain: value - principal };
}

export function pointBalances(data) {
  return data.pointPrograms.map(program => {
    const records = data.pointRecords.filter(r => r.programId === program.id);
    const balance = (Number(program.initial) || 0) + sum(records.map(r => r.delta));
    return { program, balance, yen: balance * (Number(program.yenPerPoint) || 0) };
  });
}

export function assetSummary(data, today) {
  const cash = cashBalance(data, today);
  const invest = investmentTotals(data).value;
  const points = sum(pointBalances(data).map(p => p.yen));
  const cardUnpaid = sum(unpaidCardBills(data, today).map(b => b.total));
  return {
    cash,
    invest,
    points,
    cardUnpaid,
    // 純資産：未払いのカード代を差し引いた額
    net: cash + invest + points - cardUnpaid
  };
}

// 今月の資産をスナップショットとして記録する（同じ月なら上書き）
export function snapshotAssets(data, today) {
  const s = assetSummary(data, today);
  const month = monthOf(today);
  const entry = {
    month,
    date: today,
    cash: Math.round(s.cash),
    invest: Math.round(s.invest),
    points: Math.round(s.points),
    net: Math.round(s.net)
  };
  const index = data.assetHistory.findIndex(h => h.month === month);
  if (index >= 0) data.assetHistory[index] = entry;
  else data.assetHistory.push(entry);
  data.assetHistory.sort((a, b) => a.month.localeCompare(b.month));
}

// -------------------------
// 月ごとの集計
// -------------------------

export function monthSummary(data, ym) {
  const list = data.transactions.filter(tx => monthOf(tx.date) === ym);
  let income = 0;
  let expense = 0;
  let invest = 0;
  const byCategory = new Map();

  for (const tx of list) {
    // 口座間の移動（ATM で引き出すなど）は、収入にも支出にも数えない
    if (tx.type === 'transfer') continue;
    if (tx.type === 'income') {
      income += tx.amount;
    } else if (tx.category === INVEST_CATEGORY) {
      invest += tx.amount;
    } else {
      expense += tx.amount;
      const label = categoryLabel(tx);
      byCategory.set(label, (byCategory.get(label) || 0) + tx.amount);
    }
  }

  const categories = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { income, expense, invest, net: income - expense - invest, categories, count: list.length };
}

// 直近3か月（今月を除く、記録がある月だけ）の平均の月収支
// includeInvest が true なら、投資・積立は資産として残るので差し引かない
export function averageMonthlyNet(data, today, includeInvest) {
  const current = monthOf(today);
  const months = [];

  for (let i = 1; i <= 3; i++) {
    const ym = addMonths(current, -i);
    const s = monthSummary(data, ym);
    if (s.count > 0) months.push({ ym, net: includeInvest ? s.net + s.invest : s.net });
  }

  if (months.length === 0) return { value: null, months };
  return { value: sum(months.map(m => m.net)) / months.length, months };
}

// -------------------------
// 固定費の自動記帳
// -------------------------

// 支払日を過ぎた月のうち、まだ記帳していない分の取引を作る
// 一度作った月は fixedGenerated に記録するので、取引を消しても作り直さない
export function generateFixedCosts(data, today) {
  const currentMonth = monthOf(today);
  const done = new Set(data.fixedGenerated);
  let count = 0;

  for (const fc of data.fixedCosts) {
    if (!fc.active || !fc.startMonth) continue;

    for (let ym = fc.startMonth; ym <= currentMonth; ym = addMonths(ym, 1)) {
      if (fc.endMonth && ym > fc.endMonth) break;

      const key = `${fc.id}|${ym}`;
      const date = dayInMonth(ym, fc.day);
      if (done.has(key) || date > today) continue;

      const tx = {
        id: `${fc.id}-${ym}`,
        date,
        type: fc.type || 'expense',
        amount: fc.amount,
        category: fc.category,
        method: fc.method,
        card: fc.card || '',
        account: fc.account || '',
        memo: fc.name,
        fixedId: fc.id,
        createdAt: Date.now()
      };
      data.transactions.push(applyDueDate(tx, data.cards));
      done.add(key);
      count += 1;
    }
  }

  data.fixedGenerated = [...done];
  return count;
}

export function fixedMonthlyTotal(data) {
  const active = data.fixedCosts.filter(fc => fc.active);
  const expense = sum(active.filter(fc => (fc.type || 'expense') === 'expense').map(fc => fc.amount));
  const income = sum(active.filter(fc => fc.type === 'income').map(fc => fc.amount));
  return { expense, income };
}

// -------------------------
// 大学院の資金計画
// -------------------------

// 支払期日ごとに「その日までに必要な累計額」を出し、
// 今のペースで貯めた場合の予想額と比べる
//
// startAssets: 今使えるお金
// pace: 入学までに毎月増える額
export function gradTimeline(plan, startAssets, pace, today) {
  const enrollDate = `${plan.enrollMonth}-01`;
  const months = Math.max(1, Math.round(plan.years * 12));
  const endMonth = addMonths(plan.enrollMonth, months - 1);

  const living = sum(plan.living.map(x => x.amount));
  const income = sum(plan.income.map(x => x.amount));
  const loan = Number(plan.loanMonthly) || 0;
  // 在学中に毎月足りなくなる額（マイナスなら余る）
  const monthlyGap = living - income - loan;

  const events = [];
  for (const p of plan.payments) {
    if (p.due) events.push({ date: p.due, name: p.name, amount: Number(p.amount) || 0, kind: 'payment' });
  }
  if (plan.buffer > 0) {
    events.push({ date: enrollDate, name: '予備費', amount: Number(plan.buffer), kind: 'buffer' });
  }
  for (let i = 0; i < months; i++) {
    const ym = addMonths(plan.enrollMonth, i);
    events.push({ date: `${ym}-01`, name: `${formatMonth(ym)}の生活費`, amount: monthlyGap, kind: 'living' });
  }

  // 期日を過ぎた支払いは、もう払ったものとして除く
  const future = events
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 入学後は今の収入がなくなるので、貯金が増えるのは入学までとする
  const projectedAt = (date, monthlyPace) => {
    const until = date < enrollDate ? date : enrollDate;
    return startAssets + monthlyPace * Math.max(0, monthsUntil(today, until));
  };

  let cumulative = 0;
  let peak = 0;
  let requiredPace = 0;
  const shortNow = [];

  const rows = future.map(e => {
    cumulative += e.amount;
    peak = Math.max(peak, cumulative);
    const projected = projectedAt(e.date, pace);
    const shortage = cumulative - startAssets;
    const until = e.date < enrollDate ? e.date : enrollDate;
    const monthsLeft = monthsUntil(today, until);

    if (shortage > 0) {
      // 1か月を切った期日は、貯金で間に合わせるのが難しいので別に扱う
      if (monthsLeft < 1) shortNow.push({ ...e, shortage });
      else requiredPace = Math.max(requiredPace, shortage / monthsLeft);
    }

    return { ...e, cumulative, projected, ok: projected >= cumulative };
  });

  // グラフ用：今月から卒業月まで、月末時点の値
  const labels = [];
  const required = [];
  const projected = [];
  const needed = [];
  for (let ym = monthOf(today); ym <= endMonth; ym = addMonths(ym, 1)) {
    const monthEnd = dayInMonth(ym, 31);
    labels.push(ym);
    required.push(Math.round(sum(future.filter(e => e.date <= monthEnd).map(e => e.amount))));
    projected.push(Math.round(projectedAt(monthEnd, pace)));
    needed.push(Math.round(projectedAt(monthEnd, Math.max(pace, requiredPace))));
  }

  return {
    rows,
    peak,
    requiredPace,
    shortNow,
    monthlyGap,
    loanTotal: loan * months,
    enrollDate,
    endMonth,
    firstShortfall: rows.find(r => !r.ok) || null,
    chart: { labels, required, projected, needed }
  };
}
