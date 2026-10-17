import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../../app/AppContext";
import { ApiError } from "../../app/api";
import { formatTime } from "../../app/format";
import type { Dict } from "../../i18n/dict";
import {
  confirmAssistantAction,
  sendAssistantChat,
  ASSISTANT_CONFIG_CHANGED_EVENT,
  type AssistantConfig,
  type AssistantMessage,
  type PendingAssistantAction,
} from "../../app/assistantApi";
import { renderAssistantMarkdown } from "./assistantMarkdown";
import { describeConfirmResult, formatArgKey, formatServerValue } from "./displayValues";
import { CloseIcon } from "../../components/icons";

/**
 * The مدام عفاف chat panel - brief H18, piece 2; reworked by brief H40.
 *
 * A side panel over the app: the persona header, the provider/model shown
 * subtly, the transcript in component state ONLY (no localStorage - the
 * conversation dies with the page), a composer with a typing state, and the
 * confirmation card for a pending write. Nothing reaches the system until
 * تأكيد is pressed: the pending action card only ever renders what the
 * assistant asked to do, and إلغاء throws it away.
 *
 * H40 rules lived here:
 *  - ONE waiting state: the typing bubble in the transcript (animated dots +
 *    text). The send button stays a plain, clearly disabled submit - it never
 *    repeats «بيفكر…».
 *  - إلغاء aborts the in-flight send (a real AbortSignal down to apiRequest),
 *    puts the question back in the composer, and shows no fake error.
 *  - A failure is an honest error card (danger card, like the settings card)
 *    with إعادة المحاولة resending exactly the failed question.
 *  - The transcript list pins to the TAIL: spare space sits above the last
 *    message, never between the conversation and the composer; an empty chat
 *    shows a useful empty state with ready-made questions instead of dead
 *    white.
 *  - Every string comes from dict.ts in the UI language; Latin runs sit in
 *    <bdi>; the textarea is dir="auto" (Arabic or English, the user decides).
 */

interface AssistantPanelProps {
  config: AssistantConfig;
  open: boolean;
  onClose: () => void;
}

interface ChatEntry extends AssistantMessage {
  /** Set on the entry the pending card belongs to. */
  pending?: PendingAssistantAction | null;
  /** Client-side timestamp for the hover-revealed time stamp. */
  at?: string;
}

/** Error text that never shows raw HTTP wording: an ApiError maps to a label. */
function failureText(error: unknown, t: (key: keyof Dict) => string): string {
  if (error instanceof ApiError) {
    if (error.kind === "unauthenticated") return t("assistantErrSession");
    if (error.kind === "unreachable") return t("assistantErrNetwork");
    return t("assistantErrServer");
  }
  return t("assistantErrNetwork");
}

/** H41 - a failed CONFIRM is honest too: expiry and replay get their own
 * lines from dict, and «إعادة المحاولة» re-presses the SAME token. */
function confirmFailureText(error: unknown, t: (key: keyof Dict) => string): string {
  if (error instanceof ApiError && error.code === "expired") return t("assistantErrActionExpired");
  if (error instanceof ApiError && error.code === "already_used") return t("assistantErrActionUsed");
  return failureText(error, t);
}

/** H40 - the ready-made questions the empty state offers; one fills the composer. */
const SUGGESTION_KEYS = [
  "assistantSuggestionBalance",
  "assistantSuggestionRequests",
  "assistantSuggestionSchedule",
  "assistantSuggestionLeave",
] as const satisfies readonly (keyof Dict)[];

export default function AssistantPanel({ config, open, onClose }: AssistantPanelProps) {
  const { t, locale } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  /** The in-flight send's abort controller; null whenever nothing is pending. */
  const abortRef = useRef<AbortController | null>(null);
  /** True only when the abort came from the إلغاء button, not the timeout. */
  const cancelledRef = useRef(false);
  /** The text whose send failed, so «إعادة المحاولة» resends exactly it. */
  const failedTextRef = useRef<string | null>(null);
  /** H41 - the token whose confirm failed, so retry re-presses it (not the chat). */
  const failedConfirmRef = useRef<string | null>(null);

  // The panel is a dialog while open: Escape closes, focus starts at the composer.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.setTimeout(() => inputRef.current?.focus(), 0);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // New entries (and the typing state coming and going) keep the tail visible.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, thinking]);

  // Configuration saved elsewhere refreshes the subtle provider line via the launcher's config.
  useEffect(() => {
    const onChange = () => {
      /* the launcher owns the refetch; this listener only keeps the component honest */
    };
    window.addEventListener(ASSISTANT_CONFIG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ASSISTANT_CONFIG_CHANGED_EVENT, onChange);
  }, []);

  const appendMessages = useCallback((messages: ChatEntry[]) => {
    setEntries((current) => [...current, ...messages]);
  }, []);

  /**
   * The one send path. `append` puts the question in the transcript (a fresh
   * send); `retry` resends the failed question that is ALREADY the last
   * transcript entry, so no duplicate bubble ever appears.
   */
  const runChat = useCallback(
    async (text: string, mode: "append" | "retry") => {
      const history: AssistantMessage[] = entries
        .filter((entry) => entry.role === "user" || entry.role === "assistant")
        .map((entry) => ({ role: entry.role, content: entry.content }));
      const outgoing: AssistantMessage[] =
        mode === "append" ? [...history, { role: "user", content: text }] : history;
      if (mode === "append") {
        appendMessages([{ role: "user", content: text, at: new Date().toISOString() }]);
        setDraft("");
      }
      setThinking(true);
      setErrorLine(null);
      const controller = new AbortController();
      abortRef.current = controller;
      cancelledRef.current = false;
      try {
        const reply = await sendAssistantChat(outgoing, locale, controller.signal);
        appendMessages([
          {
            role: "assistant",
            content: reply.reply,
            pending: reply.pending_action ?? null,
            at: new Date().toISOString(),
          },
        ]);
        failedTextRef.current = null;
      } catch (failure) {
        if (cancelledRef.current) {
          // A cancelled send is not an error: the question goes back into the
          // composer and the transcript returns to its pre-send state.
          setEntries((current) => {
            const last = current[current.length - 1];
            return last && last.role === "user" ? current.slice(0, -1) : current;
          });
          setDraft(text);
          failedTextRef.current = null;
        } else {
          failedTextRef.current = text;
          setErrorLine(failureText(failure, t));
        }
      } finally {
        abortRef.current = null;
        setThinking(false);
      }
    },
    [entries, locale, t, appendMessages],
  );

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || thinking) return;
    void runChat(text, "append");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitDraft();
  };

  /** إلغاء: abort the in-flight send; the catch above restores the composer. */
  const cancelSend = () => {
    if (!thinking || !abortRef.current) return;
    cancelledRef.current = true;
    abortRef.current.abort();
  };

  const retryFailed = () => {
    // H41 - a failed confirm retries the confirm itself, not the chat send.
    if (failedConfirmRef.current) {
      const token = failedConfirmRef.current;
      void confirm(token);
      return;
    }
    const text = failedTextRef.current;
    if (!text || thinking) return;
    void runChat(text, "retry");
  };

  const confirm = async (token: string) => {
    if (confirming) return;
    setConfirming(true);
    setErrorLine(null);
    try {
      const result = await confirmAssistantAction(token);
      failedConfirmRef.current = null;
      // H41 - the confirm body's `result` is an OBJECT (verified against
      // accounts/assistant_chat.py). describeConfirmResult renders it as the
      // promised formal receipt - headline + رقم + status - never
      // "[object Object]"; an unrecognized shape falls back to the honest
      // generic line from dict.
      setEntries((current) =>
        current.map((entry) => {
          if (entry.pending?.token !== token) return entry;
          const { pending: _pending, ...rest } = entry;
          return {
            ...rest,
            content: `${rest.content}\n${describeConfirmResult(result.tool, result.result, t)}`,
          };
        }),
      );
    } catch (failure) {
      failedConfirmRef.current = token;
      setErrorLine(confirmFailureText(failure, t));
    } finally {
      setConfirming(false);
    }
  };

  const cancel = (token: string) => {
    if (confirming) return;
    setEntries((current) =>
      current.map((entry) => {
        if (entry.pending?.token !== token) return entry;
        const { pending: _pending, ...rest } = entry;
        return rest;
      }),
    );
  };

  const copyReply = async (index: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      /* clipboard blocked: the reply is right there to copy by hand */
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="assistant-backdrop" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panelRef}
        className="assistant-panel"
        role="dialog"
        aria-modal="false"
        aria-label={t("assistantName")}
      >
        <header className="assistant-header">
          <img src="/brand/afaf.png" alt="" width={36} height={36} className="assistant-face" />
          <div className="assistant-header-text">
            <strong>{t("assistantName")}</strong>
            <span className="assistant-provider-line page-meta" title={t("assistantProviderLine")}>
              <bdi>{config.base_url}</bdi> · <bdi dir="ltr">{config.model}</bdi>
            </span>
          </div>
          <Link className="btn btn-ghost btn-compact assistant-settings-link" to="/profile#assistant" onClick={onClose}>
            {t("assistantSettingsLink")}
          </Link>
          <button type="button" className="btn btn-ghost btn-compact" aria-label={t("close")} onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="assistant-transcript" ref={listRef} aria-live="polite">
          {entries.length === 0 && !thinking ? (
            <div className="assistant-empty-state">
              <p className="assistant-empty page-meta">{t("assistantEmptyChat")}</p>
              <p className="assistant-suggestions-title">{t("assistantSuggestionsTitle")}</p>
              <div className="assistant-suggestions">
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="assistant-suggestion"
                    onClick={() => {
                      setDraft(t(key));
                      inputRef.current?.focus();
                    }}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {entries.length > 0 || thinking ? (
            <div className="assistant-transcript-list">
              {entries.map((entry, index) => (
                <div key={index} className={`assistant-message assistant-message-${entry.role}`}>
                  {/* H20 - the reply renders as elements (bold/lists/code), never raw `**`. */}
                  <div className="assistant-message-text" dir="auto" style={{ display: "block" }}>
                    {renderAssistantMarkdown(entry.content)}
                  </div>
                  {entry.role === "assistant" ? (
                    <div className="assistant-message-meta">
                      <time className="assistant-message-time" dateTime={entry.at}>
                        {entry.at ? formatTime(entry.at, locale) : null}
                      </time>
                      <button
                        type="button"
                        className="assistant-copy"
                        onClick={() => void copyReply(index, entry.content)}
                      >
                        {copiedIndex === index ? t("assistantCopied") : t("assistantCopy")}
                      </button>
                    </div>
                  ) : null}
                  {entry.pending ? (
                    <div className="assistant-action-card" role="group" aria-label={t("assistantActionCard")}>
                      <strong>{t("assistantActionCard")}</strong>
                      <span className="assistant-action-name"><bdi dir="ltr">{entry.pending.name}</bdi></span>
                      {entry.pending.args && Object.keys(entry.pending.args).length > 0 ? (
                        <dl className="assistant-action-args">
                          {Object.entries(entry.pending.args).map(([key, value]) => (
                            <div key={key} className="assistant-action-arg">
                              <dt>{formatArgKey(key, t)}</dt>
                              <dd><bdi>{formatServerValue(value, t)}</bdi></dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      <p className="page-meta">{t("assistantActionAsk")}</p>
                      <button type="button" className="btn btn-primary btn-compact" disabled={confirming} onClick={() => confirm(entry.pending!.token)}>
                        {confirming ? t("saving") : t("confirm")}
                      </button>
                      <button type="button" className="btn btn-secondary btn-compact" disabled={confirming} onClick={() => cancel(entry.pending!.token)}>
                        {t("cancel")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {/* H40 - the ONE waiting state: dots + text in a bubble, with a
                  real إلغاء beside it. The send button never repeats this. */}
              {thinking ? (
                <div className="assistant-message assistant-message-assistant assistant-typing-wrap">
                  <div className="assistant-typing-row">
                    <span className="assistant-typing-dots" aria-hidden="true"><i /><i /><i /></span>
                    <p className="assistant-message-text assistant-typing">{t("assistantTyping")}</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-compact assistant-typing-cancel" onClick={cancelSend}>
                    {t("cancel")}
                  </button>
                </div>
              ) : null}
              {errorLine ? (
                <div className="assistant-error assistant-error-card" role="alert">
                  <p>{errorLine}</p>
                  <button type="button" className="btn btn-secondary btn-compact" disabled={thinking} onClick={retryFailed}>
                    {t("retry")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <form className="assistant-composer" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            className="input assistant-composer-input"
            rows={2}
            dir="auto"
            value={draft}
            placeholder={t("assistantComposerPlaceholder")}
            aria-label={t("assistantComposerPlaceholder")}
            disabled={thinking}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitDraft();
              }
            }}
          />
          <button type="submit" className="btn btn-primary assistant-send" disabled={thinking || !draft.trim()}>
            {t("submit")}
          </button>
        </form>
        <p className="assistant-composer-hint page-meta">{t("assistantComposerHint")}</p>
      </aside>
    </>
  );
}
