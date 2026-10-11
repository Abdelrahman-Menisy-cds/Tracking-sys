import type { ReactNode } from "react";
import { useApp } from "../../app/AppContext";

export default function PageHeader({
  title,
  subtitle,
  primaryAction,
  breadcrumb,
  headingId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  primaryAction?: ReactNode;
  breadcrumb?: ReactNode;
  headingId?: string;
}) {
  const { locale } = useApp();
  return (
    <>
      {breadcrumb ? <nav className="muted" aria-label={locale === "ar" ? "مسار التنقل" : "Breadcrumb"}>{breadcrumb}</nav> : null}
      <header className="page-header">
        <div className="page-header-copy">
          <h1 id={headingId}>{title}</h1>
          {subtitle ? <p className="page-meta">{subtitle}</p> : null}
        </div>
        {primaryAction ? <div className="page-actions">{primaryAction}</div> : null}
      </header>
    </>
  );
}
