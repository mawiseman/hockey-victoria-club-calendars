import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

// Import shared utilities
import { loadCompetitionData } from '../lib/competition-utils.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';

const ICAL_BASE_URL = 'https://www.hockeyvictoria.org.au/games/team/export/ical/';

/**
 * Downloads an iCal calendar from Hockey Victoria
 * @param {string} competitionTeamId - The competition team ID (can be full URL or just ID)
 * @param {string} outputPath - Path to save the downloaded calendar
 * @returns {Promise<boolean>} - Success status
 */
export async function downloadCalendar(competitionTeamId, outputPath) {
    // Extract team ID from fixture URL if it's a full URL
    let teamId = competitionTeamId;
    if (competitionTeamId.includes('/games/team/')) {
        // Extract team ID from URL like "https://www.hockeyvictoria.org.au/games/team/21935/336963"
        const urlParts = competitionTeamId.split('/');
        const teamIndex = urlParts.indexOf('team');
        if (teamIndex !== -1 && urlParts.length > teamIndex + 2) {
            teamId = `${urlParts[teamIndex + 1]}/${urlParts[teamIndex + 2]}`;
        }
    }
    
    const url = `${ICAL_BASE_URL}${teamId}`;
    
    logInfo(`Downloading calendar from: ${url}`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.text();
        
        // Ensure output directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        
        // Save the calendar
        await fs.writeFile(outputPath, data, 'utf8');
        
        logSuccess(`Calendar saved to: ${outputPath}`);
        return true;
    } catch (error) {
        logWarning(`Error downloading calendar: ${error.message}`);
        return false;
    }
}

/**
 * Downloads multiple calendars
 * @param {Array} competitions - Array of competition objects
 * @param {string} outputDir - Directory to save calendars
 * @returns {Promise<Object>} - Object with download results
 */
export async function downloadAllCalendars(competitions, outputDir) {
    const results = {};
    
    for (const competition of competitions) {
        const fileName = `${competition.name.replace(/[^a-z0-9]/gi, '_')}.ics`;
        const outputPath = path.join(outputDir, fileName);
        
        logInfo(`Processing: ${competition.name}`);
        
        // Handle both old format (competitionTeamId) and new format (fixtureUrl)
        const teamIdOrUrl = competition.fixtureUrl || competition.competitionTeamId;
        
        if (!teamIdOrUrl) {
            logWarning(`No fixture URL or competition team ID found for: ${competition.name}`);
            results[competition.name] = {
                success: false,
                path: null,
                competition,
                error: 'Missing fixture URL or competition team ID'
            };
            continue;
        }
        
        const success = await downloadCalendar(teamIdOrUrl, outputPath);
        
        results[competition.name] = {
            success,
            path: success ? outputPath : null,
            competition
        };
    }
    
    return results;
}

