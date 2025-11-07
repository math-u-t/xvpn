import { useAuth0 } from '@auth0/auth0-react';
import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const { isAuthenticated, isLoading, loginWithRedirect, logout, user, getAccessTokenSilently } = useAuth0();
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [targetUrl, setTargetUrl] = useState('');
  const [proxyStatus, setProxyStatus] = useState('inactive');
  const [error, setError] = useState(null);

  const workerUrl = import.meta.env.VITE_WORKER_URL;

  // Register Service Worker when authenticated
  useEffect(() => {
    if (isAuthenticated && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('Service Worker registered:', registration);
        })
        .catch(error => {
          console.error('Service Worker registration failed:', error);
          setError('Service Workerの登録に失敗しました');
        });
    }
  }, [isAuthenticated]);

  // Fetch session info when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchSessionInfo();
    }
  }, [isAuthenticated]);

  const fetchSessionInfo = async () => {
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(`${workerUrl}/session`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSessionInfo(data);
      } else {
        console.error('Failed to fetch session info');
      }
    } catch (error) {
      console.error('Error fetching session info:', error);
    }
  };

  const handleLogin = () => {
    loginWithRedirect();
  };

  const handleLogout = () => {
    setProxyEnabled(false);
    setProxyStatus('inactive');
    logout({ returnTo: window.location.origin });
  };

  const toggleProxy = async () => {
    if (!proxyEnabled) {
      // Enable proxy
      try {
        const token = await getAccessTokenSilently();

        // Send message to Service Worker to enable proxy
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'ENABLE_PROXY',
            workerUrl,
            token,
          });

          setProxyEnabled(true);
          setProxyStatus('active');
          setError(null);
        } else {
          setError('Service Workerが利用できません。ページを再読み込みしてください。');
        }
      } catch (error) {
        console.error('Failed to enable proxy:', error);
        setError('プロキシの有効化に失敗しました');
      }
    } else {
      // Disable proxy
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'DISABLE_PROXY',
        });
      }

      setProxyEnabled(false);
      setProxyStatus('inactive');
    }
  };

  const testProxy = async () => {
    if (!targetUrl) {
      setError('URLを入力してください');
      return;
    }

    try {
      const token = await getAccessTokenSilently();

      const response = await fetch(`${workerUrl}/proxy`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Target-URL': targetUrl,
        },
      });

      if (response.ok) {
        const text = await response.text();
        alert(`プロキシ成功!\n\nレスポンス長: ${text.length} bytes`);
        setError(null);
      } else {
        const errorData = await response.json();
        setError(`プロキシエラー: ${errorData.error}`);
      }
    } catch (error) {
      console.error('Proxy test failed:', error);
      setError(`テスト失敗: ${error.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="app loading">
        <div className="spinner"></div>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app login-screen">
        <div className="login-card">
          <h1>
            <span className="material-icons">vpn_lock</span>
            xvpn
          </h1>
          <p className="subtitle">ブラウザで動作するセキュアプロキシ</p>

          <div className="features">
            <div className="feature">
              <span className="material-icons">security</span>
              <span>Auth0認証</span>
            </div>
            <div className="feature">
              <span className="material-icons">speed</span>
              <span>高速プロキシ</span>
            </div>
            <div className="feature">
              <span className="material-icons">privacy_tip</span>
              <span>プライバシー保護</span>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleLogin}>
            <span className="material-icons">login</span>
            ログイン
          </button>

          <p className="disclaimer">
            <span className="material-icons">info</span>
            教育目的でのみ使用してください
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>
            <span className="material-icons">vpn_lock</span>
            xvpn
          </h1>

          <div className="user-info">
            <img src={user.picture} alt={user.name} className="user-avatar" />
            <span className="user-name">{user.name}</span>
            <button className="btn btn-small" onClick={handleLogout}>
              <span className="material-icons">logout</span>
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          {error && (
            <div className="alert alert-error">
              <span className="material-icons">error</span>
              {error}
              <button onClick={() => setError(null)} className="alert-close">
                <span className="material-icons">close</span>
              </button>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h2>
                <span className="material-icons">power_settings_new</span>
                プロキシ制御
              </h2>
              <div className={`status-badge status-${proxyStatus}`}>
                {proxyStatus === 'active' ? '有効' : '無効'}
              </div>
            </div>

            <div className="card-body">
              <p className="description">
                プロキシを有効にすると、このブラウザからのリクエストがxvpn経由になります。
              </p>

              <button
                className={`btn btn-large ${proxyEnabled ? 'btn-danger' : 'btn-success'}`}
                onClick={toggleProxy}
              >
                <span className="material-icons">
                  {proxyEnabled ? 'power_settings_new' : 'power_settings_new'}
                </span>
                {proxyEnabled ? 'プロキシを無効化' : 'プロキシを有効化'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>
                <span className="material-icons">science</span>
                プロキシテスト
              </h2>
            </div>

            <div className="card-body">
              <div className="form-group">
                <label htmlFor="target-url">
                  <span className="material-icons">link</span>
                  テストURL
                </label>
                <input
                  id="target-url"
                  type="url"
                  className="input"
                  placeholder="https://example.com"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                />
              </div>

              <button className="btn btn-primary" onClick={testProxy}>
                <span className="material-icons">play_arrow</span>
                テスト実行
              </button>
            </div>
          </div>

          {sessionInfo && (
            <div className="card">
              <div className="card-header">
                <h2>
                  <span className="material-icons">info</span>
                  セッション情報
                </h2>
              </div>

              <div className="card-body">
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">ユーザーID</span>
                    <span className="info-value">{sessionInfo.userId}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">メール</span>
                    <span className="info-value">{sessionInfo.email}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">残りリクエスト</span>
                    <span className="info-value">{sessionInfo.rateLimit?.remaining || 'N/A'}</span>
                  </div>
                </div>

                <button className="btn btn-small" onClick={fetchSessionInfo}>
                  <span className="material-icons">refresh</span>
                  更新
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="footer">
        <p>
          <span className="material-icons">warning</span>
          教育目的でのみ使用してください。法規制を遵守してください。
        </p>
      </footer>
    </div>
  );
}

export default App;
