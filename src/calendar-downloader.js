import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

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
    
    console.log(`Downloading calendar from: ${url}`);
    
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
        
        console.log(`Calendar saved to: ${outputPath}`);
        return true;
    } catch (error) {
        console.error(`Error downloading calendar: ${error.message}`);
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
        
        console.log(`\nProcessing: ${competition.name}`);
        
        // Handle both old format (competitionTeamId) and new format (fixtureUrl)
        const teamIdOrUrl = competition.fixtureUrl || competition.competitionTeamId;
        
        if (!teamIdOrUrl) {
            console.error(`No fixture URL or competition team ID found for: ${competition.name}`);
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

/**
 * Load competitions from competitions.json
 * @param {string} filePath - Path to the competitions file
 * @returns {Promise<Array>} - Array of competition objects
 */
export async function loadFootscrayCompetitions(filePath = 'config/competitions.json') {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const competitionsData = JSON.parse(data);
        
        if (!competitionsData.competitions || !Array.isArray(competitionsData.competitions)) {
            throw new Error('Invalid competition data format - missing competitions array');
        }
        
        console.log(`Loaded ${competitionsData.competitions.length} competitions from ${filePath}`);
        console.log(`Data scraped at: ${competitionsData.scrapedAt}`);
        console.log(`Last updated: ${competitionsData.lastUpdated}`);
        
        return competitionsData.competitions;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Competition file not found: ${filePath}. Run the competition scraper first.`);
        }
        throw error;
    }
}

/**
 * Load competitions from legacy competitions.json format
 * @param {string} filePath - Path to the competitions file
 * @returns {Promise<Array>} - Array of competition objects
 */
export async function loadLegacyCompetitions(filePath = 'config/competitions.json') {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const competitionsData = JSON.parse(data);
        
        if (!competitionsData.competitions || !Array.isArray(competitionsData.competitions)) {
            throw new Error('Invalid competition data format - missing competitions array');
        }
        
        console.log(`Loaded ${competitionsData.competitions.length} competitions from ${filePath}`);
        
        return competitionsData.competitions;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Competition file not found: ${filePath}`);
        }
        throw error;
    }
}