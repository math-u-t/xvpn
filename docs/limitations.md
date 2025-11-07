# xvpn 技術的制限事項

このドキュメントでは、ブラウザベースVPN（プロキシ）の技術的制限、ブラウザの制約、代替案を説明します。

## 目次

1. [概要](#概要)
2. [プロトコル制限](#プロトコル制限)
3. [ブラウザの制約](#ブラウザの制約)
4. [パフォーマンス制限](#パフォーマンス制限)
5. [Cloudflare Workers の制限](#cloudflare-workers-の制限)
6. [セキュリティ上の制限](#セキュリティ上の制限)
7. [代替案と回避策](#代替案と回避策)

## 概要

xvpnは「ブラウザで動作するVPN」を目指していますが、正確には**HTTP/HTTPSプロキシ**です。真のVPNとは異なる点があります。

### 真のVPNとの違い

| 機能 | 真のVPN | xvpn |
|------|---------|------|
| OSレベルのトラフィック | ✅ 全て | ❌ ブラウザのみ |
| TCP/UDPサポート | ✅ | ❌ |
| アプリケーション間共有 | ✅ | ❌ |
| DNSトンネリング | ✅ | ❌ |
| WebSocket | ✅ | ❌（現在未対応） |
| HTTP/HTTPS | ✅ | ✅ |

**xvpnは「ブラウザ内HTTPプロキシ」として機能します。**

## プロトコル制限

### サポートされるプロトコル

- ✅ HTTP
- ✅ HTTPS

### サポートされないプロトコル

- ❌ WebSocket (`ws://`, `wss://`)
- ❌ WebRTC
- ❌ Server-Sent Events (SSE)
- ❌ FTP
- ❌ SSH
- ❌ その他のTCP/UDPプロトコル

### WebSocketについて

**現在の状態**: WebSocketはService Workerで完全にサポートされていません。

**技術的理由**:
1. Service WorkerのFetch APIはWebSocketのアップグレードリクエストをインターセプトできない
2. `new WebSocket(url)` はService Workerを経由しない

**将来の対応**:
Cloudflare Workers Durable Objectsを使用してWebSocketプロキシを実装可能。しかし：
- 実装が複雑
- コストが高い（Durable Objectsは従量課金）
- ブラウザ側の対応が必要

### Server-Sent Events (SSE)

**現在の状態**: 理論的にはサポート可能だが、テストが必要。

**問題点**:
- 長時間接続の維持
- Cloudflare Workers の CPU 時間制限（50ms/リクエスト）

## ブラウザの制約

### 1. 混合コンテンツ（Mixed Content）

**問題**: HTTPSページからHTTPリソースをロードできない。

**シナリオ**:
```
https://your-app.com (HTTPS)
  ↓ Service Worker経由でプロキシ
http://example.com (HTTP)
```

**結果**: ブラウザがブロック（セキュリティポリシー）

**回避策**:
- HTTPSのみをプロキシ対象にする
- または、Worker側でHTTP→HTTPSアップグレードを試みる（可能な場合）

**現在の実装**: HTTPもサポートしているが、HTTPSページからは使用できない

### 2. CORS (Cross-Origin Resource Sharing)

**問題**: Service WorkerでプロキシしてもCORS制限は残る。

**理由**: CORSはブラウザのセキュリティ機能で、レスポンスを読む前にチェックされる。

**例**:
```javascript
// JavaScript から
fetch('https://api.example.com/data')

// Service Worker が https://worker.dev/proxy にプロキシ
// → レスポンスが返ってくる
// → ブラウザが CORS ヘッダーをチェック
// → CORS エラー（api.example.com が許可していない場合）
```

**現状**: 完全な回避は不可能。

**部分的回避策**:
- Worker側でCORSヘッダーを追加（`Access-Control-Allow-Origin`等）
- ただし、元のサイトのセキュリティポリシーを迂回することは倫理的に問題

**推奨**: CORS制限を尊重し、許可されたAPIのみ使用

### 3. Cookie と認証

**問題**: プロキシ経由のリクエストは元のドメインのCookieを送信しない。

**理由**: Service Workerが新しいリクエスト（Worker宛）を作成するため、元のドメインのCookieは含まれない。

**影響**:
- ログインが必要なサイトは動作しない
- セッション管理ができない

**回避策**:
- 認証トークンを手動で付与（`Authorization`ヘッダー）
- ただし、多くのサイトはCookieベース認証を使用

### 4. Same-Origin Policy

**問題**: Service Workerは同じオリジンのリクエストしか完全に制御できない。

**現在の実装**: 外部オリジンも一部インターセプト可能だが、制限あり。

### 5. ブラウザの制限

#### Service Worker のスコープ

**問題**: Service Workerは登録されたスコープ内のみ動作。

**例**:
```javascript
// https://your-app.com/ で登録
navigator.serviceWorker.register('/service-worker.js');

// https://your-app.com/page でのみ動作
// 他のタブやウィンドウには影響しない
```

**影響**: xvpnはアプリを開いているタブのみで動作。

#### プライベートモード

**問題**: 一部ブラウザでService Workerが制限される。

**Safari**: プライベートブラウジングでService Worker無効。

### 6. DNS解決

**問題**: ブラウザ（およびService Worker）はDNS解決を直接制御できない。

**影響**:
- カスタムDNSサーバーを使用不可
- DNSベースのフィルタリング回避不可
- DNS-over-HTTPS（DoH）の制御不可

**真のVPNとの違い**: 真のVPNはDNSトラフィックもトンネリング可能。

## パフォーマンス制限

### 1. レイテンシ（遅延）

**通常のリクエスト**:
```
ブラウザ → 外部サイト
(1ホップ)
```

**xvpn経由**:
```
ブラウザ → Service Worker → Cloudflare Worker → 外部サイト
(3ホップ + 2つの処理)
```

**影響**: 数十〜数百ミリ秒の遅延が追加される。

**緩和策**:
- Cloudflare Workersはエッジで実行（低レイテンシ）
- 地理的に近いエッジで処理

### 2. 帯域幅

**Cloudflare Workers の制限**:
- **無料プラン**: 10ms CPU時間/リクエスト
- **有料プラン**: 50ms CPU時間/リクエスト

**影響**:
- 大きなファイル（動画、大きな画像等）のプロキシは困難
- ストリーミング処理で緩和可能だが複雑

### 3. リクエスト数

**Cloudflare Workers の無料枠**:
- 100,000 リクエスト/日

**超過後**: 従量課金（$0.50 / 100万リクエスト）

**xvpnのレート制限**: 100 リクエスト/分/ユーザー（デフォルト）

## Cloudflare Workers の制限

### 1. CPU時間

**制限**: 50ms/リクエスト（有料）、10ms（無料）

**影響**:
- 複雑な処理は不可
- 大きなレスポンスの処理に時間がかかる

### 2. メモリ

**制限**: 128MB/リクエスト

**影響**: 大きなファイルをメモリに読み込めない

**回避策**: ストリーミング処理

### 3. リクエストサイズ

**制限**: 100MB/リクエスト

**影響**: 100MB以上のファイルアップロードは不可

### 4. KV Storage

**読み取り**:
- **無料**: 100,000 read/日
- **有料**: $0.50 / 100万 read

**書き込み**:
- **無料**: 1,000 write/日
- **有料**: $5.00 / 100万 write

**影響**: 監査ログ、レート制限で書き込みが多い場合、無料枠を超える可能性。

### 5. WebSocket制限

**無料プラン**: WebSocket未対応

**有料プラン（Durable Objects）**: 対応だが追加料金

## セキュリティ上の制限

### 1. エンドツーエンド暗号化の欠如

**問題**: xvpn経由のトラフィックはCloudflare Workerで復号化される。

**影響**:
- Cloudflare（および運営者）が理論的にトラフィックを見れる
- 真のVPNのようなエンドツーエンド暗号化ではない

**緩和策**:
- HTTPSを使用（ブラウザ→Worker、Worker→外部サイト）
- ログに機密情報を記録しない

### 2. プロキシチェーン

**問題**: 複数のプロキシを経由できない（現在の実装）。

**影響**: 匿名性の向上が困難。

### 3. IP匿名化

**問題**: 外部サイトにはCloudflareのIPが見える。

**メリット**: ユーザーの実IPは隠される。

**デメリット**: Cloudflare IPは既知のため、プロキシ使用が検出される可能性。

## 代替案と回避策

### 1. ブラウザ拡張機能

**メリット**:
- より深いブラウザ統合
- `webRequest` APIでより強力な制御
- Cookie、認証の処理が可能

**デメリット**:
- インストールが必要
- ブラウザごとに開発が必要
- ストア審査が必要

**推奨**: 本格的なプロキシが必要な場合は拡張機能を検討。

### 2. ネイティブアプリ

**メリット**:
- OSレベルのVPN
- 全てのアプリケーションに影響
- TCP/UDPサポート
- DNS制御

**デメリット**:
- 開発が複雑
- プラットフォームごとに開発
- インストールが必要

**推奨**: 真のVPNが必要な場合。

### 3. 既存のVPNサービス

**メリット**:
- プロフェッショナルなセキュリティ
- 高速
- サポートあり

**デメリット**:
- 有料（多くの場合）
- サービスプロバイダーを信頼する必要

**推奨**: 日常使用にはWireGuard、OpenVPN等の確立されたVPNを使用。

### 4. Cloudflare WARP

**メリット**:
- Cloudflareの公式VPNサービス
- 無料プランあり
- 高速

**デメリット**:
- カスタマイズ性が低い

**推奨**: Cloudflareエコシステムを使う場合。

## xvpnの適切な使用シーン

### ✅ 適している用途

1. **教育・学習**: VPN/プロキシの仕組みを学ぶ
2. **開発・テスト**: APIのテスト、CORS回避（開発時のみ）
3. **軽量なプロキシ**: 特定のHTTP/HTTPS APIへのアクセス
4. **デモ・プロトタイプ**: コンセプト実証

### ❌ 適していない用途

1. **プライバシー保護**: 真のVPNを使用
2. **大量データ転送**: 動画ストリーミング等
3. **WebSocketアプリ**: チャット、リアルタイムゲーム等
4. **本格的な匿名化**: Torや専用サービスを使用
5. **商用サービス**: 法的リスク、スケーラビリティ問題

## 将来の改善案

### 短期（実装可能）

1. **レスポンスキャッシング**: よく使うリソースをKVにキャッシュ
2. **圧縮**: gzip/brotli圧縮でデータ量削減
3. **並列リクエスト**: 複数リクエストを並列処理

### 中期（Durable Objects使用）

1. **WebSocketサポート**: Durable Objectsで実装
2. **セッション管理**: 長時間接続の維持
3. **キャッシュ最適化**: より高度なキャッシング

### 長期（大規模改造）

1. **ブラウザ拡張版**: より強力な機能
2. **ネイティブエージェント**: OSレベルVPN
3. **分散プロキシ**: 複数のCloudflare Workersをチェーン

## まとめ

xvpnは**教育目的のブラウザHTTP/HTTPSプロキシ**です。以下を理解した上で使用してください：

- 真のVPNではない
- WebSocket等の高度なプロトコルは未対応
- ブラウザのセキュリティ制約は回避できない
- プライバシー保護には限界がある
- 本番環境での使用には追加の考慮が必要

**目的に応じて適切なツールを選択してください。**

## 参考資料

- [Service Worker API制限](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Cloudflare Workers制限](https://developers.cloudflare.com/workers/platform/limits/)
- [Mixed Content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)
- [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
