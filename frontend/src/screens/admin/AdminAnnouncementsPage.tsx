import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { ApiError } from "../../app/api";
import { formatDateTime } from "../../app/format";
import {
  createAnnouncement,
  fetchAnnouncementLog,
  fetchAnnouncements,
  publishAnnouncement,
  type AnnouncementAudience,
  type ServerAnnouncement,
  type ServerDelivery,
} from "../../app/announcementsApi";
import { listEmployees, type ServerEmployee } from "../../app/orgApi";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import { Banner, Dialog, EmptyState, SkeletonRows, StatusPill } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";
import type { Dict } from "../../i18n/dict";

/**
 * الإعلانات الداخلية - the real, server-backed announcements module.
 *
 * The page used to be an honest banner: there was no announcements endpoint, so
 * it refused to compose or send anything. Now it reads and writes the real API:
 *
 *   • the composer authors a DRAFT (POST /announcements);
 *   • the list shows HR every company announcement and offers «publish» on a
 *     draft (POST /announcements/<id>/publish, carrying the version);
 *   • the send log reads GET /announcements/log — what the server actually did.
 *
 * It never fakes a delivery. The only channel the product has is the in-app
 * feed, and the log says exactly that; there is no email/push copy anywhere.
 * A failed read is stated by its real reason and never renders as «empty».
 */

type T = (key: keyof Dict) => string;

/** OperationalTable keys rows by a STRING id; the server's ids are numeric. */
type AnnouncementRow = Omit<ServerAnnouncement, "id"> & { id: string };
type DeliveryRow = Omit<ServerDelivery, "id"> & { id: string };

export default function AdminAnnouncementsPage() {
  const { t, locale, capabilities } = useApp();
  usePageTitle(t("adminNavAnnouncements"));

  if (!capabilities.canSendAnnouncements) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page">
      <AdminNav />
      <PageHeader title={t("hrAnnouncementsTitle")} subtitle={t("hrAnnouncementsSubtitle")} />
      <AnnouncementsWorkspace t={t} locale={locale} />
    </div>
  );
}

/* ================================ workspace ================================ */

function AnnouncementsWorkspace({ t, locale }: { t: T; locale: "ar" | "en" }) {
  const [announcements, setAnnouncements] = useState<ServerAnnouncement[] | null>(null);
  const [log, setLog] = useState<ServerDelivery[] | null>(null);
  const [employees, setEmployees] = useState<ServerEmployee[] | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The composer's draft.
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("ALL");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fieldIssues, setFieldIssues] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  // The publish confirmation. Only the fields the publish call needs.
  const [publishTarget, setPublishTarget] = useState<
    { id: number; version: number; title: string } | null
  >(null);
  const [publishing, setPublishing] = useState(false);

  const reload = useCallback(async () => {
    const [nextAnnouncements, nextLog, nextEmployees] = await Promise.all([
      fetchAnnouncements(locale),
      fetchAnnouncementLog(locale),
      listEmployees(locale),
    ]);
    setAnnouncements(nextAnnouncements);
    setLog(nextLog);
    setEmployees(nextEmployees);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    reload()
      .then(() => {
        if (!cancelled) setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reload, attempt]);

  const activeEmployees = useMemo(
    () => (employees ?? []).filter((person) => person.is_active),
    [employees],
  );

  const toggleRecipient = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetComposer = () => {
    setTitle("");
    setBody("");
    setAudience("ALL");
    setSelected(new Set());
    setFieldIssues({});
  };

  const submitDraft = async () => {
    setProblem(null);
    const issues: Record<string, string[]> = {};
    if (!title.trim()) issues.title = [t("adminErrorRequired")];
    if (!body.trim()) issues.body = [t("adminErrorRequired")];
    if (audience === "SELECTED" && selected.size === 0) {
      issues.recipients = [t("hrAnnouncementNoRecipients")];
    }
    if (Object.keys(issues).length > 0) {
      setFieldIssues(issues);
      return;
    }
    setFieldIssues({});
    setSaving(true);
    try {
      await createAnnouncement(
        {
          title: title.trim(),
          body: body.trim(),
          audience,
          recipients: audience === "SELECTED" ? Array.from(selected) : undefined,
        },
        locale,
      );
      resetComposer();
      await reload();
      setNotice(t("hrAnnouncementCreated"));
    } catch (failure) {
      const serverIssues = fieldIssuesFrom(failure);
      if (serverIssues) setFieldIssues(serverIssues);
      else setProblem(describeFailure(failure, t));
    } finally {
      setSaving(false);
    }
  };

  const confirmPublish = async () => {
    if (!publishTarget) return;
    setPublishing(true);
    setProblem(null);
    try {
      await publishAnnouncement(publishTarget.id, publishTarget.version, locale);
      setPublishTarget(null);
      await reload();
      setNotice(t("hrAnnouncementPublishedNotice"));
    } catch (failure) {
      // A stale version or an already-published row is reported honestly, and
      // the list is re-read so the operator sees the real current state.
      setPublishTarget(null);
      setProblem(describeFailure(failure, t));
      await reload().catch(() => undefined);
    } finally {
      setPublishing(false);
    }
  };

  const announcementColumns: OperationalColumn<AnnouncementRow>[] = [
    {
      key: "title",
      label: t("hrAnnouncementSubject"),
      render: (row) => (
        <div>
          <strong>{row.title}</strong>
          <div className="page-meta">{row.body}</div>
        </div>
      ),
    },
    {
      key: "state",
      label: t("hrAnnouncementStateColumn"),
      render: (row) =>
        row.state === "PUBLISHED" ? (
          <StatusPill tone="success" label={t("hrAnnouncementStatePublished")} icon="approved" />
        ) : (
          <StatusPill tone="neutral" label={t("hrAnnouncementStateDraft")} icon="draft" />
        ),
    },
    {
      key: "audience",
      label: t("hrAnnouncementAudience"),
      render: (row) => (
        <span className="page-meta">
          {row.audience === "ALL" ? t("hrAnnouncementAudienceAll") : t("hrAnnouncementAudienceSelected")}
        </span>
      ),
    },
    {
      key: "recipients",
      label: t("hrAnnouncementRecipients"),
      render: (row) => (
        <span className="page-meta">
          {t("hrAnnouncementRecipientCount").replace("%s", String(row.recipient_count))}
        </span>
      ),
    },
    {
      key: "action",
      label: t("hrAnnouncementStateColumn"),
      render: (row) =>
        row.state === "DRAFT" ? (
          <button
            className="btn btn-primary btn-compact"
            type="button"
            onClick={() => {
              setProblem(null);
              setPublishTarget({ id: Number(row.id), version: row.version, title: row.title });
            }}
          >
            {t("hrAnnouncementPublishAction")}
          </button>
        ) : (
          <span className="page-meta">
            {row.published_at ? formatDateTime(row.published_at, locale) : ""}
          </span>
        ),
    },
  ];

  const logColumns: OperationalColumn<DeliveryRow>[] = [
    {
      key: "announcement",
      label: t("hrAnnouncementSubject"),
      render: (row) => <span>{row.announcement_title}</span>,
    },
    {
      key: "audience",
      label: t("hrAnnouncementAudience"),
      render: (row) => (
        <span className="page-meta">
          {row.audience === "ALL" ? t("hrAnnouncementAudienceAll") : t("hrAnnouncementAudienceSelected")}
        </span>
      ),
    },
    {
      key: "recipients",
      label: t("hrAnnouncementRecipients"),
      render: (row) => (
        <span className="page-meta">
          {t("hrAnnouncementRecipientCount").replace("%s", String(row.recipient_count))}
        </span>
      ),
    },
    {
      key: "channel",
      label: t("hrAnnouncementChannel"),
      render: () => <span className="page-meta">{t("hrAnnouncementChannelInApp")}</span>,
    },
    {
      key: "sent_by",
      label: t("hrAnnouncementSentBy"),
      render: (row) => <span className="page-meta">{row.sent_by_name}</span>,
    },
    {
      key: "sent_at",
      label: t("hrAnnouncementSentAt"),
      render: (row) => <span className="page-meta">{formatDateTime(row.sent_at, locale)}</span>,
    },
  ];

  const announcementRecords = (announcements ?? []).map((row) => ({ ...row, id: String(row.id) }));
  const logRecords = (log ?? []).map((row) => ({ ...row, id: String(row.id) }));

  return (
    <>
      {notice ? (
        <Banner tone="success" role="status">
          {notice}
        </Banner>
      ) : null}
      {problem ? (
        <Banner tone="error" role="alert">
          {problem}
        </Banner>
      ) : null}

      {/* ------------------------------- composer ------------------------------- */}
      <section className="work-surface section" aria-labelledby="announcements-compose-heading">
        <div className="section-heading">
          <h2 id="announcements-compose-heading">{t("hrAnnouncementComposeTitle")}</h2>
          <span className="page-meta">{t("hrAnnouncementDraftHint")}</span>
        </div>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <div className="form-grid">
            <label className="field" htmlFor="announcement-title">
              <span className="field-label">
                {t("hrAnnouncementSubject")} <span className="field-required">*</span>
              </span>
              <input
                id="announcement-title"
                className="input"
                value={title}
                aria-invalid={fieldIssues.title ? "true" : undefined}
                onChange={(event) => setTitle(event.target.value)}
              />
              {fieldIssues.title ? (
                <span className="field-error" role="alert">
                  {fieldIssues.title.join(" · ")}
                </span>
              ) : null}
            </label>

            <label className="field" htmlFor="announcement-audience">
              <span className="field-label">{t("hrAnnouncementAudience")}</span>
              {/* ds-allow-native-select: two fixed options; listbox rewrite is deferred */}
              <select
                id="announcement-audience"
                className="select"
                value={audience}
                onChange={(event) => setAudience(event.target.value as AnnouncementAudience)}
              >
                <option value="ALL">{t("hrAnnouncementAudienceAll")}</option>
                <option value="SELECTED">{t("hrAnnouncementAudienceSelected")}</option>
              </select>
              <span className="field-hint">
                {audience === "ALL"
                  ? t("hrAnnouncementAudienceAllHint")
                  : t("hrAnnouncementAudienceSelectedHint")}
              </span>
            </label>
          </div>

          {audience === "SELECTED" ? (
            <fieldset
              className="quiet-inset"
              disabled={saving}
              style={{ marginBlock: "var(--sp-4)" }}
              aria-invalid={fieldIssues.recipients ? "true" : undefined}
            >
              <legend className="field-label">{t("hrAnnouncementRecipients")}</legend>
              {employees === null ? <SkeletonRows rows={2} /> : null}
              {employees !== null && activeEmployees.length === 0 ? (
                <p className="page-meta">{t("hrAnnouncementEmployeesFailed")}</p>
              ) : null}
              {activeEmployees.map((person) => (
                <label className="field" key={person.id} style={{ marginBlockEnd: "var(--sp-1)" }}>
                  <span>
                    <input
                      type="checkbox"
                      checked={selected.has(person.id)}
                      onChange={() => toggleRecipient(person.id)}
                    />{" "}
                    {person.full_name || person.email}
                  </span>
                </label>
              ))}
              {fieldIssues.recipients ? (
                <span className="field-error" role="alert">
                  {fieldIssues.recipients.join(" · ")}
                </span>
              ) : null}
            </fieldset>
          ) : null}

          <label className="field" htmlFor="announcement-body" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">
              {t("hrAnnouncementBody")} <span className="field-required">*</span>
            </span>
            <textarea
              id="announcement-body"
              className="textarea"
              rows={4}
              value={body}
              aria-invalid={fieldIssues.body ? "true" : undefined}
              onChange={(event) => setBody(event.target.value)}
            />
            {fieldIssues.body ? (
              <span className="field-error" role="alert">
                {fieldIssues.body.join(" · ")}
              </span>
            ) : null}
          </label>

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={saving} aria-busy={saving}>
              {saving ? t("hrAnnouncementCreating") : t("hrAnnouncementCreateAction")}
            </button>
          </div>
        </form>
      </section>

      {/* -------------------------------- the list ------------------------------- */}
      <section className="section" aria-labelledby="announcements-list-heading">
        <div className="section-heading">
          <h2 id="announcements-list-heading">{t("hrAnnouncementListTitle")}</h2>
          <div className="row-actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setAttempt((count) => count + 1)}
            >
              {t("retry")}
            </button>
          </div>
        </div>

        {phase === "loading" ? <SkeletonRows rows={3} /> : null}
        {phase === "error" ? (
          <Banner tone="error" role="alert">
            {t("hrAnnouncementLoadFailed")}
          </Banner>
        ) : null}
        {phase === "ready" && announcements && announcements.length === 0 ? (
          <EmptyState message={t("hrAnnouncementEmpty")} />
        ) : null}
        {phase === "ready" && announcements && announcements.length > 0 ? (
          <OperationalTable
            caption={t("hrAnnouncementListTitle")}
            columns={announcementColumns}
            records={announcementRecords}
          />
        ) : null}
      </section>

      {/* ------------------------------ the send log ----------------------------- */}
      <section className="section" aria-labelledby="announcements-log-heading">
        <div className="section-heading">
          <h2 id="announcements-log-heading">{t("hrAnnouncementLogTitle")}</h2>
          <span className="page-meta">
            {t("reportOrgTimezone")}: <bdi dir="ltr">Africa/Cairo</bdi>
          </span>
        </div>

        {phase === "error" ? (
          <Banner tone="error" role="alert">
            {t("hrAnnouncementLogLoadFailed")}
          </Banner>
        ) : null}
        {phase === "ready" && log && log.length === 0 ? (
          <EmptyState message={t("hrAnnouncementLogEmpty")} />
        ) : null}
        {phase === "ready" && log && log.length > 0 ? (
          <OperationalTable
            caption={t("hrAnnouncementLogTitle")}
            columns={logColumns}
            records={logRecords}
          />
        ) : null}
      </section>

      {publishTarget ? (
        <Dialog
          title={t("hrAnnouncementPublishDialogTitle")}
          description={t("hrAnnouncementPublishDialogBody")}
          busy={publishing}
          onClose={() => setPublishTarget(null)}
        >
          <p>{publishTarget.title}</p>
          <div className="dialog-actions">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={publishing}
              onClick={() => setPublishTarget(null)}
            >
              {t("cancel")}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={publishing}
              aria-busy={publishing}
              onClick={confirmPublish}
            >
              {publishing ? t("hrAnnouncementPublishing") : t("hrAnnouncementPublishAction")}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/* ================================ helpers ================================= */

/** The server's per-field refusals, kept verbatim for the form. */
function fieldIssuesFrom(failure: unknown): Record<string, string[]> | null {
  if (!(failure instanceof ApiError) || !failure.fields) return null;
  const issues: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(failure.fields)) {
    const list = (messages ?? []).filter(Boolean);
    if (list.length > 0) issues[field] = list;
  }
  return Object.keys(issues).length > 0 ? issues : null;
}

/** Why a write did not land, said without pretending. */
function describeFailure(failure: unknown, t: T): string {
  if (failure instanceof ApiError) {
    if (failure.kind === "unauthenticated" || failure.kind === "forbidden") {
      return t("hrAnnouncementActionDenied");
    }
    if (failure.kind === "unreachable") return t("hrAnnouncementLoadFailed");
    if (failure.message) return failure.message;
  }
  return t("hrAnnouncementLoadFailed");
}
