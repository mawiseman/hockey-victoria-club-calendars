import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const ICAL_BASE_URL = 'https://www.hockeyvictoria.org.au/games/team/export/ical/';

/**
 * Downloads an iCal calendar from Hockey Victoria
 * @param {string} competitionTeamId - The competition ID
 * @param {string} outputPath - Path to save the downloaded calendar
 * @returns {Promise<boolean>} - Success status
 */
export async function downloadCalendar(competitionTeamId, outputPath) {
    const url = `${ICAL_BASE_URL}${competitionTeamId}`;
    
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
        const success = await downloadCalendar(competition.competitionTeamId, outputPath);
        
        results[competition.name] = {
            success,
            path: success ? outputPath : null,
            competition
        };
    }
    
    return results;
}