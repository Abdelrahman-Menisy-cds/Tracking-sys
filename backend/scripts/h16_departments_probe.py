#!/usr/bin/env python3
"""H16 P2 live probe — departments, the department rule, and HR grants.

Runs against the SERVED app over HTTP as HR (signed in with the subscription
code), so every line below is evidence about the running system rather than about
a test database. Prints one PASS/FAIL line per assertion.

Scenario (the owner's own words, in order):
  * HR creates a place for departments and names one.
  * HR puts a manager INSIDE a department.
  * HR puts an employee in that same department under that manager  -> allowed.
  * HR tries to put an employee of ANOTHER department under him      -> refused.
  * HR names that manager as the department's manager                -> allowed.
  * HR grants that manager scope over the out-of-department employee -> allowed,
    and it is revocable.

Usage: python3 h16_departments_probe.py [base-url]
"""
import http.cookiejar
import json
import random
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.19:8080/api/v1"
SUFFIX = random.randint(1000, 9999)

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
token = {"value": ""}
checks = []


def call(method, path, body=None, lang="ar"):
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=payload, method=method)
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept-Language", lang)
    if token["value"]:
        request.add_header("X-CSRFToken", token["value"])
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"{}")
        except ValueError:
            return error.code, {"raw": raw.decode(errors="replace")[:200]}


def refresh_csrf():
    _status, payload = call("GET", "/auth/csrf")
    token["value"] = (payload.get("data") or {}).get("csrftoken", "")
    return token["value"]


def check(name, ok, extra=None):
    checks.append(bool(ok))
    tail = "" if extra is None else "  — " + json.dumps(extra, ensure_ascii=False)[:320]
    print(("PASS  " if ok else "FAIL  ") + name + tail)


# ---------------------------------------------------------------- HR sign-in
refresh_csrf()
hr_email = f"h16.hr.{SUFFIX}@example.com"
status, payload = call(
    "POST",
    "/auth/signup",
    {"email": hr_email, "code": "Menisy2002", "password": "StrongPass!2026"},
)
check(
    "HR session through the subscription code",
    status == 200 and (payload.get("data") or {}).get("role") == "HR",
    [status, (payload.get("data") or {}).get("role")],
)
refresh_csrf()

# ------------------------------------------------------- departments exist
status, payload = call("POST", "/departments", {"code": f"OPS{SUFFIX}", "name_ar": "العمليات", "name_en": "Operations"})
ops = (payload.get("data") or {})
check("HR can create a department", status == 201 and ops.get("code") == f"OPS{SUFFIX}", [status, ops])
status, payload = call("POST", "/departments", {"code": f"FIN{SUFFIX}", "name_ar": "المالية", "name_en": "Finance"})
fin = (payload.get("data") or {})
check("HR can create a second department", status == 201 and fin.get("id") is not None, [status, fin.get("code")])
status, payload = call("POST", "/departments", {"code": f"OPS{SUFFIX}", "name_ar": "مكرر"})
check("a duplicate department code is refused", status == 422 and "code" in (payload.get("error") or {}).get("fields", {}), [status, payload])

# ------------------------------------------------- the manager, inside OPS
mgr_email = f"h16.mgr.{SUFFIX}@example.com"
status, payload = call(
    "POST",
    "/employees",
    {"email": mgr_email, "full_name": "مدير العمليات", "role": "MANAGER", "department": ops.get("id")},
)
manager = (payload.get("data") or {})
check(
    "HR creates a manager and places them in the department",
    status == 201 and manager.get("department_id") == ops.get("id") and manager.get("role") == "MANAGER",
    [status, manager.get("department_id"), manager.get("department_name_ar")],
)

# ------------------------- employee in the SAME department, same manager OK
emp_email = f"h16.emp.{SUFFIX}@example.com"
status, payload = call(
    "POST",
    "/employees",
    {
        "email": emp_email,
        "full_name": "موظف العمليات",
        "role": "EMPLOYEE",
        "department": ops.get("id"),
        "manager": manager.get("id"),
    },
)
same = (payload.get("data") or {})
check(
    "an employee of the SAME department can report to that manager",
    status == 201 and same.get("manager_id") == manager.get("id"),
    [status, (payload.get("error") or {}).get("fields") or same.get("job_title")],
)

# ------------- employee of ANOTHER department under that manager: REFUSED
other_email = f"h16.other.{SUFFIX}@example.com"
status, payload = call(
    "POST",
    "/employees",
    {
        "email": other_email,
        "full_name": "موظف المالية",
        "role": "EMPLOYEE",
        "department": fin.get("id"),
        "manager": manager.get("id"),
    },
)
fields = (payload.get("error") or {}).get("fields", {})
check(
    "OWNER'S RULE: a manager outside the employee's department is refused",
    status == 422 and "manager" in fields,
    [status, fields],
)

# create that employee WITHOUT the cross-department manager, for the grant step
status, payload = call(
    "POST",
    "/employees",
    {"email": other_email, "full_name": "موظف المالية", "role": "EMPLOYEE", "department": fin.get("id")},
)
other = (payload.get("data") or {})
check("the same employee is accepted without that manager", status == 201, [status, other.get("department_name_ar")])

# ------------------------------------ name that manager the department's own
status, payload = call("PATCH", f"/departments/{ops.get('id')}", {"manager": manager.get("id")})
check(
    "the department's manager is set (and is a member of it)",
    status == 200 and (payload.get("data") or {}).get("manager_id") == manager.get("id"),
    [status, (payload.get("data") or {}).get("manager_name")],
)

# --------------------------------------------------- the HR grant over them
status, payload = call(
    "POST",
    "/manager-grants",
    {"manager": manager.get("id"), "employee": other.get("id"), "scope": "requests"},
)
grant = (payload.get("data") or {})
check(
    "HR can grant the manager scope over an out-of-department employee",
    status in (200, 201) and grant.get("scope") == "requests" and grant.get("is_active") is True,
    [status, grant],
)
status, payload = call(
    "POST",
    "/manager-grants",
    {"manager": manager.get("id"), "employee": other.get("id"), "scope": "salary"},
)
check(
    "a scope outside the closed list is refused",
    status == 422,
    [status, (payload.get("error") or {}).get("fields")],
)
status, payload = call("GET", "/manager-grants")
rows = payload.get("data") or []
check("the grant is listed for HR", any(row.get("id") == grant.get("id") for row in rows), len(rows))

# ------------------------------------------------------------ revocation
status, payload = call("DELETE", f"/manager-grants/{grant.get('id')}")
check(
    "revoking deactivates the grant instead of deleting it",
    status == 200 and (payload.get("data") or {}).get("is_active") is False,
    [status, (payload.get("data") or {}).get("is_active")],
)

print()
print(f"{sum(checks)}/{len(checks)} checks passed")
print("ids: " + json.dumps({"ops": ops.get("id"), "fin": fin.get("id"), "manager": manager.get("id"), "employee": other.get("id"), "grant": grant.get("id")}))
sys.exit(0 if all(checks) else 1)
