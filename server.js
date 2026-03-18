// ===== サーバーファイル =====
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const db      = require('./database');

const app  = express();
// Renderは環境変数PORTを自動でセットする。ローカルは3000を使用
const PORT = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ===== CSVアップロードAPI =====
// CSVフォーマット例（ヘッダーなし）:
//   A001,2026-03-05
//   A002,2026-03-12
// 日付列がない場合は会員IDのみでもOK
app.post('/api/upload', upload.single('csvfile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルが選択されていません' });
    }

    const text = req.file.buffer.toString('utf-8');

    const rows = text
      .replace(/^\uFEFF/, '')        // BOM除去
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const cols = line.split(',');
        const memberId = cols[0].trim();

        // 日付を YYYY-MM-DD に正規化
        // 対応フォーマット: 2026/1/5 → 2026-01-05 / 2026-01-05 はそのまま
        let noshowDate = null;
        if (cols[1]) {
          const raw = cols[1].trim();
          const m = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
          if (m) {
            const y = m[1];
            const mo = m[2].padStart(2, '0');
            const d  = m[3].padStart(2, '0');
            noshowDate = `${y}-${mo}-${d}`;
          }
        }
        return { memberId, noshowDate };
      })
      .filter(row => row.memberId.length > 0);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSVに有効なデータがありません' });
    }

    db.saveNoshow(rows);
    res.json({ message: `${rows.length}件のノーショウデータを保存しました` });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ===== 全件集計API =====
app.get('/api/counts', (req, res) => {
  res.json(db.getNoShowCounts());
});

// ===== 2回以上ノーショウAPI =====
app.get('/api/repeat', (req, res) => {
  res.json(db.getRepeatNoShow());
});

// ===== 月別集計API =====
// 例: GET /api/monthly?month=2026-03
app.get('/api/monthly', (req, res) => {
  const { month } = req.query;
  if (!month) return res.json([]);
  res.json(db.getMonthlyCount(month));
});

// ===== 月一覧API（プルダウン用）=====
app.get('/api/months', (req, res) => {
  res.json(db.getAvailableMonths());
});

// ===== 会員ID検索API =====
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  res.json(db.searchMember(q));
});

// ===== 請求チェック保存API =====
app.post('/api/billing', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'invalid' });
  db.saveBilling(items);
  res.json({ message: '保存しました' });
});

// ===== 請求チェック取得API =====
app.get('/api/billing', (req, res) => {
  res.json(db.getBilling());
});

// ===== 月別サマリAPI =====
app.get('/api/summary', (req, res) => {
  res.json(db.getMonthlySummary());
});

// ===== 未配信日付一覧API =====
app.get('/api/unchecked_dates', (req, res) => {
  res.json(db.getUncheckedDates());
});

// ===== 日次一覧API =====
// 例: GET /api/daily_list?date=2026-03-16
app.get('/api/daily_list', (req, res) => {
  const { date } = req.query;
  if (!date) return res.json({ date: '', checked: false, members: [] });
  res.json(db.getDailyList(date));
});

// ===== 日次配信チェック保存API（日付単位）=====
// body: { date: 'YYYY-MM-DD', checked: true/false }
app.post('/api/daily_check', (req, res) => {
  const { date, checked } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });
  db.saveDailyCheck(date, checked);
  res.json({ message: '保存しました' });
});

// ===== 週間要注意者API =====
// 例: GET /api/weekly_alerts?start=2026-03-10&end=2026-03-16
app.get('/api/weekly_alerts', (req, res) => {
  let { start, end } = req.query;
  // 未指定の場合は直近7日間
  if (!end) {
    const today = new Date();
    end = today.toISOString().slice(0, 10);
  }
  if (!start) {
    const s = new Date(end);
    s.setDate(s.getDate() - 6);
    start = s.toISOString().slice(0, 10);
  }
  res.json({ start, end, alerts: db.getWeeklyAlerts(start, end) });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});
