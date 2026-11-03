// -------------------------
// 証券会社の保有商品（CSV）の取り込み
// 楽天証券「保有商品一覧」の CSV（Shift_JIS）に対応
//   ■資産合計欄      … 預り金（証券口座にある現金）を使う
//   ■ 保有商品詳細   … 1行が1つの保有商品
//     "種別","銘柄コード・ティッカー","銘柄","口座","保有数量",…,"時価評価額[円]",…,"評価損益[円]",…
// -------------------------

import { splitCsvLine, tidy } from './cardImport.js';

export const BROKER = '楽天証券';
export const DEPOSIT_NAME = '預り金（証券口座の現金）';

const KIND_MAP = {
  '国内株式': '日本株',
  '米国株式': '米国株',
  '投資信託': '投資信託',
  '国内債券': '債券',
  '外国債券': '債券'
};

// "1,830.00" "+390" "-130" を数にする（"-" だけのときは 0）
const toNumber = value => Number(tidy(value || '').replace(/[,+円]/g, '')) || 0;

// 銘柄名を比べるための形（空白・かっこ・記号の違いを無視する）
export function holdingKey(name) {
  return tidy(name).toLowerCase().replace(/[\s()（）［］[\]・\-‐−ー]/g, '');
}

export function parseHoldingsCsv(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const holdings = [];
  let deposit = 0;
  let csvTotal = null;
  let columns = null;

  for (const line of lines) {
    const cols = splitCsvLine(line);
    const first = tidy(cols[0] || '');

    // 資産合計欄
    if (first === '預り金') deposit = toNumber(cols[1]);
    if (first === '保有商品の評価額合計') csvTotal = toNumber(cols[1]);

    // 保有商品詳細の見出し行を見つけたら、列の位置を覚える
    if (first === '種別' && cols.includes('銘柄')) {
      columns = Object.fromEntries(cols.map((name, i) => [name, i]));
      continue;
    }
    if (!columns) continue;

    // 空行や次の「■」の欄で、保有商品詳細は終わり
    if (!first || first.startsWith('■')) {
      if (holdings.length) columns = null;
      continue;
    }

    const value = toNumber(cols[columns['時価評価額[円]']]);
    const gain = toNumber(cols[columns['評価損益[円]']]);
    const name = tidy(cols[columns['銘柄']] || '');
    if (!name || !value) continue;

    holdings.push({
      name,
      kind: KIND_MAP[first] || 'その他',
      code: tidy(cols[columns['銘柄コード・ティッカー']] || ''),
      account: tidy(cols[columns['口座']] || ''),
      quantity: toNumber(cols[columns['保有数量']]),
      value,
      // 元本（取得額）＝ 評価額 − 評価損益
      principal: value - gain
    });
  }

  if (deposit > 0) {
    holdings.push({ name: DEPOSIT_NAME, kind: 'その他', code: '', account: '', quantity: 0, value: deposit, principal: deposit });
  }

  return { holdings, csvTotal };
}

// -------------------------
// アプリに登録済みの投資との突き合わせ
// 'update': 登録済みの同じ商品を、CSV の値で上書きする
// 'add':    新しい商品として追加する
// 'remove': 楽天証券の商品なのに CSV にない（売却済みの可能性）
// -------------------------

export function planHoldingsImport(holdings, investments) {
  const used = new Set();

  const findExisting = h => {
    const key = holdingKey(h.name);
    const candidates = investments.filter(inv => !used.has(inv.id) && (
      (h.code && inv.code === h.code && inv.account === h.account) || holdingKey(inv.name) === key
    ));
    // 同じ銘柄を別の口座（NISA と特定口座など）で持っている場合は、口座も合うものを優先する
    return candidates.find(inv => inv.account === h.account) || candidates.find(inv => !inv.account) || null;
  };

  const rows = holdings.map(h => {
    const existing = findExisting(h);
    if (existing) used.add(existing.id);
    return { ...h, action: existing ? 'update' : 'add', existing, checked: true };
  });

  for (const inv of investments) {
    if (!used.has(inv.id) && inv.broker === BROKER) {
      rows.push({ ...inv, action: 'remove', existing: inv, checked: false });
    }
  }
  return rows;
}
