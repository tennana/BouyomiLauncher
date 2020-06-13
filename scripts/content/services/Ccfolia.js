/* global STORAGE_KEYS */
/* global storage */
/* global bouyomi */



class Ccfolia {
	static get SELECTORS () {
		return {
			ChatList: ".MuiList-root > div:first-child > div:first-child > div:first-child",
		
			Chat_ViewerMessage: ".MuiTypography-subtitle2",
			Chat_TextMessage: ".MuiTypography-body2",
		};
	}
}



chrome.runtime.onMessage.addListener(({ serviceId }, sender, resolve) => {
	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			if (mutation.type !== "childList") return;

			for (const chat of mutation.addedNodes) {
				if (![ "div" ].includes(chat.tagName.toLowerCase()) || chat.nextSibling) {
					continue;
				}
				const scrollDiv = chat.parentElement.parentElement;
				// speak new message only
				if(scrollDiv.scrollHeight - scrollDiv.clientHeight !== scrollDiv.scrollTop){
					continue;
				}
				const author = chat.querySelector(Ccfolia.SELECTORS.Chat_ViewerMessage).firstChild.textContent;
				const message = chat.querySelector(Ccfolia.SELECTORS.Chat_TextMessage).textContent;
				if(!author || !message) return;
				storage.get(STORAGE_KEYS.getServiceKey(serviceId)).then(value => {
					if (value) bouyomi.speak(`${author} さん。${message}`);
				});
			}
		}
	});
	
	const looper = setInterval(() => {
		const chatList = document.querySelector(Ccfolia.SELECTORS.ChatList);

		if (chatList) {
			clearInterval(looper);
			observer.observe(chatList, { childList: true });

			resolve({ serviceId });
		}
	}, 1000);
	return true;
});