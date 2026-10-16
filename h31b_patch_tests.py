#!/usr/bin/env python3
"""H31b R1 test-suite adjuster — round 2 (remaining files after the round-1
import-placement bug). Paren-aware import insertion; per-file expected counts
asserted; idempotent via the (?!\s*company) lookaheads.
"""
import py_compile
import re
from pathlib import Path

BACKEND = Path("/home/menisy/Desktop/Me/tracking_system_project/backend")

EXPECTED = {
    "accounts/test_assistant.py": {"user": 0, "aconfig": 0, "eprofile": 0},  # round 1 applied the kwarg inserts; import only
    "accounts/test_assistant_subscription.py": {"user": 1, "aconfig": 8},
    "accounts/test_company.py": {"user": 1},
    "notifications/tests.py": {"user": 2},
    "notifications/test_story_4_2.py": {"user": 16, "eprofile": 2},
    "review/test_reports.py": {"user": 1, "eprofile": 3, "tz_update": 2},
    "review/test_queues.py": {"user": 1, "eprofile": 2},
    "reqs/test_cancel.py": {"user": 3},
    "reqs/test_drafts.py": {"user": 2},
    "reqs/test_submission.py": {"user": 5, "eprofile": 2},
    "reqs/test_decision.py": {"user": 11, "eprofile": 4},
    "reqs/test_attachments.py": {"user": 2},
    "timesheets/test_timesheets.py": {"user": 2, "tz_get": 1},
    "timesheets/test_story_3_2.py": {"user": 3, "tz_get": 2},
    "timesheets/test_story_3_3.py": {"user": 3, "eprofile": 1},
}

COMPANY_KW = "company=default_company(), "
IMPORT_LINE = "from tenants.context import default_company\n"

PATTERNS = [
    (re.compile(r"(get_user_model\(\)\.objects\.create_user\()(?!\s*company)"), r"\1" + COMPANY_KW, "user"),
    (re.compile(r"(User\.objects\.create_user\()(?!\s*company)"), r"\1" + COMPANY_KW, "user"),
    (re.compile(r"(EmployeeProfile\.objects\.create\()(?!\s*company)"), r"\1" + COMPANY_KW, "eprofile"),
    (re.compile(r"(AssistantConfig\.objects\.create\()(?!\s*company)"), r"\1" + COMPANY_KW, "aconfig"),
    (
        re.compile(r'TimezoneConfig\.objects\.get_or_create\(name="UTC"\)'),
        'TimezoneConfig.objects.get_or_create(company=default_company(), defaults={"name": "UTC"})',
        "tz_get",
    ),
    (
        re.compile(r"TimezoneConfig\.objects\.update_or_create\(pk=1, defaults=\{"),
        "TimezoneConfig.objects.update_or_create(company=default_company(), defaults={",
        "tz_update",
    ),
]


def insert_import(text: str) -> str:
    # Idempotent-ish: strip any misplaced copy first (round-1 bug), re-insert
    # at the end of the top-level import block (paren-aware).
    text = text.replace("\n" + IMPORT_LINE, "\n", 1) if f"\n{IMPORT_LINE}" in text else text
    if text.startswith(IMPORT_LINE):
        text = text[len(IMPORT_LINE):]
    lines = text.splitlines(keepends=True)
    last_import = -1
    depth = 0
    for i, line in enumerate(lines):
        if depth > 0:
            depth += line.count("(") - line.count(")")
            if depth <= 0:
                depth = 0
                last_import = i  # the closing-paren line belongs to the import
            continue
        if re.match(r"^(from \S+ import |import )", line):
            last_import = i
            depth = line.count("(") - line.count(")")
            if depth > 0:
                depth = max(depth, 1)
        elif last_import >= 0 and line.strip():
            break
    assert last_import >= 0, "no import block found"
    lines.insert(last_import + 1, IMPORT_LINE)
    return "".join(lines)


for rel, expected in EXPECTED.items():
    path = BACKEND / rel
    text = path.read_text()
    if IMPORT_LINE in text and "company=default_company()" in text:
        print(f"SKIP {rel}: already patched in a previous round")
        continue
    counts = {}
    for pattern, replacement, key in PATTERNS:
        text, n = pattern.subn(replacement, text)
        if n:
            counts[key] = counts.get(key, 0) + n
    assert set(counts) <= set(expected) and all(
        counts.get(k, 0) == v for k, v in expected.items()
    ), f"{rel}: expected {expected}, got {counts}"
    text = insert_import(text)
    path.write_text(text)
    py_compile.compile(str(path), doraise=True)
    print(f"OK {rel}: {counts}")

print("ALL REMAINING FILES PATCHED AND COMPILED")
