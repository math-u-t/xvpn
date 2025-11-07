# xvpn API ドキュメント

このドキュメントでは、Cloudflare WorkerのREST API仕様と使用例を説明します。

## 目次

1. [API概要](#api概要)
2. [認証](#認証)
3. [エンドポイント](#エンドポイント)
4. [エラーハンドリング](#エラーハンドリング)
5. [使用例](#使用例)
6. [OpenAPI仕様](#openapi仕様)

## API概要

### ベースURL

**ローカル開発**:
```
http://localhost:8787
```

**本番環境**:
```
https://xvpn-worker.your-subdomain.workers.dev
```

### プロトコル

- **本番**: HTTPS必須
- **ローカル**: HTTPも可（開発のみ）

### コンテンツタイプ

- **リクエスト**: `application/json` または指定なし
- **レスポンス**: `application/json`

### レート制限

- **デフォルト**: 100リクエスト/分/ユーザー
- **レスポンスヘッダー**:
  ```
  X-RateLimit-Remaining: 95
  X-RateLimit-Reset: 1640000060000
  ```

## 認証

### JWT Bearer Token

全ての保護されたエンドポイントはJWT Bearer認証を要求します。

**ヘッダー**:
```
Authorization: Bearer <access_token>
```

**トークン取得**:
Auth0から取得（フロントエンドSDKが自動処理）。

**有効期限**:
通常24時間（Auth0設定による）。

**検証**:
- 署名（RS256）
- 発行者（Issuer）
- Audience
- 有効期限（exp）

## エンドポイント

### 1. ヘルスチェック

システムの稼働状態を確認します。

**エンドポイント**: `GET /health`

**認証**: 不要

**レスポンス**:
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

**ステータスコード**:
- `200 OK`: 正常

**curl例**:
```bash
curl https://xvpn-worker.your-subdomain.workers.dev/health
```

---

### 2. API情報

APIの基本情報とエンドポイント一覧を取得します。

**エンドポイント**: `GET /` または `GET /api`

**認証**: 不要

**レスポンス**:
```json
{
  "name": "xvpn-worker",
  "version": "1.0.0",
  "endpoints": {
    "health": "/health",
    "proxy": "/proxy",
    "session": "/session"
  }
}
```

**ステータスコード**:
- `200 OK`: 正常

**curl例**:
```bash
curl https://xvpn-worker.your-subdomain.workers.dev/api
```

---

### 3. セッション情報

認証済みユーザーのセッション情報を取得します。

**エンドポイント**: `GET /session`

**認証**: 必要

**リクエストヘッダー**:
```
Authorization: Bearer <access_token>
```

**レスポンス**:
```json
{
  "userId": "auth0|123456789",
  "email": "user@example.com",
  "emailVerified": true,
  "rateLimit": {
    "remaining": 95
  }
}
```

**レスポンスヘッダー**:
```
X-RateLimit-Remaining: 95
```

**ステータスコード**:
- `200 OK`: 正常
- `401 Unauthorized`: 認証失敗
- `429 Too Many Requests`: レート制限超過

**curl例**:
```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://xvpn-worker.your-subdomain.workers.dev/session
```

**エラー例**（401）:
```json
{
  "error": "Invalid token",
  "details": "jwt expired"
}
```

---

### 4. プロキシリクエスト

外部サイトへのHTTP/HTTPSリクエストをプロキシします。

**エンドポイント**: `GET /proxy` または `POST /proxy`

**認証**: 必要

**リクエストヘッダー**:
```
Authorization: Bearer <access_token>
X-Target-URL: <target_url>
Content-Type: application/json (POSTの場合)
```

**リクエストパラメータ**:

| パラメータ | 場所 | 必須 | 説明 |
|-----------|------|------|------|
| `X-Target-URL` | Header | Yes | プロキシ先のURL |
| `Authorization` | Header | Yes | Bearer トークン |
| Body | Body | No | POSTの場合のリクエストボディ |

**レスポンス**:
プロキシ先のレスポンスをそのまま返却。

**レスポンスヘッダー**:
```
X-Proxied-By: xvpn
X-RateLimit-Remaining: 94
```

**ステータスコード**:
- `200-299`: プロキシ先のステータス
- `400 Bad Request`: X-Target-URLヘッダー不正
- `401 Unauthorized`: 認証失敗
- `403 Forbidden`: ドメイン未許可
- `429 Too Many Requests`: レート制限超過
- `502 Bad Gateway`: プロキシ先エラー

**curl例（GET）**:
```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "X-Target-URL: https://api.github.com/users/octocat" \
     https://xvpn-worker.your-subdomain.workers.dev/proxy
```

**curl例（POST）**:
```bash
curl -X POST \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "X-Target-URL: https://api.example.com/data" \
     -H "Content-Type: application/json" \
     -d '{"key":"value"}' \
     https://xvpn-worker.your-subdomain.workers.dev/proxy
```

**エラー例（400）**:
```json
{
  "error": "X-Target-URL header is required"
}
```

**エラー例（403）**:
```json
{
  "error": "Domain not allowed"
}
```

**エラー例（502）**:
```json
{
  "error": "Proxy request failed",
  "details": "ECONNREFUSED"
}
```

---

## エラーハンドリング

### エラーレスポンス形式

全てのエラーレスポンスは以下の形式：

```json
{
  "error": "エラーの説明",
  "details": "詳細情報（オプション）"
}
```

### 一般的なエラー

#### 400 Bad Request

リクエストが不正な場合。

**原因**:
- 必須ヘッダー不足
- 不正なURL形式
- 不正なJSON

**対処**:
- リクエストパラメータを確認
- ヘッダーを確認

#### 401 Unauthorized

認証失敗。

**原因**:
- トークンが無効
- トークンの有効期限切れ
- 署名検証失敗

**対処**:
- Auth0から新しいトークンを取得
- トークンの形式を確認（`Bearer <token>`）

#### 403 Forbidden

アクセス拒否。

**原因**:
- ドメインが許可リストにない
- プライベートIPへのアクセス試行

**対処**:
- `ALLOWED_PROXY_DOMAINS`にドメインを追加
- 管理者に連絡

#### 429 Too Many Requests

レート制限超過。

**原因**:
- 短時間に多数のリクエスト

**対処**:
- `X-RateLimit-Reset`まで待機
- リクエスト頻度を減らす

**レスポンス例**:
```json
{
  "error": "Rate limit exceeded",
  "resetAt": "2025-01-01T00:01:00Z"
}
```

**ヘッダー**:
```
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640000060000
```

#### 502 Bad Gateway

プロキシ先のエラー。

**原因**:
- プロキシ先サーバーがダウン
- ネットワークエラー
- タイムアウト

**対処**:
- プロキシ先URLを確認
- 後で再試行

## 使用例

### JavaScript (Fetch API)

```javascript
// セッション情報取得
async function getSession(accessToken) {
  const response = await fetch('https://xvpn-worker.your-subdomain.workers.dev/session', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

// プロキシリクエスト（GET）
async function proxyGet(accessToken, targetUrl) {
  const response = await fetch('https://xvpn-worker.your-subdomain.workers.dev/proxy', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Target-URL': targetUrl,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return await response.text(); // または .json()
}

// プロキシリクエスト（POST）
async function proxyPost(accessToken, targetUrl, data) {
  const response = await fetch('https://xvpn-worker.your-subdomain.workers.dev/proxy', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Target-URL': targetUrl,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return await response.json();
}

// 使用例
const token = 'YOUR_ACCESS_TOKEN';

// セッション情報
getSession(token)
  .then(session => console.log('Session:', session))
  .catch(error => console.error('Error:', error));

// プロキシGET
proxyGet(token, 'https://api.github.com/users/octocat')
  .then(data => console.log('Data:', data))
  .catch(error => console.error('Error:', error));

// プロキシPOST
proxyPost(token, 'https://api.example.com/data', { key: 'value' })
  .then(data => console.log('Response:', data))
  .catch(error => console.error('Error:', error));
```

### Python (requests)

```python
import requests

ACCESS_TOKEN = 'YOUR_ACCESS_TOKEN'
BASE_URL = 'https://xvpn-worker.your-subdomain.workers.dev'

headers = {
    'Authorization': f'Bearer {ACCESS_TOKEN}',
}

# セッション情報
response = requests.get(f'{BASE_URL}/session', headers=headers)
print(response.json())

# プロキシGET
proxy_headers = headers.copy()
proxy_headers['X-Target-URL'] = 'https://api.github.com/users/octocat'

response = requests.get(f'{BASE_URL}/proxy', headers=proxy_headers)
print(response.text)

# プロキシPOST
proxy_headers['Content-Type'] = 'application/json'
proxy_headers['X-Target-URL'] = 'https://api.example.com/data'

response = requests.post(
    f'{BASE_URL}/proxy',
    headers=proxy_headers,
    json={'key': 'value'}
)
print(response.json())
```

### Node.js (axios)

```javascript
const axios = require('axios');

const ACCESS_TOKEN = 'YOUR_ACCESS_TOKEN';
const BASE_URL = 'https://xvpn-worker.your-subdomain.workers.dev';

// セッション情報
axios.get(`${BASE_URL}/session`, {
  headers: {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
  },
})
  .then(response => console.log(response.data))
  .catch(error => console.error(error.response.data));

// プロキシGET
axios.get(`${BASE_URL}/proxy`, {
  headers: {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'X-Target-URL': 'https://api.github.com/users/octocat',
  },
})
  .then(response => console.log(response.data))
  .catch(error => console.error(error.response.data));

// プロキシPOST
axios.post(
  `${BASE_URL}/proxy`,
  { key: 'value' },
  {
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'X-Target-URL': 'https://api.example.com/data',
      'Content-Type': 'application/json',
    },
  }
)
  .then(response => console.log(response.data))
  .catch(error => console.error(error.response.data));
```

## OpenAPI仕様

完全なOpenAPI 3.0仕様は [openapi.yaml](../openapi.yaml) を参照してください。

### スキーマ概要

**主要なスキーマ**:

#### HealthResponse
```yaml
type: object
properties:
  status:
    type: string
    example: ok
  timestamp:
    type: string
    format: date-time
```

#### SessionResponse
```yaml
type: object
properties:
  userId:
    type: string
  email:
    type: string
    format: email
  emailVerified:
    type: boolean
  rateLimit:
    type: object
    properties:
      remaining:
        type: integer
```

#### ErrorResponse
```yaml
type: object
properties:
  error:
    type: string
  details:
    type: string
```

## ベストプラクティス

### 1. トークンの管理

- トークンを安全に保存（`localStorage`より`sessionStorage`推奨）
- 有効期限切れを適切にハンドリング
- Auth0 SDKの自動リフレッシュ機能を活用

### 2. エラーハンドリング

- 全てのリクエストで`try-catch`を使用
- ステータスコードに応じた適切な処理
- ユーザーにわかりやすいエラーメッセージ

### 3. レート制限の考慮

- `X-RateLimit-Remaining`ヘッダーを監視
- 429エラー時は`X-RateLimit-Reset`まで待機
- バックオフ戦略を実装

### 4. セキュリティ

- HTTPS必須（本番環境）
- トークンをURLパラメータに含めない
- CORSエラーを無視しない（セキュリティ警告の可能性）

## サポート

API関連の問題:
- [トラブルシューティング](./troubleshooting.md)を確認
- [FAQ](./faq.md)を確認
- GitHubのissueを作成

## バージョニング

現在のバージョン: `v1.0.0`

破壊的変更がある場合は、メジャーバージョンを更新します。
