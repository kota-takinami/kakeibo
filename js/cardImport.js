// -------------------------
// クレジットカード明細（CSV）の取り込み
// 次の2つの形式に対応（どちらかは自動で見分ける）
//
// 三井住友カード（Vpass）：Shift_JIS
//   1行目：  名前 様,カード番号,カード名
//   明細行： 利用日,利用店名,利用金額,支払区分,回数,今回支払額,備考
//   最終行： ,,,,,合計
//
// 楽天カード（楽天e-NAVI）：UTF-8、すべての列が "..." で囲まれている
//   1行目：  "利用日","利用店名・商品名","利用者","支払方法","利用金額",…,"新規サイン"
//   明細行： "2026/09/30","店名","本人","1回払い","890",…,"*"
//   補足行： 利用日が空の行（海外利用の金額、ETC の区間など）は、直前の明細の補足
// -------------------------

import { CARD_METHOD, INVEST_CATEGORY } from './calc.js';

// Shift_JIS と UTF-8 のどちらで保存されていても読めるようにする
export function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

// 1行を列に分ける（"..." で囲まれた列の中のカンマにも対応）
export function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells.map(s => s.trim());
}

// 全角英数字を半角に、全角スペースを半角にそろえる
export const tidy = s => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

// 店名を比べるための形（記号・空白・長音の違いを無視する）
export function merchantKey(name) {
  return tidy(name).toLowerCase().replace(/[\s\-‐‑‒–—―−ーｰ・/／]/g, '');
}

// キーワードで探すための形（小さい「ッ」「ャ」なども大きい字にそろえる）
// 半角カナの「ﾈﾂﾄﾌﾘﾂｸｽ」と「ネットフリックス」を同じものとして見つけるため
const SMALL_KANA = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ' };
const matchKey = name => merchantKey(name).replace(/[ァィゥェォッャュョヮ]/g, c => SMALL_KANA[c]);

const pad = n => String(n).padStart(2, '0');

const toDate = value => {
  const m = tidy(value || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
};

const toAmount = value => Number(tidy(value || '').replace(/[,¥\\円]/g, ''));

// 電子マネー（楽天キャッシュなど）へのチャージ
// このユーザーは楽天キャッシュで投資しているので、最初は「投資・積立」として扱う
const isCharge = name => /チヤジ|ペイ残高|ペイザンダカ/.test(matchKey(name));

export function parseCardCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r|\u0085/).filter(l => l.trim());
  const header = splitCsvLine(lines[0] || '');
  const isRakuten = header[0] === '利用日';
  const raw = isRakuten ? parseRakuten(lines.slice(1)) : parseVpass(lines);
  const cardName = isRakuten ? '楽天カード' : tidy(header[2] || '');
  const billMonth = isRakuten ? findBillMonth(header, raw) : null;

  // 同じ日・同じ店・同じ金額が2件あっても区別できるよう、何件目かを付ける
  const seen = new Map();
  const rows = raw.map(r => {
    const memoParts = [r.name];
    if (r.note && r.note !== r.name && !r.name.includes(r.note)) memoParts.push(`（${r.note}）`);
    if (r.installments > 1) memoParts.push(`（${r.installments}回払い）`);
    if (r.amount < 0) memoParts.push('（返品・取消）');

    const base = `${r.date}|${r.amount}|${merchantKey(r.name)}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);

    return {
      date: r.date,
      name: r.name,
      amount: r.amount,
      memo: memoParts.join(''),
      merchant: merchantKey(r.name),
      importKey: `${base}|${count}`,
      charge: isCharge(r.name),
      // 最初はチェックを外しておく理由（なければ null）
      skipReason: r.carried ? 'carried' : null
    };
  });

  return { cardName, billMonth, rows };
}

// 楽天カードの見出し「10月支払金額」から、引き落とされる年月（"2026-10"）を出す
// ETC のように遅れて請求される利用分も、この明細の月に引き落とされる
function findBillMonth(header, rows) {
  const month = header.map(h => h.match(/^(\d{1,2})月支払金額$/)).find(Boolean);
  const latest = rows.filter(r => !r.carried).map(r => r.date).sort().at(-1);
  if (!month || !latest) return null;
  const m = Number(month[1]);
  const year = Number(latest.slice(0, 4)) + (m < Number(latest.slice(5, 7)) ? 1 : 0);
  return `${year}-${pad(m)}`;
}

function parseVpass(lines) {
  const rows = [];
  for (const line of lines) {
    const cols = splitCsvLine(line);
    const date = toDate(cols[0]);
    const amount = toAmount(cols[2]);
    if (!date || !amount) continue;

    rows.push({
      date,
      name: tidy(cols[1] || '').replace(/\/NFC$/i, ''),
      amount,
      installments: toAmount(cols[3]) || 1,
      // 分割の2回目以降は、前の月の明細ですでに出ている買い物
      carried: (toAmount(cols[4]) || 1) > 1,
      note: tidy(cols[6] || '')
    });
  }
  return rows;
}

function parseRakuten(lines) {
  const rows = [];
  for (const line of lines) {
    const cols = splitCsvLine(line);
    const date = toDate(cols[0]);

    // 利用日が空の行は、直前の明細の補足
    if (!date) {
      const last = rows[rows.length - 1];
      const text = tidy(cols[1] || '');
      if (!last || !text) continue;
      const purchase = text.match(/ご利用金額[:：]\s*[\\¥]?([\d,]+)/);
      if (purchase && !last.amount) last.amount = toAmount(purchase[1]);
      // 海外利用の換算や分割の購入金額は、メモに入れなくてよい
      if (!/^(現地利用額|購入金額|ご利用金額)/.test(text)) last.note = text;
      continue;
    }

    const plan = tidy(cols[3] || '').match(/(\d+)回払い(?:\((\d+)回目\))?/);
    rows.push({
      date,
      // 海外利用は「SPOTIFY利用国SWE」のように国名が付くので外す
      name: tidy(cols[1] || '').replace(/利用国[A-Z]{3}$/, '').trim(),
      amount: toAmount(cols[4]) || 0,
      installments: plan ? Number(plan[1]) : 1,
      // 新規サイン（*）がない行は、前の月までの明細の続き（分割の2回目以降など）
      carried: tidy(cols[10] || '') !== '*',
      note: ''
    });
  }
  return rows.filter(r => r.amount);
}

// -------------------------
// カテゴリの推測
// 1. 前に同じ店で記録したカテゴリ（後から直した分も反映される）
// 2. 店名のキーワード
// 3. どれにも当てはまらなければ「その他」
// -------------------------

const KEYWORD_RULES = [
  ['食費', ['ローソン', 'セブンイレブン', 'ファミリーマート', 'ミニストップ', 'デイリーヤマザキ', 'すき家', '吉野家', '松屋', 'マクドナルド', 'モスバーガー', 'ケンタッキー', 'スターバックス', 'ドトール', 'タリーズ', 'コメダ', 'サイゼリヤ', 'ガスト', 'くら寿司', 'スシロー', 'はま寿司', '原信', 'バロー', 'イオン', 'ウオロク', '清水フードセンター', 'シャトレーゼ', 'ナルス', 'スーパー', 'ベーカリー', '食堂', 'ラーメン', 'カフェ', 'cafe', 'coffee']],
  ['日用品', ['ココカラファイン', 'ウエルシア', 'マツモトキヨシ', 'スギ薬局', 'ツルハ', 'クスリのアオキ', 'ドラッグ', '無印良品', 'セリア', 'ダイソー', 'キャンドゥ', 'ニトリ', 'ホームセンター', 'ムサシ', 'コメリ', 'カインズ', 'ケーヨー']],
  ['車・ガソリン', ['駐車場', 'パーキング', 'parkdirect', 'タイムズ', 'etcカード', 'eneos', 'エネオス', '出光', 'コスモ石油', 'ガソリン', 'オートバックス', 'イエローハット']],
  ['交通費', ['jr東日本', 'jr西日本', 'jr東海', '新幹線', 'えきねっと', 'suica', 'バス', 'タクシー', '航空']],
  ['通信費', ['ドコモ', 'docomo', 'ソフトバンク', 'softbank', 'kddi', 'auじぶん', 'ahamo', 'povo', 'linemo', '楽天モバイル', 'uqモバイル', 'ワイモバイル', 'ymobile']],
  ['サブスク', ['netflix', 'ネットフリックス', 'spotify', 'スポティファイ', 'applecom', 'apple', 'amazonプライム', 'prime', 'youtube', 'グーグルプレイ', 'googleplay', 'disney', 'hulu', 'uネクスト', 'unext', 'adobe', 'chatgpt', 'openai', 'claude', 'フィットネス', 'fit365', 'エニタイム', 'チョコザップ']],
  ['衣服', ['zozotown', 'ユニクロ', 'uniqlo', 'ジーユー', 'しまむら', 'モンベル', 'ワークマン', 'abcマート']],
  ['医療', ['病院', 'クリニック', '医院', '歯科', '薬局']],
  ['教育・研究', ['書店', '紀伊國屋', 'ジュンク堂', '蔦屋', '丸善', '生協']],
  ['娯楽・交際費', ['山荘', 'ホテル', '旅館', '温泉', '映画', 'シネマ', 'カラオケ', 'ゲーム', 'パーク', 'ロープウェイ', 'スキー', 'チケット']]
];

const RULES = KEYWORD_RULES.map(([category, words]) => [category, words.map(matchKey)]);

export function guessCategory(row, data) {
  const categories = data.categories.expense;

  // 前に同じ店で記録したものがあれば、いちばん新しいもののカテゴリを使う
  const past = data.transactions
    .filter(tx => tx.merchant === row.merchant && categories.includes(tx.category))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (past) return past.category;

  if (row.charge && categories.includes(INVEST_CATEGORY)) return INVEST_CATEGORY;

  const key = matchKey(row.name);
  for (const [category, words] of RULES) {
    if (categories.includes(category) && words.some(w => key.includes(w))) return category;
  }
  return categories.includes('その他') ? 'その他' : categories[0];
}

// 前に同じ店で「その他（○○）」と記録していれば、その○○を使う
export function guessDetail(row, data) {
  const past = data.transactions
    .filter(tx => tx.merchant === row.merchant && tx.detail)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return past ? past.detail : '';
}

// -------------------------
// 重複のチェック
// 'imported': 同じ明細をすでに取り込んでいる
// 'manual':   手入力した同じ日・同じ金額のカード払いがある（同じ買い物の可能性が高い）
// -------------------------

export function markDuplicates(rows, data, cardName) {
  const importedKeys = new Set(data.transactions.map(tx => tx.importKey).filter(Boolean));
  const manual = data.transactions.filter(tx =>
    !tx.importKey && tx.type === 'expense' && tx.method === CARD_METHOD && tx.card === cardName);
  const used = new Set();

  return rows.map(row => {
    if (importedKeys.has(row.importKey)) return { ...row, duplicate: 'imported' };
    const match = manual.find(tx => !used.has(tx.id) && tx.date === row.date && tx.amount === row.amount);
    if (match) {
      used.add(match.id);
      return { ...row, duplicate: 'manual' };
    }
    return { ...row, duplicate: null };
  });
}
