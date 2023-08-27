/* global STORAGE_KEYS */
/* global storage */

/* global bouyomi */


class Whocares {
    static get SELECTORS() {
        return {
            ChatListRoot: "#content",
            ChatList: "#content > .log1",

            Chat_ViewerMessage: ".logUser",
            Chat_TextMessage: ".logMsg",
        };
    }
}


chrome.runtime.onMessage.addListener(({serviceId}, sender, resolve) => {
    if(serviceId != "005_Whocares") {
        resolve();
    }
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type !== "childList" || !mutation.addedNodes || mutation.addedNodes.length === 0 || mutation.addedNodes.length > 5) return;

            for (const chat of mutation.addedNodes) {
                // speak new message only
                if (!["div"].includes(chat.tagName.toLowerCase()) || !chat.nextSibling || !chat.parentElement) {
                    continue;
                }
                const author = chat.querySelector(Whocares.SELECTORS.Chat_ViewerMessage).firstChild.textContent;
                const message = chat.querySelector(Whocares.SELECTORS.Chat_TextMessage).textContent;
                if (!author || !message) return;
                storage.get(STORAGE_KEYS.getServiceKey(serviceId)).then(value => {
                    if (value) bouyomi.speak(`${author} さん。${message}`, 2);
                });
            }
        }
    });

    const looper = setInterval(() => {
        const chatListRoot = document.querySelector(Whocares.SELECTORS.ChatListRoot);
        if (chatListRoot) {
            clearInterval(looper);
            observer.observe(chatListRoot, {childList: true, subtree: true});

            resolve({serviceId});
        }
    }, 1000);
    return true;
});
