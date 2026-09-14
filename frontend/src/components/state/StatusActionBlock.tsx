import type { ReactNode } from "react";
export default function StatusActionBlock({ children, tone = "pending" }: { children: ReactNode; tone?: "pending" | "approved" | "rejected" }) { return <div className={`status-action-block ${tone}`}>{children}</div>; }
