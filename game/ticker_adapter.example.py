"""Ticker adapter template. Used only when site.json has "ticker": {"source": "adapter"}.

Copy this file to ticker_adapter.py (next to server.py) and make get_items() return this office's items. The
server calls it in a background thread every refresh_minutes (site.json), so it may be slow, may fetch from other
systems, and may raise: on an error the ticker keeps its last items and the error goes to data/server.log.

Each item is a dict (see DESIGN.md, "The ticker"):
    label   required, up to 80 characters: what the item is ("Projects shipped this month")
    value   optional, up to 40: the number or short text to show ("7", "$12,400", "2.1 h"); numbers are allowed
    change  optional, up to 40: the change to show next to it ("+2", "-4%")
    trend   optional, "up" or "down": which way it moved; colors the change (or the value if there's no change)
    good    optional, "up" (default) or "down": which way is good news, so green means good and red bad
    group   optional, up to 40: items with the same group are shown together under that heading

Keep only totals and public-in-the-office facts: the ticker is on the office TV and any player's browser, so
never return names of customers, personal data, or anything the whole office shouldn't see.
"""

import json
import urllib.request


def get_items():
    # Example: read a JSON report from an internal system and keep two totals from it.
    # with urllib.request.urlopen("http://reports.internal/api/weekly", timeout=30) as res:
    #     report = json.load(res)
    # return [
    #     {"label": "Projects shipped this month", "value": report["shipped"], "change": f"{report['shipped_delta']:+}",
    #      "trend": "up" if report["shipped_delta"] > 0 else "down" if report["shipped_delta"] < 0 else None},
    #     {"label": "Open support tickets", "value": report["open_tickets"], "good": "down", "group": "Support"},
    # ]
    return [{"label": "Welcome to Battlefish!"}]
