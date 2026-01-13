// Service Workerの生存維持と接続管理
let keepAliveInterval;
let reconnectInterval;
const connections = new Map();
let isServiceWorkerActive = true;

// 軽量な文字列ハッシュ関数（Service Worker環境対応）
function simpleHash(str) {
  let hash = 0;
  if (str.length === 0) return hash.toString(16);
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit整数に変換
  }
  
  return Math.abs(hash).toString(16).substring(0, 8);
}

// 永続的な重複メッセージチェック
async function isMessageProcessed(messageId) {
  try {
    const result = await chrome.storage.local.get(['processedMessages']);
    const processedMessages = new Set(result.processedMessages);
    return processedMessages.has(messageId);
  } catch (error) {
    console.error('Service Worker: 重複チェックエラー', error);
    return false;
  }
}

async function markMessageAsProcessed(messageId) {
  try {
    const result = await chrome.storage.local.get(['processedMessages']);
    const processedMessages = new Set(result.processedMessages);
    processedMessages.add(messageId);
    
    // 古いメッセージIDを定期的にクリア（100件を超えた場合）
    if (processedMessages.size > 100) {
      const oldestMessages = Array.from(processedMessages).slice(0, 50);
      oldestMessages.forEach(id => processedMessages.delete(id));
    }
    
    await chrome.storage.local.set({ processedMessages: Array.from(processedMessages) });
  } catch (error) {
    console.error('Service Worker: メッセージ処理済みマークエラー', error);
  }
}

// Service Workerの生存維持（Chrome 105+で動作）
function keepServiceWorkerAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  // 27秒ごとにアラームを作成してService Workerを生存させる
  chrome.alarms.create('keepAlive', { 
    delayInMinutes: 0.45, // 27秒
    periodInMinutes: 0.45 
  });
  
  // 20秒ごとにchrome.runtime.getPlatformInfoを呼び出してService Workerを生存させる
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, 20000);
}

// 接続の自動再接続処理
function setupAutoReconnect() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }
  
  reconnectInterval = setInterval(() => {
    if (connections.size === 0) return;
    
    // 接続が切断されている場合の再接続処理
    connections.forEach((port, connectionId) => {
      try {
        // 接続状態をチェック
        port.postMessage({ type: 'ping', timestamp: Date.now() });
      } catch (error) {
        console.log('Service Worker: 切断された接続を削除', connectionId);
        connections.delete(connectionId);
      }
    });
  }, 10000); // 10秒ごとにチェック
}

// 接続状態の確認と復帰処理
async function ensureServiceWorkerActive() {
  if (!isServiceWorkerActive) {
    console.log('Service Worker: 非アクティブ状態を検出、復帰処理を実行');
    isServiceWorkerActive = true;
    
    // 生存維持を再開
    keepServiceWorkerAlive();
    setupAutoReconnect();
  }
  return isServiceWorkerActive;
}

// Service Workerのライフサイクル管理
self.addEventListener('activate', async (event) => {
  console.log('Service Worker: アクティベート', {
    timestamp: Date.now(),
    connections: connections.size,
    isActive: isServiceWorkerActive
  });
  isServiceWorkerActive = true;
  
  // 生存維持を開始
  keepServiceWorkerAlive();
  setupAutoReconnect();
});

self.addEventListener('install', async (event) => {
  console.log('Service Worker: インストール', {
    timestamp: Date.now(),
    connections: connections.size,
    isActive: isServiceWorkerActive
  });
  isServiceWorkerActive = true;
  
  // 生存維持を開始
  keepServiceWorkerAlive();
  setupAutoReconnect();
});

// Alarms APIのリスナー（Service Workerを生存させる）
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // 何もしない（Service Workerを生存させるため）
    console.log('Service Worker: keepAlive alarm triggered');
  }
});

// Service Workerの状態変化を監視
self.addEventListener('message', (event) => {
  console.log('Service Worker: メッセージ受信', event.data);
});

// エラーハンドリング
self.addEventListener('error', (event) => {
  console.error('Service Worker: エラー発生', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker: 未処理のPromise拒否', event.reason);
});

// chrome.runtime.connect()による接続処理
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'bouyomi-client') {
    console.log('Service Worker: BouyomiClient接続を受信');
    
    const connectionId = Date.now().toString();
    connections.set(connectionId, port);
    
    // 接続確認メッセージを送信
    port.postMessage({ type: 'connection_established', connectionId });
    
    port.onMessage.addListener(async (message) => {
      // Service Workerの状態を確認し、必要に応じて復帰処理を実行
      await ensureServiceWorkerActive();

      const {commandType, port: bouyomiPort, time, ...props} = message;
      if (!bouyomiPort) {
        port.postMessage({ error: 'ポートが指定されていません' });
        return;
      }

      // メッセージ内容に基づいてロック名を生成（同じ内容は同じロック名）
      const messageContent = JSON.stringify({ commandType, props });
      const lockName = `bouyomi-${commandType}-${simpleHash(messageContent)}`;

      // 重複メッセージチェック（永続的）
      if (lockName && await isMessageProcessed(lockName)) {
        console.log('Service Worker: 重複メッセージをスキップ', lockName);
        return;
      }
      
      if (lockName) {
        await markMessageAsProcessed(lockName);
      }


      // Web Locks APIを使用して排他制御（同じ内容のメッセージのみ排他）
      try {
        await navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
          try {
            let response;
            
            if (commandType === "BouyomiGetVoice") {
              response = await fetch("http://localhost:" + bouyomiPort + "/GetVoiceList");
            } else {
              const queryString = commandType !== "talk" ? '' : '?' + Object.entries(props)
                  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                  .join('&');
              response = await fetch("http://localhost:" + bouyomiPort + "/" + commandType + queryString, {
                method: "GET",
                cache: "no-cache"
              });
            }
            
            const result = await response.json();
            port.postMessage({ success: true, data: result });
            
          } catch (error) {
            console.error('Service Worker: Bouyomi通信エラー', error);
            port.postMessage({ error: error.message });
          }
        });
      } catch (lockError) {
        console.log('Service Worker: ロック取得失敗 - 同じ内容のメッセージが処理中', lockError);
        port.postMessage({ error: '同じ内容の処理が実行中のため実行できませんでした' });
      }
    });
    
    port.onDisconnect.addListener(() => {
      console.log('Service Worker: BouyomiClient接続が切断されました');
      connections.delete(connectionId);
    });
  }
});

// 既存のonMessageリスナー（後方互換性のため）
chrome.runtime.onMessage.addListener(async (message, sender, resolve) => {
  // Service Workerの状態を確認し、必要に応じて復帰処理を実行
  await ensureServiceWorkerActive();
  
  // pingメッセージの処理
  if (message.type === 'ping') {
    console.log('Service Worker: pingメッセージを受信', message);
    resolve({ 
      status: 'active', 
      timestamp: Date.now(),
      connections: connections.size,
      isActive: isServiceWorkerActive,
    });
    return true;
  }

  const {commandType, port, time, messageId, ...props} = message;
  
  if (!port) {
    return false;
  }
  
  // 重複メッセージチェック（永続的）
  if (messageId && await isMessageProcessed(messageId)) {
    console.log('Service Worker: 重複メッセージをスキップ', messageId);
    resolve({ error: '重複メッセージです' });
    return true;
  }
  
  if (messageId) {
    await markMessageAsProcessed(messageId);
  }
  
  // メッセージ内容に基づいてロック名を生成（同じ内容は同じロック名）
  const messageContent = JSON.stringify({ commandType, props });
  const lockName = `bouyomi-${commandType}-${simpleHash(messageContent)}`;
  
  // Web Locks APIを使用して排他制御（同じ内容のメッセージのみ排他）
  (async () => {
    try {
      await navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
        if (commandType === "BouyomiGetVoice") {
          const result = await fetch("http://localhost:" + port + "/GetVoiceList").then(res => res.json());
          resolve(result);
        } else {
          const queryString = commandType !== "talk" ? '' : '?' + Object.entries(props)
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
              .join('&');
          const result = await fetch("http://localhost:" + port + "/" + commandType + queryString, {
            method: "GET",
            cache: "no-cache"
          }).then(res => res.json());
          resolve(result);
        }
      });
    } catch (lockError) {
      console.log('Service Worker: ロック取得失敗 - 同じ内容のメッセージが処理中', lockError);
      resolve({ error: '同じ内容の処理が実行中のため実行できませんでした' });
    }
  })();
  
  return true;
});

// webNavigationリスナー（Service Workerのトップレベルで定義）
chrome.webNavigation.onCompleted.addListener(async details => { 
  const SERVICES = {
    "001_YouTubeLiveOnViewer": {
      expression: /https?:\/\/www\.youtube\.com\/live_chat(?:_replay)?(\?.*)?/
    },

    "002_YouTubeLiveOnBroadcaster": {
      expressions: [
        /https?:\/\/studio\.youtube.com\/live_chat(\?.*)/,
        /https?:\/\/studio\.youtube.com\/channel\/([^/]+)\/livestreaming.*/,
        /https?:\/\/studio\.youtube.com\/video\/([^/]+)\/livestreaming/
      ]
    },
    "003_TwitCasting": {
      expression: /https?:\/\/twitcasting\.tv\/([^/]+)\/broadcaster.*/
    },
    "004_Ccfolia": {
      expression: /https?:\/\/ccfolia\.com\/rooms\/([a-zA-Z0-9]+)/
    }
  };
  
  for (const service of Object.entries(SERVICES)) {
    if ((() => {
      if (!service[1].expression) {
        for (const expr of service[1].expressions) {
          if (expr.exec(details.url)) return true;
        }
        return;
      }
      if (service[1].expression.exec(details.url)) return true;
    })()) {
      const message = {
        serviceId: service[0]
      };
      chrome.tabs.sendMessage(details.tabId, message, {frameId: details.frameId});
      break;
    }
  }
}, (async () => {
  const filter = {};
  filter.url = [];
  const SERVICES = {
    "001_YouTubeLiveOnViewer": {
      expression: /https?:\/\/www\.youtube\.com\/live_chat(?:_replay)?(\?.*)?/
    },
    "002_YouTubeLiveOnBroadcaster": {
      expressions: [
        /https?:\/\/studio\.youtube.com\/live_chat(\?.*)/,
        /https?:\/\/studio\.youtube.com\/channel\/([^/]+)\/livestreaming.*/,
        /https?:\/\/studio\.youtube.com\/video\/([^/]+)\/livestreaming/
      ]
    },
    "003_TwitCasting": {
      expression: /https?:\/\/twitcasting\.tv\/([^/]+)\/broadcaster.*/
    },
    "004_Ccfolia": {
      expression: /https?:\/\/ccfolia\.com\/rooms\/([a-zA-Z0-9]+)/
    }
  };
  
  for (const service of Object.values(SERVICES)) {
    if (!service.expression) {
      for (const expr of service.expressions) {
        filter.url.push({urlMatches: expr.source});
      }
      continue;
    }
    filter.url.push({urlMatches: service.expression.source});
  }
  
  return filter;
})());

(async () => {
    keepServiceWorkerAlive();
    setupAutoReconnect();
})();