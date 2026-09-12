"""Pluggable malware scan interface (Story 2.2).

DEVELOPMENT STUB ONLY: DefaultMalwareScanner is deterministic and performs
NO real malware detection. A real ClamAV / VirusTotal provider is a separate
story; no AV vendor is contacted from this code. The stub simply marks the
attachment CLEAN. Production must replace `scan_attachment`'s provider
selection with a registered real scanner before release.

Scans run in a plain background thread scheduled via transaction.on_commit
(no Celery/Redis introduction). Tests can force a synchronous result through
`reqs.scan.force_scan_result` (a test-only hook) or by patching
`reqs.scan.get_scanner`.
"""
import threading

from django.db import transaction


class ScanResult:
    def __init__(self, *, clean: bool, engine: str, detail: str = ""):
        self.clean = clean
        self.engine = engine
        self.detail = detail


class BaseMalwareScanner:
    """Interface every scanner provider implements."""

    name = "base"

    def scan(self, storage_key: str) -> ScanResult:  # pragma: no cover - interface
        raise NotImplementedError


class DefaultMalwareScanner(BaseMalwareScanner):
    """DETERMINISTIC DEV STUB — NOT A REAL SCANNER. Never ships as-is.

    It always reports CLEAN so the quarantine flow stays exercisable locally.
    Real detection (ClamAV/VirusTotal) is a separate, explicitly scoped story.
    """

    name = "dev-stub"

    def scan(self, storage_key: str) -> ScanResult:
        return ScanResult(clean=True, engine=self.name, detail="stub: no real detection")


def get_scanner() -> BaseMalwareScanner:
    # Provider selection point: swap the stub for a real engine per deploy env.
    return DefaultMalwareScanner()


# Test-only synchronous hook (see docs in module docstring).
force_scan_result: ScanResult | None = None


def scan_attachment(attachment_id):
    """Run the configured scanner and persist the resulting scan status.

    Opens its own DB connection because it usually runs on a background
    thread after the uploading transaction committed.
    """
    from .models import RequestAttachment

    def _run():
        if force_scan_result is not None:
            result = force_scan_result
        else:
            try:
                attachment = RequestAttachment.objects.get(pk=attachment_id)
            except RequestAttachment.DoesNotExist:
                return
            result = get_scanner().scan(attachment.storage_key)
        status = RequestAttachment.ScanStatus.CLEAN if result.clean else RequestAttachment.ScanStatus.FAILED
        RequestAttachment.objects.filter(pk=attachment_id).update(scan_status=status)

    return _run()


def schedule_scan(attachment_id):
    """Schedule the scan after the upload transaction commits (threading only)."""

    def _on_commit():
        thread = threading.Thread(target=scan_attachment, args=(attachment_id,), daemon=True)
        thread.start()

    transaction.on_commit(_on_commit)
