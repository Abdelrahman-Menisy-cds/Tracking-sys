import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../../app/AppContext";
import { ApiError } from "../../app/api";
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
import { CloseIcon } from "../../components/icons";

/**
 * The مدام عفاف chat panel - brief H18, piece 2.
 *
 * A side panel over the app: the persona header, the provider/model shown
 * subtly, the transcript in component state ONLY (no localStorage - the
 * conversation dies with the page), a composer with a typing state, and the
 * confirmation card for a pending write. Nothing reaches the system until
 * تأكيد is pressed: the pending action card only ever renders what the
 * assistant asked to do, and إلغاء throws it away.
 */

interface AssistantPanelProps {
  config: AssistantConfig;
  open: boolean;
  onClose: () => void;
}

interface ChatEntry extends AssistantMessage {
  /** Set on the entry the pending card belongs to. */
  pending?: PendingAssistantAction | null;
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

export default function AssistantPanel({ config, open, onClose }: AssistantPanelProps) {
  const { t } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

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

  //.configuration saved elsewhere refreshes the subtle provider line via the launcher's config.
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

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || thinking) return;
    const history: AssistantMessage[] = entries
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({ role: entry.role, content: entry.content }));
    appendMessages([{ role: "user", content: text }]);
    setDraft("");
    setThinking(true);
    setErrorLine(null);
    try {
      const reply = await sendAssistantChat([...history, { role: "user", content: text }]);
      appendMessages([
        {
          role: "assistant",
          content: reply.reply,
          pending: reply.pending_action ?? null,
        },
      ]);
    } catch (failure) {
      setErrorLine(failureText(failure, t));
    } finally {
      setThinking(false);
    }
  };

  const confirm = async (token: string) => {
    if (confirming) return;
    setConfirming(true);
    setErrorLine(null);
    try {
      const result = await confirmAssistantAction(token);
      // The action ran: the card gives way to what the system said back.
      setEntries((current) =>
        current.map((entry) => {
          if (entry.pending?.token !== token) return entry;
          const { pending: _pending, ...rest } = entry;
          return { ...rest, content: `${rest.content}\n${result.result || t("assistantActionDone")}` };
        }),
      );
    } catch (failure) {
      setErrorLine(failureText(failure, t));
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
          {entries.length === 0 && !thinking ? <p className="assistant-empty page-meta">{t("assistantEmptyChat")}</p> : null}
          {entries.map((entry, index) => (
            <div key={index} className={`assistant-message assistant-message-${entry.role}`}>
              {/* H20 - the reply renders as elements (bold/lists/code), never raw `**`. */}
              <div className="assistant-message-text" dir="auto" style={{ display: "block" }}>
                {renderAssistantMarkdown(entry.content)}
              </div>
              {entry.pending ? (
                <div className="assistant-action-card" role="group" aria-label={t("assistantActionCard")}>
                  <strong>{t("assistantActionCard")}</strong>
                  <span className="assistant-action-name"><bdi dir="ltr">{entry.pending.name}</bdi></span>
                  {entry.pending.args && Object.keys(entry.pending.args).length > 0 ? (
                    <dl className="assistant-action-args">
                      {Object.entries(entry.pending.args).map(([key, value]) => (
                        <div key={key} className="assistant-action-arg">
                          <dt><bdi dir="ltr">{key}</bdi></dt>
                          <dd><bdi>{String(value)}</bdi></dd>
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
          {thinking ? <div className="assistant-message assistant-message-assistant"><p className="assistant-message-text assistant-typing">{t("assistantTyping")}</p></div> : null}
          {errorLine ? <p className="assistant-error" role="alert">{errorLine}</p> : null}
        </div>
        <form className="assistant-composer" onSubmit={send}>
          <textarea
            ref={inputRef}
            className="input assistant-composer-input"
            rows={2}
            value={draft}
            placeholder={t("assistantComposerPlaceholder")}
            aria-label={t("assistantComposerPlaceholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(event as unknown as FormEvent);
              }
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={thinking || !draft.trim()}>
            {thinking ? <><span className="spinner" aria-hidden="true" />{t("assistantTyping")}</> : t("submit")}
          </button>
        </form>
      </aside>
    </>
  );
}
