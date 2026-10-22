window.__ModuleLoader__.load({
	id: "notix-dsh-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/client/locales.js
		/** English copy. */
		const en = {
			title: "Notix notifications",
			description: "System notifications for approvals, pending questions, long tasks, errors and completions.",
			summaryTriggers: "Triggers on",
			summaryQuietHours: "quiet hours",
			summaryChannel: "macOS channel",
			summaryOn: "on",
			summaryOff: "off",
			loading: "Loading settings…",
			unavailable: "The Notix plugin is not loaded, so it cannot be configured right now.",
			readOnly: "This deployment stores settings read-only; the fields below are not editable.",
			saving: "Saving…",
			saved: "Saved.",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			reloadNote: "Changes take effect immediately.",
			sectionTriggers: "When to notify",
			sectionQuietHours: "Quiet hours",
			sectionContent: "Notification content",
			sectionChannel: "macOS channel",
			triggerApproval: "Approval requests",
			triggerApprovalHint: "Notify when a tool call waits for your approval.",
			triggerUserQuestion: "Pending questions",
			triggerUserQuestionHint: "Notify when the Agent asks you a question.",
			triggerLongTask: "Long-running tasks",
			triggerLongTaskHint: "Notify when a turn or background job runs longer than the thresholds.",
			triggerError: "Errors",
			triggerErrorHint: "Notify when a tool call fails.",
			triggerCompletion: "Turn completion",
			triggerCompletionHint: "Notify when a long turn finishes.",
			fieldRemindAfter: "Remind after (min)",
			fieldMaxReminders: "Max reminders",
			fieldRemindOnContinued: "Keep reminding while unanswered",
			fieldTurnThreshold: "Turn threshold (min)",
			fieldJobThreshold: "Job threshold (min)",
			fieldCooldown: "Cooldown (min)",
			fieldToolErrors: "Tool errors",
			fieldToolTimeout: "Tool timeouts",
			fieldMinDuration: "Completion notification min duration (min)",
			fieldJobs: "Include background jobs",
			quietEnabled: "Enable quiet hours",
			quietFrom: "From",
			quietTo: "To",
			quietAllowUrgent: "Allow urgent notifications (approvals)",
			fieldLanguage: "Language",
			languageZh: "中文",
			languageEn: "English",
			fieldVerbosity: "Verbosity",
			verbosityMinimal: "Minimal",
			verbosityNormal: "Normal",
			channelEnabled: "Enable macOS notifications",
			channelSound: "Play sound",
			channelClickToOpen: "Click to open Harness",
			channelBaseUrl: "Harness URL for click-to-open",
			channelBaseUrlHint: "Leave blank to use the default address.",
			testNotify: "Send test notification",
			testNotifyHint: "Needs a Host-side API and ships in a later release. For now, save any change to let the Host verify the delivery path.",
			invalidNumber: "Enter a non-negative number, within the allowed range."
		};
		/** Simplified Chinese copy. */
		const zh = {
			title: "Notix 通知",
			description: "为审批、待回答问题、长任务、错误和完成事件发送系统通知。",
			summaryTriggers: "已启用触发器",
			summaryQuietHours: "免打扰",
			summaryChannel: "macOS 渠道",
			summaryOn: "开",
			summaryOff: "关",
			loading: "正在加载设置…",
			unavailable: "Notix 插件当前未加载，暂时无法配置。",
			readOnly: "本部署的设置为只读，以下字段不可编辑。",
			saving: "保存中…",
			saved: "已保存。",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			reloadNote: "修改即时生效。",
			sectionTriggers: "触发时机",
			sectionQuietHours: "免打扰",
			sectionContent: "通知内容",
			sectionChannel: "macOS 渠道",
			triggerApproval: "审批请求",
			triggerApprovalHint: "工具调用等待你批准时通知。",
			triggerUserQuestion: "待回答问题",
			triggerUserQuestionHint: "Agent 向你提问并等待回答时通知。",
			triggerLongTask: "长任务",
			triggerLongTaskHint: "轮次或后台任务运行超过阈值时通知。",
			triggerError: "错误",
			triggerErrorHint: "工具调用失败时通知。",
			triggerCompletion: "轮次完成",
			triggerCompletionHint: "较长的轮次结束时通知。",
			fieldRemindAfter: "提醒间隔（分钟）",
			fieldMaxReminders: "最多提醒次数",
			fieldRemindOnContinued: "未回答时持续提醒",
			fieldTurnThreshold: "轮次阈值（分钟）",
			fieldJobThreshold: "任务阈值（分钟）",
			fieldCooldown: "冷却时间（分钟）",
			fieldToolErrors: "工具错误",
			fieldToolTimeout: "工具超时",
			fieldMinDuration: "任务完成通知最短时长（分钟）",
			fieldJobs: "包含后台任务",
			quietEnabled: "启用免打扰时段",
			quietFrom: "开始",
			quietTo: "结束",
			quietAllowUrgent: "允许紧急通知（审批）",
			fieldLanguage: "语言",
			languageZh: "中文",
			languageEn: "English",
			fieldVerbosity: "详略程度",
			verbosityMinimal: "简洁",
			verbosityNormal: "常规",
			channelEnabled: "启用 macOS 通知",
			channelSound: "播放声音",
			channelClickToOpen: "点击打开 Harness",
			channelBaseUrl: "点击跳转的 Harness 地址",
			channelBaseUrlHint: "留空使用默认地址。",
			testNotify: "发送测试通知",
			testNotifyHint: "该能力需要 Host 侧接口，将在后续版本提供；当前可先保存任一修改，由 Host 侧验证通知链路。",
			invalidNumber: "请输入范围内不小于 0 的数字。"
		};
		//#endregion
		//#region lib/client/styles.js
		/**
		* One small stylesheet for the card, injected once like other client plugins
		* do. The layout mirrors the built-in settings pages: sections are titled
		* groups of `.5px`-stroked cards (settings-models' rowCard), each trigger is
		* a "label + description left, switch right" row (settings-general's
		* DeveloperToolsRow), and sub-fields are "label left, control right" rows
		* with SettingsValueField-style inputs. Colors come from theme variables
		* only, so the card follows light/dark themes.
		*/
		const CSS = [
			".notix-card{box-sizing:border-box;max-width:640px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:24px;font-size:13px;line-height:1.5;display:flex}",
			".notix-card *{box-sizing:border-box}",
			".notix-summary{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}",
			".notix-section{flex-direction:column;gap:10px;display:flex}",
			".notix-section-title{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}",
			".notix-group{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-alias-settings-card-fill,transparent);padding:0 14px}",
			".notix-trigger{padding:12px 0}",
			".notix-trigger+.notix-trigger{border-top:.5px solid var(--dsw-alias-border-l2)}",
			".notix-trigger-head{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}",
			".notix-trigger-text{flex:1;min-width:0}",
			".notix-trigger-title{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}",
			".notix-trigger-hint{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".notix-fields{flex-direction:column;display:flex}",
			".notix-trigger .notix-fields{margin-top:4px}",
			".notix-group>.notix-fields{padding:6px 0}",
			".notix-fields-disabled{opacity:.55}",
			".notix-field{flex-direction:column;gap:2px;padding:4px 0;display:flex}",
			".notix-field-row{justify-content:space-between;align-items:center;gap:16px;min-height:32px;padding:4px 0;display:flex}",
			".notix-field-label{flex:1;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
			".notix-field-message{margin:0;font-size:12px;line-height:18px}",
			".notix-field-error{color:var(--dsw-alias-state-error-primary,#d03050)}",
			".notix-field-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".notix-input{height:28px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-3,transparent);padding:0 10px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);outline:none}",
			".notix-input::placeholder{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary))}",
			".notix-input:focus-visible{border-color:var(--dsw-alias-state-business-primary,#3b6ef6)}",
			".notix-input:disabled{opacity:.6;cursor:default}",
			".notix-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary,#d03050)}",
			".notix-input-num{flex:none;width:88px;text-align:right;font-variant-numeric:tabular-nums}",
			".notix-input-time{flex:none;width:120px;font-variant-numeric:tabular-nums}",
			".notix-input-select{flex:none;min-width:120px}",
			".notix-input-text{flex:1;min-width:0;max-width:360px}",
			".notix-test-button{flex:none;height:28px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,6px);color:var(--dsw-alias-label-primary);background:0 0;padding:0 12px;font:inherit;font-size:13px;line-height:20px;cursor:pointer}",
			".notix-test-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".notix-test-button:disabled{opacity:.5;cursor:default}",
			".notix-status{flex-wrap:wrap;align-items:baseline;gap:4px 12px;min-height:18px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px;font-size:12px;line-height:18px;display:flex}",
			".notix-status-error{color:var(--dsw-alias-state-error-primary,#d03050)}",
			".notix-status-saved{color:var(--dsw-alias-state-success-primary,#2ba471)}",
			".notix-status-note{margin-left:auto;color:var(--dsw-alias-label-tertiary)}"
		].join(" ");
		const CSS_TAG = "notix-dsh-ui/card.css";
		function injectStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "notix-dsh-ui";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region lib/client/fields.js
		const h = react.createElement;
		const Switch = _deepseek_ai_dsh_client_ui_primitives.Switch;
		const MS_PER_MINUTE = 60000;
		/** Subscribe to the config form snapshot and re-render on every change. */
		function useSnapshot(form) {
			const [snap, setSnap] = react.useState(() => form.getSnapshot());
			react.useEffect(() => form.subscribe(() => setSnap(form.getSnapshot())), [form]);
			return snap;
		}
		/**
		* Draft text for an input that commits on blur/Enter. The draft follows the
		* external display value whenever the field is not focused, so values written
		* by the Host (or rejected writes) show up without clobbering typing.
		*/
		function useDraft(display) {
			const [text, setText] = react.useState(display);
			const editing = react.useRef(false);
			react.useEffect(() => {
				if (!editing.current) setText(display);
			}, [display]);
			return { text, setText, editing };
		}
		/**
		* A group's master toggle: title + description on the left, the shared
		* Switch on the right — the row shape settings-general uses.
		*/
		function TriggerRow(props) {
			return h("div", { className: "notix-trigger-head" }, h("div", { className: "notix-trigger-text" }, h("div", { className: "notix-trigger-title" }, props.title), props.hint ? h("div", { className: "notix-trigger-hint" }, props.hint) : null), h(Switch, {
				checked: props.checked,
				label: props.title,
				disabled: props.disabled,
				onChange: (next) => props.onChange(next)
			}));
		}
		/**
		* One trigger group inside a section card: the master row plus its
		* sub-fields, which stay visible but disabled while the group is off.
		*/
		function Trigger(props) {
			return h("div", { className: "notix-trigger" }, h(TriggerRow, {
				title: props.title,
				hint: props.hint,
				checked: props.checked,
				disabled: props.disabled,
				onChange: props.onChange
			}), props.fields && props.fields.length > 0 ? h("div", {
				className: props.checked ? "notix-fields" : "notix-fields notix-fields-disabled"
			}, props.fields) : null);
		}
		/** A sub-item toggle: secondary label on the left, Switch on the right. */
		function ToggleField(props) {
			return h("div", { className: "notix-field-row" }, h("span", { className: "notix-field-label" }, props.label), h(Switch, {
				checked: props.checked,
				label: props.label,
				disabled: props.disabled,
				onChange: (next) => props.onChange(next)
			}));
		}
		/**
		* Generic numeric input with draft/commit behaviour, styled like the
		* built-in SettingsValueField input.
		* format(value) -> shown text; parse(text) -> committed value or null when invalid.
		*/
		function NumberField(props) {
			const display = props.format(props.value);
			const draft = useDraft(display);
			const [invalid, setInvalid] = react.useState(false);
			const messageId = `${props.id}-message`;
			const commitText = () => {
				const parsed = props.parse(draft.text);
				if (parsed === null) {
					setInvalid(true);
					return;
				}
				setInvalid(false);
				draft.setText(props.format(parsed));
				if (parsed !== props.value) props.onCommit(parsed);
			};
			return h("div", { className: "notix-field" }, h("label", { className: "notix-field-row", htmlFor: props.id }, h("span", { className: "notix-field-label" }, props.label), h("input", {
				id: props.id,
				className: "notix-input notix-input-num",
				type: "text",
				inputMode: props.integer ? "numeric" : "decimal",
				disabled: props.disabled,
				value: draft.text,
				"aria-label": props.label,
				...invalid ? { "aria-invalid": true, "aria-describedby": messageId } : {},
				onFocus: () => {
					draft.editing.current = true;
				},
				onChange: (event) => {
					setInvalid(false);
					draft.setText(event.target.value);
				},
				onBlur: () => {
					draft.editing.current = false;
					commitText();
				},
				onKeyDown: (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commitText();
						if (props.parse(draft.text) !== null) event.target.blur();
					}
				}
			})), invalid ? h("p", { id: messageId, className: "notix-field-message notix-field-error", role: "alert" }, props.invalidLabel) : props.hint ? h("p", { className: "notix-field-message notix-field-hint" }, props.hint) : null);
		}
		/** Millisecond-valued duration edited in minutes. */
		function MinutesField(props) {
			return h(NumberField, {
				...props,
				format: (ms) => String(Math.round((ms / MS_PER_MINUTE) * 100) / 100),
				parse: (text) => {
					const n = Number(text);
					if (!Number.isFinite(n) || n < 0) return null;
					return Math.round(n * MS_PER_MINUTE);
				}
			});
		}
		/** Integer counter (e.g. maxReminders, 0..10). */
		function CountField(props) {
			return h(NumberField, {
				...props,
				integer: true,
				format: (n) => String(n),
				parse: (text) => {
					const n = Number(text);
					if (!Number.isFinite(n)) return null;
					const r = Math.round(n);
					if (r < 0 || r > 10) return null;
					return r;
				}
			});
		}
		/** "HH:MM" time-of-day field. */
		function TimeField(props) {
			return h("label", { className: "notix-field-row", htmlFor: props.id }, h("span", { className: "notix-field-label" }, props.label), h("input", {
				id: props.id,
				className: "notix-input notix-input-time",
				type: "time",
				disabled: props.disabled,
				value: props.value,
				"aria-label": props.label,
				onChange: (event) => {
					const v = event.target.value;
					if (/^\d{2}:\d{2}$/.test(v)) props.onCommit(v);
				}
			}));
		}
		/** Enum dropdown. options: [{ value, label }]. */
		function SelectField(props) {
			return h("label", { className: "notix-field-row", htmlFor: props.id }, h("span", { className: "notix-field-label" }, props.label), h("select", {
				id: props.id,
				className: "notix-input notix-input-select",
				disabled: props.disabled,
				value: props.value,
				"aria-label": props.label,
				onChange: (event) => props.onCommit(event.target.value)
			}, props.options.map((opt) => h("option", { key: opt.value, value: opt.value }, opt.label))));
		}
		/** Free text committed on blur/Enter. */
		function TextField(props) {
			const draft = useDraft(props.value);
			const commitText = () => {
				if (draft.text !== props.value) props.onCommit(draft.text);
			};
			return h("div", { className: "notix-field" }, h("label", { className: "notix-field-row", htmlFor: props.id }, h("span", { className: "notix-field-label" }, props.label), h("input", {
				id: props.id,
				className: "notix-input notix-input-text",
				type: "text",
				disabled: props.disabled,
				value: draft.text,
				placeholder: props.placeholder,
				"aria-label": props.label,
				onFocus: () => {
					draft.editing.current = true;
				},
				onChange: (event) => draft.setText(event.target.value),
				onBlur: () => {
					draft.editing.current = false;
					commitText();
				},
				onKeyDown: (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commitText();
						event.target.blur();
					}
				}
			})), props.hint ? h("p", { className: "notix-field-message notix-field-hint" }, props.hint) : null);
		}
		/** Section frame: a title above one stroked group card. */
		function Section(props) {
			return h("section", { className: "notix-section" }, h("h3", { className: "notix-section-title" }, props.title), h("div", { className: "notix-group" }, props.children));
		}
		//#endregion
		//#region lib/client/NotixCard.js
		/** Schema defaults, mirrored so the card renders sanely on partial snapshots. */
		const DEFAULTS = {
			language: "zh",
			verbosity: "minimal",
			quietHours: { enabled: false, from: "23:00", to: "08:00", allowUrgent: true },
			triggers: {
				approval: { enabled: true, remindAfterMs: 300000, maxReminders: 2 },
				userQuestion: { enabled: true, remindAfterMs: 300000, remindOnContinued: true },
				longTask: { enabled: true, turnThresholdMs: 600000, jobThresholdMs: 900000, jobs: false },
				error: { enabled: true, cooldownMs: 60000, toolErrors: false, toolTimeout: false },
				completion: { enabled: true, minDurationMs: 180000, jobs: false }
			},
			macos: { enabled: true, sound: true, clickToOpen: true, baseUrl: "" }
		};
		function pick(obj, fallback) {
			return obj === undefined || obj === null ? fallback : obj;
		}
		function group(value, fallback) {
			return { ...fallback, ...(value || {}) };
		}
		/** The one-line status read from accepted values, for both card views. */
		function summarize(value) {
			const v = value || {};
			const triggers = v.triggers || {};
			const enabledCount = TRIGGER_GROUP_KEYS.filter((key) => group(triggers[key], DEFAULTS.triggers[key]).enabled).length;
			return {
				enabledCount,
				quietEnabled: group(v.quietHours, DEFAULTS.quietHours).enabled,
				macosEnabled: group((v.channels || {}).macos, DEFAULTS.macos).enabled
			};
		}
		const TRIGGER_GROUP_KEYS = ["approval", "userQuestion", "longTask", "error", "completion"];
		/**
		* The Notix settings card. `props.form` is the ConfigFormController for the
		* `notix` namespace; `props.view === "summary"` asks for the one-liner the
		* Plugins page shows when the card is collapsed.
		*/
		function NotixCard(props) {
			const { t, form } = props;
			const snap = useSnapshot(form);
			const [pending, setPending] = react.useState(0);
			const [result, setResult] = react.useState("idle");
			react.useEffect(() => {
				injectStyles();
			}, []);
			if (props.view === "summary") {
				if (snap.status !== "ready" || snap.value === undefined) return t("description");
				const s = summarize(snap.value);
				return `${t("summaryTriggers")}: ${s.enabledCount}/5 · ${t("summaryQuietHours")}: ${s.quietEnabled ? t("summaryOn") : t("summaryOff")} · ${t("summaryChannel")}: ${s.macosEnabled ? t("summaryOn") : t("summaryOff")}`;
			}
			if (snap.status === "loading") return h("div", { className: "notix-card" }, t("loading"));
			if (snap.status === "unavailable") return h("div", { className: "notix-card" }, t("unavailable"));
			const v = snap.value || {};
			const writable = snap.writable !== false;
			const disabled = pending > 0 || !writable;
			const commit = (path, value) => {
				setPending((n) => n + 1);
				Promise.resolve(form.mutate([{ op: "set", path, value }])).then((ok) => {
					setResult(ok ? "saved" : "failed");
				}).catch(() => {
					setResult("failed");
				}).finally(() => {
					setPending((n) => n - 1);
				});
			};
			const quiet = group(v.quietHours, DEFAULTS.quietHours);
			const triggers = v.triggers || {};
			const approval = group(triggers.approval, DEFAULTS.triggers.approval);
			const userQuestion = group(triggers.userQuestion, DEFAULTS.triggers.userQuestion);
			const longTask = group(triggers.longTask, DEFAULTS.triggers.longTask);
			const errorTrig = group(triggers.error, DEFAULTS.triggers.error);
			const completion = group(triggers.completion, DEFAULTS.triggers.completion);
			const macos = group((v.channels || {}).macos, DEFAULTS.macos);
			const enabledCount = [approval, userQuestion, longTask, errorTrig, completion].filter((g) => g.enabled).length;
			return h("div", { className: "notix-card" }, h("p", { className: "notix-summary" }, `${t("summaryTriggers")}: ${enabledCount}/5 · ${t("summaryQuietHours")}: ${quiet.enabled ? t("summaryOn") : t("summaryOff")} · ${t("summaryChannel")}: ${macos.enabled ? t("summaryOn") : t("summaryOff")}`), h(Section, { title: t("sectionTriggers") }, h(Trigger, {
				title: t("triggerApproval"),
				hint: t("triggerApprovalHint"),
				checked: approval.enabled,
				disabled,
				onChange: (next) => commit(["triggers", "approval", "enabled"], next),
				fields: [
					h(MinutesField, {
						key: "approval-remind",
						id: "notix-approval-remind",
						label: t("fieldRemindAfter"),
						invalidLabel: t("invalidNumber"),
						value: approval.remindAfterMs,
						disabled: disabled || !approval.enabled,
						onCommit: (ms) => commit(["triggers", "approval", "remindAfterMs"], ms)
					}),
					h(CountField, {
						key: "approval-max",
						id: "notix-approval-max",
						label: t("fieldMaxReminders"),
						invalidLabel: t("invalidNumber"),
						value: approval.maxReminders,
						disabled: disabled || !approval.enabled,
						onCommit: (n) => commit(["triggers", "approval", "maxReminders"], n)
					})
				]
			}), h(Trigger, {
				title: t("triggerUserQuestion"),
				hint: t("triggerUserQuestionHint"),
				checked: userQuestion.enabled,
				disabled,
				onChange: (next) => commit(["triggers", "userQuestion", "enabled"], next),
				fields: [
					h(MinutesField, {
						key: "uq-remind",
						id: "notix-uq-remind",
						label: t("fieldRemindAfter"),
						invalidLabel: t("invalidNumber"),
						value: userQuestion.remindAfterMs,
						disabled: disabled || !userQuestion.enabled,
						onCommit: (ms) => commit(["triggers", "userQuestion", "remindAfterMs"], ms)
					}),
					h(ToggleField, {
						key: "uq-continued",
						label: t("fieldRemindOnContinued"),
						checked: userQuestion.remindOnContinued,
						disabled: disabled || !userQuestion.enabled,
						onChange: (next) => commit(["triggers", "userQuestion", "remindOnContinued"], next)
					})
				]
			}), h(Trigger, {
				title: t("triggerLongTask"),
				hint: t("triggerLongTaskHint"),
				checked: longTask.enabled,
				disabled,
				onChange: (next) => commit(["triggers", "longTask", "enabled"], next),
				fields: [
					h(MinutesField, {
						key: "lt-turn",
						id: "notix-lt-turn",
						label: t("fieldTurnThreshold"),
						invalidLabel: t("invalidNumber"),
						value: longTask.turnThresholdMs,
						disabled: disabled || !longTask.enabled,
						onCommit: (ms) => commit(["triggers", "longTask", "turnThresholdMs"], ms)
					}),
					h(ToggleField, {
						key: "lt-jobs",
						label: t("fieldJobs"),
						checked: longTask.jobs,
						disabled: disabled || !longTask.enabled,
						onChange: (next) => commit(["triggers", "longTask", "jobs"], next)
					}),
					h(MinutesField, {
						key: "lt-job",
						id: "notix-lt-job",
						label: t("fieldJobThreshold"),
						invalidLabel: t("invalidNumber"),
						value: longTask.jobThresholdMs,
						disabled: disabled || !longTask.enabled || !longTask.jobs,
						onCommit: (ms) => commit(["triggers", "longTask", "jobThresholdMs"], ms)
					})
				]
			}), h(Trigger, {
				title: t("triggerError"),
				hint: t("triggerErrorHint"),
				checked: errorTrig.enabled,
				disabled,
				onChange: (next) => commit(["triggers", "error", "enabled"], next),
				fields: [
					h(MinutesField, {
						key: "err-cooldown",
						id: "notix-err-cooldown",
						label: t("fieldCooldown"),
						invalidLabel: t("invalidNumber"),
						value: errorTrig.cooldownMs,
						disabled: disabled || !errorTrig.enabled,
						onCommit: (ms) => commit(["triggers", "error", "cooldownMs"], ms)
					}),
					h(ToggleField, {
						key: "err-tool",
						label: t("fieldToolErrors"),
						checked: errorTrig.toolErrors,
						disabled: disabled || !errorTrig.enabled,
						onChange: (next) => commit(["triggers", "error", "toolErrors"], next)
					}),
					h(ToggleField, {
						key: "err-timeout",
						label: t("fieldToolTimeout"),
						checked: errorTrig.toolTimeout,
						disabled: disabled || !errorTrig.enabled,
						onChange: (next) => commit(["triggers", "error", "toolTimeout"], next)
					})
				]
			}), h(Trigger, {
				title: t("triggerCompletion"),
				hint: t("triggerCompletionHint"),
				checked: completion.enabled,
				disabled,
				onChange: (next) => commit(["triggers", "completion", "enabled"], next),
				fields: [
					h(MinutesField, {
						key: "cmp-min",
						id: "notix-cmp-min",
						label: t("fieldMinDuration"),
						invalidLabel: t("invalidNumber"),
						value: completion.minDurationMs,
						disabled: disabled || !completion.enabled,
						onCommit: (ms) => commit(["triggers", "completion", "minDurationMs"], ms)
					}),
					h(ToggleField, {
						key: "cmp-jobs",
						label: t("fieldJobs"),
						checked: completion.jobs,
						disabled: disabled || !completion.enabled,
						onChange: (next) => commit(["triggers", "completion", "jobs"], next)
					})
				]
			})), h(Section, { title: t("sectionQuietHours") }, h(Trigger, {
				title: t("quietEnabled"),
				checked: quiet.enabled,
				disabled,
				onChange: (next) => commit(["quietHours", "enabled"], next),
				fields: [
					h(TimeField, {
						key: "qh-from",
						id: "notix-qh-from",
						label: t("quietFrom"),
						value: quiet.from,
						disabled: disabled || !quiet.enabled,
						onCommit: (v2) => commit(["quietHours", "from"], v2)
					}),
					h(TimeField, {
						key: "qh-to",
						id: "notix-qh-to",
						label: t("quietTo"),
						value: quiet.to,
						disabled: disabled || !quiet.enabled,
						onCommit: (v2) => commit(["quietHours", "to"], v2)
					}),
					h(ToggleField, {
						key: "qh-urgent",
						label: t("quietAllowUrgent"),
						checked: quiet.allowUrgent,
						disabled: disabled || !quiet.enabled,
						onChange: (next) => commit(["quietHours", "allowUrgent"], next)
					})
				]
			})), h(Section, { title: t("sectionContent") }, h("div", { className: "notix-fields" }, h(SelectField, {
				id: "notix-language",
				label: t("fieldLanguage"),
				value: pick(v.language, DEFAULTS.language),
				disabled,
				options: [
					{ value: "zh", label: t("languageZh") },
					{ value: "en", label: t("languageEn") }
				],
				onCommit: (v2) => commit(["language"], v2)
			}), h(SelectField, {
				id: "notix-verbosity",
				label: t("fieldVerbosity"),
				value: pick(v.verbosity, DEFAULTS.verbosity),
				disabled,
				options: [
					{ value: "minimal", label: t("verbosityMinimal") },
					{ value: "normal", label: t("verbosityNormal") }
				],
				onCommit: (v2) => commit(["verbosity"], v2)
			}))), h(Section, { title: t("sectionChannel") }, h(Trigger, {
				title: t("channelEnabled"),
				checked: macos.enabled,
				disabled,
				onChange: (next) => commit(["channels", "macos", "enabled"], next),
				fields: [
					h(ToggleField, {
						key: "ch-sound",
						label: t("channelSound"),
						checked: macos.sound,
						disabled: disabled || !macos.enabled,
						onChange: (next) => commit(["channels", "macos", "sound"], next)
					}),
					h(ToggleField, {
						key: "ch-click",
						label: t("channelClickToOpen"),
						checked: macos.clickToOpen,
						disabled: disabled || !macos.enabled,
						onChange: (next) => commit(["channels", "macos", "clickToOpen"], next)
					}),
					h(TextField, {
						key: "ch-url",
						id: "notix-ch-url",
						label: t("channelBaseUrl"),
						hint: t("channelBaseUrlHint"),
						value: macos.baseUrl,
						disabled: disabled || !macos.enabled,
						onCommit: (v2) => commit(["channels", "macos", "baseUrl"], v2)
					}),
					h("div", {
						key: "ch-test",
						className: "notix-field-row"
					}, h("button", {
						type: "button",
						className: "notix-test-button",
						disabled: true,
						title: t("testNotifyHint")
					}, t("testNotify")), h("span", { className: "notix-field-label notix-field-hint" }, t("testNotifyHint")))
				]
			})), h("div", {
				className: "notix-status",
				role: "status",
				"aria-live": "polite"
			}, !writable ? h("span", null, t("readOnly")) : pending > 0 ? h("span", null, t("saving")) : result === "failed" ? h("span", { className: "notix-status-error", role: "alert" }, t("saveFailed")) : result === "saved" ? h("span", { className: "notix-status-saved" }, t("saved")) : null, writable ? h("span", { className: "notix-status-note" }, t("reloadNote")) : null));
		}
		//#endregion
		//#region lib/client/index.js
		/**
		* The Notix settings card, browser half: renders one card into the Plugins
		* page's `plugins.item` slot while the Host serves the `notix` namespace.
		* Edits go through the ConfigFormController's nested-path `mutate`, which the
		* Host's config editor lands into the profile patch and applies live.
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.notix";
		/** Config namespace served by the Host plugin (entry id `notix`). */
		const NOTIX_NS = "notix";
		/** Required services (cordis fiber inject). */
		const inject = ["slots", "locale", "configForms"];
		/**
		* Mount the Notix settings card while the Host serves its namespace.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "notix-dsh-ui: dictionaries");
			const form = ctx.configForms.get(NOTIX_NS);
			ctx.effect(() => ctx.configForms.whileServed([NOTIX_NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
				name: "plugins.item",
				id: "notix",
				order: 40,
				label: () => t("title"),
				locale: NS,
				inject: () => ({ form })
			}, NotixCard))), "notix-dsh-ui: page");
			ctx.effect(() => ctx.configForms.whileServed([NOTIX_NS], () => ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "notix",
				order: 30,
				label: () => t("title"),
				locale: NS,
				inject: () => ({ form })
			}, NotixCard))), "notix-dsh-ui: settings tab");
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
