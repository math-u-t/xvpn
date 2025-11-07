# xvpn トラブルシューティングガイド

このドキュメントでは、よくある問題とその解決方法を説明します。

## 目次

1. [セットアップに関する問題](#セットアップに関する問題)
2. [認証に関する問題](#認証に関する問題)
3. [プロキシに関する問題](#プロキシに関する問題)
4. [Service Workerに関する問題](#service-workerに関する問題)
5. [Workerデプロイに関する問題](#workerデプロイに関する問題)
6. [パフォーマンスに関する問題](#パフォーマンスに関する問題)
7. [デバッグ方法](#デバッグ方法)

## セットアップに関する問題

### 問題: `npm install` が失敗する

**エラー例**:
```
npm ERR! code EACCES
npm ERR! syscall access
```

**原因**: 権限の問題、または古いNode.jsバージョン。

**解決方法**:

1. **Node.jsバージョン確認**:
   ```bash
   node --version  # v18.0.0以上が必要
   ```

   古い場合は[Node.js](https://nodejs.org/)から最新LTSをインストール。

2. **npmキャッシュクリア**:
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **権限の問題（Linux/Mac）**:
   ```bash
   sudo chown -R $USER:$USER ~/.npm
   sudo chown -R $USER:$USER .
   ```

---

### 問題: `wrangler` コマンドが見つからない

**エラー例**:
```
bash: wrangler: command not found
```

**原因**: wranglerがインストールされていない。

**解決方法**:

```bash
cd worker
npm install  # ローカルインストール

# または
npx wrangler --version  # npx経由で実行

# グローバルインストール（オプション）
npm install -g wrangler
```

---

### 問題: 環境変数が読み込まれない

**症状**: アプリが動作するが、Auth0やWorkerに接続できない。

**原因**: `.env`ファイルが正しく設定されていない。

**解決方法**:

1. **ファイルの存在確認**:
   ```bash
   ls frontend/.env
   ls worker/.dev.vars
   ```

2. **ファイルの内容確認**:
   ```bash
   cat frontend/.env
   # VITE_AUTH0_DOMAIN=... が設定されているか確認
   ```

3. **Viteの再起動**:
   環境変数変更後は開発サーバーを再起動：
   ```bash
   cd frontend
   npm run dev
   ```

4. **変数名の確認**:
   Viteでは`VITE_`プレフィックスが必須：
   ```bash
   # ✅ 正しい
   VITE_AUTH0_DOMAIN=...

   # ❌ 間違い
   AUTH0_DOMAIN=...
   ```

---

## 認証に関する問題

### 問題: ログインボタンをクリックしても何も起こらない

**症状**: ログインボタンをクリックしてもAuth0のログイン画面に遷移しない。

**原因**: Auth0設定またはネットワークの問題。

**解決方法**:

1. **ブラウザのコンソール確認**:
   開発者ツール（F12）でエラーを確認。

2. **Auth0設定確認**:
   ```javascript
   // frontend/.env
   VITE_AUTH0_DOMAIN=your-tenant.auth0.com  // 正しいドメイン?
   VITE_AUTH0_CLIENT_ID=...  // 正しいClient ID?
   ```

3. **ネットワーク確認**:
   開発者ツールのNetworkタブで、Auth0へのリクエストが失敗していないか確認。

4. **Callback URL確認**:
   Auth0ダッシュボード → Application → Settings → Allowed Callback URLs:
   ```
   http://localhost:5173,
   http://localhost:5173/callback
   ```

---

### 問題: ログイン後に「Error: redirect_uri_mismatch」

**エラー例**:
```
error: redirect_uri_mismatch
error_description: The redirect URI is wrong
```

**原因**: Auth0のCallback URLが一致しない。

**解決方法**:

1. **Auth0設定を確認**:
   Auth0ダッシュボード → Application → Settings → Allowed Callback URLs

   以下を追加：
   ```
   http://localhost:5173
   http://localhost:5173/callback
   ```

2. **Save Changes**をクリック。

3. **アプリを再起動**。

---

### 問題: 「401 Unauthorized」エラー

**症状**: ログイン後、Workerへのリクエストが401エラー。

**原因**: JWTトークンの検証失敗。

**解決方法**:

1. **Worker環境変数確認**:
   ```bash
   # worker/.dev.vars
   AUTH0_DOMAIN=your-tenant.auth0.com  # 正しいか?
   AUTH0_AUDIENCE=...  # 正しいAudience?
   ```

2. **トークンの確認**:
   ブラウザのコンソールで：
   ```javascript
   const token = localStorage.getItem('@@auth0spajs@@::YOUR_CLIENT_ID::default::openid profile email');
   console.log(token);
   ```

   トークンが存在するか確認。

3. **Auth0 API設定確認**:
   Auth0ダッシュボード → APIs → xvpn API → Identifier

   `VITE_AUTH0_AUDIENCE`と一致しているか確認。

4. **ログの確認**:
   ```bash
   cd worker
   wrangler tail
   ```

   Workerのログでエラー詳細を確認。

---

### 問題: トークンの有効期限切れ

**エラー例**:
```
{
  "error": "Invalid token",
  "details": "jwt expired"
}
```

**原因**: JWTの有効期限切れ。

**解決方法**:

1. **再ログイン**: ログアウトして再度ログイン。

2. **Auth0のトークン有効期限確認**:
   Auth0ダッシュボード → APIs → xvpn API → Settings → Token Expiration

3. **自動リフレッシュ**:
   Auth0 React SDKは自動的にトークンをリフレッシュします。エラーが頻発する場合は、SDKの設定を確認。

---

## プロキシに関する問題

### 問題: プロキシが動作しない

**症状**: プロキシを有効化してもリクエストがプロキシされない。

**解決方法**:

1. **Service Workerの登録確認**:
   ブラウザのコンソールで：
   ```javascript
   navigator.serviceWorker.getRegistrations()
     .then(regs => console.log('Registrations:', regs));
   ```

   Service Workerが登録されているか確認。

2. **プロキシ有効化確認**:
   「プロキシを有効化」ボタンをクリックしたか確認。

3. **Worker URL確認**:
   ```javascript
   // frontend/.env
   VITE_WORKER_URL=http://localhost:8787  # ローカル開発時
   ```

   Workerが起動しているか確認：
   ```bash
   curl http://localhost:8787/health
   ```

4. **ドメイン許可リスト確認**:
   ```bash
   # worker/.dev.vars
   ALLOWED_PROXY_DOMAINS=*.wikipedia.org,*.example.com
   ```

   プロキシ先がリストに含まれているか確認。

---

### 問題: 「403 Forbidden: Domain not allowed」

**症状**: プロキシリクエストが403エラー。

**原因**: ドメインが許可リストにない。

**解決方法**:

1. **許可リストに追加**:
   ```bash
   # worker/.dev.vars
   ALLOWED_PROXY_DOMAINS=*.wikipedia.org,*.github.com,example.com
   ```

   ワイルドカード（`*.`）も使用可能。

2. **Workerを再起動**:
   ```bash
   cd worker
   npm run dev
   ```

---

### 問題: 「429 Too Many Requests」

**症状**: 頻繁に429エラーが発生。

**原因**: レート制限超過。

**解決方法**:

1. **待機**: `X-RateLimit-Reset`のタイムスタンプまで待機。

2. **レート制限の調整**（開発環境のみ）:
   ```bash
   # worker/.dev.vars
   RATE_LIMIT_MAX_REQUESTS=200  # デフォルト: 100
   RATE_LIMIT_WINDOW_MS=60000   # 60秒
   ```

3. **リクエストの最適化**: 不必要なリクエストを減らす。

---

### 問題: CORSエラー

**エラー例**:
```
Access to fetch at 'https://api.example.com' from origin 'http://localhost:5173' has been blocked by CORS policy
```

**原因**: ブラウザのCORS制限。

**解決方法**:

1. **現実を受け入れる**: xvpnでもCORS制限は完全には回避できません。

2. **Worker側でヘッダー追加**（限定的）:
   Worker側で`Access-Control-Allow-Origin`を追加していますが、元のサイトのポリシーによっては効果がありません。

3. **代替案**:
   - CORS対応のAPIを使用
   - 開発時はブラウザのCORS無効化（セキュリティリスクあり）
   - ブラウザ拡張機能を開発

---

### 問題: 混合コンテンツエラー

**エラー例**:
```
Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an insecure resource 'http://...'
```

**原因**: HTTPSページからHTTPリソースをロード。

**解決方法**:

1. **HTTPSのみ使用**: プロキシ先もHTTPSにする。

2. **Worker側でアップグレード**（実装が必要）:
   HTTP→HTTPSにリダイレクトを試みる。

3. **制限を理解**: これはブラウザのセキュリティ機能であり、完全な回避は不可能。

---

## Service Workerに関する問題

### 問題: Service Worker registration failed

**エラー例**:
```
Failed to register a ServiceWorker: A bad HTTP response code (404) was received when fetching the script.
```

**原因**: Service Workerファイルが見つからない。

**解決方法**:

1. **ファイルの存在確認**:
   ```bash
   ls frontend/public/service-worker.js
   ```

2. **パスの確認**:
   ```javascript
   // frontend/src/App.jsx
   navigator.serviceWorker.register('/service-worker.js')
   ```

   `/service-worker.js`は`public/`フォルダ内のファイルを指します。

3. **Vite設定確認**:
   `vite.config.js`で`public`フォルダが正しく設定されているか確認。

---

### 問題: Service Worker が更新されない

**症状**: コードを変更してもService Workerが古いまま。

**原因**: Service Workerは積極的にキャッシュされる。

**解決方法**:

1. **手動更新**:
   開発者ツール → Application → Service Workers → "Update"ボタン

2. **登録解除**:
   開発者ツール → Application → Service Workers → "Unregister"

   その後、ページをリロード。

3. **スキップウェイティング**:
   Service Workerに以下を追加（既に実装済み）：
   ```javascript
   self.addEventListener('install', (event) => {
     self.skipWaiting();
   });
   ```

4. **ハードリロード**:
   Ctrl+Shift+R（Windows/Linux）または Cmd+Shift+R（Mac）

---

### 問題: Service Worker がHTTPで動作しない

**症状**: HTTPSではService Workerが動作するが、HTTPでは動作しない。

**原因**: Service WorkerはHTTPS必須（localhost除く）。

**解決方法**:

1. **ローカル開発**: `localhost`を使用（HTTPでも動作）。

2. **本番**: 必ずHTTPSを使用。

3. **テスト**: ngrok等でHTTPSトンネルを作成：
   ```bash
   npx ngrok http 5173
   ```

---

## Workerデプロイに関する問題

### 問題: `wrangler login` が失敗する

**症状**: ブラウザが開かない、または認証が完了しない。

**解決方法**:

1. **APIトークンを使用**:
   ```bash
   export CLOUDFLARE_API_TOKEN=your_token
   wrangler deploy
   ```

2. **ブラウザを手動で開く**:
   ターミナルに表示されるURLを手動でブラウザで開く。

---

### 問題: デプロイ時に「Invalid KV Namespace」

**エラー例**:
```
Error: Invalid KV namespace binding
```

**原因**: KV NamespaceのIDが正しくない。

**解決方法**:

1. **KV Namespaceを作成**:
   ```bash
   wrangler kv:namespace create "RATE_LIMIT"
   wrangler kv:namespace create "SESSIONS"
   wrangler kv:namespace create "AUDIT_LOG"
   ```

2. **wrangler.tomlに設定**:
   出力されたIDを`wrangler.toml`にコピー：
   ```toml
   [[kv_namespaces]]
   binding = "RATE_LIMIT"
   id = "abc123..."
   ```

3. **preview IDも設定**:
   ```bash
   wrangler kv:namespace create "RATE_LIMIT" --preview
   ```

---

### 問題: デプロイ後、環境変数が設定されていない

**症状**: デプロイは成功するが、Workerが環境変数を読めない。

**原因**: `.dev.vars`はローカルのみ。本番では`wrangler secret`を使用。

**解決方法**:

```bash
cd worker

wrangler secret put AUTH0_DOMAIN
# プロンプトで値を入力

wrangler secret put AUTH0_AUDIENCE
wrangler secret put ALLOWED_ORIGINS
# ... 他の環境変数も同様に
```

---

## パフォーマンスに関する問題

### 問題: プロキシが非常に遅い

**症状**: リクエストに数秒かかる。

**原因**: ネットワークレイテンシ、Worker処理時間。

**解決方法**:

1. **ネットワーク確認**:
   開発者ツールのNetworkタブで各リクエストの時間を確認。

2. **Worker ログ確認**:
   ```bash
   wrangler tail
   ```

   CPU時間を確認。

3. **キャッシング実装**（将来の改善）:
   よく使うリソースをKVにキャッシュ。

4. **地理的な問題**:
   Cloudflare Workersは最寄りのエッジで実行されますが、プロキシ先が遠い場合は遅くなります。

---

### 問題: 大きなファイルのダウンロードが失敗する

**症状**: 動画や大きな画像のプロキシが失敗。

**原因**: Cloudflare WorkersのCPU時間制限（50ms）。

**解決方法**:

1. **ストリーミング処理**（実装が必要）:
   レスポンスをストリームで処理。

2. **直接アクセス**:
   大きなファイルはプロキシせず、直接アクセス。

3. **制限を理解**:
   xvpnは大きなファイル転送には適していません。

---

## デバッグ方法

### ブラウザのデバッグ

1. **開発者ツールを開く**: F12またはCmd+Opt+I

2. **コンソールタブ**:
   JavaScriptエラー、ログを確認。

3. **Networkタブ**:
   HTTPリクエストを確認：
   - リクエストURL
   - ステータスコード
   - レスポンス内容
   - タイミング

4. **Applicationタブ**:
   - Service Workers: 登録状態、ログ
   - Local Storage: Auth0トークン確認
   - Console: Service Workerのログ

---

### Workerのデバッグ

1. **ローカルログ**:
   ```bash
   cd worker
   npm run dev
   ```

   ターミナルにログが出力されます。

2. **リモートログ（本番）**:
   ```bash
   wrangler tail
   ```

   リアルタイムでログを表示。

3. **console.log追加**:
   ```javascript
   // worker/src/index.js
   console.log('Debug:', { userId, targetUrl });
   ```

4. **Cloudflareダッシュボード**:
   Workers → xvpn-worker → Logs

---

### Auth0のデバッグ

1. **Auth0ログ**:
   Auth0ダッシュボード → Monitoring → Logs

   認証の成功・失敗を確認。

2. **Real-time Webtask Logs**:
   リアルタイムでAuth0のイベントを表示。

---

### curl でのテスト

**ヘルスチェック**:
```bash
curl https://xvpn-worker.your-subdomain.workers.dev/health
```

**セッション情報**（トークン必要）:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://xvpn-worker.your-subdomain.workers.dev/session
```

**プロキシテスト**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "X-Target-URL: https://api.github.com/users/octocat" \
     https://xvpn-worker.your-subdomain.workers.dev/proxy
```

---

## それでも解決しない場合

1. **ドキュメントを確認**:
   - [setup.md](./setup.md)
   - [architecture.md](./architecture.md)
   - [faq.md](./faq.md)

2. **GitHub Issuesを検索**:
   同じ問題がないか確認。

3. **新しいIssueを作成**:
   以下の情報を含めてください：
   - OS、ブラウザ、Node.jsバージョン
   - エラーメッセージ
   - 再現手順
   - 試した解決方法

4. **ログを提供**:
   - ブラウザのコンソールログ
   - Workerのログ
   - Auth0のログ

---

## デバッグチェックリスト

問題が発生したら、以下を確認してください：

- [ ] Node.js v18以上を使用している
- [ ] `npm install`が成功している
- [ ] 環境変数（`.env`, `.dev.vars`）が正しく設定されている
- [ ] Auth0のCallback URLsが正しい
- [ ] Workerが起動している（`wrangler dev`）
- [ ] Frontendが起動している（`npm run dev`）
- [ ] ブラウザのコンソールにエラーがない
- [ ] Service Workerが登録されている
- [ ] プロキシが有効化されている
- [ ] ログインしている
- [ ] ドメインが許可リストにある

---

デバッグは難しいですが、一歩ずつ問題を切り分けていけば必ず解決できます。頑張ってください！
