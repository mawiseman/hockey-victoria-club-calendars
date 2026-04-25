// Scrapes Hockey Victoria team-fixture pages for scores and writes a
// consolidated temp/scores.json that generate-fixtures-json merges into the
// committed fixtures.json. Runs daily as part of the sync-calendars workflow.
//
// One HTTP request per active competition (≈14 today). Cards on each page
// follow this layout, parsed below:
//
//   <div class="card card-hover mb-4">
//     <b>Round N</b><br />
//     {Day DD Mmm YYYY}<br />
//     {HH:MM}
//     <a href=".../venues/...">{Venue name}</a>
//     <div>{venueAbbr}</div>
//     <div class="text-muted">{Played | Playing}</div>
//     <a href=".../games/team/...">{Comp + opponent}</a>
//     <b>{home} - {away}</b>          ← only when status === "Played"
//     <div class="badge ...">{Win|Loss|Draw|FL|FF}</div>
//     <a href="/game/{gameId}">Details</a>

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { loadCompetitions } from '../lib/competition-utils.js';
import { TEMP_DIR } from '../lib/config.js';
import { logInfo, logWarning, logSuccess } from '../lib/error-utils.js';

const SCORES_FILE = path.join(TEMP_DIR, 'scores.json');

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.hockeyvictoria.org.au/'
};

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function parseDateLocal(dayStr, dayNum, monthStr, yearStr, hourStr, minuteStr) {
    const monthIdx = MONTHS[monthStr];
    if (monthIdx === undefined) return null;
    const yyyy = yearStr;
    const MM = String(monthIdx + 1).padStart(2, '0');
    const dd = String(parseInt(dayNum, 10)).padStart(2, '0');
    const HH = String(parseInt(hourStr, 10)).padStart(2, '0');
    const mn = String(parseInt(minuteStr, 10)).padStart(2, '0');
    // Melbourne local (no TZ suffix). The fixtures generator converts each
    // event's UTC dtstart to the same Melbourne-local form for matching.
    return `${yyyy}-${MM}-${dd}T${HH}:${mn}`;
}

function parseCard(blockText) {
    // Round number — anchor on <b>Round N</b>.
    const roundMatch = blockText.match(/<b>Round\s+(\d+)<\/b>/i);
    if (!roundMatch) return null;
    const round = parseInt(roundMatch[1], 10);

    // Date + time follow the round line via <br /> separators.
    const dtMatch = blockText.match(
        /<b>Round\s+\d+<\/b>\s*<br\s*\/?>\s*(\w{3})\s+(\d{1,2})\s+(\w{3})\s+(\d{4})\s*<br\s*\/?>\s*(\d{1,2}):(\d{2})/
    );
    if (!dtMatch) return null;
    const dtstartLocal = parseDateLocal(dtMatch[1], dtMatch[2], dtMatch[3], dtMatch[4], dtMatch[5], dtMatch[6]);
    if (!dtstartLocal) return null;

    // Venue abbreviation — the small <div>ABBR</div> sitting after the venue
    // link. Hyphens permitted (e.g. "H-2").
    const venueMatch = blockText.match(
        /href="[^"]*\/venues\/[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>\s*<div>\s*([A-Za-z0-9-]+)\s*<\/div>/
    );
    const venueAbbr = venueMatch ? venueMatch[2] : null;

    // Status / score / badge live in the centre column. Slicing from the
    // status div onward avoids the "Round N" <b> matching as the score.
    const statusIdx = blockText.search(/<div class="text-muted">/);
    if (statusIdx === -1) return null;
    const tail = blockText.substring(statusIdx);

    const statusMatch = tail.match(/<div class="text-muted">\s*([^\s<][^<]*?)\s*<\/div>/);
    const status = statusMatch ? statusMatch[1].trim() : null;

    const scoreMatch = tail.match(/<b>\s*(\d+)\s*-\s*(\d+)\s*<\/b>/);
    const score = scoreMatch ? `${parseInt(scoreMatch[1], 10)}-${parseInt(scoreMatch[2], 10)}` : null;

    const badgeMatch = tail.match(/<div class="badge badge-\w+">\s*([^<]+?)\s*<\/div>/);
    const result = badgeMatch ? badgeMatch[1].trim() : null;

    // Game ID from /game/<id>.
    const gameIdMatch = blockText.match(/\/game\/(\d+)/);
    const gameId = gameIdMatch ? gameIdMatch[1] : null;

    return { round, dtstartLocal, venueAbbr, status, score, result, gameId };
}

function parseScoresHtml(html) {
    const games = [];
    // Each card opens with this exact class set; split-and-skip-first strips
    // page chrome above the first card.
    const blocks = html.split(/<div\s+class="card card-hover mb-4">/);
    for (let i = 1; i < blocks.length; i++) {
        const game = parseCard(blocks[i]);
        if (game) games.push(game);
    }
    return games;
}

async function scrapeCompetition(competition) {
    if (!competition.fixtureUrl) {
        logWarning(`Missing fixtureUrl for ${competition.name}, skipping`);
        return null;
    }

    logInfo(`Scraping scores: ${competition.name}`);

    try {
        const res = await fetch(competition.fixtureUrl, { headers: FETCH_HEADERS });
        if (res.status === 202) {
            const wafAction = res.headers.get('x-amzn-waf-action');
            throw new Error(`WAF challenge (status 202, action=${wafAction})`);
        }
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const html = await res.text();
        const games = parseScoresHtml(html);

        const played = games.filter(g => g.status === 'Played' && g.score).length;
        logSuccess(`  ${competition.name}: ${games.length} cards parsed (${played} with scores)`);
        return games;
    } catch (err) {
        logWarning(`Failed to scrape ${competition.name}: ${err.message}`);
        return null;
    }
}

async function main() {
    const competitions = await loadCompetitions();
    // Match process-all-competitions.js: treat a missing isActive as active.
    // The senior comps have isActive=true, but midweek/junior comps were
    // added without it ever being computed and would be silently skipped
    // by a strict === true filter.
    const active = competitions.filter(c => c.fixtureUrl && c.isActive !== false);
    logInfo(`Scraping scores for ${active.length} active competitions`);

    // Single flat list — the generator builds an index from this.
    const games = [];
    let failed = 0;

    for (const comp of active) {
        const compGames = await scrapeCompetition(comp);
        if (compGames === null) {
            failed++;
        } else {
            for (const g of compGames) {
                games.push({ competition: comp.name, ...g });
            }
        }
        // Polite jitter so we don't hammer HV's site or trip the WAF.
        await sleep(200 + Math.random() * 300);
    }

    await fs.mkdir(TEMP_DIR, { recursive: true });
    const payload = {
        generatedAt: new Date().toISOString(),
        competitionsScraped: active.length - failed,
        competitionsFailed: failed,
        games
    };
    await fs.writeFile(SCORES_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    const playedCount = games.filter(g => g.status === 'Played' && g.score).length;
    logSuccess(`Wrote ${games.length} cards (${playedCount} with scores) from ${active.length - failed}/${active.length} competitions to ${SCORES_FILE}`);

    // Don't fail the workflow if some scrapes failed — partial data is fine.
    // The generator merges whatever's available and leaves un-scored events alone.
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
