import { useApp } from "../../app/AppContext";

type BrandLockupProps = { showTagline?: boolean };

export default function BrandLockup(_props: BrandLockupProps) {
  const { resolvedTheme, t } = useApp();
  return (
    <div className="brand-lockup">
      <img className="brand-logo" src={`/brand/logo-${resolvedTheme}.png`} alt={t("brand")} />
    </div>
  );
}
