// ===== インメモリ版データベース（Render対応・SQLiteなし）=====
// ※ サーバー再起動でデータはリセットされます

let noshows    = [];  // { memberId, noshowDate } の配列
let billing    = [];  // 請求チェックデータ
let dailyChecks = {}; // { 'YYYY-MM-DD': true/false }

module.exports = {

  // ===== CSVデータを保存 =====
  saveNoshow(rows) {
    noshows.push(...rows);
  },

  // ===== 会員IDごとのノーショウ回数を集計 =====
  getNoShowCounts() {
    const counts = {};
    noshows.forEach(r => {
      counts[r.memberId] = (counts[r.memberId] || 0) + 1;
    });
    // server.js が期待する { member_id, count } 形式に変換
    return Object.entries(counts)
      .map(([member_id, count]) => ({ member_id, count }))
      .sort((a, b) => b.count - a.count);
  },

  // ===== 同月2回以上ノーショウの顧客一覧（月別内訳付き）=====
  getRepeatNoShow() {
    // 月一覧
    const monthSet = new Set(
      noshows.map(r => r.noshowDate?.slice(0, 7)).filter(Boolean)
    );
    const months = Array.from(monthSet).sort();

    // 会員×月ごとの件数
    const map = {};
    noshows.forEach(r => {
      if (!r.noshowDate) return;
      const month = r.noshowDate.slice(0, 7);
      if (!map[r.memberId]) map[r.memberId] = { member_id: r.memberId, total: 0, months: {} };
      map[r.memberId].months[month] = (map[r.memberId].months[month] || 0) + 1;
      map[r.memberId].total++;
    });

    // いずれかの月に2回以上の会員のみ抽出
    const members = Object.values(map)
      .filter(r => Object.values(r.months).some(cnt => cnt >= 2))
      .sort((a, b) => b.total - a.total);

    return { months, members };
  },

  // ===== 月ごとのノーショウ集計 =====
  getMonthlyCount(month) {
    const counts = {};
    noshows
      .filter(r => r.noshowDate?.startsWith(month))
      .forEach(r => {
        counts[r.memberId] = (counts[r.memberId] || 0) + 1;
      });
    return Object.entries(counts)
      .map(([member_id, count]) => ({ member_id, count }))
      .sort((a, b) => b.count - a.count);
  },

  // ===== 月一覧を取得（プルダウン用）=====
  getAvailableMonths() {
    const set = new Set(
      noshows.map(r => r.noshowDate?.slice(0, 7)).filter(Boolean)
    );
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map(month => ({ month }));
  },

  // ===== 会員ID検索 =====
  searchMember(q) {
    return noshows
      .filter(r => r.memberId.includes(q))
      .map(r => ({
        member_id:   r.memberId,
        noshow_date: r.noshowDate || null,
        uploaded_at: r.uploadedAt || ''
      }));
  },

  // ===== 請求チェックを保存 =====
  saveBilling(items) {
    billing = items;
  },

  // ===== 請求チェックを取得 =====
  getBilling() {
    return billing.map(b => ({
      member_id: b.memberId,
      month:     b.month,
      checked:   b.checked ? 1 : 0
    }));
  },

  // ===== 月別サマリを取得 =====
  getMonthlySummary() {
    const monthMap = {};
    noshows.forEach(r => {
      if (!r.noshowDate) return;
      const m = r.noshowDate.slice(0, 7);
      if (!monthMap[m]) monthMap[m] = {};
      monthMap[m][r.memberId] = (monthMap[m][r.memberId] || 0) + 1;
    });

    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, memberCounts]) => {
        const unique_members = Object.keys(memberCounts).length;
        const total  = Object.values(memberCounts).reduce((s, c) => s + c, 0);
        const once   = Object.values(memberCounts).filter(c => c === 1).length;
        const repeat = Object.values(memberCounts).filter(c => c >= 2).length;
        return { month, total, unique_members, once, repeat };
      });
  },

  // ===== 未配信の日付一覧を取得 =====
  getUncheckedDates() {
    // noshowデータがある日付のうち、配信済みでないものを返す
    const dateSet = new Set(
      noshows.map(r => r.noshowDate).filter(Boolean)
    );
    return Array.from(dateSet)
      .filter(date => !dailyChecks[date])
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({
        date,
        count: new Set(noshows.filter(r => r.noshowDate === date).map(r => r.memberId)).size
      }));
  },

  // ===== 指定日のノーショウ会員一覧＋配信チェック状態を取得 =====
  getDailyList(date) {
    const memberSet = new Set(
      noshows.filter(r => r.noshowDate === date).map(r => r.memberId)
    );
    return {
      date,
      checked: dailyChecks[date] || false,
      members: Array.from(memberSet).sort()
    };
  },

  // ===== 日次配信チェックを日付単位で保存 =====
  saveDailyCheck(date, checked) {
    dailyChecks[date] = !!checked;
  },

  // ===== 週間要注意者を取得（指定期間で2回以上）=====
  getWeeklyAlerts(start, end) {
    const counts = {};
    noshows
      .filter(r => r.noshowDate >= start && r.noshowDate <= end)
      .forEach(r => {
        counts[r.memberId] = (counts[r.memberId] || 0) + 1;
      });
    return Object.entries(counts)
      .filter(([_, c]) => c >= 2)
      .map(([member_id, count]) => ({ member_id, count }))
      .sort((a, b) => b.count - a.count);
  }
};
