// -------------------------
// クレジットカード明細（CSV）の取り込み
// 三井住友カード（Vpass）の CSV 形式に対応
//   1行目：  名前 様,カード番号,カード名
//   明細行： 利用日,利用店名,利用金額,支払区分,回数,今回支払額,備考
//   最終行： ,,,,,合計
// -------------------------

import { CARD_METHOD } from './calc.js';

// Shift_JIS と UTF-8 のどちらで保存されていても読めるようにする
export function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

// 1行を列に分ける（"..." で囲まれた列の中のカンマにも対応）
function splitCsvLine(line) {
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
const tidy = s => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

// 店名を比べるための形（記号・空白・長音の違いを無視する）
export function merchantKey(name) {
  return tidy(name).toLowerCase().replace(/[\s\-‐‑‒–—―−ーｰ・/／]/g, '');
}

const pad = n => String(n).padStart(2, '0');

export function parseCardCsv(text) {
  const lines = text.split(/\r\n|\n|\r|\u0085/).filter(l => l.trim());
  const header = splitCsvLine(lines[0] || '');
  const rows = [];
  const seen = new Map();

  for (const line of lines) {
    const cols = splitCsvLine(line);
    const date = cols[0].match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!date) continue;

    const amount = Number(tidy(cols[2] || '').replace(/,/g, ''));
    if (!amount) continue;

    const dateStr = `${date[1]}-${pad(date[2])}-${pad(date[3])}`;
    const name = tidy(cols[1] || '').replace(/\/NFC$/i, '');
    const installments = Number(tidy(cols[3] || '1')) || 1;
    const note = tidy(cols[6] || '');

    const memoParts = [name];
    if (note && note !== name && !name.includes(note)) memoParts.push(`（${note}）`);
    if (installments > 1) memoParts.push(`（${installments}回払い）`);
    if (amount < 0) memoParts.push('（返品・取消）');

    // 同じ日・同じ店・同じ金額が2件あっても区別できるよう、何件目かを付ける
    const base = `${dateStr}|${amount}|${merchantKey(name)}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);

    rows.push({
      date: dateStr,
      name,
      amount,
      memo: memoParts.join(''),
      merchant: merchantKey(name),
      importKey: `${base}|${count}`
    });
  }

  return { cardName: tidy(header[2] || ''), rows };
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
  ['車・ガソリン', ['駐車場', 'パーキング', 'parkdirect', 'タイムズ', 'eneos', 'エネオス', '出光', 'コスモ石油', 'ガソリン', 'オートバックス', 'イエローハット']],
  ['交通費', ['jr東日本', 'jr西日本', 'jr東海', '新幹線', 'えきねっと', 'suica', 'バス', 'タクシー', '航空']],
  ['通信費', ['ドコモ', 'docomo', 'ソフトバンク', 'softbank', 'kddi', 'auじぶん', 'ahamo', 'povo', 'linemo', '楽天モバイル', 'uqモバイル', 'ワイモバイル', 'ymobile']],
  ['サブスク', ['netflix', 'spotify', 'applecom', 'apple', 'amazonプライム', 'prime', 'youtube', 'disney', 'hulu', 'uネクスト', 'unext', 'adobe', 'chatgpt', 'openai', 'claude']],
  ['衣服', ['zozotown', 'ユニクロ', 'uniqlo', 'ジーユー', 'しまむら', 'モンベル', 'ワークマン', 'abcマート']],
  ['医療', ['病院', 'クリニック', '医院', '歯科', '薬局']],
  ['教育・研究', ['書店', '紀伊國屋', 'ジュンク堂', '蔦屋', '丸善', '生協']],
  ['娯楽・交際費', ['山荘', 'ホテル', '旅館', '温泉', '映画', 'シネマ', 'カラオケ', 'ゲーム', 'パーク', 'ロープウェイ', 'スキー', 'チケット']]
];

const RULES = KEYWORD_RULES.map(([category, words]) => [category, words.map(merchantKey)]);

export function guessCategory(row, data) {
  const categories = data.categories.expense;

  // 前に同じ店で記録したものがあれば、いちばん新しいもののカテゴリを使う
  const past = data.transactions
    .filter(tx => tx.merchant === row.merchant && categories.includes(tx.category))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (past) return past.category;

  for (const [category, words] of RULES) {
    if (categories.includes(category) && words.some(w => row.merchant.includes(w))) return category;
  }
  return categories.includes('その他') ? 'その他' : categories[0];
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
