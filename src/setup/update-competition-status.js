import fs from 'fs/promises';
import fetch from 'node-fetch';
import ical from 'ical';

// Import shared utilities
import { loadCompetitionData } from '../lib/competition-utils.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';
import { COMPETITIONS_FILE } from '../lib/config.js';

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
 * Download and parse an iCal feed, returning the latest event date
 * @param {string} fixtureUrl - The competition's fixture URL
 * @returns {Promise<Date|null>} - Latest event date or null
 */
async function getLatestEventDateFromHV(fixtureUrl) {
    const teamId = extractTeamId(fixtureUrl);
    if (!teamId) return null;

    const url = `${ICAL_BASE_URL}${teamId}`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/calendar,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.hockeyvictoria.org.au/'
            }
        });

        if (!response.ok) {
            logWarning(`HTTP ${response.status} fetching iCal for ${fixtureUrl}`);
            return null;
        }

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
    } catch (error) {
        logWarning(`Error fetching iCal for ${fixtureUrl}: ${error.message}`);
        return null;
    }
}

/**
 * Check if a competition is active by fetching its iCal feed from Hockey Victoria
 * @param {Object} competition - Competition object
 * @returns {Promise<{isActive: boolean, latestDate: Date|null, daysDiff: number|null}>}
 */
async function isCompetitionActive(competition) {
    const latestDate = await getLatestEventDateFromHV(competition.fixtureUrl);

    if (!latestDate) {
        logWarning(`${competition.name}: No events found or could not fetch calendar`);
        return { isActive: false, latestDate: null, daysDiff: null };
    }

    const now = new Date();
    const timeDiff = latestDate - now;
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    // Consider competition active if the latest event is within 7 days past or in the future
    const isActive = daysDiff >= -7;

    logInfo(`${competition.name}: Latest event ${latestDate.toDateString()}, ${daysDiff} days from now, ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

    return { isActive, latestDate, daysDiff };
}

/**
 * Update competitions.json with active status flags
 */
async function updateCompetitionStatus() {
    try {
        logInfo('Loading competitions data...');
        const competitionData = await loadCompetitionData();

        logInfo(`Found ${competitionData.competitions.length} competitions`);

        let updatedCount = 0;
        let activeCount = 0;
        let inactiveCount = 0;

        for (const competition of competitionData.competitions) {
            const result = await isCompetitionActive(competition);

            const wasActive = competition.isActive;
            const isActive = result.isActive;

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

        // Save the updated competitions file
        await fs.writeFile(COMPETITIONS_FILE, JSON.stringify(competitionData, null, 2), 'utf8');

        logSuccess(`Updated ${updatedCount} competition statuses`);
        logInfo(`Active competitions: ${activeCount}`);
        logInfo(`Inactive competitions: ${inactiveCount}`);

        return {
            total: competitionData.competitions.length,
            updated: updatedCount,
            active: activeCount,
            inactive: inactiveCount
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
