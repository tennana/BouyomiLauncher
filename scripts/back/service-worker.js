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

  chrome.runtime.onMessage.addListener(({commandType, port, ...props}, sender, resolve) => {
    if (!port) {
      return false;
    }
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