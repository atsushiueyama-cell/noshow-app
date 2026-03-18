// ===== データベース操作ファイル =====
const Database = require('better-sqlite3');

const db = new Database('noshow.db');

// テーブル作成（noshow_date列を追加）
db.exec(`
  CREATE TABLE IF NOT EXISTS noshow (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   TEXT NOT NULL,                              -- 会員ID
    noshow_date TEXT,                                       -- ノーショウ日 (YYYY-MM-DD)
    uploaded_at TEXT DEFAULT (datetime('now', 'localtime')) -- アップロード日時
  )
`);

// 既存DBにnoshow_date列がない場合は追加する（初回移行用）
const cols = db.prepare(`PRAGMA table_info(noshow)`).all();
const hasNoshowDate = cols.some(c => c.name === 'noshow_date');
if (!hasNoshowDate) {
  db.exec(`ALTER TABLE noshow ADD COLUMN noshow_date TEXT`);
}

// 請求チェック保存テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS billing (
    member_id  TEXT NOT NULL,
    month      TEXT NOT NULL,
    checked    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (member_id, month)
  )
`);

// 日次配信チェック保存テーブル（日付単位で一括管理）
// ※古いスキーマ(member_id+date複合PK)が残っている場合は作り直す
(function() {
  const cols = db.prepare('PRAGMA table_info(daily_check)').all();
  const hasMemberId = cols.some(c => c.name === 'member_id');
  if (hasMemberId) {
    // 古いスキーマ → 削除して再作成
    db.exec('DROP TABLE daily_check');
  }
})();

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_check (
    date       TEXT NOT NULL PRIMARY KEY,  -- 対象日 (YYYY-MM-DD)
    checked    INTEGER NOT NULL DEFAULT 0, -- 1=配信済み, 0=未配信
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

// ===== 請求チェックを保存 =====
// items: [{ memberId, month, checked }]
function saveBilling(items) {
  const upsert = db.prepare(`
    INSERT INTO billing (member_id, month, checked, updated_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(member_id, month) DO UPDATE SET
      checked = excluded.checked,
      updated_at = excluded.updated_at
  `);
  const run = db.transaction((list) => {
    for (const item of list) {
      upsert.run(item.memberId, item.month, item.checked ? 1 : 0);
    }
  });
  run(items);
}

// ===== 請求チェック状態を全件取得 =====
function getBilling() {
  return db.prepare(`SELECT member_id, month, checked FROM billing`).all();
}

// ===== CSVデータを保存する =====
// rows: { memberId, noshowDate } の配列
function saveNoshow(rows) {
  const insert = db.prepare(
    'INSERT INTO noshow (member_id, noshow_date) VALUES (?, ?)'
  );
  const insertMany = db.transaction((list) => {
    for (const row of list) {
      insert.run(row.memberId, row.noshowDate || null);
    }
  });
  insertMany(rows);
}

// ===== 会員IDごとのノーショウ回数を集計 =====
function getNoShowCounts() {
  return db.prepare(`
    SELECT member_id, COUNT(*) as count
    FROM noshow
    GROUP BY member_id
    ORDER BY count DESC
  `).all();
}

// ===== 2回以上ノーショウの顧客一覧（月別内訳付き）=====
function getRepeatNoShow() {
  // 月一覧を取得
  const months = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', noshow_date) AS month
    FROM noshow
    WHERE noshow_date IS NOT NULL
    ORDER BY month ASC
  `).all().map(r => r.month);

  // 会員×月ごとの件数
  const rows = db.prepare(`
    SELECT
      member_id,
      strftime('%Y-%m', noshow_date) AS month,
      COUNT(*) AS cnt
    FROM noshow
    WHERE noshow_date IS NOT NULL
    GROUP BY member_id, strftime('%Y-%m', noshow_date)
  `).all();

  // 会員ごとに集計
  const map = {};
  for (const r of rows) {
    if (!map[r.member_id]) map[r.member_id] = { member_id: r.member_id, total: 0, months: {} };
    map[r.member_id].months[r.month] = r.cnt;
    map[r.member_id].total += r.cnt;
  }

  // 「いずれかの月に2回以上」のみ抽出、累計降順
  const result = Object.values(map)
    .filter(r => Object.values(r.months).some(cnt => cnt >= 2))
    .sort((a, b) => b.total - a.total);

  return { months, members: result };
}

// ===== 月ごとのノーショウ集計 =====
// 指定した年月（例: '2026-03'）の会員IDごとの回数を返す
function getMonthlyCount(yearMonth) {
  return db.prepare(`
    SELECT member_id, COUNT(*) as count
    FROM noshow
    WHERE strftime('%Y-%m', noshow_date) = ?
    GROUP BY member_id
    ORDER BY count DESC
  `).all(yearMonth);
}

// ===== CSVに含まれる月の一覧を取得（プルダウン用）=====
function getAvailableMonths() {
  return db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', noshow_date) as month
    FROM noshow
    WHERE noshow_date IS NOT NULL
    ORDER BY month DESC
  `).all();
}

// ===== 会員IDで検索 =====
function searchMember(memberId) {
  return db.prepare(`
    SELECT member_id, noshow_date, uploaded_at
    FROM noshow
    WHERE member_id LIKE ?
    ORDER BY noshow_date DESC
  `).all(`%${memberId}%`);
}

// ===== 月別サマリを取得 =====
function getMonthlySummary() {
  // 月ごとの総件数 + ユニーク会員数を1クエリで取得
  const totals = db.prepare(`
    SELECT
      strftime('%Y-%m', noshow_date) AS month,
      COUNT(*) AS total,
      COUNT(DISTINCT member_id) AS unique_members
    FROM noshow
    WHERE noshow_date IS NOT NULL
    GROUP BY strftime('%Y-%m', noshow_date)
    ORDER BY month ASC
  `).all();

  // 月×会員ごとの件数を取得してJS側で集計
  const perMember = db.prepare(`
    SELECT
      strftime('%Y-%m', noshow_date) AS month,
      member_id,
      COUNT(*) AS cnt
    FROM noshow
    WHERE noshow_date IS NOT NULL
    GROUP BY strftime('%Y-%m', noshow_date), member_id
  `).all();

  // once / repeat をJS側で集計
  const breakMap = {};
  for (const r of perMember) {
    if (!breakMap[r.month]) breakMap[r.month] = { once: 0, repeat: 0 };
    if (r.cnt === 1) breakMap[r.month].once++;
    else             breakMap[r.month].repeat++;
  }

  return totals.map(r => ({
    month:          r.month,
    total:          r.total,
    unique_members: r.unique_members,
    once:           breakMap[r.month] ? breakMap[r.month].once   : 0,
    repeat:         breakMap[r.month] ? breakMap[r.month].repeat : 0,
  }));
}

// ===== ノーショウがある日付のうち未配信の日付一覧を取得 =====
function getUncheckedDates() {
  // noshowテーブルに存在する全日付を取得し、配信済みでないものを返す
  return db.prepare(`
    SELECT DISTINCT noshow_date AS date, COUNT(DISTINCT member_id) AS count
    FROM noshow
    WHERE noshow_date IS NOT NULL
      AND noshow_date NOT IN (
        SELECT date FROM daily_check WHERE checked = 1
      )
    GROUP BY noshow_date
    ORDER BY noshow_date DESC
  `).all();
}

// ===== 指定日のノーショウ会員一覧＋日付単位の配信チェック状態を取得 =====
// date: 'YYYY-MM-DD'
function getDailyList(date) {
  // その日にノーショウした会員ID（重複除去）
  const members = db.prepare(`
    SELECT DISTINCT member_id
    FROM noshow
    WHERE noshow_date = ?
    ORDER BY member_id ASC
  `).all(date);

  // その日の配信チェック状態（日付単位）
  const row = db.prepare(`
    SELECT checked FROM daily_check WHERE date = ?
  `).get(date);

  const dateChecked = row ? row.checked === 1 : false;

  return {
    date,
    checked: dateChecked,
    members: members.map(r => r.member_id)
  };
}

// ===== 日次配信チェックを日付単位で保存 =====
// date: 'YYYY-MM-DD', checked: boolean
function saveDailyCheck(date, checked) {
  db.prepare(`
    INSERT INTO daily_check (date, checked, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(date) DO UPDATE SET
      checked    = excluded.checked,
      updated_at = excluded.updated_at
  `).run(date, checked ? 1 : 0);
}

// ===== 週間要注意者を取得 =====
// startDate〜endDate（7日間）で2回以上ノーショウの会員を返す
// startDate, endDate: 'YYYY-MM-DD'
function getWeeklyAlerts(startDate, endDate) {
  return db.prepare(`
    SELECT member_id, COUNT(*) AS count
    FROM noshow
    WHERE noshow_date BETWEEN ? AND ?
    GROUP BY member_id
    HAVING COUNT(*) >= 2
    ORDER BY count DESC
  `).all(startDate, endDate);
}

module.exports = {
  saveNoshow,
  getNoShowCounts,
  getRepeatNoShow,
  getMonthlyCount,
  getAvailableMonths,
  searchMember,
  getMonthlySummary,
  saveBilling,
  getBilling,
  getDailyList,
  saveDailyCheck,
  getWeeklyAlerts,
  getUncheckedDates
};
