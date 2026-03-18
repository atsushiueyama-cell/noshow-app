# ノーショウ顧客管理アプリ

Node.js + Express + SQLite で動作するノーショウ顧客管理Webアプリです。

---

## ローカルでの起動方法

```bash
cd noshow-app
npm install
npm start
```

ブラウザで http://localhost:3000 を開く。

または `起動.bat` をダブルクリックしても起動できます。

---

## Render へのデプロイ手順

### 1. GitHubにpushする

```bash
# リポジトリのルート（noshow-appの親フォルダ）で実行
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
git push -u origin main
```

> `.gitignore` により `node_modules/` と `*.db` はpush対象外になっています。

---

### 2. Render で Web Service を作成する

1. https://render.com にログイン
2. 「New」→「Web Service」をクリック
3. GitHubリポジトリを接続して対象リポジトリを選択
4. 以下の設定を入力する

| 項目 | 値 |
|------|-----|
| Name | noshow-app（任意） |
| Root Directory | `noshow-app` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |

5. 「Create Web Service」をクリック → デプロイ開始

デプロイ完了後、`https://xxxx.onrender.com` のURLでアクセスできます。

---

## ⚠️ SQLite（データ永続化）に関する重要な注意点

Renderの**Freeプラン**はディスクが**永続化されません**。

- サービスが再起動・再デプロイされると `noshow.db` が**リセット**されます
- アップロードしたCSVデータ・請求チェック・配信チェックが消えます

### 対策オプション

| 方法 | 概要 |
|------|------|
| Render Disk（有料） | Renderの永続ディスクを追加（$1/月〜） |
| PostgreSQL に移行 | Renderが無料のPostgreSQLを提供。better-sqlite3 → pg に変更が必要 |
| PlanetScale / Turso | 外部のクラウドDBサービスを利用 |

**本番運用する場合は永続化対応を強く推奨します。**

---

## エラーが出た場合の確認ポイント

### デプロイ時

| エラー | 確認箇所 |
|--------|---------|
| `Cannot find module 'better-sqlite3'` | Root Directory が `noshow-app` になっているか確認 |
| Build失敗 | Renderのログで `npm install` のエラー内容を確認 |
| `node-gyp` エラー | better-sqlite3はネイティブモジュールのためビルドに時間がかかる。ログを最後まで確認 |

### 起動時

| エラー | 確認箇所 |
|--------|---------|
| `Port already in use` | `process.env.PORT` が正しく使われているか確認 |
| 画面が真っ白 | `public/index.html` が `public/` フォルダに存在するか確認 |
| APIが404 | Root Directory の設定ミス。`server.js` がルートにあるか確認 |

### データが消えた

- Freeプランのディスク非永続化が原因。上記「SQLite注意点」を参照

---

## 技術スタック

- Node.js 18+
- Express 4
- better-sqlite3
- multer（CSVアップロード）
