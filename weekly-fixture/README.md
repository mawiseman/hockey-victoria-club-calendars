# Weekly Fixture

Static web page showing this week's FHC fixtures, styled after the club's social-media graphics.

Views, switched via the tabs at the top:

| Tab | Contents |
| --- | --- |
| **All** | Every fixture for the week |
| **Premier League** | Men's PL / PLR and Women's PL / PLR |
| **Seniors** | All other senior men's / women's grades (Pennant A–D, Metro 1/2, etc.) |
| **Midweek** | All midweek competitions |
| **Juniors** | All junior competitions |

Data comes from the four public Google Calendar iCal feeds defined at `app.js:2` (`CALENDAR_FEEDS`).

## Run locally

From the **repo root**:

```bash
npm run dev
```

Then open <http://localhost:3000>.

## How the data is parsed

- `app.js` fetches each iCal feed via the `corsproxy.io` public CORS proxy.
- Only events with `DTSTART` in the current Mon–Sun window are kept.
- Each event's `SUMMARY` is parsed as `"<COMP> - <HOME> vs <AWAY>"`.
- The competition string is classified into one of the four views:
  - `midweek` / `juniors` feeds map straight to their tabs
  - `mens` / `womens` split on whether the comp contains `PL` / `PLR` (→ `pl` tab) or not (→ `club` tab)
- A short grade code is derived for display (`Men PEN A` → `MPA`, `Women M1 NW` → `WM1`, etc.) — see `buildShortCode()` in `app.js`.

## Updating

- **Calendar IDs**: if a category calendar is recreated, update the iCal URL in `app.js:2` (`CALENDAR_FEEDS`).
- **Logos**: drop a new `<ABBR>.png` into `logos/`. Abbreviations come from `config/mappings-club-names.json`. Non-PNG extensions can be registered in `LOGO_EXTENSIONS` in `app.js`.
- **Styling**: edit `styles.css`.

## Notes

- The CORS proxy is a shared public service — fine for personal use but don't rely on it for production without your own proxy.
- Fixtures are filtered client-side against Melbourne time, so visitors in other timezones still see the correct week.
