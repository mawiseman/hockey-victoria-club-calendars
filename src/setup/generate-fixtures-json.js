// Fetches the four category iCal feeds from Google, extracts the upcoming
// events in a rolling window, and writes a static JSON file for the
// weekly-fixture site to consume. Removes the need for any runtime CORS
// proxy and lets Netlify cache the response like any other static asset.

import fs from 'fs/promises';
import path from 'path';
import { getCategoryCalendars } from '../lib/config.js';

const OUTPUT = 'weekly-fixture/data/fixtures.json';

// Roll forward a little past this week so users don't hit the site on
// Monday morning (before the daily GitHub Action has re-run) and see last
// week's data. The client filters by current Mon–Sun regardless.
const LOOKBACK_DAYS = 2;
const LOOKAHEAD_DAYS = 14;

// ─── iCal parsing ──────────────────────────────────────────────────

function parseICS(icsText) {
    const events = [];
    const blocks = icsText.split('BEGIN:VEVENT');

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VEVENT')[0];
        const event = {};

        // Unfold long lines (RFC 5545 line folding)
        const unfolded = block.replace(/\r?\n[ \t]/g, '');

        for (const line of unfolded.split(/\r?\n/)) {
            if (line.startsWith('SUMMARY:')) {
                event.summary = line.substring(8).trim();
            } else if (line.startsWith('DTSTART')) {
                event.dtstart = extractDateTime(line);
            } else if (line.startsWith('DTEND')) {
                event.dtend = extractDateTime(line);
            } else if (line.startsWith('LOCATION:')) {
                event.location = line.substring(9).trim();
            }
        }

        if (event.summary && event.dtstart) events.push(event);
    }

    return events;
}

function extractDateTime(line) {
    const value = line.split(':').pop().trim();
    if (value.length >= 15) {
        const y = value.substring(0, 4);
        const m = value.substring(4, 6);
        const d = value.substring(6, 8);
        const h = value.substring(9, 11);
        const min = value.substring(11, 13);
        const sec = value.substring(13, 15);
        const isUTC = value.endsWith('Z');
        return new Date(`${y}-${m}-${d}T${h}:${min}:${sec}${isUTC ? 'Z' : ''}`);
    }
    return new Date(value);
}

// ─── Fetching ───────────────────────────────────────────────────────

async function fetchCalendar(calendarId) {
    const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
    const categoryCalendars = await getCategoryCalendars();
    if (!categoryCalendars || Object.keys(categoryCalendars).length === 0) {
        throw new Error('No categoryCalendars configured in config/settings.json');
    }

    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);

    const results = await Promise.all(
        Object.entries(categoryCalendars).map(async ([category, cfg]) => {
            if (!cfg.calendarId) return { category, events: [] };
            console.log(`Fetching ${category}...`);
            const ics = await fetchCalendar(cfg.calendarId);
            const events = parseICS(ics).filter(e => e.dtstart >= from && e.dtstart <= to);
            console.log(`  ${category}: ${events.length} events within window`);
            return { category, events };
        })
    );

    const allEvents = [];
    for (const { category, events } of results) {
        for (const e of events) {
            allEvents.push({
                category,
                summary: e.summary,
                dtstart: e.dtstart.toISOString(),
                dtend: e.dtend ? e.dtend.toISOString() : null,
                location: e.location || '',
            });
        }
    }
    allEvents.sort((a, b) => a.dtstart.localeCompare(b.dtstart));

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    const payload = {
        generatedAt: now.toISOString(),
        windowStart: from.toISOString(),
        windowEnd: to.toISOString(),
        events: allEvents,
    };
    await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`\n✅ Wrote ${allEvents.length} events to ${OUTPUT}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
