import type { ReactNode } from "react";
import { useApp } from "../../app/AppContext";

export default function PageHeader({
  title,
  subtitle,
  primaryAction,
  breadcrumb,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  primaryAction?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  const { locale } = useApp();
  return (
    <>
      {breadcrumb ? <nav className="muted" aria-label={locale === "ar" ? "مسار التنقل" : "Breadcrumb"}>{breadcrumb}</nav> : null}
      <header className="page-header">
        <div className="page-header-copy">
          <h1>{title}</h1>
          {subtitle ? <p className="page-meta">{subtitle}</p> : null}
        </div>
        {primaryAction ? <div className="page-actions">{primaryAction}</div> : null}
      </header>
    </>
  );
}
