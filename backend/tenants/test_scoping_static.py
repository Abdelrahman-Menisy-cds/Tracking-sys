"""H30 R0 — tenants/static guard (H30 plan §3.2.4, §8.2): the leak ratchet.

AST-scans the REAL application source (never tests, migrations, venv, or the
operator/grown-past files the plan itself names as outside) for a tenant
model's bare ``.objects.<shape>`` — resolved without a company anchor —
outside an explicit allow-list. A NEW unscoped usage in a file without an
allow-list entry fails this test with the file and line, so "no new leaks"
is enforced by CI; each R-phase drops its files from the list as it converts
them (the ratchet in §3.2.4 / §9.1 R0).

Written BEFORE the R1 model work (test-first, per the H31 brief); the
allow-list below is the scanner's own output against the pre-change tree
(34 files / 169 bare-tier usages of tenant models on 2026-10-15).

Sanctioned shapes that never need a list entry:
- ``Model.objects.of(...)`` — the TenantManager authorized entry point
  (§3.2.2: ``Model.objects.of(user)`` is the ONLY way to reach tenant rows),
  plus ``.get_queryset()`` / ``.as_manager()`` / ``.none()`` (manager
  internals and the pure-deny shape), and
- the operator's ``seed_signup_code`` management command, whose
  SubscriptionCode row is the org-wide operator surface the plan keeps
  (§2.5: the operator bindings are tenant-issued, not per-user).
"""
import ast
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]

#: `.objects.<THIS>` is a sanctioned manager contract, not a query.
ALLOWED_SETTER = frozenset(
    {
        "of",  # TenantManager.of — THE authorized entry point (§3.2.2).
        "get_queryset",  # Manager internals.
        "as_manager",  # Manager machinery.
        "none",  # Pure deny; resolves nothing, never a cross-company read.
    }
)

SCAN_EXEMPT_DIR_NAMES = frozenset(
    {"migrations", "__pycache__", "scripts", "attachments", "logs", "locale"}
)

#: Plan-named operator surface (§2.5): the operator seeds subscription codes
#: independently of any tenant because bootstrap create-company codes are
#: tenantless (§2.3: "operator-issued bootstrap codes are tenantless").
SCAN_EXEMPT_FILE_GLOBS = (
    "conftest.py",
    "test_*.py",
    "*_test.py",
    "tests.py",
    "settings.py",
    "test_settings.py",
    "admin.py",
    "wsgi.py",
    "asgi.py",
    "manage.py",
    "seed_signup_code.py",
)

#: The R0 baseline: every file where the CURRENT (pre-R1, §1.1 surface) code
#: calls a tenant model's ``.objects`` without the sanctioned shapes. Each
#: R-phase REMOVES the entries it converts; a NEW unscoped usage in a file
#: NOT listed fails — that is the point of this ratchet.
ALLOWED_FILES = frozenset(
    {
        "accounts/assistant_chat.py",
        "accounts/assistant_subscriptions.py",
        "accounts/assistant_tools.py",
        "accounts/assistant_views.py",
        "accounts/company_serializers.py",
        "accounts/company_views.py",
        "accounts/department_serializers.py",
        "accounts/department_views.py",
        "accounts/employee_serializers.py",
        "accounts/employee_service.py",
        "accounts/grant_views.py",
        "accounts/serializers.py",
        "holidays/services.py",
        "holidays/views.py",
        "notifications/services.py",
        "notifications/views.py",
        "reqs/attachment_services.py",
        "reqs/attachment_views.py",
        "reqs/cancel_notifications.py",
        "reqs/cancel_services.py",
        "reqs/decision_notifications.py",
        "reqs/decision_services.py",
        "reqs/scan.py",
        "reqs/serializers.py",
        "reqs/services.py",
        "reqs/submission_services.py",
        "reqs/views.py",
        "review/report_views.py",
        "review/reports.py",
        "review/scope.py",
        "timesheets/correction_services.py",
        "timesheets/review_services.py",
        "timesheets/services.py",
        "timesheets/views.py",
    }
)


def _iter_backend_py():
    for path in BACKEND_DIR.rglob("*.py"):
        rel = path.relative_to(BACKEND_DIR).as_posix()
        if ".venv" in rel:
            continue
        if any(part in path.parts for part in SCAN_EXEMPT_DIR_NAMES):
            continue
        if any(path.match(glob) for glob in SCAN_EXEMPT_FILE_GLOBS):
            continue
        if path.name.startswith("test_") or path.name in {"tests.py", "conftest.py", "*_test.py"}:
            continue
        yield path


def _tenant_model_names():
    """Every model the plan's §6 inventory makes tenant-scoped, read from the
    real per-app ``class X(models.Model)`` declarations; a future tenant model
    is guarded automatically, without editing a baked-in list."""
    source_dirs = ("accounts", "reqs", "timesheets", "notifications", "holidays", "review")
    names = set()
    for app in source_dirs:
        models_py = BACKEND_DIR / app / "models.py"
        if not models_py.is_file():
            continue
        tree = ast.parse(models_py.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            if any(isinstance(b, ast.Attribute) and b.attr == "Model" for b in node.bases):
                names.add(node.name)
    for internal in {"Meta", "UserManager", "TenantManager", "CompanyScopeManager", "Company"}:
        names.discard(internal)
    return names


def _outer_name(outer):
    if isinstance(outer, ast.Attribute):
        return outer.attr
    if isinstance(outer, ast.Subscript):
        return "subscript"
    if outer is None:
        return "bare"
    return type(outer).__name__


def _flagged_names(path: Path):
    """(lineno, model_name, outer-shape) triples where a tenant model's
    ``.objects`` is used outside the sanctioned TenantManager entry shapes."""
    try:
        tree = ast.parse(path.read_text())
    except SyntaxError as exc:
        pytest.fail(f"unparsable source scanned by the tenant guard: {path}: {exc}")
    model_names = {name.lower() for name in _tenant_model_names()}
    parent = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    offenders = []
    for shape in ast.walk(tree):
        if not (isinstance(shape, ast.Attribute) and shape.attr == "objects"):
            continue
        target = shape.value
        if not (isinstance(target, ast.Name) and target.id.lower() in model_names):
            continue
        outer = parent.get(shape)
        if isinstance(outer, ast.Attribute) and outer.attr in ALLOWED_SETTER:
            continue
        offenders.append((shape.lineno, target.id, _outer_name(outer)))
    return offenders


def test_no_bare_tenant_model_objects_usage_outside_the_r0_allow_list():
    """Every project (non-test, non-migration, non-venv) file whose tenant
    model ``.objects`` shape is NOT the sanctioned TenantManager entry point
    must be on the explicit allow-list; anything else fails with the exact
    file and line so the ratchet is enforced by CI (H30 §3.2.4 / §8.2)."""
    offenders = {}
    for path in _iter_backend_py():
        rel = path.relative_to(BACKEND_DIR).as_posix()
        hits = _flagged_names(path)
        if hits:
            offenders[rel] = hits

    unexpected = {rel: hits for rel, hits in offenders.items() if rel not in ALLOWED_FILES}
    assert not unexpected, (
        "tenant-scoped .objects usage outside the sanctioned TenantManager "
        f"shapes and outside the R0 allow-list (H30 plan §3.2.4): offenders={unexpected}"
    )
    # Corollary: the scanner MUST still be finding the seeded reality (i.e.
    # the allow-list is not a vacuous no-op because the scan broke).
    assert offenders, "the guard found no bare .objects usage at all; the scanner is broken"


def test_guard_self_check_scans_at_least_the_baseline_reality():
    """Anti-corruption check for the ratchet itself: the scanner must still
    be detecting the sanctioned shapes (i.e. it parses and walks), otherwise
    a future refactor that breaks _flagged_names would silently neuter the
    guard. Asserts the pre-R1 code contains at least ONE sanctioned
    `.objects.of` usage (which R1 introduces and later phases rely on) is
    FALSE on the R0 baseline; the correctness check here is instead that the
    allowed-setter filtering does not mis-classify `.create(...)`."""
    from tenants.context import current_company

    # Sanity: the anchor itself must deny anonymous, not guess.
    assert current_company(None) is None

    # And the flagged shapes must at least include `.create`-shaped writers
    # somewhere on the baseline (they are the leak class §9.2 row 3 calls out).
    found_writer = False
    for path in _iter_backend_py():
        for _lineno, _model, shape in _flagged_names(path):
            if shape in {"create", "get_or_create", "update_or_create"}:
                found_writer = True
                break
        if found_writer:
            break
    assert found_writer, "no creator-shaped .objects usage detected; scanner may be crippled"
