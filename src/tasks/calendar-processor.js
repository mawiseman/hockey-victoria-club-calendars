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
export async function loadConfig() {
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
export function replaceClubNames(text, clubMappings) {
    let result = text;
    const originalText = text;

    // Escape special regex characters in club name
    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    for (const [fullName, abbreviation] of Object.entries(clubMappings.clubMappings)) {
        const escapedName = escapeRegex(fullName);

        // Replace club names followed by optional team suffix (space + word/number)
        // This handles any suffix pattern without hardcoding them
        const patternWithSuffix = new RegExp(`${escapedName}( [A-Za-z0-9]+)?\\b`, 'g');
        result = result.replace(patternWithSuffix, (match, suffix) => {
            return suffix ? `${abbreviation}${suffix}` : abbreviation;
        });
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
export function replaceCompetitionNames(text, competitionReplacements) {
    let result = text;
    const originalText = text;
    const currentYear = new Date().getFullYear().toString();

    for (const replacement of competitionReplacements) {
        let pattern = replacement.pattern;

        // Replace {{YEAR}} variable (replace all occurrences)
        pattern = pattern.replace(/\{\{YEAR\}\}/g, currentYear);

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

    // Normalize whitespace - collapse multiple spaces to single space
    result = result.replace(/\s+/g, ' ').trim();

    // Check if any replacements were made
    if (result === originalText) {
        logWarning(`No competition name mappings found for: "${originalText}"`);
    }

    return result;
}

/**
 * Replace round names using regex patterns
 */
export function replaceRoundNames(text, roundPatterns) {
    let result = text;

    for (const pattern of roundPatterns) {
        result = result.replace(new RegExp(pattern.regex, 'g'), pattern.replacement);
    }

    return result;
}

/**
 * Detect gender from original summary
 */
export function detectGender(text) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes("women") || lowerText.includes("girls")) {
        return "Women";
    }
    if (lowerText.includes("men") || lowerText.includes("boys")) {
        return "Men";
    }
    return null;
}

/**
 * Add gender prefix to competitions that need it
 */
export function addGenderPrefix(text, originalSummary) {
    const gender = detectGender(originalSummary);
    if (!gender) return text;

    // Remove trailing gender terms (Men/Women) that might already be present
    const cleanedText = text.replace(/\s+(Men|Women)(\s|$)/, '$2');

    // List of competition abbreviations that need gender prefix
    const needsGenderPrefix = [
        /^(PL|PLR|PEN [A-E]|M1|M2)\s/,
        /^Indoor (League )?\d+/
    ];

    for (const pattern of needsGenderPrefix) {
        if (pattern.test(cleanedText)) {
            // Add "League" if it's Indoor without it
            let result = cleanedText;
            if (/^Indoor \d+/.test(result)) {
                result = result.replace(/^Indoor (\d+)/, 'Indoor League $1');
            }
            return `${gender} ${result}`;
        }
    }

    return text;
}

/**
 * Extract round number from event summary, returns null for finals or unknown rounds
 */
function extractRoundFromSummary(summary, maxRegularRound = 0) {
    // First check for regular rounds - use word boundary to avoid matching "Under 12"
    const roundMatches = summary.match(/\b(?:Round|Rd)\s+(\d+)/i);
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
            const roundMatches = event.summary.match(/\b(?:Round|Rd)\s+(\d+)/i);
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
 * Parse raw iCal data to extract original datetime strings
 * This avoids timezone conversion issues
 */
function parseRawICalEvents(icalData) {
    const events = {};
    const eventBlocks = icalData.split('BEGIN:VEVENT');

    for (let i = 1; i < eventBlocks.length; i++) {
        const eventText = eventBlocks[i].split('END:VEVENT')[0];
        const lines = eventText.split(/\r?\n/);

        let uid = null;
        let dtstart = null;

        for (const line of lines) {
            if (line.startsWith('UID:')) {
                uid = line.substring(4).trim();
            } else if (line.startsWith('DTSTART')) {
                // Extract the datetime value after the colon
                // Format: DTSTART;TZID=Australia/Melbourne:20250414T201500
                const colonIndex = line.indexOf(':');
                if (colonIndex !== -1) {
                    dtstart = line.substring(colonIndex + 1).trim();
                }
            }
        }

        if (uid && dtstart) {
            events[uid] = { dtstart };
        }
    }

    return events;
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
    const gameDuration = competition.matchDuration || 90;

    // Parse original iCal to extract raw datetime strings
    const rawEvents = parseRawICalEvents(icalData);
    
    // Build new iCal file
    let processedCal = 'BEGIN:VCALENDAR\n';
    processedCal += 'VERSION:2.0\n';
    processedCal += 'PRODID:-//Hockey Victoria Calendar Scraper//EN\n';
    /*
    processedCal += 'CALSCALE:GREGORIAN\n';
    processedCal += 'METHOD:PUBLISH\n';
    
    // Add Australia/Melbourne timezone definition
    processedCal += 'BEGIN:VTIMEZONE\n';
    processedCal += 'TZID:Australia/Melbourne\n';
    processedCal += 'BEGIN:STANDARD\n';
    processedCal += 'DTSTART:20070401T030000\n';
    processedCal += 'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU\n';
    processedCal += 'TZNAME:AEST\n';
    processedCal += 'END:STANDARD\n';
    processedCal += 'BEGIN:DAYLIGHT\n';
    processedCal += 'DTSTART:20071007T020000\n';
    processedCal += 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU\n';
    processedCal += 'TZNAME:AEDT\n';
    processedCal += 'END:DAYLIGHT\n';
    processedCal += 'END:VTIMEZONE\n';
    */
   
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
            summary = addGenderPrefix(summary, originalSummary);
            
            // Generate description
            const description = await generateDescription(competition, roundNumber);
            
            // Get the original datetime string to preserve timezone handling
            const rawEvent = rawEvents[event.uid];
            if (!rawEvent || !rawEvent.dtstart) {
                logWarning(`Skipping event with missing raw datetime: ${summary}`);
                continue;
            }

            // Use the original DTSTART value directly
            const originalDtstart = rawEvent.dtstart;

            // Calculate DTEND by adding game duration to DTSTART
            // Parse the datetime string: YYYYMMDDTHHMMSS
            const year = parseInt(originalDtstart.substring(0, 4));
            const month = parseInt(originalDtstart.substring(4, 6)) - 1; // 0-indexed
            const day = parseInt(originalDtstart.substring(6, 8));
            const hour = parseInt(originalDtstart.substring(9, 11));
            const minute = parseInt(originalDtstart.substring(11, 13));
            const second = parseInt(originalDtstart.substring(13, 15)) || 0;

            // Create a date object for calculation purposes only
            const startDate = new Date(year, month, day, hour, minute, second);
            const endDate = new Date(startDate.getTime() + (gameDuration * 60 * 1000));

            // Format end date/time in the same format as the original
            const endYear = endDate.getFullYear();
            const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
            const endDay = String(endDate.getDate()).padStart(2, '0');
            const endHour = String(endDate.getHours()).padStart(2, '0');
            const endMinute = String(endDate.getMinutes()).padStart(2, '0');
            const endSecond = String(endDate.getSeconds()).padStart(2, '0');
            const originalDtend = `${endYear}${endMonth}${endDay}T${endHour}${endMinute}${endSecond}`;

            // Build event using TZID format (same as source)
            processedCal += 'BEGIN:VEVENT\n';
            processedCal += `UID:${event.uid}\n`;
            processedCal += `DTSTART;TZID=Australia/Melbourne:${originalDtstart}\n`;
            processedCal += `DTEND;TZID=Australia/Melbourne:${originalDtend}\n`;
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
 * Format date/time for iCal in local time format (without Z)
 */
function formatDateTimeLocal(date) {
    if (!date) return '';

    const d = date instanceof Date ? date : new Date(date);

    // Format as iCal local datetime: YYYYMMDDTHHMMSS (no Z)
    // Use UTC methods because the date object already represents local time components
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hour = String(d.getUTCHours()).padStart(2, '0');
    const minute = String(d.getUTCMinutes()).padStart(2, '0');
    const second = String(d.getUTCSeconds()).padStart(2, '0');

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