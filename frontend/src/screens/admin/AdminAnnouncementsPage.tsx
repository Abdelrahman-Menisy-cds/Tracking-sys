import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { formatDateTime } from "../../app/useMockList";
import { Banner, Dialog, EmptyState, ErrorState, SkeletonRows, StatusPill, type StatusTone } from "../../components/ui";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import PageHeader from "../../components/layout/PageHeader";
import { ChevronDownIcon, SearchIcon } from "../../components/icons";
import AdminNav from "./AdminNav";
import type { Dict } from "../../i18n/dict";
import type {
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementMock,
  EmployeeDirectoryEntry,
} from "../../mock/data";
import { findDirectoryEntry } from "../../mock/data";

type DictKey = keyof Dict;

/**
 * Announcements — spec §4 (composer §4.1, honest send lifecycle §4.2, history
 * §4.3) under the shared §5 mutation contract, §6 RTL and §7/§8 behavior.
 * The demo layer never touches a real mail/push/AI API: a send starts PENDING
 * and the mock boundary settles it; nothing here claims a delivery that did
 * not happen — there is deliberately no "mark as sent" affordance (§4.2, §9).
 */

const BUDGET_BYTES_MAX = 10 * 1024 * 1024; // §4.1 item 3: the explicit demo ceiling
const SUBJECT_MAX = 120;

const numText = (value: number, locale: string): string => new Intl.NumberFormat(locale).format(value);

const bytesText = (bytes: number, locale: "ar" | "en"): string => {
  if (bytes < 1024) return `${numText(bytes, locale)} ${locale === "ar" ? "ب" : "B"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${numText(Math.round(kb), locale)} ${locale === "ar" ? "ك.ب" : "KB"}`;
  const roundedMb = Math.round((kb / 1024) * 10) / 10;
  return `${numText(roundedMb, locale)} ${locale === "ar" ? "م.ب" : "MB"}`;
};

// Brief H3 — the ONE shared formatting path; no screen-local Intl formatters.
const fmtDateTime = (value: string, locale: string): string => formatDateTime(value, locale === "ar" ? "ar" : "en");

type Resolution =
  | { kind: "idle" }
  | { kind: "pending"; subject: string; recipientCount: number; startedAt: string }
  | { kind: "confirmed"; subject: string; recipientCount: number; settledAt: string }
  | { kind: "unknown"; subject: string; recipientCount: number }
  | { kind: "denied" };

const statusMeta: Record<AnnouncementMock["status"], { tone: StatusTone; key: DictKey }> = {
  PENDING: { tone: "info", key: "hrAnnouncementStatusPending" },
  CONFIRMED: { tone: "success", key: "hrAnnouncementStatusConfirmed" },
  UNKNOWN: { tone: "warning", key: "hrAnnouncementStatusUnknown" },
  CONFLICT: { tone: "warning", key: "hrAnnouncementStatusConflict" },
};

const statusIcon = (status: AnnouncementMock["status"]): "approved" | "pending" | "returned" =>
  status === "CONFIRMED" ? "approved" : status === "PENDING" ? "pending" : "returned";

export default function AdminAnnouncementsPage() {
  const { t, locale, capabilities } = useApp();
  usePageTitle(t("adminNavAnnouncements"));

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  // Same honest read lifecycle as the rest of the suite (AdminSettingsPage).
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setPhase("ready"), 350);
    return () => window.clearTimeout(timer);
  }, [phase, attempt]);

  if (!capabilities.canSendAnnouncements) {
    return <Navigate to="/" replace />;
  }

  if (phase === "error") {
    return (
      <div className="page">
        <AdminNav />
        <PageHeader title={t("adminNavAnnouncements")} />
        <ErrorState onRetry={() => { setAttempt((current) => current + 1); setPhase("loading"); }} />
      </div>
    );
  }

  return (
    <div className="page reading-page">
      <AdminNav />
      <PageHeader title={t("hrAnnouncementsTitle")} subtitle={t("hrAnnouncementsSubtitle")} />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>
      {phase === "loading" ? (
        <section className="work-surface section" aria-busy="true">
          <SkeletonRows rows={3} />
        </section>
      ) : (
        <ComposerSection t={t as (key: DictKey) => string} locale={locale} />
      )}
    </div>
  );
}

/* ========================= §4.1 composer + §4.2 lifecycle ========================= */

function ComposerSection({ t, locale }: { t: (key: DictKey) => string; locale: "ar" | "en" }) {
  const { employeeDirectory, sendAnnouncement, settleAnnouncement } = useApp();

  // Draft state lives in React (not form fields) so it survives audience edits (§4.1 item 5).
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [channel, setChannel] = useState<AnnouncementChannel>("BOTH");
  const [audienceMode, setAudienceMode] = useState<AnnouncementAudience>("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  const [resolution, setResolution] = useState<Resolution>({ kind: "idle" });
  const [listDialog, setListDialog] = useState(false);

  // §4.1 item 7 gate, tracked as real state: has HR opened the delivery list?
  const [deliveryInspected, setDeliveryInspected] = useState(false);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const overBudget = totalBytes > BUDGET_BYTES_MAX;

  // Directory grouped by department for the picker and the preview dialog.
  type DepartmentGroup = { key: string; label: { ar: string; en: string }; entries: EmployeeDirectoryEntry[] };
  const groupedDirectory = useMemo<DepartmentGroup[]>(() => {
    const map = new Map<string, { label: { ar: string; en: string }; entries: EmployeeDirectoryEntry[] }>();
    for (const entry of employeeDirectory) {
      const key = entry.department.en;
      const group = map.get(key) ?? { label: entry.department, entries: [] };
      group.entries.push(entry);
      map.set(key, group);
    }
    return [...map.values()].map((group) => ({
      key: group.label.en,
      label: group.label,
      entries: [...group.entries].sort((l, r) => l.name[locale].localeCompare(r.name[locale])),
    }));
  }, [employeeDirectory, locale]);

  const filteredGroups = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    if (!query) return groupedDirectory;
    return groupedDirectory
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          `${entry.name[locale]} ${entry.employee_number} ${entry.email}`.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groupedDirectory, pickerSearch, locale]);

  const shownCount = filteredGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const directoryCount = employeeDirectory.length;
  const resolvedRecipients = audienceMode === "ALL"
    ? employeeDirectory
    : selectedIds.map((id) => findDirectoryEntry(id)).filter((entry): entry is EmployeeDirectoryEntry => Boolean(entry));
  const recipientCount = resolvedRecipients.length;

  const invalidateInspection = () => setDeliveryInspected(false);

  const toggleRecipient = (id: string) => {
    setSelectedIds((current) => (current.includes(id)
      ? current.filter((existingId) => existingId !== id)
      : [...current, id]));
    invalidateInspection();
  };

  const toggleGroup = (group: DepartmentGroup) => {
    const ids = group.entries.map((entry) => entry.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => (allSelected
      ? current.filter((id) => !ids.includes(id))
      : [...new Set([...current, ...ids])]));
    invalidateInspection();
  };

  const selectEveryoneInDirectory = () => {
    setSelectedIds(employeeDirectory.map((entry) => entry.id));
    invalidateInspection();
  };

  const clearSelection = () => {
    setSelectedIds([]);
    invalidateInspection();
  };

  const setMode = (mode: AnnouncementAudience) => {
    setAudienceMode(mode);
    invalidateInspection();
  };

  // --- One pending at a time (§5): pressSend → pending → settle → tried state.
  const channelLabel = (value: AnnouncementChannel): string =>
    value === "EMAIL"
      ? t("hrAnnouncementChannelEmail")
      : value === "NOTIFICATION"
        ? t("hrAnnouncementChannelNotification")
        : t("hrAnnouncementChannelBoth");

  const startSendAttempt = (input: { subject: string; body: string; channel: AnnouncementChannel; audience: AnnouncementAudience; recipientIds: string[] }) => {
    const startedAt = new Date().toISOString();
    const result = sendAnnouncement(input);
    if (!result.ok) {
      // Only reachable refusal is the capability boundary (§4.2 denied).
      setResolution({ kind: "denied" });
      return;
    }
    // Narrow the value before the timeout closure (narrowing dies inside it).
    const pending: AnnouncementMock = result.value !== undefined
      ? result.value
      : { ...({ subject: input.subject, body: input.body, channel: input.channel, audience: input.audience, recipient_ids: input.recipientIds, created_at: startedAt, status: "PENDING" as const } as AnnouncementMock), id: `ann-fallback-${Date.now()}`, attachments: [], created_by: "hr1" };
    const pendingSubject = pending.subject;
    const pendingCount = pending.audience === "ALL" ? directoryCount : pending.recipient_ids.length;
    const pendingChannel = channelLabel(pending.channel);
    const pendingAudience = pending.audience;
    setResolution({ kind: "pending", subject: pendingSubject, recipientCount: pendingCount, startedAt });
    invalidateInspection(); // every send re-opens the inspection gate
    window.setTimeout(() => {
      // The demo boundary always settles as CONFIRMED here: it reports the
      // settled receipt honestly, never a synchronous success (§4.2).
      // The record must be settled too, not just the banner — otherwise the
      // history row stays PENDING forever while the banner claims success.
      settleAnnouncement(pending.id, "CONFIRMED");
      setResolution({
        kind: "confirmed",
        subject: pendingSubject,
        recipientCount: pendingCount,
        settledAt: new Date().toISOString(),
      });
      window.setTimeout(() => setResolution({ kind: "idle" }), 6000);
    }, 1800);
    void pendingChannel;
    void pendingAudience;
  };

  const pressSend = (event: FormEvent) => {
    event.preventDefault();
    startSendAttempt({
      subject: subject.trim(),
      body: body.trim(),
      channel,
      audience: audienceMode,
      recipientIds: audienceMode === "ALL" ? [] : selectedIds,
    });
  };

  // §4.2 retry from UNKNOWN history: a NEW send attempt creating a new record —
  // never a mutation of the unknown row, never mark-as-sent.
  const retrySend = (record: AnnouncementMock) => {
    startSendAttempt({
      subject: record.subject,
      body: record.body,
      channel: record.channel,
      audience: record.audience,
      recipientIds: record.recipient_ids,
    });
  };

  const locked = resolution.kind === "pending";
  const channelKey: Record<AnnouncementChannel, DictKey> = {
    EMAIL: "hrAnnouncementChannelEmail",
    NOTIFICATION: "hrAnnouncementChannelNotification",
    BOTH: "hrAnnouncementChannelBoth",
  };

  // --- §4.1 item 7 gate ---
  const fieldsFilled = subject.trim().length > 0 && body.trim().length > 0;
  const audienceSatisfied = recipientCount > 0;
  const canSend = fieldsFilled && !overBudget && audienceSatisfied && deliveryInspected && !locked;
  const gateMessage = !fieldsFilled
    ? t("hrAnnouncementGateFields")
    : overBudget
      ? t("hrAnnouncementGateBudget").replace("%s", bytesText(BUDGET_BYTES_MAX, locale))
      : !audienceSatisfied
        ? t("hrAnnouncementGateAudienceEmpty")
        : !deliveryInspected
          ? t("hrAnnouncementGateNotInspected")
          : t("hrAnnouncementSendHint");

  return (
    <>
      <section className="work-surface section" aria-labelledby="announce-composer" aria-busy={locked || undefined}>
        <div className="section-heading">
          <h2 id="announce-composer">{t("hrAnnouncementsTitle")}</h2>
        </div>

        {/* --- §4.2 lifecycle: exactly one banner for one mutation --- */}
        {resolution.kind === "pending" ? (
          <Banner tone="info" role="status">
            <div role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              {" "}
              <strong>{t("hrAnnouncementStatusPending")}</strong>
              {" · "}
              {t("hrAnnouncementPendingLine").replace("%s", numText(resolution.recipientCount, locale))}
              {" · "}
              {fmtDateTime(resolution.startedAt, locale)}
            </div>
          </Banner>
        ) : null}

        {resolution.kind === "confirmed" ? (
          <Banner tone="success" role="status">
            <p>{t("hrAnnouncementConfirmedLine").replace("%s", numText(resolution.recipientCount, locale))}</p>
            <p className="page-meta">
              {t("hrAnnouncementReceiptTime").replace("%s", "")}
              {" "}
              {fmtDateTime(resolution.settledAt, locale)}
            </p>
          </Banner>
        ) : null}

        {resolution.kind === "unknown" ? (
          <Banner tone="warning" role="alert">
            <p>{t("hrAnnouncementUnknownBanner").replace("%s", numText(resolution.recipientCount, locale))}</p>
          </Banner>
        ) : null}

        {resolution.kind === "denied" ? (
          <Banner tone="error" role="alert">
            <p>{t("hrAnnouncementDeniedBanner")}</p>
          </Banner>
        ) : null}

        {/* --- 1. Subject with the live counter --- */}
        <label className="field">
          <span className="field-label">{t("hrAnnouncementSubject")}</span>
          <input
            className="input"
            value={subject}
            maxLength={SUBJECT_MAX}
            disabled={locked}
            aria-describedby="announce-subject-counter"
            onChange={(event) => setSubject(event.target.value)}
          />
          <span className="field-hint" id="announce-subject-counter" aria-live="polite">
            {t("hrAnnouncementSubjectCounter").replace("%s", numText(SUBJECT_MAX - subject.length, locale))}
          </span>
        </label>

        {/* --- 2. Body (plain text; markdown is rejected by the email channel in reality) --- */}
        <label className="field">
          <span className="field-label">{t("hrAnnouncementBody")}</span>
          <textarea
            className="textarea"
            rows={6}
            value={body}
            disabled={locked}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>

        {/* --- 3. Attachments with the explicit demo size-budget line --- */}
        <fieldset className="quiet-inset field">
          <legend className="field-label">{t("attachments")}</legend>
          <input
            className="input"
            type="file"
            multiple
            disabled={locked}
            aria-describedby="announce-attachments-demo"
            onChange={(event) => {
              setFiles([...(event.target.files ?? [])]);
              invalidateInspection();
            }}
          />
          {files.length > 0 ? (
            <ul className="attachment-list">
              {files.map((file, index) => (
                <li className="compact-row" key={`${file.name}-${index}`}>
                  <bdi dir="ltr">{file.name}</bdi>
                  <span className="page-meta"><bdi dir="ltr">{bytesText(file.size, locale)}</bdi></span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={locked}
                    aria-label={`${t("hrAnnouncementAttachmentRemoveAria")} ${file.name}`}
                    onClick={() => {
                      setFiles((current) => current.filter((_, i) => i !== index));
                      invalidateInspection();
                    }}
                  >
                    {t("hrAnnouncementAttachmentRemove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <span className={`field-hint${overBudget ? " field-error" : ""}`} aria-live="polite">
            {overBudget
              ? t("hrAnnouncementAttachmentsOverBudget").replace("%s", bytesText(BUDGET_BYTES_MAX, locale))
              : t("hrAnnouncementAttachmentsBudget")
                  .replace("%s", bytesText(totalBytes, locale))
                  .replace("%s", bytesText(BUDGET_BYTES_MAX, locale))}
          </span>
          <span className="field-hint" id="announce-attachments-demo">
            {t("hrAnnouncementAttachmentsDemo")}
          </span>
        </fieldset>

        {/* --- 4. Channel + 5. Audience — side-by-side via form-grid on desktop --- */}
        <div className="form-grid">
          <fieldset className="field announce-choice-field">
            <legend className="field-label">{t("hrAnnouncementChannel")}</legend>
            <div className="role-segmented" role="radiogroup" aria-label={t("hrAnnouncementChannel")}>
              {(["EMAIL", "NOTIFICATION", "BOTH"] as AnnouncementChannel[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={channel === value}
                  className={`role-segmented-option${channel === value ? " is-selected" : ""}`}
                  disabled={locked}
                  onClick={() => setChannel(value)}
                >
                  {t(channelKey[value])}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field announce-choice-field">
            <legend className="field-label">{t("hrAnnouncementAudience")}</legend>
            <div className="role-segmented" role="radiogroup" aria-label={t("hrAnnouncementAudience")}>
              {([
                { value: "ALL" as AnnouncementAudience, label: t("hrAnnouncementAudienceAll") },
                { value: "SELECTED" as AnnouncementAudience, label: t("hrAnnouncementAudienceSelected") },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={audienceMode === option.value}
                  className={`role-segmented-option${audienceMode === option.value ? " is-selected" : ""}`}
                  disabled={locked}
                  onClick={() => setMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {/* --- Two-step audience: expandable searchable, department-grouped picker --- */}
        {audienceMode === "SELECTED" ? (
          <details
            className="quiet-inset announce-audience-picker"
            open={pickerOpen}
            onToggle={(event) => setPickerOpen((event.target as HTMLDetailsElement).open)}
          >
            <summary className="field-label">
              {t("hrAnnouncementAudiencePickerSummary").replace("%s", numText(selectedIds.length, locale))}
            </summary>
            <label className="field announce-picker-search">
              <span className="field-label"><SearchIcon />{t("hrAnnouncementAudienceSearchLabel")}</span>
              <input
                className="input"
                type="search"
                value={pickerSearch}
                disabled={locked}
                onChange={(event) => setPickerSearch(event.target.value)}
              />
            </label>
            <p className="page-meta" aria-live="polite">
              {t("hrAnnouncementAudienceSearchCount")
                .replace("%s", numText(shownCount, locale))
                .replace("%s", numText(directoryCount, locale))}
            </p>
            {filteredGroups.map((group) => {
              const groupAllSelected = group.entries.every((entry) => selectedIds.includes(entry.id));
              return (
                <div className="announce-picker-group" key={group.key}>
                  <div className="row-actions announce-picker-group-heading">
                    <strong>{group.label[locale]}</strong>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      aria-label={t("hrAnnouncementDeptSelectAllAria").replace("%s", group.label[locale])}
                      aria-pressed={groupAllSelected}
                      disabled={locked}
                      onClick={() => toggleGroup(group)}
                    >
                      {groupAllSelected ? t("hrAnnouncementDeptClearAll") : t("hrAnnouncementDeptSelectAll")}
                    </button>
                  </div>
                  <ul className="compact-list">
                    {group.entries.map((entry) => (
                      <li className="compact-row" key={entry.id}>
                        <span className="row-actions">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(entry.id)}
                            disabled={locked}
                            onChange={() => toggleRecipient(entry.id)}
                          />
                          <bdi>{entry.name[locale]}</bdi>
                        </span>
                        <span className="page-meta"><bdi dir="ltr">{entry.employee_number}</bdi></span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <div className="row-actions announce-picker-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                disabled={locked}
                onClick={selectEveryoneInDirectory}
              >
                {t("hrAnnouncementSelectEveryoneInDirectory")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                disabled={locked}
                onClick={clearSelection}
              >
                {t("hrAnnouncementClearSelection")}
              </button>
              <span className="page-meta">
                {t("hrAnnouncementSelectionNote")
                  .replace("%s", numText(selectedIds.length, locale))
                  .replace("%s", numText(groupedDirectory.length, locale))}
              </span>
            </div>
          </details>
        ) : null}

        {/* --- 6. Delivery-list preview — changes as the audience is edited --- */}
        {recipientCount === 0 ? (
          <div className="quiet-inset announce-preview-warning" role="note">
            <p>{t("hrAnnouncementPreviewEmpty")}</p>
          </div>
        ) : (
          <div className="quiet-inset announce-preview" role="note">
            <p>
              {audienceMode === "ALL"
                ? t("hrAnnouncementPreviewAll").replace("%s", numText(directoryCount, locale))
                : t("hrAnnouncementPreviewChosen").replace("%s", numText(recipientCount, locale))}
            </p>
            <p className="page-meta">
              {audienceMode === "ALL" ? `${t("hrAnnouncementPreviewManagersNote")} ` : null}
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                disabled={locked}
                onClick={() => {
                  // Opening the delivery list is the deliberate inspection act (§4.1 item 7).
                  setDeliveryInspected(true);
                  setListDialog(true);
                }}
              >
                {t("hrAnnouncementPreviewViewList")}
              </button>
              {deliveryInspected ? <StatusPill tone="success" label={t("hrAnnouncementInspectedPill")} /> : null}
            </p>
          </div>
        )}

        {/* --- 7. Send, gated on §4.1 item 7's four conditions --- */}
        <form className="form-actions announce-send-actions" onSubmit={pressSend}>
          <button type="submit" className="btn btn-primary" disabled={!canSend || locked} aria-describedby="send-hint">
            {locked ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {t("hrAnnouncementSending")}
              </>
            ) : (
              t("hrAnnouncementSend")
            )}
          </button>
          {/* "Send again" appears only after resolution (§4.2 — no cancel). */}
          {resolution.kind === "confirmed" || resolution.kind === "unknown" ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setResolution({ kind: "idle" });
                setDeliveryInspected(false);
              }}
            >
              {t("hrAnnouncementSendAgain")}
            </button>
          ) : null}
        </form>
        <p className="field-hint" id="send-hint">{gateMessage}</p>
      </section>

      {listDialog ? (
        <DeliveryListDialog
          t={t}
          locale={locale}
          audienceMode={audienceMode}
          entries={resolvedRecipients}
          onClose={() => setListDialog(false)}
        />
      ) : null}

      <HistorySection t={t} locale={locale} onRetry={retrySend} />
    </>
  );
}

/* ============================== §4.3 History list ============================== */

function HistorySection({
  t,
  locale,
  onRetry,
}: {
  t: (key: DictKey) => string;
  locale: "ar" | "en";
  onRetry: (record: AnnouncementMock) => void;
}) {
  const { employeeDirectory, announcementItems } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // §4.3 newest first, no pagination (demo volumes).
  const rows = useMemo(
    () => [...announcementItems].sort((l, r) => r.created_at.localeCompare(l.created_at)),
    [announcementItems],
  );

  const columns: OperationalColumn<AnnouncementMock>[] = [
    {
      key: "subject",
      label: t("hrAnnouncementSubject"),
      render: (record) => (
        <span title={record.subject}>
          <bdi>{record.subject.length > 60 ? `${record.subject.slice(0, 60)}…` : record.subject}</bdi>
        </span>
      ),
    },
    {
      key: "channel",
      label: t("hrAnnouncementChannel"),
      render: (record) => {
        const label = record.channel === "EMAIL"
          ? t("hrAnnouncementChannelEmail")
          : record.channel === "NOTIFICATION"
            ? t("hrAnnouncementChannelNotification")
            : t("hrAnnouncementChannelBoth");
        return <StatusPill tone="neutral" icon="draft" label={label} />;
      },
    },
    {
      key: "recipients",
      label: t("hrAnnouncementRecipients"),
      render: (record) => {
        const recipients = record.audience === "ALL"
          ? employeeDirectory
          : record.recipient_ids.map((id) => findDirectoryEntry(id)).filter((entry): entry is EmployeeDirectoryEntry => Boolean(entry));
        const open = expandedId === record.id;
        return (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              aria-expanded={open}
              aria-label={t("hrAnnouncementShowRecipientsAria").replace("%s", numText(recipients.length, locale))}
              onClick={() => setExpandedId(open ? null : record.id)}
            >
              <ChevronDownIcon className={open ? "is-open" : undefined} />
              {t("hrAnnouncementShowRecipients").replace("%s", numText(recipients.length, locale))}
            </button>
            {open ? (
              <ul className="compact-list quiet-inset">
                {[...recipients]
                  .sort((l, r) => l.department[locale].localeCompare(r.department[locale]) || l.name[locale].localeCompare(r.name[locale]))
                  .map((entry) => (
                    <li className="compact-row" key={entry.id}>
                      <bdi>{entry.name[locale]}</bdi>
                      <span className="page-meta">{entry.department[locale]}</span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        );
      },
    },
    {
      key: "sent",
      label: t("hrAnnouncementSentAt"),
      render: (record) => fmtDateTime(record.created_at, locale),
    },
    {
      key: "status",
      label: t("status"),
      render: (record) => (
        <StatusPill tone={statusMeta[record.status].tone} icon={statusIcon(record.status)} label={t(statusMeta[record.status].key)} />
      ),
    },
    {
      key: "action",
      label: t("attendanceActionLabel"),
      render: (record) =>
        // §4.3: retry only when unknown; "View" otherwise (read-only details).
        record.status === "UNKNOWN" || record.status === "CONFLICT" ? (
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            aria-label={t("hrAnnouncementRetryAria").replace("%s", record.subject)}
            onClick={() => onRetry(record)}
          >
            {t("hrAnnouncementRetry")}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            aria-expanded={expandedId === record.id}
            aria-label={t("hrAnnouncementViewAria").replace("%s", record.subject)}
            onClick={() => setExpandedId((current) => (current === record.id ? null : record.id))}
          >
            {t("hrAnnouncementView")}
          </button>
        ),
    },
  ];

  return (
    <section className="work-surface section" aria-labelledby="announce-history">
      <div className="section-heading">
        <h2 id="announce-history">{t("hrAnnouncementHistoryTitle")}</h2>
        <span className="page-meta">
          {t("hrAnnouncementHistoryCount").replace("%s", numText(rows.length, locale))}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState message={t("hrAnnouncementEmpty")} />
      ) : (
        <OperationalTable
          caption={t("hrAnnouncementHistoryCount").replace("%s", numText(rows.length, locale))}
          columns={columns}
          records={rows}
        />
      )}
    </section>
  );
}

/* ===================== §4.1 delivery-list Dialog (one name per row) ===================== */

function DeliveryListDialog({
  t,
  locale,
  audienceMode,
  entries,
  onClose,
}: {
  t: (key: DictKey) => string;
  locale: "ar" | "en";
  audienceMode: AnnouncementAudience;
  entries: EmployeeDirectoryEntry[];
  onClose: () => void;
}) {
  const sorted = [...entries].sort(
    (l, r) => l.department[locale].localeCompare(r.department[locale]) || l.name[locale].localeCompare(r.name[locale]),
  );
  return (
    <Dialog
      title={t("hrAnnouncementDialogTitle")}
      description={
        (audienceMode === "ALL"
          ? t("hrAnnouncementPreviewAll")
          : t("hrAnnouncementPreviewChosen")).replace(/%s/g, numText(sorted.length, locale))
      }
      onClose={onClose}
    >
      <ul className="compact-list announce-delivery-list">
        {sorted.map((entry) => (
          <li className="compact-row" key={entry.id}>
            <bdi>{entry.name[locale]}</bdi>
            <span className="page-meta">
              {entry.department[locale]} · <bdi dir="ltr">{entry.employee_number}</bdi>
            </span>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t("close")}</button>
      </div>
    </Dialog>
  );
}
