"""Recorded fixture: the real shape of Nager.Date's
GET /api/v3/PublicHolidays/2026/EG response (HTTP 200, verified against
the live API on 2026-10-02 by the human owner).

Ground truth baked in here:
- `localName` is Arabic for most entries (عيد الميلاد المجيد, عيد العمال,
  عيد القوات المسلحة, ثورة 30 يونيو...) but FALLS BACK TO ENGLISH for the
  Islamic ones (Eid Al-Adha, Islamic New Year, Prophet Muhammad's Birthday)
  and for Sham El-Nessim — exactly the gap the LLM fills.
- Eid Al-Adha arrives as FIVE separate rows (2026-05-27..31), same name,
  different dates — the upsert key must tolerate same-name rows.
- Eid Al-Fitr and Ramadan are MISSING entirely — the "missing cases" the
  LLM proposes.
"""

NAGER_EG_2026 = [
    {"date": "2026-01-07", "localName": "عيد الميلاد المجيد", "name": "Christmas Day",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": 2001},
    {"date": "2026-01-25", "localName": "عيد الشرطة", "name": "National Police Day",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": 2010},
    {"date": "2026-04-25", "localName": "عيد تحرير سيناء", "name": "Sinai Liberation Day",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-05-01", "localName": "عيد العمال", "name": "Labour Day",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": 1966},
    # Sham El-Nessim: localName falls back to English.
    {"date": "2026-05-18", "localName": "Sham El-Nessim", "name": "Sham El-Nessim",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    # Eid Al-Adha arrives as FIVE rows, same name, consecutive dates, and the
    # localName is the English fallback, not Arabic.
    {"date": "2026-05-27", "localName": "Eid Al-Adha", "name": "Eid Al-Adha",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-05-28", "localName": "Eid Al-Adha", "name": "Eid Al-Adha",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-05-29", "localName": "Eid Al-Adha", "name": "Eid Al-Adha",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-05-30", "localName": "Eid Al-Adha", "name": "Eid Al-Adha",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-05-31", "localName": "Eid Al-Adha", "name": "Eid Al-Adha",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-06-30", "localName": "ثورة 30 يونيو", "name": "June 30 Revolution",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-07-23", "localName": "عيد الثورة", "name": "July Revolution Day",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    # Islamic New Year: localName falls back to English.
    {"date": "2026-06-16", "localName": "Islamic New Year", "name": "Islamic New Year",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    {"date": "2026-10-06", "localName": "عيد القوات المسلحة", "name": "Armed Forces Day",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
    # Prophet Muhammad's Birthday: localName falls back to English.
    {"date": "2026-08-25", "localName": "Prophet Muhammad's Birthday",
     "name": "Prophet Muhammad's Birthday",
     "countryCode": "EG", "global": True, "counties": None, "types": ["Public"],
     "launchYear": None},
]

# Identities of the fixture rows, for set-based (not count-based) idempotency
# assertions: Eid Al-Adha's five rows share a name.
NAGER_EG_2026_IDENTITIES = {
    (item["date"], item["name"]) for item in NAGER_EG_2026
}

# Names whose Nager localName is NOT Arabic: exactly four in this fixture.
# (Ramadan Start / Eid Al-Fitr are absent from Nager's payload altogether.)
NON_ARABIC_LOCAL_NAMES = [
    "Sham El-Nessim",
    "Eid Al-Adha",
    "Islamic New Year",
    "Prophet Muhammad's Birthday",
]

LLM_EG_2026_PROPOSALS = [
    {"name": "Eid Al-Fitr", "name_local": "عيد الفطر المبارك", "date": "2026-03-20"},
    {"name": "Ramadan Start", "name_local": "أول رمضان", "date": "2026-02-18"},
    {"name": "Eid Al-Adha", "name_local": "عيد الأضحى المبارك", "date": "2026-05-27"},
    {"name": "Islamic New Year", "name_local": "رأس السنة الهجرية", "date": "2026-06-16"},
    {"name": "Prophet Muhammad's Birthday", "name_local": "المولد النبوي الشريف",
     "date": "2026-08-25"},
]
