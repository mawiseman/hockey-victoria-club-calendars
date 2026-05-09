// Scrapes Hockey Victoria pointscore (ladder) pages for each active competition
// and writes a consolidated temp/ladders.json that generate-season-json merges
// into the per-team season payload. Runs daily as part of sync-calendars.
//
// One HTTP request per active competition. The ladder table has this shape:
//
//   <table class="table table-hover font-size-sm mb-0">
//     <thead><tr>
//       <th>Team</th><th>Played</th><th>Wins</th><th>Draws</th><th>Losses</th>
//       <th>BYEs</th><th>For</th><th>Against</th><th>Diff.</th><th>Points</th>
//       <th>WR*<sup>1</sup></th>
//     </tr></thead>
//     <tbody>
//       <tr>
//         <td>1. <a href=".../games/team/...">Doncaster Hockey Club</a></td>
//         <td>6</td><td>6</td><td>0</td><td>0</td><td>0</td>
//         <td>22</td><td>5</td><td>17</td><td>18</td><td><b>100%</b></td>
//       </tr>
//       …
//
// Position is encoded as the "N. " prefix on the first cell rather than its
// own column. Numeric cells contain just whitespace + an integer (or a percent
// for the WR column, which we ignore).

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { loadCompetitions } from '../lib/competition-utils.js';
import { TEMP_DIR, getClubName } from '../lib/config.js';
import { logInfo, logWarning, logSuccess } from '../lib/error-utils.js';

const LADDERS_FILE = path.join(TEMP_DIR, 'ladders.json');

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.hockeyvictoria.org.au/'
};

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

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

function stripTags(text) {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Pull the ladder table out of the page. The class string is distinctive
// enough to be unique on HV pointscore pages — there's only one match.
function extractLadderTable(html) {
    const open = html.indexOf('<table class="table table-hover font-size-sm mb-0">');
    if (open === -1) return null;
    const close = html.indexOf('</table>', open);
    if (close === -1) return null;
    return html.substring(open, close + '</table>'.length);
}

function parseLadder(html, clubName) {
    const table = extractLadderTable(html);
    if (!table) return null;

    // Slice out tbody so a stray <tr> in the header (e.g. a column-group row)
    // can't be mistaken for a team row.
    const tbodyStart = table.indexOf('<tbody>');
    const tbodyEnd = table.indexOf('</tbody>', tbodyStart);
    if (tbodyStart === -1 || tbodyEnd === -1) return null;
    const tbody = table.substring(tbodyStart, tbodyEnd);

    // Each row is delimited by <tr> … </tr>. Splitting on the closing tag is
    // the safer direction since opening tags can vary in attributes.
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRegex.exec(tbody)) !== null) {
        const row = parseRow(m[1], clubName);
        if (row) rows.push(row);
    }
    return rows;
}

function parseRow(rowHtml, clubName) {
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let c;
    while ((c = cellRegex.exec(rowHtml)) !== null) cells.push(c[1]);

    // Senior + junior + midweek tables we've inspected all share the same
    // 11-column layout: team, P, W, D, L, BYE, GF, GA, GD, Pts, WR.
    if (cells.length < 10) return null;

    const teamCellRaw = cells[0];

    // Position prefix sits before the <a>: "1. <a>…</a>". On rare comps with
    // no link (e.g. byes/forfeits) we still extract the visible name.
    const posMatch = teamCellRaw.match(/(\d+)\s*\./);
    if (!posMatch) return null;
    const pos = parseInt(posMatch[1], 10);

    const linkMatch = teamCellRaw.match(/<a\s[^>]*>([\s\S]*?)<\/a>/i);
    const teamName = decodeEntities(stripTags(linkMatch ? linkMatch[1] : teamCellRaw.replace(/^\s*\d+\s*\.\s*/, '')));
    if (!teamName) return null;

    const num = (raw) => {
        const text = stripTags(raw);
        const m = text.match(/-?\d+/);
        return m ? parseInt(m[0], 10) : 0;
    };

    return {
        pos,
        team: teamName,
        p:   num(cells[1]),
        w:   num(cells[2]),
        d:   num(cells[3]),
        l:   num(cells[4]),
        bye: num(cells[5]),
        gf:  num(cells[6]),
        ga:  num(cells[7]),
        gd:  num(cells[8]),
        pts: num(cells[9]),
        // FHC fields the front-end keys on. Multiple FHC teams can share a
        // ladder when entered with suffixes (e.g. "Footscray Hockey Club 2"),
        // so prefix-match rather than equality.
        isClub: !!clubName && (teamName === clubName || teamName.startsWith(clubName + ' '))
    };
}

async function scrapeCompetition(competition, clubName) {
    if (!competition.ladderUrl) {
        logWarning(`Missing ladderUrl for ${competition.name}, skipping`);
        return null;
    }

    logInfo(`Scraping ladder: ${competition.name}`);

    try {
        const res = await fetch(competition.ladderUrl, { headers: FETCH_HEADERS });
        if (res.status === 202) {
            const wafAction = res.headers.get('x-amzn-waf-action');
            throw new Error(`WAF challenge (status 202, action=${wafAction})`);
        }
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const html = await res.text();
        const rows = parseLadder(html, clubName);
        if (rows === null) {
            logWarning(`  ${competition.name}: no ladder table found`);
            return null;
        }
        logSuccess(`  ${competition.name}: ${rows.length} rows`);
        return rows;
    } catch (err) {
        logWarning(`Failed to scrape ${competition.name}: ${err.message}`);
        return null;
    }
}

async function main() {
    const [competitions, clubName] = await Promise.all([
        loadCompetitions(),
        getClubName()
    ]);
    // Match score-scraper: treat a missing isActive as active so newly added
    // comps without computed status still get scraped.
    const active = competitions.filter(c => c.ladderUrl && c.isActive !== false);
    logInfo(`Scraping ladders for ${active.length} active competitions`);

    const ladders = {};
    let failed = 0;

    for (const comp of active) {
        const rows = await scrapeCompetition(comp, clubName);
        if (rows === null) {
            failed++;
        } else if (rows.length > 0) {
            ladders[comp.name] = rows;
        }
        await sleep(200 + Math.random() * 300);
    }

    await fs.mkdir(TEMP_DIR, { recursive: true });
    const payload = {
        generatedAt: new Date().toISOString(),
        competitionsScraped: active.length - failed,
        competitionsFailed: failed,
        ladders
    };
    await fs.writeFile(LADDERS_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    const totalRows = Object.values(ladders).reduce((s, r) => s + r.length, 0);
    logSuccess(`Wrote ${Object.keys(ladders).length} ladders (${totalRows} rows) from ${active.length - failed}/${active.length} competitions to ${LADDERS_FILE}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
