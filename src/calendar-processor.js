import fs from 'fs/promises';
import path from 'path';
import ical from 'ical';

// Import shared utilities
import { MAPPINGS_CLUB_FILE, MAPPINGS_COMPETITION_FILE } from '../shared/config.js';
import { logSuccess, logWarning, logInfo } from '../shared/error-utils.js';

const FIXTURE_BASE_URL = 'https://www.hockeyvictoria.org.au/games/team/';
const LADDER_BASE_URL = 'https://www.hockeyvictoria.org.au/pointscore/';
const ROUND_BASE_URL = 'https://www.hockeyvictoria.org.au/games/';

/**
 * Load configuration files
 */
async function loadConfig() {
    const clubMappings = JSON.parse(
        await fs.readFile(MAPPINGS_CLUB_FILE, 'utf8')
    );
    const competitionNames = JSON.parse(
        await fs.readFile(MAPPINGS_COMPETITION_FILE, 'utf8')
    );
    return { clubMappings, competitionNames };
}

/**
 * Replace club names with abbreviations
 */
function replaceClubNames(text, clubMappings) {
    let result = text;
    const originalText = text;
    
    for (const [fullName, abbreviation] of Object.entries(clubMappings.clubMappings)) {
        result = result.replace(new RegExp(fullName, 'g'), abbreviation);
    }
    
    // Check if any replacements were made
    if (result === originalText) {
        logWarning(`No club name mappings found for: "${originalText}"`);
    }
    
    return result;
}

/**
 * Replace competition names
 */
function replaceCompetitionNames(text, competitionReplacements) {
    let result = text;
    const originalText = text;
    const currentYear = new Date().getFullYear().toString();
    
    for (const replacement of competitionReplacements) {
        let pattern = replacement.pattern;
        
        // Replace {{YEAR}} variable
        pattern = pattern.replace('{{YEAR}}', currentYear);
        
        // Replace {{GENDER}} variable with both Men's and Women's options
        if (pattern.includes('{{GENDER}}')) {
            const menPattern = pattern.replace('{{GENDER}}', "Men's");
            const womenPattern = pattern.replace('{{GENDER}}', "Women's");
            
            const menReplacement = replacement.replacement.replace('{{GENDER}}', 'Men');
            const womenReplacement = replacement.replacement.replace('{{GENDER}}', 'Women');
            
            result = result.replace(new RegExp(menPattern, 'g'), menReplacement);
            result = result.replace(new RegExp(womenPattern, 'g'), womenReplacement);
        } else {
            result = result.replace(new RegExp(pattern, 'g'), replacement.replacement);
        }
    }
    
    // Check if any replacements were made
    if (result === originalText) {
        logWarning(`No competition name mappings found for: "${originalText}"`);
    }
    
    return result;
}

/**
 * Replace round names using regex patterns
 */
function replaceRoundNames(text, roundPatterns) {
    let result = text;
    
    for (const pattern of roundPatterns) {
        result = result.replace(new RegExp(pattern.regex, 'g'), pattern.replacement);
    }
    
    return result;
}

/**
 * Extract round number from event summary
 */
function extractRoundFromSummary(summary) {
    // Look for patterns like "Round 1", "R1", "Rd 5", etc.
    const roundMatches = summary.match(/(?:Round|R|Rd)\s*(\d+)/i);
    return roundMatches ? roundMatches[1] : '1'; // Default to round 1 if not found
}

/**
 * Generate event description
 */
function generateDescription(competition, roundNumber) {
    let description = '';
    
    // Handle both old format (competitionTeamId/competitionId) and new format (URLs)
    if (competition.fixtureUrl) {
        // New format - use the URLs directly
        description += `Full Fixture: ${competition.fixtureUrl}\n`;
        
        if (competition.ladderUrl) {
            description += `Ladder: ${competition.ladderUrl}\n`;
        }
        
        // Extract competition ID from ladder URL for round URL
        if (competition.ladderUrl) {
            const ladderMatch = competition.ladderUrl.match(/\/pointscore\/(\d+\/\d+)/);
            if (ladderMatch) {
                const competitionId = ladderMatch[1]; // This will be "21935/37286"
                const roundUrl = `${ROUND_BASE_URL}${competitionId}/round/${roundNumber}`;
                description += `Current Round: ${roundUrl}\n`;
            }
        }
    } else if (competition.competitionTeamId && competition.competitionId) {
        // Legacy format - construct URLs
        const fixtureUrl = `${FIXTURE_BASE_URL}${competition.competitionTeamId}`;
        const ladderUrl = `${LADDER_BASE_URL}${competition.competitionId}`;
        const roundUrl = `${ROUND_BASE_URL}${competition.competitionId}/${roundNumber}`;
        
        description += `Full Fixture: ${fixtureUrl}\n\n`;
        description += `Current Round: ${roundUrl}\n\n`;
        description += `Ladder: ${ladderUrl}\n\n`;
    }
    
    description += `\n\nLast Updated: ${new Date().toISOString()}`;
    
    return description;
}

/**
 * Process a single calendar file
 */
export async function processCalendar(inputPath, outputPath, competition) {
    logInfo(`Processing calendar: ${inputPath}`);
    
    const config = await loadConfig();
    const icalData = await fs.readFile(inputPath, 'utf8');
    const parsedCal = ical.parseICS(icalData);
    
    // Get game duration for this competition (default to 90 minutes if not specified)
    const gameDuration = competition.gameDuration || 90;
    
    // Build new iCal file
    let processedCal = 'BEGIN:VCALENDAR\n';
    processedCal += 'VERSION:2.0\n';
    processedCal += 'PRODID:-//Hockey Victoria Calendar Scraper//EN\n';
    processedCal += 'CALSCALE:GREGORIAN\n';
    processedCal += 'METHOD:PUBLISH\n';
    
    for (const key in parsedCal) {
        const event = parsedCal[key];
        if (event.type === 'VEVENT') {
            // Extract round from original summary before processing
            const originalSummary = event.summary || '';
            const roundNumber = extractRoundFromSummary(originalSummary);
            
            // Process summary
            let summary = originalSummary;
            summary = replaceClubNames(summary, config.clubMappings);
            summary = replaceCompetitionNames(summary, config.competitionNames.competitionReplacements);
            summary = replaceRoundNames(summary, config.competitionNames.roundPatterns);
            
            // Generate description
            const description = generateDescription(competition, roundNumber);
            
            // Calculate end time based on game duration
            const startDate = new Date(event.start);
            const endDate = new Date(startDate.getTime() + (gameDuration * 60 * 1000));
            
            // Build event
            processedCal += 'BEGIN:VEVENT\n';
            processedCal += `UID:${event.uid}\n`;
            processedCal += `DTSTART:${formatDateTime(startDate)}\n`;
            processedCal += `DTEND:${formatDateTime(endDate)}\n`;
            processedCal += `SUMMARY:${summary}\n`;
            processedCal += `DESCRIPTION:${description.replace(/\n/g, '\\n')}\n`;
            
            if (event.location) {
                processedCal += `LOCATION:${event.location}\n`;
            }
            
            processedCal += 'END:VEVENT\n';
        }
    }
    
    processedCal += 'END:VCALENDAR\n';
    
    // Save processed calendar
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, processedCal, 'utf8');
    
    logSuccess(`Processed calendar saved to: ${outputPath}`);
    return outputPath;
}

/**
 * Format date/time for iCal
 */
function formatDateTime(date) {
    if (!date) return '';
    
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hour = String(d.getUTCHours()).padStart(2, '0');
    const minute = String(d.getUTCMinutes()).padStart(2, '0');
    const second = String(d.getUTCSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

/**
 * Process all downloaded calendars
 */
export async function processAllCalendars(downloadResults, outputDir) {
    const results = {};
    
    for (const [name, result] of Object.entries(downloadResults)) {
        if (result.success && result.path) {
            const outputFileName = `${name.replace(/[^a-z0-9]/gi, '_')}_processed.ics`;
            const outputPath = path.join(outputDir, outputFileName);
            
            try {
                const processedPath = await processCalendar(
                    result.path,
                    outputPath,
                    result.competition
                );
                
                results[name] = {
                    success: true,
                    processedPath,
                    competition: result.competition
                };
            } catch (error) {
                logWarning(`Error processing ${name}: ${error.message}`);
                results[name] = {
                    success: false,
                    error: error.message,
                    competition: result.competition
                };
            }
        } else {
            results[name] = {
                success: false,
                error: 'Download failed',
                competition: result.competition
            };
        }
    }
    
    return results;
}