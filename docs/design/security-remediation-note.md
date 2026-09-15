Security remediation note

Scope: frontend demo boundary and authorization-safe presentation only. The approved design and backend contracts remain authoritative; no backend capability was invented or changed.

Implemented safe corrections:
- Personal request detail resolves only from the active personal collection. Review records such as r-2001 use the same neutral unavailable response as an unknown ID on /requests/:id.
- Role-derived review capability is available only in the explicit Vite demo mode (build with --mode demo). The selector is labelled as a non-authoritative fixture identity and is not authentication, server authorization, or a production control.
- Demo personal, review, and notification state is isolated per fixture identity. Mutations update only the active identity; employee fixtures receive no team records or review capability.
- Review mutations require the record version captured when the dialog opened and expose conflict/unknown fixtures without automatic replay. The demo copy explicitly states the non-persistent boundary.

Verification: frontend npm run build and npm run lint pass (lint retains existing Fast Refresh warnings in AppContext exports). No production backend integration or authorization guarantee is claimed by this mock-only correction.

Remaining risks: The frontend remains a visual demo and cannot enforce real authorization; production integration must consume server-resolved identity/capabilities, scoped list/detail responses, object permissions, mutation versions, CSRF/session protections, and server-confirmed audit results. Real-browser role/direct-URL and accessibility evidence remains a separate follow-up owned by the frontend/review team.
