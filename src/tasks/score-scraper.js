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

import fs from 'fs/promises';
import path from 'path';
import { loadCompetitions } from '../lib/competition-utils.js';
import { TEMP_DIR } from '../lib/config.js';
import { logInfo, logWarning, logSuccess } from '../lib/error-utils.js';
import { hvFetch, warmUpHvSession, jitterSleep, shuffle } from '../lib/hv-fetch.js';

const SCORES_FILE = path.join(TEMP_DIR, 'scores.json');

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Decode the HTML entities HV sprinkles in (apostrophes especially:
// `&#039;` for the curly ones in midweek comp names like "Men's 40+").
function decodeEntities(text) {
    if (!text) return text;
    return text
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

// HV's team-page link text wraps the comp name around the opponent club:
//   • Seniors: "{comp.name} {opponent}"  e.g. "Mens Premier League - 2026 Altona Hockey Club"
//   • Midweek/Juniors: "{year} {comp-without-year} {opponent}"  e.g. "2026 Midweek Men's 40+ NW Essendon Hockey"
// Try the senior shape (comp.name as exact prefix) first, then fall back to a
// year-stripped substring search that handles the other layout.
function stripCompPrefix(linkText, compName) {
    if (!compName) return linkText || null;
    if (linkText.startsWith(compName)) {
        return linkText.substring(compName.length).trim() || null;
    }
    const yearStripped = compName.replace(/\s*-\s*\d{4}$/, '').trim();
    const idx = linkText.indexOf(yearStripped);
    if (idx !== -1) {
        return linkText.substring(idx + yearStripped.length).trim() || null;
    }
    return linkText;
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

function parseCard(blockText, compName) {
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
    // link. Hyphens permitted (e.g. "H-2"). The abbr group allows zero chars
    // so bye cards (which have an empty <div></div> after the venue link)
    // still match — we detect them below.
    const venueMatch = blockText.match(
        /href="[^"]*\/venues\/[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>\s*<div>\s*([A-Za-z0-9-]*)\s*<\/div>/
    );
    const venueAbbr = venueMatch && venueMatch[2] ? venueMatch[2] : null;
    const venueName = venueMatch ? decodeEntities(venueMatch[1].replace(/\s+/g, ' ').trim()) : null;

    // Bye detection — HV's team-page bye cards have venue link text "BYE",
    // an empty abbreviation div, no opponent link, and no status div. Emit a
    // tagged record up-front so the downstream pipeline doesn't have to
    // special-case the missing fields.
    if (venueName === 'BYE') {
        return {
            round,
            dtstartLocal,
            isBye: true,
            venueAbbr: null,
            venueName: null,
            opponentName: null,
            opponentTeamUrl: null,
            status: 'Bye',
            score: null,
            result: null,
            gameId: null
        };
    }

    // Opponent team link — text format is "{compName} {OpponentClubName}".
    // Stripping the comp prefix yields the opponent. The link href is the
    // opponent's team page on HV (handy for future "view opponent" features).
    const teamLinkMatch = blockText.match(
        /<a\s+href="([^"]*\/games\/team\/[^"]*)"[^>]*>\s*([^<]+?)\s*<\/a>/
    );
    let opponentName = null;
    let opponentTeamUrl = null;
    if (teamLinkMatch) {
        opponentTeamUrl = teamLinkMatch[1];
        const linkText = decodeEntities(teamLinkMatch[2].replace(/\s+/g, ' ').trim());
        opponentName = stripCompPrefix(linkText, compName);
    }

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

    // Forfeit (FF) / Forced Loss (FL) markers — HV puts these in a <span> badge
    // alongside the "No score" placeholders, while the team's own outcome
    // (Win/Loss) sits in the <div> badge above. The class attribute can wrap
    // across whitespace ("badge badge-danger\n align-middle"), so allow that.
    const outcomeTypeMatch = tail.match(/<span\s+class="badge\s+badge-\w+[^"]*">\s*(FF|FL)\s*<\/span>/i);
    const outcomeType = outcomeTypeMatch ? outcomeTypeMatch[1].toUpperCase() : null;

    // Game ID from /game/<id>.
    const gameIdMatch = blockText.match(/\/game\/(\d+)/);
    const gameId = gameIdMatch ? gameIdMatch[1] : null;

    return {
        round,
        dtstartLocal,
        venueAbbr,
        venueName,
        opponentName,
        opponentTeamUrl,
        status,
        score,
        result,
        outcomeType,
        gameId
    };
}

function parseScoresHtml(html, compName) {
    const games = [];
    // Each card opens with this exact class set; split-and-skip-first strips
    // page chrome above the first card.
    const blocks = html.split(/<div\s+class="card card-hover mb-4">/);
    for (let i = 1; i < blocks.length; i++) {
        const game = parseCard(blocks[i], compName);
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
        const res = await hvFetch(competition.fixtureUrl, { label: competition.name });
        const html = await res.text();
        const games = parseScoresHtml(html, competition.name);

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

    // Seed the WAF session cookie before the loop so the first real requests
    // aren't the ones that eat a cold-start challenge.
    await warmUpHvSession();

    // Single flat list — the generator builds an index from this.
    const games = [];

    // One pass over a list of comps; returns those that failed outright. A comp
    // only reaches here on failure of an earlier pass, so games are never
    // pushed twice.
    async function runPass(comps) {
        const stillFailed = [];
        for (const comp of comps) {
            const compGames = await scrapeCompetition(comp);
            if (compGames === null) {
                stillFailed.push(comp);
            } else {
                for (const g of compGames) {
                    games.push({ competition: comp.name, ...g });
                }
            }
            // Polite jitter so we don't hammer HV's site or trip the WAF.
            await jitterSleep();
        }
        return stillFailed;
    }

    // Shuffle so no single comp is always first to hit a cold-start challenge.
    let pending = await runPass(shuffle(active));

    // Second pass over whatever failed — WAF challenges are transient and the
    // session cookie is warm by now, so most stragglers succeed on retry.
    if (pending.length > 0) {
        logInfo(`Retrying ${pending.length} failed competition(s) in a second pass`);
        await jitterSleep(2000, 4000);
        pending = await runPass(shuffle(pending));
    }
    const failedCompetitions = pending.map(c => c.name);
    const failed = failedCompetitions.length;

    await fs.mkdir(TEMP_DIR, { recursive: true });
    const payload = {
        generatedAt: new Date().toISOString(),
        competitionsScraped: active.length - failed,
        competitionsFailed: failed,
        // Names of comps that failed both passes — the CI reporting step reads
        // this to surface complete failures (retries are logged but not raised).
        failedCompetitions,
        games
    };
    await fs.writeFile(SCORES_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    const playedCount = games.filter(g => g.status === 'Played' && g.score).length;
    logSuccess(`Wrote ${games.length} cards (${playedCount} with scores) from ${active.length - failed}/${active.length} competitions to ${SCORES_FILE}`);
    if (failed > 0) {
        logWarning(`${failed} competition(s) failed to scrape after retries: ${failedCompetitions.join(', ')}`);
    }

    // Don't fail the workflow if some scrapes failed — partial data is fine.
    // The generator merges whatever's available and leaves un-scored events alone.
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
