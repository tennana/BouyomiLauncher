/**
 * @typedef {Object} Service
 * @prop {string} id
 * @prop {RegExp} [expression]
 * @prop {RegExp[]} [expressions]
 */

/** @type {Object<string, Service>} */
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

const STORAGE_KEYS = {
	BOUYOMI_TYPE: "bouyomiType",
	NATIVE_BOUYOMI_CONFIG: "nativeBouyomiConfig",
	BOUYOMI_CONFIG: "bouyomiConfig",
	SERVICES: "services",


	/** @param {string} service */
	getServiceKey (service) { return `${this.SERVICES}_${service}` }
};