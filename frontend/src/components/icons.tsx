import { Fragment, type SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & { size?: number | string };

type IconName =
  | "activity" | "alertTriangle" | "arrowLeft" | "bell" | "calendar" | "check"
  | "chevronDown" | "chevronLeft" | "chevronRight" | "clock" | "close" | "document"
  | "edit" | "filter" | "globe" | "home" | "info" | "logout" | "moon" | "palette" | "play"
  | "plus" | "search" | "sun" | "user";

const paths: Record<IconName, ReturnType<typeof Fragment>> = {
  activity: <path d="M3 12h3l2.2-5 3.6 10 2.2-5h3" />,
  alertTriangle: <><path d="M10 3.2 18 17H2L10 3.2Z" /><path d="M10 8v4" /><path d="M10 15h.01" /></>,
  arrowLeft: <><path d="M12 5 7 10l5 5" /><path d="M7 10h10" /></>,
  bell: <><path d="M15.5 8.5a5.5 5.5 0 0 0-11 0c0 4-1.5 5-1.5 5h14s-1.5-1-1.5-5Z" /><path d="M8 16a2 2 0 0 0 4 0" /></>,
  calendar: <><path d="M6 3v3M14 3v3" /><path d="M4.5 5h11A1.5 1.5 0 0 1 17 6.5v9A1.5 1.5 0 0 1 15.5 17h-11A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5Z" /><path d="M3 9h14" /></>,
  check: <path d="m4 10 4 4 8-8" />,
  chevronDown: <path d="m6 8 4 4 4-4" />,
  chevronLeft: <path d="m12 5-5 5 5 5" />,
  chevronRight: <path d="m8 5 5 5-5 5" />,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l3 2" /></>,
  close: <path d="M5 5 15 15M15 5 5 15" />,
  document: <><path d="M6 3h5l4 4v10H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M11 3v4h4" /><path d="M8 11h4M8 14h4" /></>,
  edit: <><path d="M4 14.5V17h2.5L15 8.5 12.5 6 4 14.5Z" /><path d="m11.5 7 1.5-1.5a1.4 1.4 0 0 1 2 2L13.5 9" /></>,
  filter: <><path d="M3 5h14" /><path d="M6 10h8" /><path d="M8.5 15h3" /></>,
  globe: <><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7Z" /></>,
  home: <><path d="m3 9 7-6 7 6" /><path d="M5 8v8h10V8" /><path d="M8.5 16v-4h3v4" /></>,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v5" /><path d="M10 6h.01" /></>,
  logout: <><path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /><path d="M12 7l3 3-3 3" /><path d="M15 10H8" /></>,
  moon: <path d="M16 11.2A6.2 6.2 0 0 1 8.8 4 6.5 6.5 0 1 0 16 11.2Z" />,
  palette: <><path d="M10 3a7 7 0 1 0 0 14h1.2a1.8 1.8 0 0 0 1.3-3.1 1.8 1.8 0 0 1 1.3-3.1H16A7 7 0 0 0 10 3Z" /><path d="M6.5 8h.01M9 6h.01M13 6.5h.01M15 9h.01" /></>,
  play: <path d="M7 5.5v9l7-4.5-7-4.5Z" />,
  plus: <path d="M10 4v12M4 10h12" />,
  search: <><circle cx="9" cy="9" r="5" /><path d="m13 13 4 4" /></>,
  sun: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v1.3M10 16.2v1.3M17.5 10h-1.3M3.8 10H2.5M15.3 4.7l-.9.9M5.6 14.4l-.9.9M15.3 15.3l-.9-.9M5.6 5.6l-.9-.9" /></>,
  user: <><circle cx="10" cy="7" r="3" /><path d="M4.5 17a5.5 5.5 0 0 1 11 0" /></>,
};

function SvgIcon({ name, size = 20, className, ...props }: IconProps & { name: IconName }) {
  return <svg aria-hidden="true" className={["icon", className].filter(Boolean).join(" ")} fill="none" focusable="false" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.65} viewBox="0 0 20 20" width={size} {...props}>{paths[name]}</svg>;
}

export function ActivityIcon(props: IconProps) { return <SvgIcon name="activity" {...props} />; }
export function AlertTriangleIcon(props: IconProps) { return <SvgIcon name="alertTriangle" {...props} />; }
export function ArrowLeftIcon(props: IconProps) { return <SvgIcon name="arrowLeft" {...props} />; }
export function BellIcon(props: IconProps) { return <SvgIcon name="bell" {...props} />; }
export function CalendarIcon(props: IconProps) { return <SvgIcon name="calendar" {...props} />; }
export function CheckIcon(props: IconProps) { return <SvgIcon name="check" {...props} />; }
export function ChevronDownIcon(props: IconProps) { return <SvgIcon name="chevronDown" {...props} />; }
export function ChevronLeftIcon(props: IconProps) { return <SvgIcon name="chevronLeft" {...props} />; }
export function ChevronRightIcon(props: IconProps) { return <SvgIcon name="chevronRight" {...props} />; }
export function ClockIcon(props: IconProps) { return <SvgIcon name="clock" {...props} />; }
export function CloseIcon(props: IconProps) { return <SvgIcon name="close" {...props} />; }
export function DocumentIcon(props: IconProps) { return <SvgIcon name="document" {...props} />; }
export function EditIcon(props: IconProps) { return <SvgIcon name="edit" {...props} />; }
export function FilterIcon(props: IconProps) { return <SvgIcon name="filter" {...props} />; }
export function GlobeIcon(props: IconProps) { return <SvgIcon name="globe" {...props} />; }
export function HomeIcon(props: IconProps) { return <SvgIcon name="home" {...props} />; }
export function InfoIcon(props: IconProps) { return <SvgIcon name="info" {...props} />; }
export function LogoutIcon(props: IconProps) { return <SvgIcon name="logout" {...props} />; }
export function MoonIcon(props: IconProps) { return <SvgIcon name="moon" {...props} />; }
export function PaletteIcon(props: IconProps) { return <SvgIcon name="palette" {...props} />; }
export function PlayIcon(props: IconProps) { return <SvgIcon name="play" {...props} />; }
export function PlusIcon(props: IconProps) { return <SvgIcon name="plus" {...props} />; }
export function SearchIcon(props: IconProps) { return <SvgIcon name="search" {...props} />; }
export function SunIcon(props: IconProps) { return <SvgIcon name="sun" {...props} />; }
export function UserIcon(props: IconProps) { return <SvgIcon name="user" {...props} />; }

export function RtlChevronIcon({ locale, direction, ...props }: IconProps & { locale: "ar" | "en"; direction: "back" | "forward" }) {
  const pointsLeft = direction === "back" ? locale !== "ar" : locale === "ar";
  return pointsLeft ? <ChevronLeftIcon {...props} /> : <ChevronRightIcon {...props} />;
}
export function RtlArrowBackIcon({ locale, ...props }: IconProps & { locale: "ar" | "en" }) {
  return <ArrowLeftIcon className={locale === "ar" ? "icon-mirror" : undefined} {...props} />;
}
