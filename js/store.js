// -------------------------
// データの保存と読み込み
// すべてのデータを1つの JSON にまとめて localStorage に保存する
// -------------------------

import { todayStr, addMonths, INVEST_CATEGORY, WALLET_ID } from './calc.js';

export { INVEST_CATEGORY };

const STORAGE_KEY = 'kakeibo-v1';
export const DATA_VERSION = 1;

export const DEFAULT_EXPENSE_CATEGORIES = [
  '食費', '日用品', '家賃', '光熱費', '通信費', '交通費', '車・ガソリン',
  '衣服', '医療', '教育・研究', '娯楽・交際費', 'サブスク', '投資・積立', 'その他'
];

export const DEFAULT_INCOME_CATEGORIES = [
  '給料・バイト', '仕送り', '奨学金', '臨時収入', 'ポイント還元', 'その他'
];

export const METHODS = [
  '現金', 'クレジットカード', 'QR決済', '電子マネー', 'デビットカード', '口座振替', 'その他'
];

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 大学院計画の初期値（入学年月から支払期日を決める）
export function defaultGradPlan() {
  const now = todayStr();
  const [y, m] = now.split('-').map(Number);
  // 次の4月入学を初期値にする
  const enrollYear = m >= 4 ? y + 1 : y;
  const enrollMonth = `${enrollYear}-04`;

  return {
    enrollMonth,
    years: 2,
    payments: [
      { id: uid(), name: '検定料', amount: 30000, due: `${addMonths(enrollMonth, -3)}-15` },
      { id: uid(), name: '入学金', amount: 282000, due: `${addMonths(enrollMonth, -2)}-28` },
      { id: uid(), name: '1年 前期授業料', amount: 267900, due: `${enrollMonth}-30` },
      { id: uid(), name: '1年 後期授業料', amount: 267900, due: `${addMonths(enrollMonth, 6)}-31` },
      { id: uid(), name: '2年 前期授業料', amount: 267900, due: `${addMonths(enrollMonth, 12)}-30` },
      { id: uid(), name: '2年 後期授業料', amount: 267900, due: `${addMonths(enrollMonth, 18)}-31` }
    ],
    living: [
      { id: uid(), name: '家賃', amount: 45000 },
      { id: uid(), name: '食費', amount: 30000 },
      { id: uid(), name: '光熱費', amount: 8000 },
      { id: uid(), name: '通信費', amount: 5000 },
      { id: uid(), name: '日用品・その他', amount: 15000 }
    ],
    income: [
      { id: uid(), name: 'バイト', amount: 40000 },
      { id: uid(), name: 'TA・RA', amount: 0 },
      { id: uid(), name: '給付奨学金', amount: 0 }
    ],
    loanMonthly: 0,
    buffer: 100000,
    includeInvestments: true,
    includePoints: false,
    paceMode: 'actual',
    manualPace: 30000
  };
}

// お金がある場所（財布と銀行）。残高は baseDate の終わり時点の金額
function defaultAccounts(baseAmount = 0, baseDate = todayStr()) {
  return [
    { id: WALLET_ID, name: '財布', kind: 'cash', baseAmount: 0, baseDate },
    { id: uid(), name: 'ゆうちょ銀行', kind: 'bank', baseAmount, baseDate }
  ];
}

function defaultData() {
  const accounts = defaultAccounts();
  return {
    version: DATA_VERSION,
    transactions: [],
    accounts,
    cards: [
      { id: uid(), name: '三井住友カード', closingDay: 31, paymentDay: 26, accountId: accounts[1].id }
    ],
    fixedCosts: [],
    fixedGenerated: [],
    investments: [],
    pointPrograms: [
      { id: uid(), name: 'Vポイント', yenPerPoint: 1, initial: 0 },
      { id: uid(), name: '楽天ポイント', yenPerPoint: 1, initial: 0 },
      { id: uid(), name: 'PayPayポイント', yenPerPoint: 1, initial: 0 }
    ],
    pointRecords: [],
    assetHistory: [],
    gradPlan: defaultGradPlan(),
    categories: {
      expense: [...DEFAULT_EXPENSE_CATEGORIES],
      income: [...DEFAULT_INCOME_CATEGORIES]
    },
    settings: {
      lastBackup: null,
      lastMethod: '現金',
      lastCard: '',
      lastBank: '',
      // 財布と銀行の残高を、利用者に合わせてもらう必要があるとき true
      needsAccountSetup: false
    }
  };
}

// 読み込んだデータに足りない項目があれば初期値で補う
function withDefaults(raw) {
  const base = defaultData();
  const merged = { ...base, ...raw };

  merged.categories = { ...base.categories, ...(raw.categories || {}) };
  merged.settings = { ...base.settings, ...(raw.settings || {}) };
  merged.gradPlan = { ...base.gradPlan, ...(raw.gradPlan || {}) };

  // 以前の「現金・預金」1つだけのデータは、財布と銀行に分ける
  // 今までの残高は銀行に入れ、あとで両方の残高を合わせてもらう
  if (!Array.isArray(raw.accounts)) {
    const cash = raw.cash || {};
    merged.accounts = defaultAccounts(Number(cash.baseAmount) || 0, cash.baseDate || todayStr());
    merged.settings.needsAccountSetup = true;
    const bankId = merged.accounts[1].id;
    merged.cards = (merged.cards || []).map(card => ({ accountId: bankId, ...card }));
  }
  delete merged.cash;
  return merged;
}

function load() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) return withDefaults(JSON.parse(text));
  } catch (e) {
    console.error('データの読み込みに失敗しました', e);
  }
  return defaultData();
}

let data = load();

export function getData() {
  return data;
}

export function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// データを変更して保存する
// 例：update(d => d.transactions.push(tx))
export function update(fn) {
  fn(data);
  save();
}

// -------------------------
// バックアップ
// -------------------------

export function exportJSON() {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.transactions)) {
    throw new Error('家計簿のバックアップファイルではありません');
  }
  delete raw.exportedAt;
  data = withDefaults(raw);
  save();
}
