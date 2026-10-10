"""The nightly public-holidays refresh — the job behind the AI button.

Nager.Date is the authority; the LLM only fills in Arabic names and proposes the
Islamic holidays Nager does not carry. `refresh_public_holidays` is idempotent, so
running this every night is safe and only changes what actually moved — which is
what "update the holidays if anything changed" means in practice.

Failure is reported, never hidden:
- Nager unreachable  -> nothing was written and the command exits non-zero, so the
  scheduler surfaces a real failure instead of a green tick over a no-op.
- LLM unreachable    -> a warning. The official import still lands; the proposals
  are simply absent this run, and the next run tries again.

Usage:
    manage.py refresh_holidays                 # this year, EG
    manage.py refresh_holidays --year 2027 --country EG
"""
import datetime

from django.core.management.base import BaseCommand

from holidays.services import NagerUnavailableError, refresh_public_holidays


class Command(BaseCommand):
    help = "Refresh the public-holidays register from Nager.Date, LLM-assisted."

    def add_arguments(self, parser):
        parser.add_argument("--year", type=int, default=None, help="Defaults to the current year.")
        parser.add_argument("--country", default="EG", help="ISO country code. Defaults to EG.")

    def handle(self, *args, **options):
        year = options["year"] or datetime.date.today().year
        country = str(options["country"]).upper()

        try:
            summary = refresh_public_holidays(year, country)
        except NagerUnavailableError as exc:
            # Nothing was written. Non-zero so a scheduler treats it as a failure.
            self.stderr.write(f"{country} {year}: Nager.Date unreachable, nothing written: {exc}")
            raise SystemExit(1)

        for warning in summary["warnings"]:
            self.stderr.write(f"warning: {warning}")

        changed = summary["added"] + summary["updated"]
        self.stdout.write(
            f"{country} {year}: "
            f"added={summary['added']} updated={summary['updated']} "
            f"unchanged={summary['unchanged']} manual_preserved={summary['manual_preserved']} "
            f"proposed={summary['proposed_missing']} llm={'up' if summary['llm_available'] else 'down'}"
        )
        # The nightly job's whole purpose is to notice movement, so say which it was.
        self.stdout.write("no changes" if changed == 0 else f"{changed} row(s) changed")
