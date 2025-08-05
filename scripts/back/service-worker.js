chrome.webNavigation.onCompleted.addListener(async details => {
  const SERVICES = {
    "001_YouTubeLiveOnViewer": {
      expression: /https?:\/\/www\.youtube\.com\/live_chat(?:_replay)?(\?.*)?/
    },

    "002_YouTubeLiveOnBroadcaster": {
      expressions: [
        /https?:\/\/studio\.youtube.com\/live_chat(\?.*)/,
        /https?:\/\/studio\.youtube\.com\/channel\/([^/]+)\/livestreaming.*/,
        /https?:\/\/studio\.youtube\.com\/video\/([^/]+)\/livestreaming/
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

  let lastTime = 0;
  
  // 接続管理
  const connections = new Map();
  let isServiceWorkerActive = true;
  const processedMessages = new Set(); // 処理済みメッセージの追跡
  
  // Service Workerのライフサイクル管理
  self.addEventListener('activate', (event) => {
    console.log('Service Worker: アクティベート', {
      timestamp: Date.now(),
      connections: connections.size,
      isActive: isServiceWorkerActive
    });
    isServiceWorkerActive = true;
  });
  
  self.addEventListener('install', (event) => {
    console.log('Service Worker: インストール', {
      timestamp: Date.now(),
      connections: connections.size,
      isActive: isServiceWorkerActive
    });
    isServiceWorkerActive = true;
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
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'bouyomi-client') {
      console.log('Service Worker: BouyomiClient接続を受信');
      
      const connectionId = Date.now().toString();
      connections.set(connectionId, port);
      
      // 接続確認メッセージを送信
      port.postMessage({ type: 'connection_established', connectionId });
      
      port.onMessage.addListener(async (message) => {
        if (!isServiceWorkerActive) {
          port.postMessage({ error: 'Service Workerが非アクティブです' });
          return;
        }
        
        const {commandType, port: bouyomiPort, time, messageId, ...props} = message;
        
        // 重複メッセージチェック
        if (messageId && processedMessages.has(messageId)) {
          console.log('Service Worker: 重複メッセージをスキップ', messageId);
          return;
        }
        
        if (messageId) {
          processedMessages.add(messageId);
          // 古いメッセージIDを定期的にクリア
          if (processedMessages.size > 100) {
            const oldestMessages = Array.from(processedMessages).slice(0, 50);
            oldestMessages.forEach(id => processedMessages.delete(id));
          }
        }
        
        if(lastTime >= time) {
          return;
        }
        
        if (!bouyomiPort) {
          port.postMessage({ error: 'ポートが指定されていません' });
          return;
        }
        
        lastTime = time;
        
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
      
      port.onDisconnect.addListener(() => {
        console.log('Service Worker: BouyomiClient接続が切断されました');
        connections.delete(connectionId);
      });
    }
  });

  // 既存のonMessageリスナー（後方互換性のため）
  chrome.runtime.onMessage.addListener((message, sender, resolve) => {
    // pingメッセージの処理
    if (message.type === 'ping') {
      console.log('Service Worker: pingメッセージを受信', message);
      resolve({ 
        status: 'active', 
        timestamp: Date.now(),
        connections: connections.size,
        isActive: isServiceWorkerActive
      });
      return true;
    }

    const {commandType, port, time, ...props} = message;
    
    if(lastTime >= time) {
      return true;
    }
    if( sender && sender.tab && sender.tab.id !== details.tabId) {
      return false;
    }
    if (!port) {
      return false;
    }
    lastTime = time;
    if (commandType === "BouyomiGetVoice") {
      fetch("http://localhost:" + port + "/GetVoiceList").then(res => res.json()).then(resolve);
      return true;
    }
    const queryString = commandType !== "talk" ? '' : '?' + Object.entries(props)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    fetch("http://localhost:" + port + "/" + commandType + queryString, {
      method: "GET",
      cache: "no-cache"
    }).then(res => res.json()).then(resolve);
    return true;
  });
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
        /https?:\/\/studio\.youtube\.com\/channel\/([^/]+)\/livestreaming.*/,
        /https?:\/\/studio\.youtube\.com\/video\/([^/]+)\/livestreaming/
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