import fs from 'fs/promises';
import path from 'path';
import ical from 'ical';

const FIXTURE_BASE_URL = 'https://www.hockeyvictoria.org.au/games/team/';

/**
 * Load configuration files
 */
async function loadConfig() {
    const clubMappings = JSON.parse(
        await fs.readFile('./config/club-mappings.json', 'utf8')
    );
    const competitionNames = JSON.parse(
        await fs.readFile('./config/competition-names.json', 'utf8')
    );
    return { clubMappings, competitionNames };
}

/**
 * Replace club names with abbreviations
 */
function replaceClubNames(text, clubMappings) {
    let result = text;
    for (const [fullName, abbreviation] of Object.entries(clubMappings.clubMappings)) {
        result = result.replace(new RegExp(fullName, 'g'), abbreviation);
    }
    return result;
}

/**
 * Replace competition names
 */
function replaceCompetitionNames(text, competitionReplacements) {
    let result = text;
    const currentYear = new Date().getFullYear().toString();
    
    for (const replacement of competitionReplacements) {
        const pattern = replacement.pattern.replace('{{YEAR}}', currentYear);
        result = result.replace(new RegExp(pattern, 'g'), replacement.replacement);
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
 * Generate event description
 */
function generateDescription(competitionId, category, calendarLinks) {
    const fixtureUrl = `${FIXTURE_BASE_URL}${competitionId}`;
    const links = calendarLinks[category];
    
    let description = `Team Fixture: ${fixtureUrl}\n\nOther Calendars\n`;
    
    if (links) {
        for (const [key, url] of Object.entries(links)) {
            if (key !== 'combined') {
                const division = key.replace('_', ' ');
                description += `- ${division}: ${url}\n`;
            }
        }
        if (links.combined) {
            description += `\n- All Combined: ${links.combined}\n`;
        }
    }
    
    description += `\nLast Updated: ${new Date().toISOString()}`;
    
    return description;
}

/**
 * Process a single calendar file
 */
export async function processCalendar(inputPath, outputPath, competition, calendarLinks) {
    console.log(`Processing calendar: ${inputPath}`);
    
    const config = await loadConfig();
    const icalData = await fs.readFile(inputPath, 'utf8');
    const parsedCal = ical.parseICS(icalData);
    
    // Build new iCal file
    let processedCal = 'BEGIN:VCALENDAR\n';
    processedCal += 'VERSION:2.0\n';
    processedCal += 'PRODID:-//Hockey Victoria Calendar Scraper//EN\n';
    processedCal += 'CALSCALE:GREGORIAN\n';
    processedCal += 'METHOD:PUBLISH\n';
    
    for (const key in parsedCal) {
        const event = parsedCal[key];
        if (event.type === 'VEVENT') {
            // Process summary
            let summary = event.summary || '';
            summary = replaceClubNames(summary, config.clubMappings);
            summary = replaceCompetitionNames(summary, config.competitionNames.competitionReplacements);
            summary = replaceRoundNames(summary, config.competitionNames.roundPatterns);
            
            // Generate description
            const description = generateDescription(
                competition.competitionId,
                competition.category,
                calendarLinks
            );
            
            // Build event
            processedCal += 'BEGIN:VEVENT\n';
            processedCal += `UID:${event.uid}\n`;
            processedCal += `DTSTART:${formatDateTime(event.start)}\n`;
            processedCal += `DTEND:${formatDateTime(event.end)}\n`;
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
    
    console.log(`Processed calendar saved to: ${outputPath}`);
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
export async function processAllCalendars(downloadResults, outputDir, calendarLinks) {
    const results = {};
    
    for (const [name, result] of Object.entries(downloadResults)) {
        if (result.success && result.path) {
            const outputFileName = `${name.replace(/[^a-z0-9]/gi, '_')}_processed.ics`;
            const outputPath = path.join(outputDir, outputFileName);
            
            try {
                const processedPath = await processCalendar(
                    result.path,
                    outputPath,
                    result.competition,
                    calendarLinks
                );
                
                results[name] = {
                    success: true,
                    processedPath,
                    competition: result.competition
                };
            } catch (error) {
                console.error(`Error processing ${name}: ${error.message}`);
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