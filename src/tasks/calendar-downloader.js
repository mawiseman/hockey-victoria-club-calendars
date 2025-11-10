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
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/calendar,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.hockeyvictoria.org.au/'
            }
        });

        // Check for specific HTTP status codes
        if (response.status === 202) {
            const wafAction = response.headers.get('x-amzn-waf-action');
            if (wafAction === 'challenge') {
                throw new Error(`Download blocked by WAF (Web Application Firewall). The server is challenging the request. Status: ${response.status}`);
            }
            throw new Error(`Server returned 202 Accepted with no content. This may indicate the calendar is being generated or the request was blocked. Status: ${response.status}`);
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
        }

        // Check content-length header
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) === 0) {
            throw new Error(`Server returned empty response (Content-Length: 0). The calendar may not exist or the request was blocked.`);
        }

        const data = await response.text();

        // Validate that we received actual ICS data
        if (!data || data.trim().length === 0) {
            throw new Error(`Downloaded file is empty. The server may have returned no data or the calendar may not exist.`);
        }

        if (!data.includes('BEGIN:VCALENDAR')) {
            throw new Error(`Downloaded content is not a valid ICS file. Received ${data.length} bytes but no VCALENDAR found. The server may have returned an error page.`);
        }

        // Ensure output directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        // Save the calendar
        await fs.writeFile(outputPath, data, 'utf8');

        logSuccess(`Calendar saved to: ${outputPath} (${data.length} bytes)`);
        return { success: true, error: null };
    } catch (error) {
        logWarning(`Error downloading calendar: ${error.message}`);
        return { success: false, error: error.message };
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
        
        const result = await downloadCalendar(teamIdOrUrl, outputPath);

        results[competition.name] = {
            success: result.success,
            path: result.success ? outputPath : null,
            competition,
            error: result.error
        };
    }
    
    return results;
}

