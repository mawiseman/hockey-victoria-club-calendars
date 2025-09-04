import fs from 'fs/promises';
import path from 'path';
import ical from 'ical';

// Import shared utilities
import { MAPPINGS_CLUB_FILE, MAPPINGS_COMPETITION_FILE, getSettings } from '../lib/config.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';

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
 * Extract round number from event summary, returns null for finals or unknown rounds
 */
function extractRoundFromSummary(summary, maxRegularRound = 0) {
    // First check for regular rounds
    const roundMatches = summary.match(/(?:Round|R|Rd)\s*(\d+)/i);
    if (roundMatches) {
        return parseInt(roundMatches[1], 10);
    }
    
    // Check for finals - return null as we don't want round links for finals
    const finalsOrder = [
        'Elimination Final',
        'Semi Final', 
        'Preliminary Final',
        'Grand Final'
    ];
    
    const summaryLower = summary.toLowerCase();
    
    for (let i = 0; i < finalsOrder.length; i++) {
        const finalType = finalsOrder[i].toLowerCase();
        if (summaryLower.includes(finalType)) {
            return null; // Don't include round links for finals
        }
    }
    
    // Return null if no round found - don't include round link
    return null;
}

/**
 * Find the highest regular round number in all events
 */
function findMaxRegularRound(parsedCal) {
    let maxRound = 0;
    
    for (const key in parsedCal) {
        const event = parsedCal[key];
        if (event.type === 'VEVENT' && event.summary) {
            const roundMatches = event.summary.match(/(?:Round|R|Rd)\s*(\d+)/i);
            if (roundMatches) {
                const roundNumber = parseInt(roundMatches[1], 10);
                maxRound = Math.max(maxRound, roundNumber);
            }
        }
    }
    
    return maxRound;
}

/**
 * Generate event description
 */
async function generateDescription(competition, roundNumber) {
    let description = '';
    
    // New format - use the URLs directly
    description += `Full Fixture: ${competition.fixtureUrl}\n\n`;
    
    if (competition.ladderUrl) {
        description += `Ladder: ${competition.ladderUrl}\n\n`;
    }
    
    // Extract competition ID from ladder URL for round URL (only for regular rounds)
    if (competition.ladderUrl && roundNumber !== null) {
        const ladderMatch = competition.ladderUrl.match(/\/pointscore\/(\d+\/\d+)/);
        if (ladderMatch) {
            const competitionId = ladderMatch[1]; // This will be "21935/37286"
            const roundUrl = `${ROUND_BASE_URL}${competitionId}/round/${roundNumber}`;
            description += `Current Round: ${roundUrl}\n`;
        }
    }
    
    // Add calendars homepage from settings
    try {
        const settings = await getSettings();
        if (settings.calendarsHomepage) {
            description += `\n\nCalendars Homepage: ${settings.calendarsHomepage}\n`;
        }
    } catch (error) {
        logWarning('Could not load settings for calendarsHomepage');
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
    
    // Add Australia/Melbourne timezone definition
    processedCal += 'BEGIN:VTIMEZONE\n';
    processedCal += 'TZID:Australia/Melbourne\n';
    processedCal += 'BEGIN:STANDARD\n';
    processedCal += 'DTSTART:20070401T030000\n';
    processedCal += 'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU\n';
    processedCal += 'TZNAME:AEST\n';
    processedCal += 'TZOFFSETFROM:+1100\n';
    processedCal += 'TZOFFSETTO:+1000\n';
    processedCal += 'END:STANDARD\n';
    processedCal += 'BEGIN:DAYLIGHT\n';
    processedCal += 'DTSTART:20071007T020000\n';
    processedCal += 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU\n';
    processedCal += 'TZNAME:AEDT\n';
    processedCal += 'TZOFFSETFROM:+1000\n';
    processedCal += 'TZOFFSETTO:+1100\n';
    processedCal += 'END:DAYLIGHT\n';
    processedCal += 'END:VTIMEZONE\n';
    
    // First pass: find the maximum regular round number
    const maxRegularRound = findMaxRegularRound(parsedCal);
    
    for (const key in parsedCal) {
        const event = parsedCal[key];
        if (event.type === 'VEVENT') {
            // Validate event has required fields
            if (!event.start || !event.uid) {
                logWarning(`Skipping event missing required fields: ${event.summary || 'Unknown'}`);
                continue;
            }
            
            // Extract round from original summary before processing
            const originalSummary = event.summary || '';
            const roundNumber = extractRoundFromSummary(originalSummary, maxRegularRound);
            
            // Process summary
            let summary = originalSummary;
            summary = replaceClubNames(summary, config.clubMappings);
            summary = replaceCompetitionNames(summary, config.competitionNames.competitionReplacements);
            summary = replaceRoundNames(summary, config.competitionNames.roundPatterns);
            
            // Generate description
            const description = await generateDescription(competition, roundNumber);
            
            // Handle start time - preserve timezone information
            let startDate;
            if (event.start instanceof Date) {
                startDate = new Date(event.start);
            } else {
                startDate = new Date(event.start);
            }
            
            // Validate start date
            if (isNaN(startDate.getTime())) {
                logWarning(`Skipping event with invalid start date: ${summary} - Start: ${event.start}`);
                continue;
            }
            
            // The original event.start should already be in the correct timezone
            // We just need to calculate the end time by adding duration
            const endDate = new Date(startDate.getTime() + (gameDuration * 60 * 1000));
            
            // Convert both times to Melbourne timezone for iCal output
            const melbourneStart = convertToMelbourneTime(startDate);
            const melbourneEnd = convertToMelbourneTime(endDate);
            
            // Validate that end time is after start time
            if (endDate <= startDate) {
                logWarning(`Skipping event with invalid time range: ${summary} - Duration: ${gameDuration} minutes`);
                continue;
            }
            
            // Build event
            processedCal += 'BEGIN:VEVENT\n';
            processedCal += `UID:${event.uid}\n`;
            processedCal += `DTSTART;TZID=Australia/Melbourne:${formatDateTime(melbourneStart)}\n`;
            processedCal += `DTEND;TZID=Australia/Melbourne:${formatDateTime(melbourneEnd)}\n`;
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
 * Convert a Date to Melbourne timezone, returning a new Date object
 * that represents the Melbourne local time
 */
function convertToMelbourneTime(date) {
    if (!date) return null;
    
    const d = date instanceof Date ? date : new Date(date);
    
    // Get the Melbourne time components
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const parts = formatter.formatToParts(d);
    const partsMap = {};
    parts.forEach(part => {
        partsMap[part.type] = part.value;
    });
    
    // Create a new Date representing the Melbourne local time
    // Note: This creates a Date object where the UTC time equals the Melbourne local time
    return new Date(`${partsMap.year}-${partsMap.month}-${partsMap.day}T${partsMap.hour}:${partsMap.minute}:${partsMap.second}`);
}

/**
 * Format date/time for iCal in local time format
 */
function formatDateTime(date) {
    if (!date) return '';
    
    const d = date instanceof Date ? date : new Date(date);
    
    // Format as iCal datetime: YYYYMMDDTHHMMSS
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    const second = String(d.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}T${hour}${minute}${second}`;
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