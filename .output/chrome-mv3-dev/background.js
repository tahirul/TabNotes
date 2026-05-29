var background = (function() {
	//#region shared/groupKey.ts
	var SCRATCHPAD_KEY = "global:scratchpad";
	function deriveOrigin(url) {
		if (!url) return "unknown";
		try {
			return new URL(url).hostname || "unknown";
		} catch {
			return "unknown";
		}
	}
	function buildGroupKey(groupId) {
		return `group:id:${groupId}`;
	}
	function createScratchpadContext(tabId, origin = "unknown") {
		return {
			kind: "scratchpad",
			key: SCRATCHPAD_KEY,
			title: "Global Scratchpad",
			origin,
			tabId
		};
	}
	function createGroupContext(input) {
		return {
			kind: "group",
			key: buildGroupKey(input.groupId),
			tabId: input.tabId,
			groupId: input.groupId,
			title: input.title,
			color: input.color,
			origin: input.origin,
			tabs: input.tabs
		};
	}
	//#endregion
	//#region shared/storage.ts
	var STORAGE_KEYS = {
		notes: "tabnotes.notes",
		activeContext: "tabnotes.activeContext"
	};
	function createDefaultNote(context) {
		return {
			key: context.key,
			title: context.title,
			body: "",
			preview: "",
			status: "active",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			color: context.kind === "group" ? context.color : void 0,
			origin: context.origin,
			groupId: context.kind === "group" ? context.groupId : void 0,
			tabTitles: context.kind === "group" ? context.tabs.map((tab) => tab.title) : void 0,
			tabLinks: context.kind === "group" ? context.tabs.map((tab) => ({
				tabId: tab.tabId,
				title: tab.title,
				url: tab.url
			})) : void 0
		};
	}
	async function readState() {
		const payload = await chrome.storage.local.get([STORAGE_KEYS.notes, STORAGE_KEYS.activeContext]);
		return {
			activeContext: payload[STORAGE_KEYS.activeContext] ?? null,
			notes: payload[STORAGE_KEYS.notes] ?? {}
		};
	}
	async function writeState(state) {
		await chrome.storage.local.set({
			[STORAGE_KEYS.notes]: state.notes,
			[STORAGE_KEYS.activeContext]: state.activeContext
		});
	}
	async function setActiveContext(context) {
		await chrome.storage.local.set({ [STORAGE_KEYS.activeContext]: context });
	}
	async function ensureContextNote(context) {
		const state = await readState();
		const existing = state.notes[context.key];
		if (!existing) {
			state.notes[context.key] = createDefaultNote(context);
			await writeState(state);
			return;
		}
		state.notes[context.key] = {
			...existing,
			title: context.title,
			origin: context.origin,
			color: context.kind === "group" ? context.color : existing.color,
			groupId: context.kind === "group" ? context.groupId : existing.groupId,
			tabTitles: context.kind === "group" ? context.tabs.map((tab) => tab.title) : existing.tabTitles,
			tabLinks: context.kind === "group" ? context.tabs.map((tab) => ({
				tabId: tab.tabId,
				title: tab.title,
				url: tab.url
			})) : existing.tabLinks
		};
		await writeState(state);
	}
	async function ensureSingleGroupNote(context) {
		if (context.kind !== "group") return;
		const state = await readState();
		const groupCandidates = Object.values(state.notes).filter((note) => note.groupId === context.groupId);
		if (groupCandidates.length <= 1 && (groupCandidates.length === 0 || groupCandidates[0].key === context.key)) return;
		const canonical = {
			...[...groupCandidates].sort((a, b) => {
				const aTime = Date.parse(a.updatedAt || "");
				const bTime = Date.parse(b.updatedAt || "");
				return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
			})[0],
			key: context.key,
			title: context.title,
			color: context.color,
			origin: context.origin,
			groupId: context.groupId,
			tabTitles: context.tabs.map((tab) => tab.title),
			tabLinks: context.tabs.map((tab) => ({
				tabId: tab.tabId,
				title: tab.title,
				url: tab.url
			})),
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		groupCandidates.forEach((candidate) => {
			delete state.notes[candidate.key];
		});
		state.notes[context.key] = canonical;
		await writeState(state);
	}
	//#endregion
	//#region shared/tabContext.ts
	async function resolveContextFromTabId(tabId) {
		const tab = await chrome.tabs.get(tabId);
		const origin = deriveOrigin(tab.url ?? null);
		if (typeof tab.groupId !== "number" || tab.groupId === -1) return createScratchpadContext(tabId, origin);
		const group = await chrome.tabGroups.get(tab.groupId);
		const groupedTabs = await chrome.tabs.query({ groupId: tab.groupId });
		return createGroupContext({
			tabId,
			groupId: tab.groupId,
			title: group.title?.trim() || tab.title?.trim() || "Untitled Group",
			color: group.color || "grey",
			origin,
			tabs: groupedTabs.filter((groupedTab) => typeof groupedTab.id === "number").map((groupedTab) => ({
				tabId: groupedTab.id,
				title: groupedTab.title?.trim() || "Untitled Tab",
				url: groupedTab.url || ""
			}))
		});
	}
	//#endregion
	//#region node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
	}
	//#endregion
	//#region entrypoints/background.ts
	async function syncTabContext(tabId) {
		const context = await resolveContextFromTabId(tabId);
		await ensureSingleGroupNote(context);
		await ensureContextNote(context);
		await setActiveContext(context);
	}
	var background_default = defineBackground(() => {
		chrome.action.onClicked.addListener((tab) => {
			if (typeof tab.windowId === "number") chrome.sidePanel.open({ windowId: tab.windowId });
		});
		chrome.runtime.onInstalled.addListener(() => {
			bootstrap();
		});
		chrome.runtime.onStartup.addListener(() => {
			bootstrap();
		});
		chrome.tabs.onActivated.addListener(({ tabId }) => {
			syncTabContext(tabId);
		});
		chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
			if (changeInfo.status === "complete") syncTabContext(tabId);
		});
		chrome.tabGroups.onUpdated.addListener((group) => {
			chrome.tabs.query({ groupId: group.id }).then((tabs) => {
				const firstTab = tabs.find((tab) => typeof tab.id === "number");
				if (firstTab?.id !== void 0) syncTabContext(firstTab.id);
			});
		});
	});
	async function bootstrap() {
		const [activeTab] = await chrome.tabs.query({
			active: true,
			currentWindow: true
		});
		if (activeTab?.id !== void 0) await syncTabContext(activeTab.id);
	}
	//#endregion
	//#region node_modules/wxt/dist/browser.mjs
	/**
	* Contains the `browser` export which you should use to access the extension
	* APIs in your project:
	*
	* ```ts
	* import { browser } from 'wxt/browser';
	*
	* browser.runtime.onInstalled.addListener(() => {
	*   // ...
	* });
	* ```
	*
	* @module wxt/browser
	*/
	var browser = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	//#endregion
	//#region node_modules/@webext-core/match-patterns/lib/index.js
	var _MatchPattern = class {
		constructor(matchPattern) {
			if (matchPattern === "<all_urls>") {
				this.isAllUrls = true;
				this.protocolMatches = [..._MatchPattern.PROTOCOLS];
				this.hostnameMatch = "*";
				this.pathnameMatch = "*";
			} else {
				const groups = /(.*):\/\/(.*?)(\/.*)/.exec(matchPattern);
				if (groups == null) throw new InvalidMatchPattern(matchPattern, "Incorrect format");
				const [_, protocol, hostname, pathname] = groups;
				validateProtocol(matchPattern, protocol);
				validateHostname(matchPattern, hostname);
				this.protocolMatches = protocol === "*" ? ["http", "https"] : [protocol];
				this.hostnameMatch = hostname;
				this.pathnameMatch = pathname;
			}
		}
		includes(url) {
			if (this.isAllUrls) return true;
			const u = typeof url === "string" ? new URL(url) : url instanceof Location ? new URL(url.href) : url;
			return !!this.protocolMatches.find((protocol) => {
				if (protocol === "http") return this.isHttpMatch(u);
				if (protocol === "https") return this.isHttpsMatch(u);
				if (protocol === "file") return this.isFileMatch(u);
				if (protocol === "ftp") return this.isFtpMatch(u);
				if (protocol === "urn") return this.isUrnMatch(u);
			});
		}
		isHttpMatch(url) {
			return url.protocol === "http:" && this.isHostPathMatch(url);
		}
		isHttpsMatch(url) {
			return url.protocol === "https:" && this.isHostPathMatch(url);
		}
		isHostPathMatch(url) {
			if (!this.hostnameMatch || !this.pathnameMatch) return false;
			const hostnameMatchRegexs = [this.convertPatternToRegex(this.hostnameMatch), this.convertPatternToRegex(this.hostnameMatch.replace(/^\*\./, ""))];
			const pathnameMatchRegex = this.convertPatternToRegex(this.pathnameMatch);
			return !!hostnameMatchRegexs.find((regex) => regex.test(url.hostname)) && pathnameMatchRegex.test(url.pathname);
		}
		isFileMatch(url) {
			throw Error("Not implemented: file:// pattern matching. Open a PR to add support");
		}
		isFtpMatch(url) {
			throw Error("Not implemented: ftp:// pattern matching. Open a PR to add support");
		}
		isUrnMatch(url) {
			throw Error("Not implemented: urn:// pattern matching. Open a PR to add support");
		}
		convertPatternToRegex(pattern) {
			const starsReplaced = this.escapeForRegex(pattern).replace(/\\\*/g, ".*");
			return RegExp(`^${starsReplaced}$`);
		}
		escapeForRegex(string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	};
	var MatchPattern = _MatchPattern;
	MatchPattern.PROTOCOLS = [
		"http",
		"https",
		"file",
		"ftp",
		"urn"
	];
	var InvalidMatchPattern = class extends Error {
		constructor(matchPattern, reason) {
			super(`Invalid match pattern "${matchPattern}": ${reason}`);
		}
	};
	function validateProtocol(matchPattern, protocol) {
		if (!MatchPattern.PROTOCOLS.includes(protocol) && protocol !== "*") throw new InvalidMatchPattern(matchPattern, `${protocol} not a valid protocol (${MatchPattern.PROTOCOLS.join(", ")})`);
	}
	function validateHostname(matchPattern, hostname) {
		if (hostname.includes(":")) throw new InvalidMatchPattern(matchPattern, `Hostname cannot include a port`);
		if (hostname.includes("*") && hostname.length > 1 && !hostname.startsWith("*.")) throw new InvalidMatchPattern(matchPattern, `If using a wildcard (*), it must go at the start of the hostname`);
	}
	//#endregion
	//#region \0virtual:wxt-background-entrypoint?C:/Users/tahir/TabNotes/entrypoints/background.ts
	function print(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => print(console.debug, ...args),
		log: (...args) => print(console.log, ...args),
		warn: (...args) => print(console.warn, ...args),
		error: (...args) => print(console.error, ...args)
	};
	var ws;
	/** Connect to the websocket and listen for messages. */
	function getDevServerWebSocket() {
		if (ws == null) {
			const serverUrl = "ws://localhost:3001";
			logger.debug("Connecting to dev server @", serverUrl);
			ws = new WebSocket(serverUrl, "vite-hmr");
			ws.addWxtEventListener = ws.addEventListener.bind(ws);
			ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
				type: "custom",
				event,
				payload
			}));
			ws.addEventListener("open", () => {
				logger.debug("Connected to dev server");
			});
			ws.addEventListener("close", () => {
				logger.debug("Disconnected from dev server");
			});
			ws.addEventListener("error", (event) => {
				logger.error("Failed to connect to dev server", event);
			});
			ws.addEventListener("message", (e) => {
				try {
					const message = JSON.parse(e.data);
					if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
				} catch (err) {
					logger.error("Failed to handle message", err);
				}
			});
		}
		return ws;
	}
	/** https://developer.chrome.com/blog/longer-esw-lifetimes/ */
	function keepServiceWorkerAlive() {
		setInterval(async () => {
			await browser.runtime.getPlatformInfo();
		}, 5e3);
	}
	function reloadContentScript(payload) {
		if (browser.runtime.getManifest().manifest_version == 2) reloadContentScriptMv2(payload);
		else reloadContentScriptMv3(payload);
	}
	async function reloadContentScriptMv3({ registration, contentScript }) {
		if (registration === "runtime") await reloadRuntimeContentScriptMv3(contentScript);
		else await reloadManifestContentScriptMv3(contentScript);
	}
	async function reloadManifestContentScriptMv3(contentScript) {
		const id = `wxt:${contentScript.js[0]}`;
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const existing = registered.find((cs) => cs.id === id);
		if (existing) {
			logger.debug("Updating content script", existing);
			await browser.scripting.updateContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		} else {
			logger.debug("Registering new content script...");
			await browser.scripting.registerContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		}
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadRuntimeContentScriptMv3(contentScript) {
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const matches = registered.filter((cs) => {
			const hasJs = contentScript.js?.find((js) => cs.js?.includes(js));
			const hasCss = contentScript.css?.find((css) => cs.css?.includes(css));
			return hasJs || hasCss;
		});
		if (matches.length === 0) {
			logger.log("Content script is not registered yet, nothing to reload", contentScript);
			return;
		}
		await browser.scripting.updateContentScripts(matches);
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadTabsForContentScript(contentScript) {
		const allTabs = await browser.tabs.query({});
		const matchPatterns = contentScript.matches.map((match) => new MatchPattern(match));
		const matchingTabs = allTabs.filter((tab) => {
			const url = tab.url;
			if (!url) return false;
			return !!matchPatterns.find((pattern) => pattern.includes(url));
		});
		await Promise.all(matchingTabs.map(async (tab) => {
			try {
				await browser.tabs.reload(tab.id);
			} catch (err) {
				logger.warn("Failed to reload tab:", err);
			}
		}));
	}
	async function reloadContentScriptMv2(_payload) {
		throw Error("TODO: reloadContentScriptMv2");
	}
	try {
		const ws = getDevServerWebSocket();
		ws.addWxtEventListener("wxt:reload-extension", () => {
			browser.runtime.reload();
		});
		ws.addWxtEventListener("wxt:reload-content-script", (event) => {
			reloadContentScript(event.detail);
		});
		ws.addEventListener("open", () => ws.sendCustom("wxt:background-initialized"));
		keepServiceWorkerAlive();
	} catch (err) {
		logger.error("Failed to setup web socket connection with dev server", err);
	}
	browser.commands.onCommand.addListener((command) => {
		if (command === "wxt:reload-extension") browser.runtime.reload();
	});
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	//#endregion
	return result;
})();

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiXSwic291cmNlcyI6WyIuLi8uLi9zaGFyZWQvZ3JvdXBLZXkudHMiLCIuLi8uLi9zaGFyZWQvc3RvcmFnZS50cyIsIi4uLy4uL3NoYXJlZC90YWJDb250ZXh0LnRzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L3V0aWxzL2RlZmluZS1iYWNrZ3JvdW5kLm1qcyIsIi4uLy4uL2VudHJ5cG9pbnRzL2JhY2tncm91bmQudHMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHd4dC1kZXYvYnJvd3Nlci9zcmMvaW5kZXgubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L2Jyb3dzZXIubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL0B3ZWJleHQtY29yZS9tYXRjaC1wYXR0ZXJucy9saWIvaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBBY3RpdmVDb250ZXh0LCBHcm91cENvbnRleHQsIFNjcmF0Y2hwYWRDb250ZXh0IH0gZnJvbSAnLi90eXBlcyc7XHJcblxyXG5jb25zdCBTQ1JBVENIUEFEX0tFWSA9ICdnbG9iYWw6c2NyYXRjaHBhZCc7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlT3JpZ2luKHVybD86IHN0cmluZyB8IG51bGwpOiBzdHJpbmcge1xyXG4gIGlmICghdXJsKSB7XHJcbiAgICByZXR1cm4gJ3Vua25vd24nO1xyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIHJldHVybiBuZXcgVVJMKHVybCkuaG9zdG5hbWUgfHwgJ3Vua25vd24nO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuICd1bmtub3duJztcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdyb3VwS2V5KGdyb3VwSWQ6IG51bWJlcik6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGBncm91cDppZDoke2dyb3VwSWR9YDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNjcmF0Y2hwYWRDb250ZXh0KHRhYklkOiBudW1iZXIsIG9yaWdpbiA9ICd1bmtub3duJyk6IFNjcmF0Y2hwYWRDb250ZXh0IHtcclxuICByZXR1cm4ge1xyXG4gICAga2luZDogJ3NjcmF0Y2hwYWQnLFxyXG4gICAga2V5OiBTQ1JBVENIUEFEX0tFWSxcclxuICAgIHRpdGxlOiAnR2xvYmFsIFNjcmF0Y2hwYWQnLFxyXG4gICAgb3JpZ2luLFxyXG4gICAgdGFiSWQsXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUdyb3VwQ29udGV4dChpbnB1dDoge1xyXG4gIHRhYklkOiBudW1iZXI7XHJcbiAgZ3JvdXBJZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgY29sb3I6IHN0cmluZztcclxuICBvcmlnaW46IHN0cmluZztcclxuICB0YWJzOiBBcnJheTx7XHJcbiAgICB0YWJJZDogbnVtYmVyO1xyXG4gICAgdGl0bGU6IHN0cmluZztcclxuICAgIHVybDogc3RyaW5nO1xyXG4gIH0+O1xyXG59KTogR3JvdXBDb250ZXh0IHtcclxuICByZXR1cm4ge1xyXG4gICAga2luZDogJ2dyb3VwJyxcclxuICAgIGtleTogYnVpbGRHcm91cEtleShpbnB1dC5ncm91cElkKSxcclxuICAgIHRhYklkOiBpbnB1dC50YWJJZCxcclxuICAgIGdyb3VwSWQ6IGlucHV0Lmdyb3VwSWQsXHJcbiAgICB0aXRsZTogaW5wdXQudGl0bGUsXHJcbiAgICBjb2xvcjogaW5wdXQuY29sb3IsXHJcbiAgICBvcmlnaW46IGlucHV0Lm9yaWdpbixcclxuICAgIHRhYnM6IGlucHV0LnRhYnMsXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHByZXZpZXdUZXh0KGJvZHk6IHN0cmluZywgbWF4TGVuZ3RoID0gNzIpOiBzdHJpbmcge1xyXG4gIGNvbnN0IGZpcnN0TGluZSA9IGJvZHkuc3BsaXQoL1xccj9cXG4vKS5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKS5maW5kKEJvb2xlYW4pID8/ICcnO1xyXG5cclxuICBpZiAoZmlyc3RMaW5lLmxlbmd0aCA8PSBtYXhMZW5ndGgpIHtcclxuICAgIHJldHVybiBmaXJzdExpbmU7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gYCR7Zmlyc3RMaW5lLnNsaWNlKDAsIE1hdGgubWF4KDAsIG1heExlbmd0aCAtIDEpKS50cmltRW5kKCl94oCmYDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlQ29udGV4dChjb250ZXh0OiBBY3RpdmVDb250ZXh0KTogc3RyaW5nIHtcclxuICByZXR1cm4gY29udGV4dC5raW5kID09PSAnZ3JvdXAnID8gYCR7Y29udGV4dC50aXRsZX0gwrcgJHtjb250ZXh0LmNvbG9yfWAgOiBjb250ZXh0LnRpdGxlO1xyXG59XHJcbiIsImltcG9ydCB7IGNyZWF0ZVNjcmF0Y2hwYWRDb250ZXh0LCBwcmV2aWV3VGV4dCB9IGZyb20gJy4vZ3JvdXBLZXknO1xyXG5pbXBvcnQgdHlwZSB7IEFjdGl2ZUNvbnRleHQsIE5vdGVSZWNvcmQsIFRhYk5vdGVzU3RhdGUgfSBmcm9tICcuL3R5cGVzJztcclxuXHJcbmV4cG9ydCBjb25zdCBTVE9SQUdFX0tFWVMgPSB7XHJcbiAgbm90ZXM6ICd0YWJub3Rlcy5ub3RlcycsXHJcbiAgYWN0aXZlQ29udGV4dDogJ3RhYm5vdGVzLmFjdGl2ZUNvbnRleHQnLFxyXG59IGFzIGNvbnN0O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGVtcHR5U3RhdGUoKTogVGFiTm90ZXNTdGF0ZSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIGFjdGl2ZUNvbnRleHQ6IG51bGwsXHJcbiAgICBub3Rlczoge30sXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHROb3RlKGNvbnRleHQ6IEFjdGl2ZUNvbnRleHQpOiBOb3RlUmVjb3JkIHtcclxuICByZXR1cm4ge1xyXG4gICAga2V5OiBjb250ZXh0LmtleSxcclxuICAgIHRpdGxlOiBjb250ZXh0LnRpdGxlLFxyXG4gICAgYm9keTogJycsXHJcbiAgICBwcmV2aWV3OiAnJyxcclxuICAgIHN0YXR1czogJ2FjdGl2ZScsXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIGNvbG9yOiBjb250ZXh0LmtpbmQgPT09ICdncm91cCcgPyBjb250ZXh0LmNvbG9yIDogdW5kZWZpbmVkLFxyXG4gICAgb3JpZ2luOiBjb250ZXh0Lm9yaWdpbixcclxuICAgIGdyb3VwSWQ6IGNvbnRleHQua2luZCA9PT0gJ2dyb3VwJyA/IGNvbnRleHQuZ3JvdXBJZCA6IHVuZGVmaW5lZCxcclxuICAgIHRhYlRpdGxlczogY29udGV4dC5raW5kID09PSAnZ3JvdXAnID8gY29udGV4dC50YWJzLm1hcCgodGFiKSA9PiB0YWIudGl0bGUpIDogdW5kZWZpbmVkLFxyXG4gICAgdGFiTGlua3M6IGNvbnRleHQua2luZCA9PT0gJ2dyb3VwJyA/IGNvbnRleHQudGFicy5tYXAoKHRhYikgPT4gKHsgdGFiSWQ6IHRhYi50YWJJZCwgdGl0bGU6IHRhYi50aXRsZSwgdXJsOiB0YWIudXJsIH0pKSA6IHVuZGVmaW5lZCxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3RhbmRhbG9uZU5vdGUodGl0bGUgPSAnVW50aXRsZWQgbm90ZScpOiBOb3RlUmVjb3JkIHtcclxuICBjb25zdCBrZXkgPSBgbm90ZToke0RhdGUubm93KCl9OiR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgOCl9YDtcclxuICByZXR1cm4ge1xyXG4gICAga2V5LFxyXG4gICAgdGl0bGUsXHJcbiAgICBib2R5OiAnJyxcclxuICAgIHByZXZpZXc6ICcnLFxyXG4gICAgc3RhdHVzOiAnYWN0aXZlJyxcclxuICAgIHBpbm5lZDogZmFsc2UsXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIG9yaWdpbjogJ21hbnVhbCcsXHJcbiAgICB0YWJUaXRsZXM6IFtdLFxyXG4gICAgdGFiTGlua3M6IFtdLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkU3RhdGUoKTogUHJvbWlzZTxUYWJOb3Rlc1N0YXRlPiB7XHJcbiAgY29uc3QgcGF5bG9hZCA9IGF3YWl0IGNocm9tZS5zdG9yYWdlLmxvY2FsLmdldChbU1RPUkFHRV9LRVlTLm5vdGVzLCBTVE9SQUdFX0tFWVMuYWN0aXZlQ29udGV4dF0pO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgYWN0aXZlQ29udGV4dDogKHBheWxvYWRbU1RPUkFHRV9LRVlTLmFjdGl2ZUNvbnRleHRdIGFzIEFjdGl2ZUNvbnRleHQgfCBudWxsIHwgdW5kZWZpbmVkKSA/PyBudWxsLFxyXG4gICAgbm90ZXM6IChwYXlsb2FkW1NUT1JBR0VfS0VZUy5ub3Rlc10gYXMgUmVjb3JkPHN0cmluZywgTm90ZVJlY29yZD4gfCB1bmRlZmluZWQpID8/IHt9LFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0ZVN0YXRlKHN0YXRlOiBUYWJOb3Rlc1N0YXRlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgYXdhaXQgY2hyb21lLnN0b3JhZ2UubG9jYWwuc2V0KHtcclxuICAgIFtTVE9SQUdFX0tFWVMubm90ZXNdOiBzdGF0ZS5ub3RlcyxcclxuICAgIFtTVE9SQUdFX0tFWVMuYWN0aXZlQ29udGV4dF06IHN0YXRlLmFjdGl2ZUNvbnRleHQsXHJcbiAgfSk7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZXRBY3RpdmVDb250ZXh0KGNvbnRleHQ6IEFjdGl2ZUNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBhd2FpdCBjaHJvbWUuc3RvcmFnZS5sb2NhbC5zZXQoeyBbU1RPUkFHRV9LRVlTLmFjdGl2ZUNvbnRleHRdOiBjb250ZXh0IH0pO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBzZXJ0Tm90ZShub3RlOiBOb3RlUmVjb3JkKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3Qgc3RhdGUgPSBhd2FpdCByZWFkU3RhdGUoKTtcclxuICBjb25zdCBib2R5ID0gbm90ZS5ib2R5ID8/ICcnO1xyXG5cclxuICBzdGF0ZS5ub3Rlc1tub3RlLmtleV0gPSB7XHJcbiAgICAuLi5ub3RlLFxyXG4gICAgYm9keSxcclxuICAgIHByZXZpZXc6IG5vdGUucHJldmlldyB8fCBwcmV2aWV3VGV4dChib2R5KSxcclxuICAgIHBpbm5lZDogbm90ZS5waW5uZWQgPz8gc3RhdGUubm90ZXNbbm90ZS5rZXldPy5waW5uZWQgPz8gZmFsc2UsXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICB9O1xyXG5cclxuICBhd2FpdCB3cml0ZVN0YXRlKHN0YXRlKTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVuc3VyZUNvbnRleHROb3RlKGNvbnRleHQ6IEFjdGl2ZUNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCBzdGF0ZSA9IGF3YWl0IHJlYWRTdGF0ZSgpO1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gc3RhdGUubm90ZXNbY29udGV4dC5rZXldO1xyXG5cclxuICBpZiAoIWV4aXN0aW5nKSB7XHJcbiAgICBzdGF0ZS5ub3Rlc1tjb250ZXh0LmtleV0gPSBjcmVhdGVEZWZhdWx0Tm90ZShjb250ZXh0KTtcclxuICAgIGF3YWl0IHdyaXRlU3RhdGUoc3RhdGUpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgc3RhdGUubm90ZXNbY29udGV4dC5rZXldID0ge1xyXG4gICAgLi4uZXhpc3RpbmcsXHJcbiAgICB0aXRsZTogY29udGV4dC50aXRsZSxcclxuICAgIG9yaWdpbjogY29udGV4dC5vcmlnaW4sXHJcbiAgICBjb2xvcjogY29udGV4dC5raW5kID09PSAnZ3JvdXAnID8gY29udGV4dC5jb2xvciA6IGV4aXN0aW5nLmNvbG9yLFxyXG4gICAgZ3JvdXBJZDogY29udGV4dC5raW5kID09PSAnZ3JvdXAnID8gY29udGV4dC5ncm91cElkIDogZXhpc3RpbmcuZ3JvdXBJZCxcclxuICAgIHRhYlRpdGxlczogY29udGV4dC5raW5kID09PSAnZ3JvdXAnID8gY29udGV4dC50YWJzLm1hcCgodGFiKSA9PiB0YWIudGl0bGUpIDogZXhpc3RpbmcudGFiVGl0bGVzLFxyXG4gICAgdGFiTGlua3M6IGNvbnRleHQua2luZCA9PT0gJ2dyb3VwJyA/IGNvbnRleHQudGFicy5tYXAoKHRhYikgPT4gKHsgdGFiSWQ6IHRhYi50YWJJZCwgdGl0bGU6IHRhYi50aXRsZSwgdXJsOiB0YWIudXJsIH0pKSA6IGV4aXN0aW5nLnRhYkxpbmtzLFxyXG4gIH07XHJcblxyXG4gIGF3YWl0IHdyaXRlU3RhdGUoc3RhdGUpO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlU2luZ2xlR3JvdXBOb3RlKGNvbnRleHQ6IEFjdGl2ZUNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBpZiAoY29udGV4dC5raW5kICE9PSAnZ3JvdXAnKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCBzdGF0ZSA9IGF3YWl0IHJlYWRTdGF0ZSgpO1xyXG4gIGNvbnN0IGdyb3VwQ2FuZGlkYXRlcyA9IE9iamVjdC52YWx1ZXMoc3RhdGUubm90ZXMpLmZpbHRlcigobm90ZSkgPT4gbm90ZS5ncm91cElkID09PSBjb250ZXh0Lmdyb3VwSWQpO1xyXG5cclxuICBpZiAoZ3JvdXBDYW5kaWRhdGVzLmxlbmd0aCA8PSAxICYmIChncm91cENhbmRpZGF0ZXMubGVuZ3RoID09PSAwIHx8IGdyb3VwQ2FuZGlkYXRlc1swXS5rZXkgPT09IGNvbnRleHQua2V5KSkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgd2lubmVyID0gWy4uLmdyb3VwQ2FuZGlkYXRlc10uc29ydCgoYSwgYikgPT4ge1xyXG4gICAgY29uc3QgYVRpbWUgPSBEYXRlLnBhcnNlKGEudXBkYXRlZEF0IHx8ICcnKTtcclxuICAgIGNvbnN0IGJUaW1lID0gRGF0ZS5wYXJzZShiLnVwZGF0ZWRBdCB8fCAnJyk7XHJcbiAgICByZXR1cm4gKE51bWJlci5pc0Zpbml0ZShiVGltZSkgPyBiVGltZSA6IDApIC0gKE51bWJlci5pc0Zpbml0ZShhVGltZSkgPyBhVGltZSA6IDApO1xyXG4gIH0pWzBdO1xyXG5cclxuICBjb25zdCBjYW5vbmljYWw6IE5vdGVSZWNvcmQgPSB7XHJcbiAgICAuLi53aW5uZXIsXHJcbiAgICBrZXk6IGNvbnRleHQua2V5LFxyXG4gICAgdGl0bGU6IGNvbnRleHQudGl0bGUsXHJcbiAgICBjb2xvcjogY29udGV4dC5jb2xvcixcclxuICAgIG9yaWdpbjogY29udGV4dC5vcmlnaW4sXHJcbiAgICBncm91cElkOiBjb250ZXh0Lmdyb3VwSWQsXHJcbiAgICB0YWJUaXRsZXM6IGNvbnRleHQudGFicy5tYXAoKHRhYikgPT4gdGFiLnRpdGxlKSxcclxuICAgIHRhYkxpbmtzOiBjb250ZXh0LnRhYnMubWFwKCh0YWIpID0+ICh7IHRhYklkOiB0YWIudGFiSWQsIHRpdGxlOiB0YWIudGl0bGUsIHVybDogdGFiLnVybCB9KSksXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICB9O1xyXG5cclxuICBncm91cENhbmRpZGF0ZXMuZm9yRWFjaCgoY2FuZGlkYXRlKSA9PiB7XHJcbiAgICBkZWxldGUgc3RhdGUubm90ZXNbY2FuZGlkYXRlLmtleV07XHJcbiAgfSk7XHJcblxyXG4gIHN0YXRlLm5vdGVzW2NvbnRleHQua2V5XSA9IGNhbm9uaWNhbDtcclxuICBhd2FpdCB3cml0ZVN0YXRlKHN0YXRlKTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFyY2hpdmVOb3RlKGtleTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3Qgc3RhdGUgPSBhd2FpdCByZWFkU3RhdGUoKTtcclxuICBjb25zdCBub3RlID0gc3RhdGUubm90ZXNba2V5XTtcclxuXHJcbiAgaWYgKCFub3RlKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBzdGF0ZS5ub3Rlc1trZXldID0ge1xyXG4gICAgLi4ubm90ZSxcclxuICAgIHN0YXR1czogJ2FyY2hpdmVkJyxcclxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gIH07XHJcblxyXG4gIGF3YWl0IHdyaXRlU3RhdGUoc3RhdGUpO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzdG9yZU5vdGUoa2V5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCBzdGF0ZSA9IGF3YWl0IHJlYWRTdGF0ZSgpO1xyXG4gIGNvbnN0IG5vdGUgPSBzdGF0ZS5ub3Rlc1trZXldO1xyXG5cclxuICBpZiAoIW5vdGUpIHtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIHN0YXRlLm5vdGVzW2tleV0gPSB7XHJcbiAgICAuLi5ub3RlLFxyXG4gICAgc3RhdHVzOiAnYWN0aXZlJyxcclxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gIH07XHJcblxyXG4gIGF3YWl0IHdyaXRlU3RhdGUoc3RhdGUpO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlTm90ZShrZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnN0IHN0YXRlID0gYXdhaXQgcmVhZFN0YXRlKCk7XHJcblxyXG4gIGlmICghKGtleSBpbiBzdGF0ZS5ub3RlcykpIHtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGRlbGV0ZSBzdGF0ZS5ub3Rlc1trZXldO1xyXG4gIGF3YWl0IHdyaXRlU3RhdGUoc3RhdGUpO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2V0UGlubmVkU3RhdGUoa2V5OiBzdHJpbmcsIHBpbm5lZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnN0IHN0YXRlID0gYXdhaXQgcmVhZFN0YXRlKCk7XHJcbiAgY29uc3Qgbm90ZSA9IHN0YXRlLm5vdGVzW2tleV07XHJcblxyXG4gIGlmICghbm90ZSkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgc3RhdGUubm90ZXNba2V5XSA9IHtcclxuICAgIC4uLm5vdGUsXHJcbiAgICBwaW5uZWQsXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICB9O1xyXG5cclxuICBhd2FpdCB3cml0ZVN0YXRlKHN0YXRlKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHN1YnNjcmliZVRvU3RhdGVDaGFuZ2VzKG9uQ2hhbmdlOiAoc3RhdGU6IFRhYk5vdGVzU3RhdGUpID0+IHZvaWQpOiAoKSA9PiB2b2lkIHtcclxuICBjb25zdCBsaXN0ZW5lciA9IChjaGFuZ2VzOiBSZWNvcmQ8c3RyaW5nLCB7IG5ld1ZhbHVlPzogdW5rbm93biB9PiwgYXJlYU5hbWU6IHN0cmluZykgPT4ge1xyXG4gICAgaWYgKGFyZWFOYW1lICE9PSAnbG9jYWwnKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBuZXh0U3RhdGU6IFRhYk5vdGVzU3RhdGUgPSBlbXB0eVN0YXRlKCk7XHJcblxyXG4gICAgaWYgKFNUT1JBR0VfS0VZUy5ub3RlcyBpbiBjaGFuZ2VzKSB7XHJcbiAgICAgIG5leHRTdGF0ZS5ub3RlcyA9IChjaGFuZ2VzW1NUT1JBR0VfS0VZUy5ub3Rlc10ubmV3VmFsdWUgYXMgUmVjb3JkPHN0cmluZywgTm90ZVJlY29yZD4gfCB1bmRlZmluZWQpID8/IHt9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChTVE9SQUdFX0tFWVMuYWN0aXZlQ29udGV4dCBpbiBjaGFuZ2VzKSB7XHJcbiAgICAgIG5leHRTdGF0ZS5hY3RpdmVDb250ZXh0ID0gKGNoYW5nZXNbU1RPUkFHRV9LRVlTLmFjdGl2ZUNvbnRleHRdLm5ld1ZhbHVlIGFzIEFjdGl2ZUNvbnRleHQgfCBudWxsIHwgdW5kZWZpbmVkKSA/PyBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChTVE9SQUdFX0tFWVMubm90ZXMgaW4gY2hhbmdlcyB8fCBTVE9SQUdFX0tFWVMuYWN0aXZlQ29udGV4dCBpbiBjaGFuZ2VzKSB7XHJcbiAgICAgIG9uQ2hhbmdlKG5leHRTdGF0ZSk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY2hyb21lLnN0b3JhZ2Uub25DaGFuZ2VkLmFkZExpc3RlbmVyKGxpc3RlbmVyKTtcclxuICByZXR1cm4gKCkgPT4gY2hyb21lLnN0b3JhZ2Uub25DaGFuZ2VkLnJlbW92ZUxpc3RlbmVyKGxpc3RlbmVyKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIG5vdGVGb3JDb250ZXh0KHN0YXRlOiBUYWJOb3Rlc1N0YXRlLCBjb250ZXh0OiBBY3RpdmVDb250ZXh0KTogTm90ZVJlY29yZCB7XHJcbiAgcmV0dXJuIHN0YXRlLm5vdGVzW2NvbnRleHQua2V5XSA/PyBjcmVhdGVEZWZhdWx0Tm90ZShjb250ZXh0KTtcclxufVxyXG4iLCJpbXBvcnQgeyBjcmVhdGVHcm91cENvbnRleHQsIGNyZWF0ZVNjcmF0Y2hwYWRDb250ZXh0LCBkZXJpdmVPcmlnaW4gfSBmcm9tICcuL2dyb3VwS2V5JztcclxuaW1wb3J0IHR5cGUgeyBBY3RpdmVDb250ZXh0IH0gZnJvbSAnLi90eXBlcyc7XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNvbnRleHRGcm9tVGFiSWQodGFiSWQ6IG51bWJlcik6IFByb21pc2U8QWN0aXZlQ29udGV4dD4ge1xyXG4gIGNvbnN0IHRhYiA9IGF3YWl0IGNocm9tZS50YWJzLmdldCh0YWJJZCk7XHJcbiAgY29uc3Qgb3JpZ2luID0gZGVyaXZlT3JpZ2luKHRhYi51cmwgPz8gbnVsbCk7XHJcblxyXG4gIGlmICh0eXBlb2YgdGFiLmdyb3VwSWQgIT09ICdudW1iZXInIHx8IHRhYi5ncm91cElkID09PSAtMSkge1xyXG4gICAgcmV0dXJuIGNyZWF0ZVNjcmF0Y2hwYWRDb250ZXh0KHRhYklkLCBvcmlnaW4pO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgZ3JvdXAgPSBhd2FpdCBjaHJvbWUudGFiR3JvdXBzLmdldCh0YWIuZ3JvdXBJZCk7XHJcbiAgY29uc3QgZ3JvdXBlZFRhYnMgPSBhd2FpdCBjaHJvbWUudGFicy5xdWVyeSh7IGdyb3VwSWQ6IHRhYi5ncm91cElkIH0pO1xyXG5cclxuICByZXR1cm4gY3JlYXRlR3JvdXBDb250ZXh0KHtcclxuICAgIHRhYklkLFxyXG4gICAgZ3JvdXBJZDogdGFiLmdyb3VwSWQsXHJcbiAgICB0aXRsZTogZ3JvdXAudGl0bGU/LnRyaW0oKSB8fCB0YWIudGl0bGU/LnRyaW0oKSB8fCAnVW50aXRsZWQgR3JvdXAnLFxyXG4gICAgY29sb3I6IGdyb3VwLmNvbG9yIHx8ICdncmV5JyxcclxuICAgIG9yaWdpbixcclxuICAgIHRhYnM6IGdyb3VwZWRUYWJzXHJcbiAgICAgIC5maWx0ZXIoKGdyb3VwZWRUYWI6IHsgaWQ/OiBudW1iZXIgfSkgPT4gdHlwZW9mIGdyb3VwZWRUYWIuaWQgPT09ICdudW1iZXInKVxyXG4gICAgICAubWFwKChncm91cGVkVGFiOiB7IGlkPzogbnVtYmVyOyB0aXRsZT86IHN0cmluZzsgdXJsPzogc3RyaW5nIH0pID0+ICh7XHJcbiAgICAgICAgdGFiSWQ6IGdyb3VwZWRUYWIuaWQgYXMgbnVtYmVyLFxyXG4gICAgICAgIHRpdGxlOiBncm91cGVkVGFiLnRpdGxlPy50cmltKCkgfHwgJ1VudGl0bGVkIFRhYicsXHJcbiAgICAgICAgdXJsOiBncm91cGVkVGFiLnVybCB8fCAnJyxcclxuICAgICAgfSkpLFxyXG4gIH0pO1xyXG59XHJcbiIsIi8vI3JlZ2lvbiBzcmMvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQudHNcbmZ1bmN0aW9uIGRlZmluZUJhY2tncm91bmQoYXJnKSB7XG5cdGlmIChhcmcgPT0gbnVsbCB8fCB0eXBlb2YgYXJnID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB7IG1haW46IGFyZyB9O1xuXHRyZXR1cm4gYXJnO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBkZWZpbmVCYWNrZ3JvdW5kIH07XG4iLCJpbXBvcnQgeyBlbnN1cmVDb250ZXh0Tm90ZSwgZW5zdXJlU2luZ2xlR3JvdXBOb3RlLCBzZXRBY3RpdmVDb250ZXh0IH0gZnJvbSAnLi4vc2hhcmVkL3N0b3JhZ2UnO1xyXG5pbXBvcnQgeyByZXNvbHZlQ29udGV4dEZyb21UYWJJZCB9IGZyb20gJy4uL3NoYXJlZC90YWJDb250ZXh0JztcclxuaW1wb3J0IHsgZGVmaW5lQmFja2dyb3VuZCB9IGZyb20gJ3d4dC91dGlscy9kZWZpbmUtYmFja2dyb3VuZCc7XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzeW5jVGFiQ29udGV4dCh0YWJJZDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgY29udGV4dCA9IGF3YWl0IHJlc29sdmVDb250ZXh0RnJvbVRhYklkKHRhYklkKTtcclxuICBhd2FpdCBlbnN1cmVTaW5nbGVHcm91cE5vdGUoY29udGV4dCk7XHJcbiAgYXdhaXQgZW5zdXJlQ29udGV4dE5vdGUoY29udGV4dCk7XHJcbiAgYXdhaXQgc2V0QWN0aXZlQ29udGV4dChjb250ZXh0KTtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQmFja2dyb3VuZCgoKSA9PiB7XHJcbiAgY2hyb21lLmFjdGlvbi5vbkNsaWNrZWQuYWRkTGlzdGVuZXIoKHRhYjogeyB3aW5kb3dJZD86IG51bWJlciB9KSA9PiB7XHJcbiAgICBpZiAodHlwZW9mIHRhYi53aW5kb3dJZCA9PT0gJ251bWJlcicpIHtcclxuICAgICAgdm9pZCBjaHJvbWUuc2lkZVBhbmVsLm9wZW4oeyB3aW5kb3dJZDogdGFiLndpbmRvd0lkIH0pO1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBjaHJvbWUucnVudGltZS5vbkluc3RhbGxlZC5hZGRMaXN0ZW5lcigoKSA9PiB7XHJcbiAgICB2b2lkIGJvb3RzdHJhcCgpO1xyXG4gIH0pO1xyXG5cclxuICBjaHJvbWUucnVudGltZS5vblN0YXJ0dXAuYWRkTGlzdGVuZXIoKCkgPT4ge1xyXG4gICAgdm9pZCBib290c3RyYXAoKTtcclxuICB9KTtcclxuXHJcbiAgY2hyb21lLnRhYnMub25BY3RpdmF0ZWQuYWRkTGlzdGVuZXIoKHsgdGFiSWQgfTogeyB0YWJJZDogbnVtYmVyIH0pID0+IHtcclxuICAgIHZvaWQgc3luY1RhYkNvbnRleHQodGFiSWQpO1xyXG4gIH0pO1xyXG5cclxuICBjaHJvbWUudGFicy5vblVwZGF0ZWQuYWRkTGlzdGVuZXIoKHRhYklkOiBudW1iZXIsIGNoYW5nZUluZm86IHsgc3RhdHVzPzogc3RyaW5nIH0pID0+IHtcclxuICAgIGlmIChjaGFuZ2VJbmZvLnN0YXR1cyA9PT0gJ2NvbXBsZXRlJykge1xyXG4gICAgICB2b2lkIHN5bmNUYWJDb250ZXh0KHRhYklkKTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgY2hyb21lLnRhYkdyb3Vwcy5vblVwZGF0ZWQuYWRkTGlzdGVuZXIoKGdyb3VwOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xyXG4gICAgdm9pZCBjaHJvbWUudGFicy5xdWVyeSh7IGdyb3VwSWQ6IGdyb3VwLmlkIH0pLnRoZW4oKHRhYnM6IEFycmF5PHsgaWQ/OiBudW1iZXIgfT4pID0+IHtcclxuICAgICAgY29uc3QgZmlyc3RUYWIgPSB0YWJzLmZpbmQoKHRhYikgPT4gdHlwZW9mIHRhYi5pZCA9PT0gJ251bWJlcicpO1xyXG4gICAgICBpZiAoZmlyc3RUYWI/LmlkICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB2b2lkIHN5bmNUYWJDb250ZXh0KGZpcnN0VGFiLmlkKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbn0pO1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gYm9vdHN0cmFwKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnN0IFthY3RpdmVUYWJdID0gYXdhaXQgY2hyb21lLnRhYnMucXVlcnkoeyBhY3RpdmU6IHRydWUsIGN1cnJlbnRXaW5kb3c6IHRydWUgfSk7XHJcblxyXG4gIGlmIChhY3RpdmVUYWI/LmlkICE9PSB1bmRlZmluZWQpIHtcclxuICAgIGF3YWl0IHN5bmNUYWJDb250ZXh0KGFjdGl2ZVRhYi5pZCk7XHJcbiAgfVxyXG59XHJcbiIsIi8vICNyZWdpb24gc25pcHBldFxuZXhwb3J0IGNvbnN0IGJyb3dzZXIgPSBnbG9iYWxUaGlzLmJyb3dzZXI/LnJ1bnRpbWU/LmlkXG4gID8gZ2xvYmFsVGhpcy5icm93c2VyXG4gIDogZ2xvYmFsVGhpcy5jaHJvbWU7XG4vLyAjZW5kcmVnaW9uIHNuaXBwZXRcbiIsImltcG9ydCB7IGJyb3dzZXIgYXMgYnJvd3NlciQxIH0gZnJvbSBcIkB3eHQtZGV2L2Jyb3dzZXJcIjtcbi8vI3JlZ2lvbiBzcmMvYnJvd3Nlci50c1xuLyoqXG4qIENvbnRhaW5zIHRoZSBgYnJvd3NlcmAgZXhwb3J0IHdoaWNoIHlvdSBzaG91bGQgdXNlIHRvIGFjY2VzcyB0aGUgZXh0ZW5zaW9uXG4qIEFQSXMgaW4geW91ciBwcm9qZWN0OlxuKlxuKiBgYGB0c1xuKiBpbXBvcnQgeyBicm93c2VyIH0gZnJvbSAnd3h0L2Jyb3dzZXInO1xuKlxuKiBicm93c2VyLnJ1bnRpbWUub25JbnN0YWxsZWQuYWRkTGlzdGVuZXIoKCkgPT4ge1xuKiAgIC8vIC4uLlxuKiB9KTtcbiogYGBgXG4qXG4qIEBtb2R1bGUgd3h0L2Jyb3dzZXJcbiovXG5jb25zdCBicm93c2VyID0gYnJvd3NlciQxO1xuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBicm93c2VyIH07XG4iLCIvLyBzcmMvaW5kZXgudHNcbnZhciBfTWF0Y2hQYXR0ZXJuID0gY2xhc3Mge1xuICBjb25zdHJ1Y3RvcihtYXRjaFBhdHRlcm4pIHtcbiAgICBpZiAobWF0Y2hQYXR0ZXJuID09PSBcIjxhbGxfdXJscz5cIikge1xuICAgICAgdGhpcy5pc0FsbFVybHMgPSB0cnVlO1xuICAgICAgdGhpcy5wcm90b2NvbE1hdGNoZXMgPSBbLi4uX01hdGNoUGF0dGVybi5QUk9UT0NPTFNdO1xuICAgICAgdGhpcy5ob3N0bmFtZU1hdGNoID0gXCIqXCI7XG4gICAgICB0aGlzLnBhdGhuYW1lTWF0Y2ggPSBcIipcIjtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZ3JvdXBzID0gLyguKik6XFwvXFwvKC4qPykoXFwvLiopLy5leGVjKG1hdGNoUGF0dGVybik7XG4gICAgICBpZiAoZ3JvdXBzID09IG51bGwpXG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgXCJJbmNvcnJlY3QgZm9ybWF0XCIpO1xuICAgICAgY29uc3QgW18sIHByb3RvY29sLCBob3N0bmFtZSwgcGF0aG5hbWVdID0gZ3JvdXBzO1xuICAgICAgdmFsaWRhdGVQcm90b2NvbChtYXRjaFBhdHRlcm4sIHByb3RvY29sKTtcbiAgICAgIHZhbGlkYXRlSG9zdG5hbWUobWF0Y2hQYXR0ZXJuLCBob3N0bmFtZSk7XG4gICAgICB2YWxpZGF0ZVBhdGhuYW1lKG1hdGNoUGF0dGVybiwgcGF0aG5hbWUpO1xuICAgICAgdGhpcy5wcm90b2NvbE1hdGNoZXMgPSBwcm90b2NvbCA9PT0gXCIqXCIgPyBbXCJodHRwXCIsIFwiaHR0cHNcIl0gOiBbcHJvdG9jb2xdO1xuICAgICAgdGhpcy5ob3N0bmFtZU1hdGNoID0gaG9zdG5hbWU7XG4gICAgICB0aGlzLnBhdGhuYW1lTWF0Y2ggPSBwYXRobmFtZTtcbiAgICB9XG4gIH1cbiAgaW5jbHVkZXModXJsKSB7XG4gICAgaWYgKHRoaXMuaXNBbGxVcmxzKVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgY29uc3QgdSA9IHR5cGVvZiB1cmwgPT09IFwic3RyaW5nXCIgPyBuZXcgVVJMKHVybCkgOiB1cmwgaW5zdGFuY2VvZiBMb2NhdGlvbiA/IG5ldyBVUkwodXJsLmhyZWYpIDogdXJsO1xuICAgIHJldHVybiAhIXRoaXMucHJvdG9jb2xNYXRjaGVzLmZpbmQoKHByb3RvY29sKSA9PiB7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwiaHR0cFwiKVxuICAgICAgICByZXR1cm4gdGhpcy5pc0h0dHBNYXRjaCh1KTtcbiAgICAgIGlmIChwcm90b2NvbCA9PT0gXCJodHRwc1wiKVxuICAgICAgICByZXR1cm4gdGhpcy5pc0h0dHBzTWF0Y2godSk7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwiZmlsZVwiKVxuICAgICAgICByZXR1cm4gdGhpcy5pc0ZpbGVNYXRjaCh1KTtcbiAgICAgIGlmIChwcm90b2NvbCA9PT0gXCJmdHBcIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNGdHBNYXRjaCh1KTtcbiAgICAgIGlmIChwcm90b2NvbCA9PT0gXCJ1cm5cIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNVcm5NYXRjaCh1KTtcbiAgICB9KTtcbiAgfVxuICBpc0h0dHBNYXRjaCh1cmwpIHtcbiAgICByZXR1cm4gdXJsLnByb3RvY29sID09PSBcImh0dHA6XCIgJiYgdGhpcy5pc0hvc3RQYXRoTWF0Y2godXJsKTtcbiAgfVxuICBpc0h0dHBzTWF0Y2godXJsKSB7XG4gICAgcmV0dXJuIHVybC5wcm90b2NvbCA9PT0gXCJodHRwczpcIiAmJiB0aGlzLmlzSG9zdFBhdGhNYXRjaCh1cmwpO1xuICB9XG4gIGlzSG9zdFBhdGhNYXRjaCh1cmwpIHtcbiAgICBpZiAoIXRoaXMuaG9zdG5hbWVNYXRjaCB8fCAhdGhpcy5wYXRobmFtZU1hdGNoKVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IGhvc3RuYW1lTWF0Y2hSZWdleHMgPSBbXG4gICAgICB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLmhvc3RuYW1lTWF0Y2gpLFxuICAgICAgdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5ob3N0bmFtZU1hdGNoLnJlcGxhY2UoL15cXCpcXC4vLCBcIlwiKSlcbiAgICBdO1xuICAgIGNvbnN0IHBhdGhuYW1lTWF0Y2hSZWdleCA9IHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMucGF0aG5hbWVNYXRjaCk7XG4gICAgcmV0dXJuICEhaG9zdG5hbWVNYXRjaFJlZ2V4cy5maW5kKChyZWdleCkgPT4gcmVnZXgudGVzdCh1cmwuaG9zdG5hbWUpKSAmJiBwYXRobmFtZU1hdGNoUmVnZXgudGVzdCh1cmwucGF0aG5hbWUpO1xuICB9XG4gIGlzRmlsZU1hdGNoKHVybCkge1xuICAgIHRocm93IEVycm9yKFwiTm90IGltcGxlbWVudGVkOiBmaWxlOi8vIHBhdHRlcm4gbWF0Y2hpbmcuIE9wZW4gYSBQUiB0byBhZGQgc3VwcG9ydFwiKTtcbiAgfVxuICBpc0Z0cE1hdGNoKHVybCkge1xuICAgIHRocm93IEVycm9yKFwiTm90IGltcGxlbWVudGVkOiBmdHA6Ly8gcGF0dGVybiBtYXRjaGluZy4gT3BlbiBhIFBSIHRvIGFkZCBzdXBwb3J0XCIpO1xuICB9XG4gIGlzVXJuTWF0Y2godXJsKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IHVybjovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG4gIH1cbiAgY29udmVydFBhdHRlcm5Ub1JlZ2V4KHBhdHRlcm4pIHtcbiAgICBjb25zdCBlc2NhcGVkID0gdGhpcy5lc2NhcGVGb3JSZWdleChwYXR0ZXJuKTtcbiAgICBjb25zdCBzdGFyc1JlcGxhY2VkID0gZXNjYXBlZC5yZXBsYWNlKC9cXFxcXFwqL2csIFwiLipcIik7XG4gICAgcmV0dXJuIFJlZ0V4cChgXiR7c3RhcnNSZXBsYWNlZH0kYCk7XG4gIH1cbiAgZXNjYXBlRm9yUmVnZXgoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG4gIH1cbn07XG52YXIgTWF0Y2hQYXR0ZXJuID0gX01hdGNoUGF0dGVybjtcbk1hdGNoUGF0dGVybi5QUk9UT0NPTFMgPSBbXCJodHRwXCIsIFwiaHR0cHNcIiwgXCJmaWxlXCIsIFwiZnRwXCIsIFwidXJuXCJdO1xudmFyIEludmFsaWRNYXRjaFBhdHRlcm4gPSBjbGFzcyBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWF0Y2hQYXR0ZXJuLCByZWFzb24pIHtcbiAgICBzdXBlcihgSW52YWxpZCBtYXRjaCBwYXR0ZXJuIFwiJHttYXRjaFBhdHRlcm59XCI6ICR7cmVhc29ufWApO1xuICB9XG59O1xuZnVuY3Rpb24gdmFsaWRhdGVQcm90b2NvbChtYXRjaFBhdHRlcm4sIHByb3RvY29sKSB7XG4gIGlmICghTWF0Y2hQYXR0ZXJuLlBST1RPQ09MUy5pbmNsdWRlcyhwcm90b2NvbCkgJiYgcHJvdG9jb2wgIT09IFwiKlwiKVxuICAgIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKFxuICAgICAgbWF0Y2hQYXR0ZXJuLFxuICAgICAgYCR7cHJvdG9jb2x9IG5vdCBhIHZhbGlkIHByb3RvY29sICgke01hdGNoUGF0dGVybi5QUk9UT0NPTFMuam9pbihcIiwgXCIpfSlgXG4gICAgKTtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlSG9zdG5hbWUobWF0Y2hQYXR0ZXJuLCBob3N0bmFtZSkge1xuICBpZiAoaG9zdG5hbWUuaW5jbHVkZXMoXCI6XCIpKVxuICAgIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgYEhvc3RuYW1lIGNhbm5vdCBpbmNsdWRlIGEgcG9ydGApO1xuICBpZiAoaG9zdG5hbWUuaW5jbHVkZXMoXCIqXCIpICYmIGhvc3RuYW1lLmxlbmd0aCA+IDEgJiYgIWhvc3RuYW1lLnN0YXJ0c1dpdGgoXCIqLlwiKSlcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihcbiAgICAgIG1hdGNoUGF0dGVybixcbiAgICAgIGBJZiB1c2luZyBhIHdpbGRjYXJkICgqKSwgaXQgbXVzdCBnbyBhdCB0aGUgc3RhcnQgb2YgdGhlIGhvc3RuYW1lYFxuICAgICk7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZVBhdGhuYW1lKG1hdGNoUGF0dGVybiwgcGF0aG5hbWUpIHtcbiAgcmV0dXJuO1xufVxuZXhwb3J0IHtcbiAgSW52YWxpZE1hdGNoUGF0dGVybixcbiAgTWF0Y2hQYXR0ZXJuXG59O1xuIl0sInhfZ29vZ2xlX2lnbm9yZUxpc3QiOlszLDUsNiw3XSwibWFwcGluZ3MiOiI7O0NBRUEsSUFBTSxpQkFBaUI7Q0FFdkIsU0FBZ0IsYUFBYSxLQUE2QjtFQUN4RCxJQUFJLENBQUMsS0FDSCxPQUFPO0VBR1QsSUFBSTtHQUNGLE9BQU8sSUFBSSxJQUFJLEdBQUcsRUFBRSxZQUFZO0VBQ2xDLFFBQVE7R0FDTixPQUFPO0VBQ1Q7Q0FDRjtDQUVBLFNBQWdCLGNBQWMsU0FBeUI7RUFDckQsT0FBTyxZQUFZO0NBQ3JCO0NBRUEsU0FBZ0Isd0JBQXdCLE9BQWUsU0FBUyxXQUE4QjtFQUM1RixPQUFPO0dBQ0wsTUFBTTtHQUNOLEtBQUs7R0FDTCxPQUFPO0dBQ1A7R0FDQTtFQUNGO0NBQ0Y7Q0FFQSxTQUFnQixtQkFBbUIsT0FXbEI7RUFDZixPQUFPO0dBQ0wsTUFBTTtHQUNOLEtBQUssY0FBYyxNQUFNLE9BQU87R0FDaEMsT0FBTyxNQUFNO0dBQ2IsU0FBUyxNQUFNO0dBQ2YsT0FBTyxNQUFNO0dBQ2IsT0FBTyxNQUFNO0dBQ2IsUUFBUSxNQUFNO0dBQ2QsTUFBTSxNQUFNO0VBQ2Q7Q0FDRjs7O0NDakRBLElBQWEsZUFBZTtFQUMxQixPQUFPO0VBQ1AsZUFBZTtDQUNqQjtDQVNBLFNBQWdCLGtCQUFrQixTQUFvQztFQUNwRSxPQUFPO0dBQ0wsS0FBSyxRQUFRO0dBQ2IsT0FBTyxRQUFRO0dBQ2YsTUFBTTtHQUNOLFNBQVM7R0FDVCxRQUFRO0dBQ1IsNEJBQVcsSUFBSSxLQUFLLEdBQUUsWUFBWTtHQUNsQyxPQUFPLFFBQVEsU0FBUyxVQUFVLFFBQVEsUUFBUSxLQUFBO0dBQ2xELFFBQVEsUUFBUTtHQUNoQixTQUFTLFFBQVEsU0FBUyxVQUFVLFFBQVEsVUFBVSxLQUFBO0dBQ3RELFdBQVcsUUFBUSxTQUFTLFVBQVUsUUFBUSxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssSUFBSSxLQUFBO0dBQzdFLFVBQVUs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