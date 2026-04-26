// Builds weekly-fixture/data/season.json — a per-team grouped fixture file
// powering the week-navigation and team-season-view features.
//
// Sources:
//   • temp/scores.json          (output of npm run scrape-scores; one card per round)
//   • config/competitions.json  (team metadata + URLs)
//   • config/mappings-club-names.json  (opponent club name → abbreviation)
//   • config/settings.json      (club name, used to detect FHC home games)
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

const SCORES_FILE = path.join(TEMP_DIR, 'scores.json');
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

// ─── Per-game build ─────────────────────────────────────────────────

function buildEvent(card, competition, clubName, clubLookup) {
    // Some cards (cancelled / placeholder rows) might miss either field.
    if (!card.dtstartLocal || !card.venueAbbr) return null;

    const dtstart = melbourneLocalToUtcIso(card.dtstartLocal);
    const matchMinutes = competition.matchDuration || DEFAULT_MATCH_MINUTES;
    const dtend = new Date(new Date(dtstart).getTime() + matchMinutes * 60 * 1000).toISOString();

    // FHC is at home when the venue belongs to the club. Venue name from the
    // scrape (full, e.g. "Footscray Hockey Club") starts with the configured
    // club name for any FHC ground.
    const isHome = !!card.venueName && card.venueName.startsWith(clubName);

    const oppAbbr = clubAbbr(card.opponentName, clubLookup);
    const home = isHome ? FHC_ABBR : (oppAbbr || '?');
    const away = isHome ? (oppAbbr || '?') : FHC_ABBR;

    const event = {
        round: card.round,
        dtstart,
        dtend,
        home,
        away,
        isHome,
        location: card.venueName ? `${card.venueName} - ${card.venueAbbr}` : card.venueAbbr,
        gameId: card.gameId || null
    };

    if (card.status === 'Played' && card.score) {
        event.score = card.score;
    }

    return event;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
    const [scoresRaw, compsRaw, clubMappingsRaw, clubName] = await Promise.all([
        fs.readFile(SCORES_FILE, 'utf8'),
        fs.readFile(COMPETITIONS_FILE, 'utf8'),
        fs.readFile(MAPPINGS_CLUB_FILE, 'utf8'),
        getClubName()
    ]);

    const scoresPayload = JSON.parse(scoresRaw);
    const allCompetitions = JSON.parse(compsRaw).competitions;
    const clubMappings = JSON.parse(clubMappingsRaw);
    const clubLookup = buildClubAbbrLookup(clubMappings);

    // Reuse the project's category logic so views match the rest of the site.
    const activeComps = allCompetitions.filter(c => c.fixtureUrl && c.isActive !== false);
    const categorized = categorizeCompetitions([...activeComps]);

    // Group scraped cards by competition for fast lookup.
    const cardsByComp = new Map();
    for (const card of scoresPayload.games || []) {
        if (!cardsByComp.has(card.competition)) cardsByComp.set(card.competition, []);
        cardsByComp.get(card.competition).push(card);
    }

    const teams = [];
    const usedSlugs = new Set();

    for (const comp of activeComps) {
        const cards = cardsByComp.get(comp.name) || [];
        const events = cards
            .map(card => buildEvent(card, comp, clubName, clubLookup))
            .filter(Boolean)
            .sort((a, b) => a.dtstart.localeCompare(b.dtstart));

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
        teams.push({
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
        });
    }

    disambiguateLabels(teams);

    teams.sort((a, b) => a.slug.localeCompare(b.slug));

    const totalEvents = teams.reduce((sum, t) => sum + t.events.length, 0);
    const totalScored = teams.reduce(
        (sum, t) => sum + t.events.filter(e => e.score).length, 0
    );

    const payload = {
        generatedAt: new Date().toISOString(),
        sourcesGeneratedAt: scoresPayload.generatedAt || null,
        teams
    };

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    console.log(`✅ Wrote ${teams.length} teams (${totalEvents} events, ${totalScored} scored) to ${OUTPUT}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
