import ical from 'ical';

// Import shared utilities
import { loadCompetitionData, saveCompetitionData } from '../lib/competition-utils.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';
import { hvFetch, warmUpHvSession, jitterSleep } from '../lib/hv-fetch.js';

const ICAL_BASE_URL = 'https://www.hockeyvictoria.org.au/games/team/export/ical/';

/**
 * Extract team ID from a fixture URL
 * @param {string} fixtureUrl - Full fixture URL
 * @returns {string|null} - Team ID path segment (e.g. "25879/409884") or null
 */
function extractTeamId(fixtureUrl) {
    if (!fixtureUrl || !fixtureUrl.includes('/games/team/')) return null;
    const urlParts = fixtureUrl.split('/');
    const teamIndex = urlParts.indexOf('team');
    if (teamIndex !== -1 && urlParts.length > teamIndex + 2) {
        return `${urlParts[teamIndex + 1]}/${urlParts[teamIndex + 2]}`;
    }
    return null;
}

/**
 * Download and parse an iCal feed, returning the latest event date.
 * Throws if the feed can't be fetched (network / WAF / HTTP error) so the caller
 * can treat an unreadable feed as "unknown" rather than "no events → inactive".
 * @param {string} fixtureUrl - The competition's fixture URL
 * @returns {Promise<Date|null>} - Latest event date, or null if the feed parsed
 *   but contained no events
 */
async function getLatestEventDateFromHV(fixtureUrl) {
    const teamId = extractTeamId(fixtureUrl);
    if (!teamId) return null;

    const url = `${ICAL_BASE_URL}${teamId}`;

    // hvFetch retries WAF challenges (202) / 429 / 5xx and carries the shared
    // session cookie; it throws once retries are exhausted, which we let
    // propagate so an unreadable feed becomes "unknown" upstream rather than a
    // silent deactivation.
    const response = await hvFetch(url, { accept: 'text/calendar,*/*', label: `ical ${teamId}` });
    const icalData = await response.text();
    const parsedCal = ical.parseICS(icalData);

    let latestDate = null;
    for (const eventId in parsedCal) {
        const event = parsedCal[eventId];
        if (event.type === 'VEVENT' && event.start) {
            const eventDate = new Date(event.start);
            if (!latestDate || eventDate > latestDate) {
                latestDate = eventDate;
            }
        }
    }

    return latestDate;
}

/**
 * Determine a competition's status from its HV iCal feed.
 *
 * Returns one of three states, never conflating a read failure with a finished
 * season:
 *   • 'active'   — feed read, latest event within 7 days past or in the future
 *   • 'inactive' — feed read, latest event more than 7 days in the past
 *   • 'unknown'  — feed couldn't be read (or parsed to zero events); the caller
 *                  keeps the competition's existing status so a transient WAF
 *                  block can't silently deactivate a live competition
 * @param {Object} competition - Competition object
 * @returns {Promise<{status: 'active'|'inactive'|'unknown', latestDate: Date|null, daysDiff: number|null}>}
 */
async function isCompetitionActive(competition) {
    let latestDate;
    try {
        latestDate = await getLatestEventDateFromHV(competition.fixtureUrl);
    } catch (error) {
        logWarning(`${competition.name}: could not fetch calendar (${error.message}) — status unknown, keeping existing`);
        return { status: 'unknown', latestDate: null, daysDiff: null };
    }

    if (!latestDate) {
        // A readable HV feed always retains past events, so an empty parse is
        // far more likely a bad response than a genuinely finished season.
        // Treat it as unknown rather than deactivating.
        logWarning(`${competition.name}: no events parsed from calendar — status unknown, keeping existing`);
        return { status: 'unknown', latestDate: null, daysDiff: null };
    }

    const now = new Date();
    const timeDiff = latestDate - now;
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    // Active if the latest event is within 7 days past or in the future.
    const status = daysDiff >= -7 ? 'active' : 'inactive';

    logInfo(`${competition.name}: Latest event ${latestDate.toDateString()}, ${daysDiff} days from now, ${status.toUpperCase()}`);

    return { status, latestDate, daysDiff };
}

/**
 * Update competitions.json with active status flags
 */
async function updateCompetitionStatus() {
    try {
        logInfo('Loading competitions data...');
        const competitionData = await loadCompetitionData();

        logInfo(`Found ${competitionData.competitions.length} competitions`);

        // Seed the WAF session before hitting ~40 feeds so the first requests
        // aren't the ones that eat a cold-start challenge.
        await warmUpHvSession();

        let updatedCount = 0;
        let activeCount = 0;
        let inactiveCount = 0;
        let unknownCount = 0;

        for (const competition of competitionData.competitions) {
            const result = await isCompetitionActive(competition);
            // Polite jitter between feeds — the old version fired all requests
            // back-to-back, which itself invited rate-limiting.
            await jitterSleep();

            if (result.status === 'unknown') {
                // Preserve whatever status the competition already had — never
                // deactivate on an unreadable feed. Count it under its current
                // status so the totals still add up.
                unknownCount++;
                if (competition.isActive === false) inactiveCount++;
                else activeCount++;
                continue;
            }

            const wasActive = competition.isActive;
            const isActive = result.status === 'active';

            if (wasActive !== isActive || competition.isActive === undefined) {
                competition.isActive = isActive;
                competition.statusUpdatedAt = new Date().toISOString();
                updatedCount++;
            }

            if (isActive) {
                activeCount++;
            } else {
                inactiveCount++;
            }
        }

        // Update the main metadata
        competitionData.lastStatusUpdate = new Date().toISOString();
        competitionData.activeCompetitions = activeCount;
        competitionData.inactiveCompetitions = inactiveCount;

        // Save the updated competitions file (sorted via shared helper)
        await saveCompetitionData(competitionData);

        logSuccess(`Updated ${updatedCount} competition statuses`);
        logInfo(`Active competitions: ${activeCount}`);
        logInfo(`Inactive competitions: ${inactiveCount}`);
        if (unknownCount > 0) {
            logWarning(`${unknownCount} competition(s) had unreadable feeds — kept their existing status`);
        }

        return {
            total: competitionData.competitions.length,
            updated: updatedCount,
            active: activeCount,
            inactive: inactiveCount,
            unknown: unknownCount
        };

    } catch (error) {
        logWarning(`Error updating competition status: ${error.message}`);
        throw error;
    }
}

/**
 * Main execution function
 */
async function main() {
    console.log('========================================');
    console.log('Hockey Victoria Competition Status Updater');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('========================================\n');

    try {
        const results = await updateCompetitionStatus();

        console.log('\n========================================');
        console.log('Status Update Summary:');
        console.log(`  Total competitions: ${results.total}`);
        console.log(`  Updated statuses: ${results.updated}`);
        console.log(`  Currently active: ${results.active}`);
        console.log(`  Currently inactive: ${results.inactive}`);
        console.log(`  Unknown (kept existing): ${results.unknown}`);
        console.log('========================================');

    } catch (error) {
        console.error('❌ Failed to update competition status:', error.message);
        process.exit(1);
    }
}

// Run if called directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    main();
}

export { updateCompetitionStatus, isCompetitionActive };
