// -------------------------
// 銀行の入出金明細（CSV）の取り込み
// ゆうちょダイレクトの「入出金明細」の CSV に対応
//   先頭：   お客さま口座情報、現在高（"26,201"）、出力日時 など
//   見出し： 取引日,入出金明細ＩＤ,受入金額（円）,払出金額（円）,詳細１,詳細２,現在（貸付）高
//   明細行： 20261001,202610010000001,138,,受取利子,,14387
// -------------------------

import { splitCsvLine, tidy, merchantKey } from './cardImport.js';

const toNumber = value => Number(tidy(value || '').replace(/[,円]/g, '')) || 0;

// 列の見出しは表記ゆれがあっても見つけられるように、含まれる言葉で探す
function findColumns(header) {
  const find = word => header.findIndex(h => tidy(h).includes(word));
  return {
    date: find('取引日'),
    id: find('明細'),
    income: find('受入'),
    expense: find('払出'),
    kind: find('詳細1'),
    party: find('詳細2')
  };
}

export function parseBankCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  let columns = null;
  let currentBalance = null;
  const rows = [];

  for (const line of lines) {
    const cols = splitCsvLine(line);
    const first = tidy(cols[0] || '');

    if (first.startsWith('現在高')) {
      currentBalance = toNumber(cols[1]) || toNumber(first.replace(/^現在高[:：]?/, ''));
      continue;
    }
    if (first === '取引日') {
      columns = findColumns(cols);
      continue;
    }
    if (!columns || !/^\d{8}$/.test(first)) continue;

    const inAmount = toNumber(cols[columns.income]);
    const outAmount = toNumber(cols[columns.expense]);
    if (!inAmount && !outAmount) continue;

    rows.push(classify({
      date: `${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}`,
      bankId: tidy(cols[columns.id] || ''),
      amount: inAmount || outAmount,
      direction: inAmount ? 'in' : 'out',
      kind: tidy(cols[columns.kind] || '').replace(/\s/g, ''),
      party: tidy(cols[columns.party] || '')
    }));
  }

  return { currentBalance, rows };
}

// -------------------------
// 明細の種類を見分けて、記録のしかたを決める
//   'transfer': ATM や窓口での現金の出し入れ → 財布との「移動」
//   'income' / 'expense': 収入・支出
// skipReason が 'cardbill' のものは、カードの引き落とし（カード明細の取り込みで記録済み）なので最初は外す
// -------------------------

// クレジットカード会社への支払い（半角カナも全角にそろえてから調べる）
const CARD_COMPANY = /カード|クレジツト|クレジット|フイナンシヤル|フィナンシャル/;

function classify(row) {
  const { kind, party, direction } = row;
  const base = {
    ...row,
    memo: party || kind,
    merchant: merchantKey(party || kind),
    importKey: `bank|${row.bankId || `${row.date}|${row.amount}|${party}`}`,
    skipReason: null,
    category: 'その他',
    detail: ''
  };

  // ATM（キャッシュカード）や窓口（通帳）での出し入れ
  if ((kind === 'カード' || kind === '通帳') && !party) {
    return { ...base, type: 'transfer', memo: kind === 'カード' ? 'ATM' : '窓口' };
  }

  if (direction === 'in') {
    let category = 'その他';
    let detail = '';
    if (kind === '給与') category = '給料・バイト';
    else if (/ガクセイシエン|学生支援/.test(party)) category = '奨学金';
    else if (kind.includes('利子')) detail = '利息';
    return { ...base, type: 'income', category, detail };
  }

  if (CARD_COMPANY.test(party)) {
    return { ...base, type: 'expense', skipReason: 'cardbill', detail: 'カードの引き落とし' };
  }

  let category = 'その他';
  let detail = '';
  if (['ガス', '電気', '水道'].includes(kind)) category = '光熱費';
  else if (kind === '年金' || party.includes('年金')) detail = '国民年金';
  else if (kind.includes('料金')) detail = '手数料';
  else if (kind === '税金') detail = '税金';
  return { ...base, type: 'expense', category, detail };
}

// 前に同じ相手で記録したことがあれば、そのときのカテゴリと内容を使う
export function applyPastChoices(rows, data) {
  return rows.map(row => {
    if (row.type === 'transfer') return row;
    const past = data.transactions
      .filter(tx => tx.merchant === row.merchant && tx.type === row.type && data.categories[row.type].includes(tx.category))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return past ? { ...row, category: past.category, detail: past.detail || '' } : row;
  });
}

// -------------------------
// 重複のチェック
// 'imported': 同じ明細（入出金明細ID）をすでに取り込んでいる
// 'manual':   手入力した同じ日・同じ金額の記録が、この銀行にある
// -------------------------

export function markBankDuplicates(rows, data, bankId, accountOf) {
  const importedKeys = new Set(data.transactions.map(tx => tx.importKey).filter(Boolean));
  // カード払いは銀行の明細では「カードの引き落とし」にまとめて出るので、比べる対象にしない
  const manual = data.transactions.filter(tx => !tx.importKey && tx.method !== 'クレジットカード' && (
    tx.type === 'transfer' ? (tx.fromAccount === bankId || tx.toAccount === bankId) : accountOf(tx, data) === bankId
  ));
  const used = new Set();

  return rows.map(row => {
    if (importedKeys.has(row.importKey)) return { ...row, duplicate: 'imported' };
    const match = manual.find(tx => !used.has(tx.id) && tx.date === row.date && tx.amount === row.amount && tx.type === row.type);
    if (match) {
      used.add(match.id);
      return { ...row, duplicate: 'manual' };
    }
    return { ...row, duplicate: null };
  });
}
