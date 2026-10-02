"""Serve the built SPA from the same origin as the API.

Why same origin: the app authenticates with a Django session cookie and echoes a
CSRF token. Serving the SPA from a different host would need CORS, a cookie
`SameSite` decision and a second CSRF-trusted origin — all easy to get subtly
wrong, and impossible to notice until a POST silently 403s. One origin removes
the whole class.

What this is NOT: a production static-file setup. `django.views.static.serve` is
Django's own documented development-only helper — no caching headers, no range
support worth relying on. For the demo handover that is fine and needs no new
dependency. A real deployment should put WhiteNoise or nginx in front and run
`collectstatic`; the only change needed then is deleting these two routes.
"""
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404
from django.views.static import serve

# frontend/dist, relative to the Django project root (backend/).
SPA_DIR = Path(settings.BASE_DIR).parent / "frontend" / "dist"

# Real files at the dist root, as opposed to SPA routes that must return the shell.
_ROOT_FILES = ("favicon.ico", "favicon.svg", "robots.txt", "manifest.webmanifest")


def _index_path() -> Path:
    index = SPA_DIR / "index.html"
    if not index.is_file():
        raise Http404(
            "The frontend has not been built yet. Run `npm run build:demo` in "
            f"frontend/ — expected {index}."
        )
    return index


def spa_index(request):
    """The SPA shell. Deep links are resolved by the client-side router."""
    response = FileResponse(
        _index_path().open("rb"), content_type="text/html; charset=utf-8"
    )
    # The shell names a content-hashed bundle, so it must never be cached: a stale
    # index.html points at a bundle that no longer exists and the app loads blank.
    response["Cache-Control"] = "no-store"
    return response


def spa_file(request, path):
    """A built asset (hashed, therefore immutable), or a known root file."""
    if path not in _ROOT_FILES and not path.startswith("assets/"):
        raise Http404

    root = SPA_DIR.resolve()
    full = (SPA_DIR / path).resolve()
    # Refuse anything that escapes dist/: `..` in a URL must not read the repo.
    if root not in full.parents:
        raise Http404

    if not full.is_file():
        raise Http404

    response = serve(request, path, document_root=str(SPA_DIR))
    if path.startswith("assets/"):
        response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response
