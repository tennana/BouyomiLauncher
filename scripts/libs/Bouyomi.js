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
			this.port = null;
			this.isConnected = false;
			this.reconnectAttempts = 0;
			this.maxReconnectAttempts = 5;
			this.reconnectDelay = 1000; // 1秒
			this.isReconnecting = false;
			this.reconnectTimer = null;
			this.lastCommandTime = 0;
			this.commandQueue = [];
			this.isProcessingQueue = false; // キュー処理中のフラグ
			this.serviceWorkerCheckInterval = null;
			this.initConnection();
			this.startServiceWorkerMonitoring();
		}

		/**
		 * Service Workerの監視を開始
		 */
		startServiceWorkerMonitoring() {
			// 30秒ごとにService Workerの状態を確認
			this.serviceWorkerCheckInterval = setInterval(async () => {
				if (this.isConnected) {
					const swActive = await this.checkServiceWorkerStatus();
					if (!swActive) {
						console.warn('BouyomiClient: Service Workerが非アクティブです。接続をリセットします。');
						this.isConnected = false;
						if (this.port) {
							this.port.disconnect();
							this.port = null;
						}
						this.scheduleReconnect();
					}
				}
			}, 30000); // 30秒間隔
		}

		/**
		 * Service Workerの監視を停止
		 */
		stopServiceWorkerMonitoring() {
			if (this.serviceWorkerCheckInterval) {
				clearInterval(this.serviceWorkerCheckInterval);
				this.serviceWorkerCheckInterval = null;
			}
		}

		/**
		 * 接続を初期化
		 */
		initConnection() {
			if (this.isReconnecting) {
				return; // 既に再接続中の場合は何もしない
			}

			try {
				console.log('BouyomiClient: 接続を初期化中...');
				this.port = chrome.runtime.connect({ name: 'bouyomi-client' });
				this.isConnected = true;
				this.isReconnecting = false;

				this.port.onDisconnect.addListener(() => {
					this.isConnected = false;
					console.log('BouyomiClient: 接続が切断されました');
					
					// エラーが発生した場合のみ再接続を試行
					if (chrome.runtime.lastError) {
						console.log('BouyomiClient: エラーが発生しました:', chrome.runtime.lastError.message);
						this.scheduleReconnect();
					}
				});

				this.port.onMessage.addListener((response) => {
					// レスポンス処理（必要に応じて）
					console.log('BouyomiClient: レスポンス受信', response);
					
					// 接続確認メッセージの処理
					if (response.type === 'connection_established') {
						console.log('BouyomiClient: 接続が確立されました', response.connectionId);
						this.isConnected = true;
						this.reconnectAttempts = 0;
						this.isReconnecting = false;
						
						// 接続が確立されたらキューに溜まったコマンドを実行
						this.processCommandQueue();
					}
				});

			} catch (error) {
				console.error('BouyomiClient: 接続初期化エラー', error);
				this.isConnected = false;
				this.scheduleReconnect();
			}
		}

		/**
		 * Service Workerの状態を確認
		 */
		async checkServiceWorkerStatus() {
			try {
				// Service Workerの状態を確認
				const response = await chrome.runtime.sendMessage({ 
					type: 'ping', 
					timestamp: Date.now() 
				});
				console.log('BouyomiClient: Service Worker応答あり', response);
				return true;
			} catch (error) {
				console.error('BouyomiClient: Service Worker応答なし', error);
				return false;
			}
		}

		/**
		 * 再接続をスケジュール
		 */
		async scheduleReconnect() {
			if (this.isReconnecting) {
				return; // 既に再接続中の場合は何もしない
			}

			if (this.reconnectAttempts >= this.maxReconnectAttempts) {
				console.error('BouyomiClient: 最大再接続回数に達しました');
				this.isReconnecting = false;
				return;
			}

			this.isReconnecting = true;
			this.reconnectAttempts++;
			
			// Service Workerの状態を確認
			const swActive = await this.checkServiceWorkerStatus();
			console.log(`BouyomiClient: Service Worker状態 - アクティブ: ${swActive}`);
			
			// 指数バックオフで遅延時間を増加
			const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
			console.log(`BouyomiClient: ${delay}ms後に再接続を試行します (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

			// 既存のタイマーをクリア
			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer);
			}

			this.reconnectTimer = setTimeout(async () => {
				this.isReconnecting = false;
				
				// 再接続前にService Workerの状態を再確認
				const swStillActive = await this.checkServiceWorkerStatus();
				if (!swStillActive) {
					console.error('BouyomiClient: Service Workerが非アクティブです。再接続を中止します。');
					return;
				}
				
				this.initConnection();
			}, delay);
		}

		/**
		 * 接続状態を確認し、必要に応じて再接続
		 */
		ensureConnection() {
			if (!this.isConnected || !this.port) {
				console.log('BouyomiClient: 接続が確立されていません。再接続を試行します');
				this.initConnection();
			}
		}

		/**
		 * コマンドをキューに追加
		 */
		queueCommand(commandType, fields = {}) {
			const command = { commandType, fields, timestamp: Date.now() };
			this.commandQueue.push(command);
			
			// キューが長すぎる場合は古いコマンドを削除
			if (this.commandQueue.length > 10) {
				this.commandQueue.shift();
			}
		}

		/**
		 * キューに溜まったコマンドを実行
		 */
		async processCommandQueue() {
			if (!this.isConnected || !this.port) {
				return;
			}

			// 処理中のフラグを設定
			if (this.isProcessingQueue) {
				return;
			}
			this.isProcessingQueue = true;

			try {
				while (this.commandQueue.length > 0) {
					const command = this.commandQueue.shift();
					try {
						await this.sendCommand(command.commandType, command.fields);
						// 各コマンドの間に少し間隔を空ける
						await new Promise(resolve => setTimeout(resolve, 50));
					} catch (error) {
						console.error('BouyomiClient: キューコマンド実行エラー', error);
						// エラーが発生した場合はコマンドを再キュー
						this.commandQueue.unshift(command);
						break;
					}
				}
			} finally {
				this.isProcessingQueue = false;
			}
		}

		/**
		 * コマンドを送信
		 */
		async sendCommand(commandType, fields = {}) {
			if (!this.isConnected || !this.port) {
				throw new Error('BouyomiClient: 接続が確立されていません');
			}

			try {
				const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
				const message = Object.assign({ 
					commandType, 
					time: new Date().getTime(),
					messageId
				}, this.config, fields);
				
				this.port.postMessage(message);
				this.lastCommandTime = Date.now();
			} catch (error) {
				console.error('BouyomiClient: メッセージ送信エラー', error);
				this.isConnected = false;
				this.scheduleReconnect();
				throw error;
			}
		}

		/**
		 * @param {BouyomiClient.Config.CommandType} commandType
		 * @param {object} [fields = {}]
		 */
		async command (commandType, fields = {}) {
			this.ensureConnection();

			if (!this.isConnected || !this.port) {
				// 接続できない場合はコマンドをキューに追加
				this.queueCommand(commandType, fields);
				return;
			}

			try {
				await this.sendCommand(commandType, fields);
				// キュー処理は接続確認時に行うため、ここでは実行しない
			} catch (error) {
				// エラーが発生した場合はコマンドをキューに追加
				this.queueCommand(commandType, fields);
				throw error;
			}
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