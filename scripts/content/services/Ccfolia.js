/* global STORAGE_KEYS */
/* global storage */

/* global bouyomi */


class Ccfolia {
    static get SELECTORS() {
        return {
            ChatListRoot: ".MuiList-root",
            ChatList: ".MuiList-root > div:first-child > div:first-child > div:first-child",

            Chat_ViewerMessage: ".MuiTypography-subtitle2",
            Chat_TextMessage: ".MuiTypography-body2",
        };
    }
}


chrome.runtime.onMessage.addListener(({serviceId}, sender, resolve) => {
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type !== "childList" || !mutation.addedNodes || mutation.addedNodes.length === 0) return;
            let root = mutation.target;
            for(let i = 0; i < 3;i++){
                if (root.tagName.toLowerCase() !== "div"){
                    return;
                }
                root = root.parentNode;
            }
            if (root.className.indexOf("MuiList-root") === -1) {
                return;
            }

            for (const chat of mutation.addedNodes) {
                // speak new message only
                if (!["div"].includes(chat.tagName.toLowerCase()) || chat.nextSibling || !chat.parentElement) {
                    continue;
                }
                const scrollDiv = chat.parentElement.parentElement;
                if (Math.abs(scrollDiv.scrollHeight - scrollDiv.clientHeight - scrollDiv.scrollTop) > 40 + chat.clientHeight) {
                    continue;
                }
                const author = chat.querySelector(Ccfolia.SELECTORS.Chat_ViewerMessage).firstChild.textContent;
                const message = chat.querySelector(Ccfolia.SELECTORS.Chat_TextMessage).textContent;
                if (!author || !message) return;
                storage.get(STORAGE_KEYS.getServiceKey(serviceId)).then(value => {
                    if (value) bouyomi.speak(`${author} さん。${message}`);
                });
            }
        }
    });

    const looper = setInterval(() => {
        const chatListRoot = document.querySelector(Ccfolia.SELECTORS.ChatListRoot);

        if (chatListRoot) {
            clearInterval(looper);
            observer.observe(chatListRoot, {childList: true, subtree: true});

            resolve({serviceId});
        }
    }, 1000);
    return true;
});
