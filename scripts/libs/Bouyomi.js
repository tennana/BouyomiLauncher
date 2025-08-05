/* global STORAGE_KEYS */
/* global storage */



const Bouyomi = (() => {
	class Bouyomi {
		static get ClientType () {
			return { Bouyomi: "BOUYOMI", Native: "NATIVE" };
		}


		get client () {
			switch (this.clientType) {
				case Bouyomi.ClientType.Bouyomi:
					return this._client;
				case Bouyomi.ClientType.Native:
					return this._nativeClient;
				default:
					throw new TypeError(`A value of "clientType", "${this.clientType}" is not acceptable`);
			}
		}


		constructor () {
			this._client = new Bouyomi.Client();
			this._nativeClient = new Bouyomi.NativeClient();

			/** @type { Bouyomi.ClientType[keyof Bouyomi.ClientType] } */
			this.clientType = Bouyomi.ClientType.Bouyomi;
		}

		init () {
			storage.on("change", store => {
				const clientTypeChanges = store[STORAGE_KEYS.BOUYOMI_TYPE];
				const nativeConfigChanges = store[STORAGE_KEYS.NATIVE_BOUYOMI_CONFIG];
				const configChanges = store[STORAGE_KEYS.BOUYOMI_CONFIG];

				if (clientTypeChanges) return this.clientType = clientTypeChanges.newValue;
				if (configChanges) return this._client.config = configChanges.newValue;
				if (nativeConfigChanges) return this._nativeClient.config = nativeConfigChanges.newValue;
			});
		}

		/**
		 * @param {string} message
		 * @param {BouyomiClient.Config | BouyomiNativeClient.Config} config
		 */
		speak (message, config) { this.client.speak(message, config) }
		pause () { this.client.pause() }
		resume () { this.client.resume() }
		skip () { this.client.skip() }
	}


	/**
	 * @namespace BouyomiClient
	 * 
	 * @typedef {Object} BouyomiClient.Config
	 * @prop {number} [speed = -1] Between 50 and 200 (Default: -1)
	 * @prop {number} [pitch = -1] Between 50 and 200 (Default: -1)
	 * @prop {number} [volume = -1] Between 0 and 100 (Default: -1)
	 * @prop {number} [type = 0] Check Bouyomi-chan's settings (Default: 0)
	 * 
	 * @typedef {0x0001 | 0x0010 | 0x0020 | 0x0030} BouyomiClient.Config.CommandType 0x0001=読み上げ / 0x0010=ポーズ / 0x0020=再開 / 0x0030=スキップ
	 */
	Bouyomi.Client = class Client {
		static get CommandType () {
			return { Speak: 'talk', Pause: 'pause', Resume: 'resume', Skip: 'skip' };
		}

		/** @return {BouyomiClient.Config} */
		static get defaultConfig () { return { speed: -1, pitch: -1, volume: -1, type: 0, port: 50080 } }

		/** @param {BouyomiClient.Config} [config = {}] */
		constructor (config = {}) {
			this.config = Object.assign(Object.create(Client.defaultConfig), config);
		}

		/**
		 * @param {BouyomiClient.Config.CommandType} commandType
		 * @param {object} [fields = {}]
		 */
		async command (commandType, fields = {}) {
			chrome.runtime.sendMessage(Object.assign({ commandType, time: new Date().getTime() }, this.config, fields));
		}
		
		/** @param {string} text
		 * @param config
		 */
		async speak (text, config) { await this.command(Client.CommandType.Speak, { text, ...config }) }
		async pause () { await this.command(Client.CommandType.Pause) }
		async resume () { await this.command(Client.CommandType.Resume) }
		async skip () { await this.command(Client.CommandType.Skip) }
	};

	/**
	 * @namespace BouyomiNativeClient
	 * 
	 * @typedef {Object} BouyomiNativeClient.Config
	 * @prop {number} [speed = 1] Between 0.1 and 10 (Default: 1)
	 * @prop {number} [pitch = 1] Between 0 and 2 (Default: 1)
	 * @prop {number} [volume = 1] Between 0 and 1 (Default: 1)
	 * @prop {SpeechSynthesisVoice} [type]
	 * 
	 * @typedef {"load"} BouyomiNativeClient.EventType
	 * 
	 * @callback BouyomiNativeClient.EventCallback
	 * @param {Bouyomi.NativeClient} client
	 */
	Bouyomi.NativeClient = class NativeClient {
		/** @return {SpeechSynthesisVoice[]} */
		static get Voices () { return speechSynthesis.getVoices() }

		/** @return {BouyomiNativeClient.Config} */
		static get defaultConfig () { return { speed: 1, pitch: 1, volume: 1, type: null } }

		/** @return {boolean} */
		static get isLoaded () { return this.Voices.length ? true : false }


		/**
		 * @param {string} name
		 * @return {SpeechSynthesisVoice}
		 */
		static getVoiceByName (name) {
			if (!this.isLoaded) return null;
			return this.Voices.find(voice => voice.name === name);
		}


		/** @return {BouyomiNativeClient.Config} */
		get config () { return this._config }

		/** @param {BouyomiNativeClient.Config} value */
		set config (value) {
			const { type } = value;

			this._config = Object.assign(Object.create(NativeClient.defaultConfig), value, (() => {
				if (!NativeClient.isLoaded) return {};

				return {
					type: typeof type === "string" ? (NativeClient.getVoiceByName(type) || NativeClient.Voices[0]) : (type || null)
				};
			})());
		}


		/** @param {BouyomiNativeClient.Config} [config = {}] */
		constructor (config = {}) {
			this.config = config;

			/** @type {SpeechSynthesisUtterance[]} */
			this.ques = [];
		}

		/**
		 * @param {BouyomiNativeClient.EventType} eventType
		 * @param {BouyomiNativeClient.EventCallback} callback
		 * 
		 * @return {Promise<NativeClient>}
		 */
		on (eventType, callback) {
			return new Promise((resolve, reject) => {
				let count = 0;
				let observer = null;

				switch (eventType) {
					case "load":
						return observer = setInterval(() => {
							if (10 < (count++)) throw reject(new Error("load-event failed with a timeout problem"));
			
							if (NativeClient.isLoaded) {
								clearInterval(observer);

								resolve(this);
								callback && callback(this);
							}
						}, 500);

					default:
						throw reject(new Error(`A value of "eventType", "${eventType}" is not acceptable`));
				}
			});
		}

		/**
		 * @param {string} message
		 * @param {BouyomiNativeClient.Config} [config]
		 */
		speak (message, config = this.config) {
			const segments = message.match(/[「『（]?[^。．.,！!？?」』）\r\n]*(?:[。．.,！!？?」』）\r\n]+|.$)/g) || [ message ]; // 上限文字数の回避処理

			for (let i = 0; i < segments.length; i++) {
				const utterance = (() => {
					const utterance = new SpeechSynthesisUtterance(segments[i]);
					utterance.rate = config.speed != undefined ? config.speed : utterance.rate,
					utterance.pitch = config.pitch != undefined ? config.pitch : utterance.pitch,
					utterance.volume = config.volume != undefined ? config.volume : utterance.volume,
					utterance.voice = config.type != undefined ? config.type : utterance.voice;

					utterance.addEventListener("end", e => {
						const queIndex = this.ques.findIndex(que => que === e.utterance);
						queIndex < 0 || this.ques.splice(queIndex, 1);
					});

					return utterance;
				})();

				speechSynthesis.speak(utterance);
				this.ques.push(utterance);
			}
		}

		pause () { speechSynthesis.pause() }
		resume () { speechSynthesis.resume() }

		skip () {
			/** @type {SpeechSynthesisUtterance[]} */
			const currentQues = Object.assign([], this.ques);
			currentQues.shift();

			this.pause(), this.clear();

			for (const que of currentQues) {
				const { text, pitch, volume } = que;

				this.speak(text, {
					speed: que.rate,
					pitch,
					volume,
					type: que.voice
				});
			}

			this.resume();
		}

		clear () {
			speechSynthesis.cancel();
			this.ques.splice(0, this.ques.length);
		}
	};


	return Bouyomi;
})();



const bouyomi = new Bouyomi();