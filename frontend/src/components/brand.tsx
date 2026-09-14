/**
 * Brand lockup: original doodle mark (composed clipboard + one wandering violet
 * slip = a touch of "fawda" inside order). Original artwork for هي فوضى؟ —
 * no third-party imagery.
 */
import { useApp } from "../app/AppContext";

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 36 36"
      aria-hidden="true"
      focusable="false"
    >
      {/* clipboard body */}
      <rect x="5.5" y="5.5" width="25" height="27" rx="4" fill="none" stroke="currentColor" strokeWidth="2.4" />
      {/* clip */}
      <rect x="12" y="2.5" width="12" height="6" rx="2" fill="currentColor" />
      {/* orderly work lines; the second line stays straight */}
      <line x1="11" y1="16" x2="25" y2="16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="11" y1="21" x2="25" y2="21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="11" y1="26" x2="21" y2="26" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      {/* the one slip that wandered off — violet accent, doodle-tilted */}
      <rect
        x="23.5"
        y="26.5"
        width="9"
        height="6"
        rx="1.5"
        fill="#6d28d9"
        transform="rotate(-8 28 30)"
      />
    </svg>
  );
}

export function Brand() {
  const { t } = useApp();
  return (
    <div className="brand">
      <BrandMark />
      <div>
        <div className="brand-word">
          <bdi>{t("brand")}</bdi>
        </div>
        <div className="brand-sub">
          <bdi>{t("descriptor")}</bdi>
        </div>
      </div>
    </div>
  );
}
