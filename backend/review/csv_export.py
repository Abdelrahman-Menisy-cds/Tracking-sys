"""Story 4.3: deterministic, injection-safe CSV export builder.

- UTF-8 output WITH BOM (\ufeff) so Excel and other consumers read Arabic
  and other non-ASCII values correctly; Content-Type declares charset.
- Formula injection: any cell beginning with =, +, -, @ (or a tab/CR
  prefix) is neutralized by prefixing a single quote `'` (standard OWASP
  mitigation). Cells are also stripped of control characters.
- Explicit units: minute columns get "_minutes" headers; every CSV embeds
  the scope/timezone/date-interval comment rows so the output carries its
  own metadata.
- Deterministic: rows come from the single report source in fixed order.
- No disk save: the response streams the CSV directly (download
  initiation only).
"""
import csv
import io

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
_CONTROL_CHARS = set(chr(c) for c in range(0, 32)) - {"\n", "\t"}

REQUEST_ROWS_HEADER = (
    "report",
    "scope",
    "org_timezone",
    "date_from",
    "date_to",
    "request_id",
    "requester_name",
    "requester_email",
    "request_type",
    "title",
    "status",
    "version",
    "submitted_at_utc",
    "created_at_utc",
)

TIMESHEET_ROWS_HEADER = (
    "report",
    "scope",
    "org_timezone",
    "date_from",
    "date_to",
    "timesheet_id",
    "employee_id",
    "employee_name",
    "employee_email",
    "week_start",
    "status",
    "version",
    "total_worked_minutes",
    "total_unpaid_break_minutes",
    "created_at_utc",
    "updated_at_utc",
)


def sanitize_cell(value) -> str:
    """Neutralize formula-injection payloads and strip control characters."""
    text = "" if value is None else str(value)
    text = "".join(ch for ch in text if ch not in _CONTROL_CHARS)
    if text.startswith(_FORMULA_PREFIXES):
        return "'" + text
    return text


def row_metadata_lines(meta: dict) -> list:
    """Leading comment-style metadata rows (no formulas possible in values)."""
    return [
        ["# report", meta["report"]],
        ["# scope", meta["scope"]],
        ["# org_timezone", meta["org_timezone"]],
        ["# date_from", meta.get("date_from") or ""],
        ["# date_to", meta.get("date_to") or ""],
        ["# generated_at_utc", meta["generated_at_utc"]],
        ["# total_units", "counts; minute totals in minutes"],
    ]


def request_row_out(meta: dict, req) -> list:
    return [
        meta["report"],
        meta["scope"],
        meta["org_timezone"],
        meta.get("date_from") or "",
        meta.get("date_to") or "",
        str(req.pk),
        req.requester.full_name,
        req.requester.email,
        req.request_type.name,
        req.title,
        req.status,
        str(req.version),
        req.submitted_at.isoformat() if req.submitted_at else "",
        req.created_at.isoformat(),
    ]


def timesheet_row_out(meta: dict, sheet) -> list:
    worked = sum(e.duration_minutes for e in sheet.entries.all())
    breaks = sum(e.unpaid_break_minutes for e in sheet.entries.all())
    return [
        meta["report"],
        meta["scope"],
        meta["org_timezone"],
        meta.get("date_from") or "",
        meta.get("date_to") or "",
        str(sheet.pk),
        str(sheet.employee_id),
        sheet.employee.full_name,
        sheet.employee.email,
        sheet.week_start.isoformat(),
        sheet.status,
        str(sheet.version),
        str(worked),
        str(breaks),
        sheet.created_at.isoformat(),
        sheet.updated_at.isoformat(),
    ]


def build_csv(meta: dict, header: tuple, rows: list) -> str:
    """Render the full CSV text. Rows must already be sanitized cells."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    for line in row_metadata_lines(meta):
        writer.writerow([sanitize_cell(cell) for cell in line])
    writer.writerow([sanitize_cell(cell) for cell in header])
    for row in rows:
        writer.writerow([sanitize_cell(cell) for cell in row])
    # Leading BOM: UTF-8-SIG consumers decode correctly; plain UTF-8 readers
    # get one harmless zero-width character before the first comment cell.
    return "\ufeff" + buffer.getvalue()
