# xvpn セットアップガイド

このガイドでは、xvpnをローカル環境と本番環境でセットアップする手順を説明します。

## 目次

1. [必要要件](#必要要件)
2. [Auth0のセットアップ](#auth0のセットアップ)
3. [Cloudflareのセットアップ](#cloudflareのセットアップ)
4. [ローカル開発環境のセットアップ](#ローカル開発環境のセットアップ)
5. [本番環境へのデプロイ](#本番環境へのデプロイ)

## 必要要件

### ソフトウェア要件

- **Node.js**: v18.0.0以上
- **npm**: v9.0.0以上（または pnpm/yarn）
- **Git**: バージョン管理用
- **wrangler CLI**: v3.24.0以上

### アカウント要件

- **Cloudflareアカウント**: Workers有効（無料プランで可）
- **Auth0アカウント**: 無料プランで可

## Auth0のセットアップ

### 1. Auth0アカウントの作成

1. [Auth0](https://auth0.com/)にアクセス
2. 「Sign Up」をクリックしてアカウントを作成
3. テナント名を設定（例: `xvpn-dev`）

### 2. Applicationの作成

1. Auth0ダッシュボードで「Applications」→「Applications」に移動
2. 「Create Application」をクリック
3. 以下を設定：
   - **Name**: `xvpn`
   - **Application Type**: `Single Page Web Applications`
4. 「Create」をクリック

### 3. Application設定

作成したApplicationの「Settings」タブで以下を設定：

#### Allowed Callback URLs
```
http://localhost:5173,
http://localhost:5173/callback,
https://your-frontend-domain.com,
https://your-frontend-domain.com/callback
```

#### Allowed Logout URLs
```
http://localhost:5173,
https://your-frontend-domain.com
```

#### Allowed Web Origins
```
http://localhost:5173,
https://your-frontend-domain.com
```

#### Allowed Origins (CORS)
```
http://localhost:5173,
https://your-frontend-domain.com
```

設定後、「Save Changes」をクリック。

### 4. APIの作成

1. Auth0ダッシュボードで「Applications」→「APIs」に移動
2. 「Create API」をクリック
3. 以下を設定：
   - **Name**: `xvpn API`
   - **Identifier**: `https://your-worker.your-subdomain.workers.dev`（後でWorkerのURLに変更可能）
   - **Signing Algorithm**: `RS256`
4. 「Create」をクリック

### 5. Connectionsの設定

#### GitHub接続（推奨）

1. 「Authentication」→「Social」に移動
2. 「GitHub」を見つけて有効化
3. GitHub OAuthアプリを作成（[GitHub Developer Settings](https://github.com/settings/developers)）
   - **Application name**: `xvpn`
   - **Homepage URL**: `http://localhost:5173`（開発用）
   - **Authorization callback URL**: Auth0が提供するコールバックURL
4. GitHub Client IDとClient Secretを取得し、Auth0に設定
5. 作成したApplicationで「Connections」タブを開き、GitHubを有効化

#### Email接続

1. 「Authentication」→「Database」に移動
2. デフォルトの「Username-Password-Authentication」を使用、または新規作成
3. 設定:
   - **Requires Username**: オフ（メールのみ）
   - **Disable Sign Ups**: 必要に応じてオン（招待制にする場合）
4. Passwordlessを使いたい場合:
   - 「Authentication」→「Passwordless」に移動
   - 「Email」を有効化

### 6. 環境変数の記録

以下の値を控えておきます（後で`.env`ファイルに設定）：

- **Domain**: `your-tenant.auth0.com`（Settings → Basicで確認）
- **Client ID**: ApplicationのClient ID
- **Client Secret**: ApplicationのClient Secret（Workerで必要な場合）
- **Audience**: APIのIdentifier

## Cloudflareのセットアップ

### 1. Cloudflareアカウントの作成

1. [Cloudflare](https://cloudflare.com/)にアクセス
2. アカウントを作成してログイン

### 2. API Tokenの作成

1. ダッシュボード右上のアイコン→「My Profile」
2. 「API Tokens」タブに移動
3. 「Create Token」をクリック
4. 「Edit Cloudflare Workers」テンプレートを使用
5. 権限を確認：
   - **Account** → **Cloudflare Workers** → **Edit**
   - **Zone** → **Workers Routes** → **Edit**（カスタムドメイン使用時）
6. 「Continue to summary」→「Create Token」
7. トークンをコピーして安全に保管

### 3. Account IDの取得

1. Cloudflareダッシュボードのホーム画面
2. 右側のサイドバーに「Account ID」が表示されています
3. これをコピー

### 4. KV Namespaceの作成

ターミナルで以下を実行：

```bash
cd worker

# Rate limiting用
wrangler kv:namespace create "RATE_LIMIT"
wrangler kv:namespace create "RATE_LIMIT" --preview

# Session管理用
wrangler kv:namespace create "SESSIONS"
wrangler kv:namespace create "SESSIONS" --preview

# Audit log用
wrangler kv:namespace create "AUDIT_LOG"
wrangler kv:namespace create "AUDIT_LOG" --preview
```

各コマンドの出力からNamespace IDをコピーし、`wrangler.toml`に設定。

### 5. wrangler.tomlの編集

`worker/wrangler.toml`を開き、以下を設定：

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "あなたのKV_ID"
preview_id = "あなたのpreview_KV_ID"

# SESSIONS、AUDIT_LOGも同様に設定
```

## ローカル開発環境のセットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/your-org/xvpn.git
cd xvpn
```

### 2. 依存関係のインストール

```bash
# 全てのパッケージをインストール
npm run install:all

# または個別に
npm install
cd worker && npm install && cd ..
cd frontend && npm install && cd ..
```

### 3. 環境変数の設定

#### Worker用（`worker/.dev.vars`）

```bash
cd worker
cp .dev.vars.example .dev.vars
```

`.dev.vars`を編集：

```bash
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://your-worker.your-subdomain.workers.dev
ALLOWED_ORIGINS=http://localhost:5173
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
ALLOWED_PROXY_DOMAINS=*.wikipedia.org,*.example.com
```

#### Frontend用（`frontend/.env`）

```bash
cd frontend
cp .env.example .env
```

`.env`を編集：

```bash
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your_client_id
VITE_AUTH0_AUDIENCE=https://your-worker.your-subdomain.workers.dev
VITE_AUTH0_CALLBACK_URL=http://localhost:5173/callback
VITE_WORKER_URL=http://localhost:8787
```

**注意**: ローカル開発時、WorkerのURLは `http://localhost:8787` です。

### 4. ローカルサーバーの起動

2つのターミナルウィンドウを開きます。

**ターミナル1 - Worker**:
```bash
cd worker
npm run dev
```

Workerが `http://localhost:8787` で起動します。

**ターミナル2 - Frontend**:
```bash
cd frontend
npm run dev
```

Frontendが `http://localhost:5173` で起動します。

### 5. 動作確認

1. ブラウザで `http://localhost:5173` にアクセス
2. 「ログイン」ボタンをクリック
3. Auth0のログイン画面でGitHubまたはメールでログイン
4. ダッシュボードが表示されることを確認

## 本番環境へのデプロイ

### 1. Workerのデプロイ

#### 環境変数の設定（本番用）

```bash
cd worker

# Auth0設定
wrangler secret put AUTH0_DOMAIN
# プロンプトで入力: your-tenant.auth0.com

wrangler secret put AUTH0_AUDIENCE
# プロンプトで入力: https://your-worker.your-subdomain.workers.dev

# CORS設定
wrangler secret put ALLOWED_ORIGINS
# プロンプトで入力: https://your-frontend-domain.com

# その他の設定
wrangler secret put ALLOWED_PROXY_DOMAINS
wrangler secret put RATE_LIMIT_MAX_REQUESTS
wrangler secret put RATE_LIMIT_WINDOW_MS
```

#### デプロイ実行

```bash
npm run deploy
```

デプロイ完了後、Worker URLが表示されます（例: `https://xvpn-worker.your-subdomain.workers.dev`）。

### 2. Auth0設定の更新

1. Auth0ダッシュボードでApplicationを開く
2. Allowed Callback URLs、Logout URLs等に本番URLを追加
3. APIのIdentifierを本番Worker URLに更新（必要に応じて）

### 3. Frontendのデプロイ

#### 環境変数の設定

`frontend/.env.production`を作成：

```bash
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your_client_id
VITE_AUTH0_AUDIENCE=https://xvpn-worker.your-subdomain.workers.dev
VITE_AUTH0_CALLBACK_URL=https://your-frontend-domain.com/callback
VITE_WORKER_URL=https://xvpn-worker.your-subdomain.workers.dev
```

#### ビルド

```bash
cd frontend
npm run build
```

`dist/`フォルダが生成されます。

#### Cloudflare Pagesへのデプロイ（推奨）

1. Cloudflareダッシュボードで「Pages」に移動
2. 「Create a project」→「Connect to Git」
3. GitHubリポジトリを接続
4. ビルド設定:
   - **Build command**: `cd frontend && npm install && npm run build`
   - **Build output directory**: `frontend/dist`
   - **Environment variables**: 上記の環境変数を設定
5. 「Save and Deploy」

または、`wrangler`経由でデプロイ：

```bash
cd frontend
npx wrangler pages deploy dist --project-name=xvpn-frontend
```

### 4. カスタムドメインの設定（オプション）

#### Worker用

`worker/wrangler.toml`に追加：

```toml
routes = [
  { pattern = "api.your-domain.com/*", zone_name = "your-domain.com" }
]
```

再デプロイ：
```bash
cd worker
npm run deploy
```

#### Frontend用

Cloudflare Pagesダッシュボードで：
1. プロジェクトを開く
2. 「Custom domains」タブ
3. ドメインを追加

### 5. 本番環境の動作確認

1. 本番URLにアクセス
2. ログインフローをテスト
3. プロキシ機能をテスト
4. エラーハンドリングを確認

## GitHub Actionsでの自動デプロイ

詳細は`.github/workflows/deploy.yml`を参照してください。

必要なSecrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

GitHubリポジトリの Settings → Secrets → Actions で設定します。

## トラブルシューティング

問題が発生した場合は、[troubleshooting.md](./troubleshooting.md)を参照してください。

## 次のステップ

- [アーキテクチャドキュメント](./architecture.md)でシステム設計を理解
- [セキュリティガイド](./security.md)でセキュリティ対策を確認
- [API仕様](./api.md)でAPIの使い方を学習
