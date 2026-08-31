// Builds weekly-fixture/data/season.json — a per-team grouped fixture file
// powering the week-navigation and team-season-view features.
//
// The processed ICS calendar (temp/processed/<comp>_processed.ics, written by
// calendar-processor.js earlier in the sync-calendars pipeline) is the base
// event list for every competition — it's the complete, stable HV fixture
// draw, including finals. temp/scores.json (output of npm run scrape-scores,
// an HTML scrape of HV's team page) is enrichment only: it overlays scores
// and results onto those events, and supplies bye rounds, which HV's iCal
// export omits entirely. A failed or missing score scrape just means events
// ship without scores — it never removes a fixture.
//
// Sources:
//   • temp/processed/<comp>_processed.ics  (base fixtures, incl. finals — required per competition)
//   • temp/scores.json                     (scores/results/byes — optional enrichment)
//   • config/competitions.json             (team metadata + URLs)
//   • config/mappings-club-names.json      (opponent club name → abbreviation)
//   • config/settings.json                 (club name, used to detect FHC home games)
//
// Output shape: see weekly-fixture/README.md → "Season data".

import fs from 'fs/promises';
import path from 'path';
import {
    TEMP_DIR,
    MAPPINGS_CLUB_FILE,
    COMPETITIONS_FILE,
    getClubName
} from '../lib/config.js';
import { categorizeCompetitions } from '../lib/competition-utils.js';
import { parseRoundFromSummary } from '../lib/finals.js';

const SCORES_FILE = path.join(TEMP_DIR, 'scores.json');
const LADDERS_FILE = path.join(TEMP_DIR, 'ladders.json');
const PROCESSED_DIR = path.join(TEMP_DIR, 'processed');
const OUTPUT = 'weekly-fixture/data/season.json';
const FHC_ABBR = 'FHC';
const DEFAULT_MATCH_MINUTES = 90;

// ─── Slug ───────────────────────────────────────────────────────────

// Build a short, URL-safe identifier from the competition name. Designed to
// look like the front-end's `shortCode` (Mens PL → "men-pl") but unique by
// construction since it derives from comp.name (which is unique).
function buildSlug(name) {
    let s = name
        .replace(/\s*-\s*\d{4}$/, '')           // strip "- 2026" suffix
        .replace(/\(.*?\)/g, '')                 // strip parenthetical bits like "(Monday)"
        .trim();

    // Senior shorthand: Men/Women + grade + region
    s = s
        .replace(/^Mens\b/i, 'Men')
        .replace(/^Womens\b/i, 'Women')
        .replace(/Premier League Reserves/i, 'PLR')
        .replace(/Premier League/i, 'PL')
        .replace(/Pennant\s+([A-Z])/ig, 'PEN $1')
        .replace(/Metro\s+(\d+)/ig, 'M$1')
        .replace(/\s+North West\b/i, ' NW')
        .replace(/\bUnder\s+(\d+)/ig, 'U$1');

    return s
        .toLowerCase()
        .replace(/'/g, '')
        .replace(/\+/g, 'plus')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Build the same display label as the front-end's buildShortCode (M PL, WPB)
// so labels look familiar. Lossy on its own (multiple comps can share a code),
// but slugs above are unique so we still index by slug.
function buildShortCode(name, category) {
    let c = name
        .replace(/\s*-\s*\d{4}$/, '')
        .replace(/\s*-\s*T\d+\b/i, '')      // term suffix on some junior comps
        .replace(/\s+North West$/i, '')     // full region form first…
        .replace(/\s+NW$/i, '')             // …then abbreviated
        .replace(/\bHalf Field\b/i, '')     // not part of the user-facing label
        .replace(/\(.*?\)/g, '')            // parenthetical day hints
        .replace(/\s+/g, ' ')
        .trim();

    // Seniors — "Men PL" / "Women PEN A" → MPL / WPA. Unchanged.
    const senior = c.match(/^(Mens|Womens|Men|Women)\s+(.+)$/i);
    if (senior && (category === 'mens' || category === 'womens')) {
        const prefix = senior[1][0].toUpperCase();
        const rest = senior[2]
            .replace(/Premier League Reserves/i, 'PLR')
            .replace(/Premier League/i, 'PL')
            .replace(/Pennant\s+([A-Z])/i, 'P$1')
            .replace(/Metro\s+(\d+)/i, 'M$1')
            .replace(/\s+/g, '')
            .toUpperCase();
        return prefix + rest;
    }

    // Midweek — keep tight: "M40+", "W35+ B", "W55+".
    if (category === 'midweek') {
        const g = c.match(/(Men|Women)/i);
        const gPrefix = g ? g[1][0].toUpperCase() : '';

        const ageBand = c.match(/(\d{2}\+)(?:\s+([A-D])\b)?/i);
        if (ageBand) {
            const tail = ageBand[2]
                ? `${ageBand[1]} ${ageBand[2].toUpperCase()}`
                : ageBand[1];
            return `${gPrefix}${tail}`;
        }
        const day = c.match(/(Wednesday|Tuesday|Monday|Thursday|Friday)/i);
        if (day) return `${gPrefix}${day[1][0].toUpperCase()}`;
    }

    // Juniors — "G U12 S", "M U18 D", "B U16 P". Comp type collapsed to its
    // first letter (Shield/Pennant/District) to keep the grade chip compact.
    if (category === 'juniors') {
        const g = c.match(/\b(Boys|Girls|Mixed)\b/i);
        const gPrefix = g ? g[1][0].toUpperCase() : '';
        const u = c.match(/U\s*(\d{1,2})/i) || c.match(/Under\s*(\d{1,2})/i);
        const ageStr = u ? `U${u[1]}` : '';
        const compType = c.match(/\b(Shield|Pennant|District)\b/i);
        const cStr = compType ? compType[1][0].toUpperCase() : '';
        const parts = [gPrefix, ageStr, cStr].filter(Boolean);
        if (parts.length > 0) return parts.join(' ');
    }

    return c.toUpperCase().substring(0, 8);
}

// If two teams ended up with identical labels, prefix a discriminator
// derived from comp.name so users can tell them apart in the UI. Term
// markers (T1, T2, T3, T4) are pulled out preferentially since they're
// the most common collision driver — e.g. T1 Social 35+ vs Midweek 35+.
function disambiguateLabels(teams) {
    const counts = new Map();
    for (const t of teams) counts.set(t.label, (counts.get(t.label) || 0) + 1);

    for (const t of teams) {
        if (counts.get(t.label) <= 1) continue;
        const term = t.name.match(/\bT(\d+)\b/i);
        if (term) {
            t.label = `T${term[1]} ${t.label}`;
            continue;
        }
        // Fallback: use the team's slug tail (last hyphen-separated piece) so
        // each colliding team still ends up unique.
        const slugTail = t.slug.split('-').pop().toUpperCase();
        t.label = `${t.label} ${slugTail}`;
    }
}

// ─── View / category helpers ────────────────────────────────────────

function getCategoryFor(comp, categorized) {
    for (const [cat, list] of Object.entries(categorized)) {
        if (list.some(c => c.name === comp.name)) return cat;
    }
    return null;
}

// PL/PLR senior comps surface in their own tab; everything else senior is
// "club"; midweek + juniors map straight to their tab names.
function getViewFor(category, name) {
    if (category === 'midweek' || category === 'juniors') return category;
    if (/Premier League/i.test(name)) return 'pl';
    return 'club';
}

// ─── Club abbreviation ───────────────────────────────────────────────

function buildClubAbbrLookup(clubMappings) {
    // Sort longest-first so "Doncaster Hockey Club Black" wins over "Doncaster
    // Hockey Club" when both happen to be configured.
    const entries = Object.entries(clubMappings.clubMappings);
    entries.sort(([a], [b]) => b.length - a.length);
    return entries;
}

// The set of every configured abbreviation (including composite ones like
// "SUHC - MNT" that contain their own " - ") — used to correctly locate the
// home team's abbreviation within a summary prefix of unknown length, see
// extractHomeTeamText below.
function buildKnownAbbrSet(clubLookup) {
    return new Set(clubLookup.map(([, abbr]) => abbr));
}

function clubAbbr(opponentName, lookup) {
    if (!opponentName) return null;
    for (const [fullName, abbr] of lookup) {
        if (opponentName === fullName) return abbr;
    }
    // Fall back to longest-prefix match — handles team suffixes like "1"/"2".
    for (const [fullName, abbr] of lookup) {
        if (opponentName.startsWith(fullName + ' ')) {
            const suffix = opponentName.substring(fullName.length + 1).trim();
            return suffix ? `${abbr} ${suffix}` : abbr;
        }
    }
    // No mapping — return the original so the UI shows something rather than blank.
    return opponentName;
}

// ─── Time conversion ───────────────────────────────────────────────

// Convert a Melbourne local time string ("2026-04-18T15:30") to a UTC ISO
// string. Uses Intl to look up the offset for the date in question, which
// handles AEST/AEDT correctly.
function melbourneLocalToUtcIso(localStr) {
    // localStr → naive Date interpreted as UTC for offset math
    const naiveUtc = new Date(`${localStr}:00.000Z`).getTime();

    // Same wall-clock interpreted in Melbourne — find what UTC it would be by
    // formatting the naive UTC moment in Melbourne and reading back the parts.
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(naiveUtc)).map(p => [p.type, p.value]));
    const hour = parts.hour === '24' ? '00' : parts.hour;
    const melbAtNaive = Date.UTC(
        +parts.year, +parts.month - 1, +parts.day,
        +hour, +parts.minute, +parts.second
    );
    // Offset = how much earlier UTC is than Melbourne wall-clock at that moment.
    const offsetMs = melbAtNaive - naiveUtc;
    return new Date(naiveUtc - offsetMs).toISOString();
}

// ─── Processed ICS parsing ──────────────────────────────────────────

// temp/processed/<comp>_processed.ics is named after the competition, using
// the same sanitisation calendar-processor.js applies when it writes the file.
function processedIcsPath(compName) {
    const fileName = `${compName.replace(/[^a-z0-9]/gi, '_')}_processed.ics`;
    return path.join(PROCESSED_DIR, fileName);
}

// Split "DTSTART;TZID=Australia/Melbourne:20260822T153000" into a
// "2026-08-22T15:30" local string — the same shape score-scraper.js produces
// for card.dtstartLocal, so the two sources can be matched directly.
function icsDateTimeToLocal(value) {
    if (!value || value.length < 13) return null;
    const y = value.substring(0, 4);
    const mo = value.substring(4, 6);
    const d = value.substring(6, 8);
    const h = value.substring(9, 11);
    const mi = value.substring(11, 13);
    return `${y}-${mo}-${d}T${h}:${mi}`;
}

// Parse a processed ICS file into raw VEVENT records. Deliberately doesn't
// use the `ical` library — calendar-processor.js found (see its own
// parseRawICalEvents) that hand-parsing the TZID'd DTSTART line avoids
// timezone round-trip surprises, and it's the same simple format here.
function parseProcessedIcs(icsText) {
    const events = [];
    const blocks = icsText.split('BEGIN:VEVENT');

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VEVENT')[0];
        const event = {};

        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('DTSTART')) {
                event.dtstartLocal = icsDateTimeToLocal(line.split(':').pop().trim());
            } else if (line.startsWith('DTEND')) {
                event.dtendLocal = icsDateTimeToLocal(line.split(':').pop().trim());
            } else if (line.startsWith('SUMMARY:')) {
                event.summary = line.substring(8).trim();
            } else if (line.startsWith('LOCATION:')) {
                event.location = line.substring(9).trim();
            } else if (line.startsWith('DESCRIPTION:')) {
                event.description = line.substring(12);
            }
        }

        if (event.summary && event.dtstartLocal) events.push(event);
    }

    return events;
}

// Pulls "ASF" from "Footscray Hockey Club - ASF". Allows hyphenated codes
// like "H-2".
function extractVenueAbbr(location) {
    if (!location) return null;
    const m = location.match(/-\s+([A-Za-z0-9-]+)\s*$/);
    return m ? m[1] : null;
}

// ─── Per-game build ─────────────────────────────────────────────────

// The text before " vs " is "{competition prefix} - {home team}", but the
// prefix itself is made of an arbitrary number of " - "-joined segments
// (comp name, "2026 Finals", a finals label…) and the home team's own
// abbreviation can *also* contain " - " (e.g. "SUHC - MNT"), so a fixed
// split point can't tell prefix from team name. Instead, try the longest
// trailing run of segments first and accept the first one that's a known
// abbreviation — "SUHC - MNT" wins over the bare "MNT" a naive last-segment
// split would produce.
function extractHomeTeamText(beforeVs, knownAbbrs) {
    const segments = beforeVs.split(' - ').map(s => s.trim());
    for (let start = 0; start < segments.length; start++) {
        const candidate = segments.slice(start).join(' - ');
        if (knownAbbrs.has(candidate)) return candidate;
    }
    // No configured abbreviation matched — best effort, same as before.
    return segments[segments.length - 1];
}

// Build a season.json event from a processed-ICS VEVENT. The ICS SUMMARY
// always ends with "{team} vs {team}" (regular round: "Men PEN D NW - FHC vs
// LAT"; finals: "Men PEN D NW - 2026 Finals - Qualifying Final - ESS vs
// FHC"). Regular rounds list the venue-owning (home) team first, but finals
// draws don't always — e.g. a U16 Boys Shield semi listed "FHC vs DON" while
// playing at Elgar Park, not Footscray — so isHome always comes from
// LOCATION, and the opponent is whichever side isn't the configured club,
// not a fixed position.
function buildEventFromIcs(icsEvent, clubName, clubLookup, knownAbbrs) {
    const vsIdx = icsEvent.summary.search(/\s+vs\s+/i);
    if (vsIdx === -1 || !icsEvent.location) return null;

    const team1 = extractHomeTeamText(icsEvent.summary.slice(0, vsIdx), knownAbbrs);
    const team2 = icsEvent.summary.slice(vsIdx).replace(/^\s+vs\s+/i, '').trim();

    const isHome = icsEvent.location.startsWith(clubName);
    const rawOpponent = team1.startsWith(FHC_ABBR) ? team2 : team1;
    const oppAbbr = clubAbbr(rawOpponent, clubLookup);
    const home = isHome ? FHC_ABBR : (oppAbbr || '?');
    const away = isHome ? (oppAbbr || '?') : FHC_ABBR;

    // Round numbers don't survive into the processed SUMMARY (see
    // calendar-processor.js's replaceRoundNames), so pull it from the
    // "Current Round: .../round/N" link generateDescription() writes for
    // regular rounds. That link is omitted for finals, so fall back to the
    // finals label, which — unlike the round number — is left in SUMMARY.
    const roundUrlMatch = icsEvent.description && icsEvent.description.match(/\/round\/(\d+)/);
    const round = roundUrlMatch ? parseInt(roundUrlMatch[1], 10) : null;
    const { finalsLabel } = parseRoundFromSummary(icsEvent.summary);

    return {
        round: finalsLabel || round,
        dtstartLocal: icsEvent.dtstartLocal,
        dtstart: melbourneLocalToUtcIso(icsEvent.dtstartLocal),
        dtend: icsEvent.dtendLocal ? melbourneLocalToUtcIso(icsEvent.dtendLocal) : null,
        home,
        away,
        isHome,
        location: icsEvent.location,
        gameId: null
    };
}

// Byes only ever exist in the score scrape — HV's iCal export omits them
// entirely since there's no fixture to publish.
function buildByeEvent(card, competition) {
    const matchMinutes = competition.matchDuration || DEFAULT_MATCH_MINUTES;
    const dtstart = melbourneLocalToUtcIso(card.dtstartLocal);
    const dtend = new Date(new Date(dtstart).getTime() + matchMinutes * 60 * 1000).toISOString();
    return {
        round: card.round,
        dtstart,
        dtend,
        isBye: true
    };
}

// Merge scraped scores onto ICS-derived events, matched by
// (Melbourne-local datetime, venue abbreviation) — the same key strategy the
// old fixtures generator used. A card that doesn't match any ICS event
// (scrape/ICS drift, or the ICS hasn't been regenerated yet) is dropped
// silently; a card that matches but carries no score just leaves the event
// unscored.
function mergeScoresIntoEvents(events, cards) {
    const index = new Map();
    for (const card of cards) {
        if (card.isBye || !card.dtstartLocal || !card.venueAbbr) continue;
        index.set(`${card.dtstartLocal}|${card.venueAbbr}`, card);
    }

    for (const event of events) {
        const venueAbbr = extractVenueAbbr(event.location);
        if (!venueAbbr) continue;
        const card = index.get(`${event.dtstartLocal}|${venueAbbr}`);
        if (!card) continue;

        event.gameId = card.gameId || null;
        if (card.status === 'Played') {
            if (card.score) event.score = card.score;
            else if (card.outcomeType) event.score = card.outcomeType;
        }
    }
}

// ─── Main ───────────────────────────────────────────────────────────

// Optional file read — returns null + a warning if the file is missing.
// Lets us tolerate a skipped scrape (continue-on-error in CI) without
// failing the season build.
async function readOptional(filePath, label) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.warn(`⚠️  ${label} not found at ${filePath} — continuing without it`);
            return null;
        }
        throw err;
    }
}

async function main() {
    const [scoresRaw, compsRaw, clubMappingsRaw, laddersRaw, clubName] = await Promise.all([
        readOptional(SCORES_FILE, 'scores.json'),
        fs.readFile(COMPETITIONS_FILE, 'utf8'),
        fs.readFile(MAPPINGS_CLUB_FILE, 'utf8'),
        readOptional(LADDERS_FILE, 'ladders.json'),
        getClubName()
    ]);

    const scoresPayload = scoresRaw ? JSON.parse(scoresRaw) : null;
    const allCompetitions = JSON.parse(compsRaw).competitions;
    const clubMappings = JSON.parse(clubMappingsRaw);
    const clubLookup = buildClubAbbrLookup(clubMappings);
    const knownAbbrs = buildKnownAbbrSet(clubLookup);
    const laddersPayload = laddersRaw ? JSON.parse(laddersRaw) : null;
    const ladders = laddersPayload?.ladders || {};

    // Deliberately not filtered on isActive: that flag only controls whether
    // process-all-competitions/scrape-scores keep polling HV daily for a
    // competition. A competition that's gone inactive (season/finals wrapped
    // up) keeps its last-processed ICS on disk indefinitely — nothing
    // deletes it short of someone manually running the interactive
    // cleanup-inactive-competitions.js — so it should keep showing here too.
    const comps = allCompetitions.filter(c => c.fixtureUrl);
    const categorized = categorizeCompetitions([...comps]);

    // Group scraped cards by competition for score/bye lookup.
    const cardsByComp = new Map();
    for (const card of scoresPayload?.games || []) {
        if (!cardsByComp.has(card.competition)) cardsByComp.set(card.competition, []);
        cardsByComp.get(card.competition).push(card);
    }

    const teams = [];
    const usedSlugs = new Set();
    let compsMissingIcs = 0;

    for (const comp of comps) {
        const icsPath = processedIcsPath(comp.name);
        const icsRaw = await readOptional(icsPath, `processed ICS for "${comp.name}"`);
        const icsEvents = icsRaw ? parseProcessedIcs(icsRaw) : [];
        if (!icsRaw) compsMissingIcs++;

        const cards = cardsByComp.get(comp.name) || [];

        const events = icsEvents
            .map(e => buildEventFromIcs(e, clubName, clubLookup, knownAbbrs))
            .filter(Boolean);
        mergeScoresIntoEvents(events, cards);
        // dtstartLocal was only needed for the score-merge key above.
        for (const e of events) delete e.dtstartLocal;

        for (const card of cards) {
            if (card.isBye) events.push(buildByeEvent(card, comp));
        }

        events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));

        const category = getCategoryFor(comp, categorized);
        if (!category) continue; // uncategorisable comp — skip

        let slug = buildSlug(comp.name);
        if (usedSlugs.has(slug)) {
            // Defensive: if two comps ever produce the same slug, append a
            // counter so each team has a unique URL.
            let n = 2;
            while (usedSlugs.has(`${slug}-${n}`)) n++;
            slug = `${slug}-${n}`;
        }
        usedSlugs.add(slug);

        const calendar = comp.googleCalendar || {};
        const team = {
            slug,
            label: buildShortCode(comp.name, category),
            name: comp.name,
            category,
            view: getViewFor(category, comp.name),
            fixtureUrl: comp.fixtureUrl || null,
            ladderUrl: comp.ladderUrl || null,
            competitionUrl: comp.competitionUrl || null,
            googleCalendar: (calendar.publicUrl || calendar.icalUrl)
                ? {
                    publicUrl: calendar.publicUrl || null,
                    icalUrl: calendar.icalUrl || null
                  }
                : null,
            events
        };
        // Attach the ladder when scraped — front-end skips the section
        // entirely when this field is absent.
        const ladderRows = ladders[comp.name];
        if (ladderRows && ladderRows.length > 0) {
            team.ladder = ladderRows;
        }
        teams.push(team);
    }

    disambiguateLabels(teams);

    teams.sort((a, b) => a.slug.localeCompare(b.slug));

    const totalEvents = teams.reduce((sum, t) => sum + t.events.length, 0);
    const totalScored = teams.reduce(
        (sum, t) => sum + t.events.filter(e => e.score).length, 0
    );

    const payload = {
        generatedAt: new Date().toISOString(),
        sourcesGeneratedAt: scoresPayload?.generatedAt || null,
        laddersGeneratedAt: laddersPayload?.generatedAt || null,
        teams
    };

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    const teamsWithLadder = teams.filter(t => t.ladder).length;
    console.log(`✅ Wrote ${teams.length} teams (${totalEvents} events, ${totalScored} scored, ${teamsWithLadder} with ladders) to ${OUTPUT}`);
    if (compsMissingIcs > 0) {
        console.warn(`⚠️  ${compsMissingIcs} competition(s) had no processed ICS — run npm run process-all-competitions first`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
