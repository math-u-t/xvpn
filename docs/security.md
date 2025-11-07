# xvpn セキュリティドキュメント

このドキュメントでは、xvpnのセキュリティ設計、攻撃シナリオと防御策、運用時の注意点を説明します。

## 目次

1. [セキュリティ設計の概要](#セキュリティ設計の概要)
2. [認証とアクセス制御](#認証とアクセス制御)
3. [レート制限](#レート制限)
4. [オープンプロキシ対策](#オープンプロキシ対策)
5. [監査ログ](#監査ログ)
6. [攻撃シナリオと防御](#攻撃シナリオと防御)
7. [セキュリティチェックリスト](#セキュリティチェックリスト)
8. [法的・倫理的注意事項](#法的倫理的注意事項)

## セキュリティ設計の概要

xvpnは以下のセキュリティ原則に基づいて設計されています：

### 多層防御（Defense in Depth）

1. **認証層**: Auth0による強固な認証
2. **認可層**: JWT検証による各リクエストの検証
3. **レート制限層**: DDoS、悪用防止
4. **ドメイン制限層**: 許可されたドメインのみプロキシ
5. **監査層**: 全てのアクションをログ記録

### ゼロトラスト原則

- 全てのリクエストを検証
- ネットワーク境界を信頼しない
- 最小権限の原則

### セキュアバイデフォルト

- HTTPS必須
- 厳格な CORS 設定
- デフォルトで制限的な設定

## 認証とアクセス制御

### Auth0認証

**認証方式**:
- GitHub OAuth（推奨）
- メール認証（Passwordless または Database）

**JWT (JSON Web Token)**:
- **アルゴリズム**: RS256（RSA署名）
- **有効期限**: デフォルト24時間（Auth0設定による）
- **クレーム**:
  - `sub`: ユーザーID
  - `iss`: 発行者（Auth0ドメイン）
  - `aud`: Audience（Worker URL）
  - `exp`: 有効期限
  - `iat`: 発行時刻

**JWT検証プロセス**:

```javascript
// worker/src/index.js
async function verifyToken(token, env) {
  // 1. JWKS（公開鍵セット）を取得
  const JWKS = createRemoteJWKSet(
    new URL(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`)
  );

  // 2. トークンを検証
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://${env.AUTH0_DOMAIN}/`,  // 発行者確認
    audience: env.AUTH0_AUDIENCE,            // Audience確認
  });

  // 3. 署名、有効期限も自動チェック
  return { valid: true, userId: payload.sub, payload };
}
```

**セキュリティ上の利点**:
- 署名検証により改ざん検出
- 有効期限で自動失効
- 公開鍵方式で秘密鍵不要（Workerに秘密情報不要）
- Auth0のセキュリティベストプラクティスを活用

### アクセス制御

**エンドポイント保護**:

| エンドポイント | 認証 | 説明 |
|--------------|-----|------|
| `/health` | 不要 | ヘルスチェック（情報漏洩なし） |
| `/api` | 不要 | API情報のみ |
| `/session` | 必須 | ユーザー情報取得 |
| `/proxy` | 必須 | プロキシリクエスト |

全ての保護されたエンドポイントで：
1. `Authorization`ヘッダーの存在確認
2. Bearer形式の確認
3. JWT検証
4. ユーザーIDの抽出

### トークンの保存

**フロントエンド**:
- **保存場所**: `localStorage`（Auth0 SDK のデフォルト）
- **代替**: `sessionStorage`（よりセキュア、タブを閉じると消える）
- **XSS対策**: CSP（Content Security Policy）で緩和

**設定方法**:
```javascript
// frontend/src/main.jsx
<Auth0Provider
  cacheLocation="localstorage"  // または "memory"
  // ...
>
```

**推奨**:
- 本番環境では `memory` または `sessionStorage` を検討
- HTTPOnly Cookieは SPA では使用不可

## レート制限

### 目的

- **DDoS攻撃防止**: 大量リクエストをブロック
- **悪用防止**: 1ユーザーが過剰にリソースを使用するのを防止
- **コスト管理**: Cloudflare Workersの無料枠を守る

### 実装

**アルゴリズム**: Sliding Window Counter（スライディングウィンドウカウンター）

```javascript
// 疑似コード
async function checkRateLimit(userId) {
  const key = `ratelimit:${userId}`;
  const data = await KV.get(key);
  const now = Date.now();

  if (!data || now > data.resetAt) {
    // 新しいウィンドウ
    await KV.put(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (data.count >= MAX_REQUESTS) {
    // 制限超過
    return { allowed: false, resetAt: data.resetAt };
  }

  // カウント増加
  data.count++;
  await KV.put(key, data);
  return { allowed: true };
}
```

**設定値** (`.dev.vars`):
- `RATE_LIMIT_MAX_REQUESTS`: デフォルト 100
- `RATE_LIMIT_WINDOW_MS`: デフォルト 60000（60秒）

**推奨設定**:
- **開発**: 100 req/min
- **本番（一般ユーザー）**: 60 req/min
- **本番（プレミアムユーザー）**: 300 req/min（実装拡張が必要）

### レスポンスヘッダー

レート制限情報をクライアントに通知：

```
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000000
```

制限超過時:
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640000060000

{
  "error": "Rate limit exceeded",
  "resetAt": "2025-01-01T00:01:00Z"
}
```

## オープンプロキシ対策

### リスク

認証なしでプロキシを公開すると「オープンプロキシ」になり、以下のリスクがあります：

- **スパム送信**: メール送信に悪用
- **攻撃の踏み台**: DDoS、不正アクセスの発信元になる
- **違法コンテンツアクセス**: 匿名化ツールとして悪用
- **IPブラックリスト**: CloudflareのIPが各種ブラックリストに登録
- **法的責任**: サービス運営者が法的責任を問われる可能性

### 対策

#### 1. 認証必須

全てのプロキシリクエストにJWT認証を要求：

```javascript
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
  });
}
```

#### 2. ドメイン制限

許可されたドメインのみプロキシ：

```javascript
// .dev.vars
ALLOWED_PROXY_DOMAINS=*.wikipedia.org,*.github.com,example.com
```

ワイルドカード対応：
```javascript
function isDomainAllowed(url, allowedDomains) {
  const domains = allowedDomains.split(',').map(d => d.trim());
  const hostname = new URL(url).hostname;

  return domains.some(domain => {
    if (domain.startsWith('*.')) {
      const baseDomain = domain.slice(2);
      return hostname.endsWith(baseDomain);
    }
    return hostname === domain;
  });
}
```

**推奨設定**:
- **開発**: 制限なし（テスト用）
- **本番**: 厳格な許可リスト

**例**:
```bash
# 教育サイトのみ
ALLOWED_PROXY_DOMAINS=*.wikipedia.org,*.khanacademy.org,*.coursera.org

# 特定のAPIのみ
ALLOWED_PROXY_DOMAINS=api.example.com,api.partner.com
```

#### 3. プロトコル制限

HTTP/HTTPS のみ許可、FTP、SSH等は拒否：

```javascript
const url = new URL(targetUrl);
if (url.protocol !== 'http:' && url.protocol !== 'https:') {
  return new Response(JSON.stringify({ error: 'Protocol not allowed' }), {
    status: 400,
  });
}
```

#### 4. 監査ログ

全てのプロキシリクエストをログ記録：

```javascript
await logAuditEvent(env, {
  type: 'proxy_request',
  userId,
  targetUrl,
  method: request.method,
  timestamp: new Date().toISOString(),
});
```

ブロックされたリクエストも記録：

```javascript
await logAuditEvent(env, {
  type: 'proxy_blocked',
  userId,
  targetUrl,
  reason: 'domain_not_allowed',
  timestamp: new Date().toISOString(),
});
```

## 監査ログ

### 目的

- **セキュリティ**: 異常なアクティビティの検出
- **コンプライアンス**: 監査要件の充足
- **デバッグ**: 問題の原因特定
- **分析**: 使用パターンの理解

### ログイベント

| イベントタイプ | 説明 | ログ内容 |
|--------------|------|---------|
| `proxy_request` | プロキシリクエスト成功 | userId, targetUrl, method, timestamp |
| `proxy_blocked` | ドメイン制限でブロック | userId, targetUrl, reason, timestamp |
| `proxy_error` | プロキシエラー | userId, targetUrl, error, timestamp |
| `auth_failed` | 認証失敗 | IP, error, timestamp |

### 実装

```javascript
async function logAuditEvent(env, event) {
  try {
    const key = `audit:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    await env.AUDIT_LOG.put(key, JSON.stringify(event), {
      expirationTtl: 30 * 24 * 60 * 60, // 30日間保持
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
    // ログ失敗はリクエストを中断しない
  }
}
```

### ログの閲覧

**開発環境**:
```bash
wrangler kv:key list --namespace-id=YOUR_AUDIT_LOG_ID --prefix="audit:"
wrangler kv:key get --namespace-id=YOUR_AUDIT_LOG_ID "audit:1640000000000:abc123"
```

**本番環境**:
管理ダッシュボード（将来実装）またはAPI経由でアクセス。

### プライバシー考慮事項

- **個人情報**: URLにクエリパラメータで個人情報が含まれる可能性
- **GDPR/CCPA**: ログは個人データとして扱う
- **削除権**: ユーザーがログ削除を要求できる仕組みが必要

**推奨**:
- URLのクエリパラメータを匿名化
- センシティブなヘッダー（Cookie等）は記録しない
- 定期的なログの自動削除（30日）

## 攻撃シナリオと防御

### 1. 認証バイパス攻撃

**攻撃**: 認証なしでプロキシを使用しようとする。

**防御**:
- 全エンドポイントでJWT検証
- トークンなし/無効な場合は401エラー
- リトライアタックを防ぐためのレート制限

### 2. JWT改ざん攻撃

**攻撃**: JWTの内容を改ざんして別ユーザーになりすます。

**防御**:
- RS256署名検証（公開鍵で検証）
- Auth0のJWKSで署名検証
- 改ざんは即座に検出される

### 3. リプレイ攻撃

**攻攻**: 盗んだJWTを再利用する。

**防御**:
- JWT有効期限（exp claim）で自動失効
- 短い有効期限（推奨: 1時間〜24時間）
- HTTPS必須で盗聴を防止

**さらなる対策**（オプション）:
- JTI（JWT ID）でワンタイムトークン化
- リフレッシュトークンのローテーション

### 4. SSRF (Server-Side Request Forgery)

**攻撃**: Workerを悪用して内部ネットワークやメタデータエンドポイントにアクセス。

**例**:
```
X-Target-URL: http://169.254.169.254/latest/meta-data/
```

**防御**:
```javascript
const url = new URL(targetUrl);

// プライベートIPをブロック
const hostname = url.hostname;
if (hostname === 'localhost' || hostname === '127.0.0.1' ||
    hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
    hostname.startsWith('172.16.') || hostname === '169.254.169.254') {
  return new Response(JSON.stringify({ error: 'Access denied' }), {
    status: 403,
  });
}

// ドメイン許可リストチェック
if (!isDomainAllowed(targetUrl, env.ALLOWED_PROXY_DOMAINS)) {
  return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
    status: 403,
  });
}
```

### 5. DDoS攻撃

**攻撃**: 大量のリクエストでサービスを停止させる。

**防御**:
- レート制限（ユーザーごと）
- Cloudflareの自動DDoS防御
- レート制限超過時は429エラー

**追加対策**:
- IPベースのレート制限（将来実装）
- Cloudflare Firewall Rules

### 6. XSS (Cross-Site Scripting)

**攻撃**: フロントエンドにスクリプトを注入。

**防御**:
- React の自動エスケープ
- CSP（Content Security Policy）ヘッダー

**CSP設定** (フロントエンドホスティングで設定):
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:;
```

### 7. CORS攻撃

**攻撃**: 悪意のあるサイトからWorkerを呼び出す。

**防御**:
```javascript
const corsHeaders = (origin) => {
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',');

  if (allowedOrigins.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      // ...
    };
  }

  return {
    'Access-Control-Allow-Origin': 'null', // 拒否
  };
};
```

**重要**: `Access-Control-Allow-Origin: *` は絶対に使用しない。

## セキュリティチェックリスト

### デプロイ前

- [ ] Auth0の本番設定が完了している
- [ ] JWTの有効期限が適切（1〜24時間）
- [ ] レート制限が有効（60 req/min以下推奨）
- [ ] ドメイン許可リストが設定されている
- [ ] HTTPS必須（HTTPは拒否）
- [ ] CORS設定が厳格（特定オリジンのみ）
- [ ] 監査ログが有効
- [ ] KV Namespaceが正しく設定されている
- [ ] 環境変数が`wrangler secret`で設定されている（`.dev.vars`を本番で使わない）

### 運用中

- [ ] 監査ログを定期的に確認
- [ ] 異常なアクティビティを監視
- [ ] レート制限の調整（必要に応じて）
- [ ] Auth0のログを確認
- [ ] Cloudflareの分析を確認
- [ ] セキュリティアップデート適用

### 定期レビュー（月次）

- [ ] アクセスパターンのレビュー
- [ ] ブロックされたリクエストの分析
- [ ] ユーザーフィードバックの確認
- [ ] 依存関係のセキュリティアップデート

## 法的・倫理的注意事項

### ⚠️ 重要な警告

xvpnは**教育目的**のプロジェクトです。本番環境で使用する前に、以下を必ず確認してください。

### 法規制の遵守

1. **各国の法律**:
   - プロキシサービスは国によって規制されている場合があります
   - 特に、匿名化ツールとして使用される可能性がある場合は注意
   - 弁護士に相談することを推奨

2. **Cloudflare利用規約**:
   - [Cloudflare Terms of Service](https://www.cloudflare.com/terms/)を確認
   - プロキシサービスがWorkers利用規約に抵触しないか確認
   - 違反した場合、アカウント停止の可能性

3. **Auth0利用規約**:
   - [Auth0 Terms of Service](https://auth0.com/legal)を確認
   - 適切な使用目的であることを確認

### 責任ある使用

1. **不正アクセスの禁止**:
   - ユーザーが不正アクセスに使用しないよう利用規約を明記
   - 違反ユーザーの停止措置

2. **プライバシー保護**:
   - ユーザーのプロキシリクエスト内容を第三者と共有しない
   - ログの適切な管理
   - プライバシーポリシーの作成と公開

3. **透明性**:
   - どのようなデータを収集・保存するか明示
   - ログの保持期間を明示
   - セキュリティインシデント時の通知プロセス

### 推奨事項

1. **利用規約の作成**: 利用規約を作成し、ユーザーに同意を求める
2. **プライバシーポリシー**: GDPR、CCPA等に準拠したポリシーを作成
3. **使用制限**: 教育、開発、テスト目的に限定
4. **監視**: 悪用の兆候を監視し、迅速に対応
5. **保険**: サイバーセキュリティ保険の検討（商用の場合）

### 免責事項

このプロジェクトは「現状のまま（AS IS）」提供されます。作者は以下について一切責任を負いません：

- ユーザーによる不正使用
- サービスの中断
- データの損失
- 法的問題
- セキュリティインシデント

**使用は自己責任でお願いします。**

## インシデント対応

### セキュリティインシデント発生時

1. **検出**: 監査ログ、エラーログを確認
2. **封じ込め**: 該当ユーザーのアクセスを停止
3. **調査**: ログを詳細に分析
4. **復旧**: 影響を受けたシステムを復旧
5. **報告**: 必要に応じて当局、ユーザーに報告

### 連絡先

セキュリティ問題を発見した場合:
- GitHubのSecurity Advisoryを使用
- または security@your-domain.com に報告

## 参考資料

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Workers Security](https://developers.cloudflare.com/workers/platform/security/)
- [Auth0 Security](https://auth0.com/security)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
