import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ical from 'ical';

// Import shared utilities
import { loadCompetitionData, categorizeCompetitions } from '../lib/competition-utils.js';
import { OUTPUT_DIR, COMPETITIONS_FILE, getSettings } from '../lib/config.js';
import { withErrorHandling, logSuccess, logInfo } from '../lib/error-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'competitions.md');

/**
 * Build combined calendar URL with club calendar first and category-specific color
 */
async function buildCombinedCalendarUrl(competitions, categoryIndex = 0) {
    const competitionsWithCalendars = competitions.filter(comp =>
        comp.googleCalendar && comp.googleCalendar.calendarId
    );

    if (competitionsWithCalendars.length === 0) {
        return null;
    }

    // Define colors for different categories (cycle through these)
    const colors = [
        '%23285F9B',  // Royal blue
        '%23D50000',  // Red
        '%23008000',  // Green
        '%23FF8C00',  // Orange
        '%239C27B0',  // Purple
        '%23F09300',  // Amber
        '%230B8043',  // Dark green
        '%23E67C73'   // Coral
    ];

    let calendarSources = '';
    let colorParams = '';

    // Try to get club calendar from settings and add it first
    try {
        const settings = await getSettings();
        if (settings.clubCalendar && settings.clubCalendar.calendarId) {
            calendarSources += `&src=${encodeURIComponent(settings.clubCalendar.calendarId)}`;
            // Club calendar gets a neutral color (grey)
            colorParams += `&color=%23616161`;
        }
    } catch (error) {
        // Continue without club calendar if settings can't be loaded
    }

    // Add individual competition calendars with category-specific color
    const categoryColor = colors[categoryIndex % colors.length];

    competitionsWithCalendars.forEach(comp => {
        calendarSources += `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`;
        colorParams += `&color=${categoryColor}`;
    });

    return `https://calendar.google.com/calendar/embed?height=600&wkst=2&ctz=Australia%2FMelbourne&showPrint=0&showTz=0${calendarSources}${colorParams}`;
}

/**
 * Build combined calendar URL with mixed colors for all categories
 */
async function buildCombinedCalendarUrlWithMixedColors(categories) {
    // Define colors for different category types (cycle through these)
    const colors = [
        '%23285F9B',  // Royal blue
        '%23D50000',  // Red
        '%23008000',  // Green
        '%23FF8C00',  // Orange
        '%239C27B0',  // Purple
        '%23F09300',  // Amber
        '%230B8043',  // Dark green
        '%23E67C73'   // Coral
    ];

    let calendarSources = '';
    let colorParams = '';

    // Try to get club calendar from settings and add it first
    try {
        const settings = await getSettings();
        if (settings.clubCalendar && settings.clubCalendar.calendarId) {
            calendarSources += `&src=${encodeURIComponent(settings.clubCalendar.calendarId)}`;
            // Club calendar gets a neutral color (grey)
            colorParams += `&color=%23616161`;
        }
    } catch (error) {
        // Continue without club calendar if settings can't be loaded
    }

    let hasCalendars = false;
    let colorIndex = 0;

    // Add competitions from each category with cycling colors
    Object.keys(categories).forEach(categoryName => {
        const categoryColor = colors[colorIndex % colors.length];
        colorIndex++;

        categories[categoryName].forEach(comp => {
            if (comp.googleCalendar && comp.googleCalendar.calendarId) {
                calendarSources += `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`;
                colorParams += `&color=${categoryColor}`;
                hasCalendars = true;
            }
        });
    });

    if (!hasCalendars) {
        return null;
    }

    return `https://calendar.google.com/calendar/embed?height=600&wkst=2&ctz=Australia%2FMelbourne&showPrint=0&showTz=0${calendarSources}${colorParams}`;
}

/**
 * Generate index markdown content with all calendars
 */
async function generateIndexMarkdown(competitionsData, categories, activeCompetitions) {
    const { clubName, lastUpdated } = competitionsData;

    let markdown = `# ${clubName} - Competition Calendars\n\n`;
    markdown += `**Active Competitions:** ${activeCompetitions.length}  \n`;
    markdown += `**Last Updated:** ${new Date(lastUpdated).toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Get all competitions with calendars for combined view
    const allCompetitions = [];
    Object.keys(categories).forEach(category => {
        allCompetitions.push(...categories[category]);
    });

    const competitionsWithCalendars = allCompetitions.filter(comp =>
        comp.googleCalendar && comp.googleCalendar.calendarId
    );
    
    // Combined calendar view of ALL competitions
    if (competitionsWithCalendars.length > 0) {
        markdown += `## All Competitions - Combined Calendar View\n\n`;
        
        const combinedCalendarUrl = await buildCombinedCalendarUrlWithMixedColors(categories);
        
        if (combinedCalendarUrl) {
            markdown += `📅 **<a href="${combinedCalendarUrl}" target="_blank">View All Competitions Calendar</a>**\n\n`;
            markdown += `*Opens Google Calendar with all ${competitionsWithCalendars.length} competition calendars combined in one view.*\n\n`;
        }
        markdown += `---\n\n`;
    }
    

    // Add individual competition sections for each category
    let categoryIndex = 0;
    for (const [categoryName, competitions] of Object.entries(categories)) {
        if (competitions.length > 0) {
            markdown += `## ${categoryName}\n\n`;
            markdown += await formatCompetitionTable(competitions, categoryName, categoryIndex);
            markdown += `\n`;
            categoryIndex++;
        }
    }
    
    // Footer
    markdown += `---\n\n`;
    markdown += `*This documentation is automatically generated from competitions.json*  \n`;
    markdown += `*To update calendars, run: \`npm run process-fixture\`*\n`;
    
    return markdown;
}

/**
 * Format competitions as a table with combined calendar link
 */
async function formatCompetitionTable(competitions, categoryName, categoryIndex = 0) {
    // Filter competitions with calendars for combined link
    const competitionsWithCalendars = competitions.filter(comp =>
        comp.googleCalendar && comp.googleCalendar.calendarId
    );

    let content = '';

    // Add combined calendar link if there are competitions with calendars
    if (competitionsWithCalendars.length > 0) {
        const combinedCalendarUrl = await buildCombinedCalendarUrl(competitions, categoryIndex);

        if (combinedCalendarUrl) {
            content += `📅 **<a href="${combinedCalendarUrl}" target="_blank">View Combined ${categoryName} Calendar</a>**\n\n`;
            content += `*Opens Google Calendar with all ${competitionsWithCalendars.length} competition calendars in one view.*\n\n`;
        }
    }

    // Add individual competitions table
    let table = `| Competition | Fixture | Competition | Google Calendar | iCal Subscribe |\n`;
    table += `|-------------|----------|-------------|----------|----------------|\n`;

    // Sort competitions by name alphabetically
    const sortedCompetitions = [...competitions].sort((a, b) => a.name.localeCompare(b.name));

    for (const competition of sortedCompetitions) {
        const name = competition.name;

        // Fixture and Competition URL columns
        const fixtureCol = competition.fixtureUrl ?
            `<a href="${competition.fixtureUrl}" target="_blank">🏑 Fixture</a>` :
            `*Not available*`;

        const competitionCol = competition.competitionUrl ?
            `<a href="${competition.competitionUrl}" target="_blank">🏆 Competition</a>` :
            `*Not available*`;

        // Google Calendar columns
        let webViewCol;
        let icalCol;
        if (competition.googleCalendar) {
            if (competition.googleCalendar.publicUrl) {
                webViewCol = `<a href="${competition.googleCalendar.publicUrl}" target="_blank">📅 View</a>`;
            } else {
                webViewCol = `*Not available*`;
            }

            if (competition.googleCalendar.icalUrl) {
                icalCol = `<details><summary>📲 Subscribe</summary>Copy this link and paste it into your preferred calendar: ${competition.googleCalendar.icalUrl}</details>`;
            } else {
                icalCol = `*Not available*`;
            }
        } else {
            webViewCol = `*Not configured*`;
            icalCol = `*Not configured*`;
        }

        table += `| ${name} | ${fixtureCol} | ${competitionCol} | ${webViewCol} | ${icalCol} |\n`;
    }
    
    content += table + `\n`;
    return content;
}


/**
 * Get the latest event date from a competition's calendar file
 */
async function getLatestEventDate(competitionName) {
    try {
        // Try processed file first, fall back to downloads
        const processedFile = `temp/processed/${competitionName.replace(/[^a-z0-9]/gi, '_')}_processed.ics`;
        const downloadFile = `temp/downloads/${competitionName.replace(/[^a-z0-9]/gi, '_')}.ics`;

        let calendarFile;
        try {
            await fs.access(processedFile);
            calendarFile = processedFile;
        } catch {
            await fs.access(downloadFile);
            calendarFile = downloadFile;
        }

        const icalData = await fs.readFile(calendarFile, 'utf8');
        const parsedCal = ical.parseICS(icalData);

        let latestDate = null;

        for (const key in parsedCal) {
            const event = parsedCal[key];
            if (event.type === 'VEVENT' && event.start) {
                const eventDate = event.start instanceof Date ? event.start : new Date(event.start);
                if (!latestDate || eventDate > latestDate) {
                    latestDate = eventDate;
                }
            }
        }

        return latestDate;
    } catch (error) {
        // If calendar file doesn't exist or can't be read, return null
        return null;
    }
}

/**
 * Group competitions by their category from the website
 */
function groupByCategory(competitions) {
    const grouped = {};

    competitions.forEach(comp => {
        const category = comp.category || 'Uncategorized';

        if (!grouped[category]) {
            grouped[category] = [];
        }

        grouped[category].push(comp);
    });

    // Sort categories alphabetically
    const sortedCategories = {};
    Object.keys(grouped).sort().forEach(key => {
        sortedCategories[key] = grouped[key];
    });

    return sortedCategories;
}

/**
 * Filter competitions to only those with events in the future
 */
async function filterActiveCompetitions(competitions) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const results = await Promise.all(
        competitions.map(async (comp) => {
            const latestDate = await getLatestEventDate(comp.name);

            // Include if:
            // - No date found (calendar not available yet) OR
            // - Latest event is today or in the future
            if (!latestDate || latestDate >= today) {
                return comp;
            }
            return null;
        })
    );

    return results.filter(comp => comp !== null);
}

/**
 * Main function to generate documentation
 */
async function generateDocs() {
    logInfo('Starting documentation generation...');

    // Load competition data
    const competitionsData = await loadCompetitionData();

    logInfo(`Loaded ${competitionsData.competitions.length} competitions from ${COMPETITIONS_FILE}`);

    // Filter to only active competitions (isActive !== false)
    let activeCompetitions = competitionsData.competitions.filter(comp => comp.isActive !== false);
    logInfo(`Filtered to ${activeCompetitions.length} active competitions (by isActive flag)`);

    // Further filter to only competitions with current or future events
    activeCompetitions = await filterActiveCompetitions(activeCompetitions);
    logInfo(`Filtered to ${activeCompetitions.length} competitions with current or future events`);

    // Group competitions by their actual category from the website
    const categories = groupByCategory(activeCompetitions);

    // Print category summary
    logInfo(`Found competitions by category:`);
    Object.keys(categories).forEach(category => {
        console.log(`  - ${category}: ${categories[category].length}`);
    });
    
    // Generate index markdown
    logInfo('Generating index markdown...');
    const indexMarkdown = await generateIndexMarkdown(competitionsData, categories, activeCompetitions);
    
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // Write index markdown file
    await fs.writeFile(OUTPUT_FILE, indexMarkdown, 'utf8');
    logSuccess(`Index documentation generated: ${OUTPUT_FILE}`);
    
    
    logInfo(`Total active competitions documented: ${activeCompetitions.length}`);
}

/**
 * Show help information
 */
function showHelp() {
    console.log(`
📖 Competition Documentation Generator

Generates markdown documentation for competitions with Google Calendar links

Usage:
  npm run generate-docs [-- options]

Options:
  --help, -h       Show this help message

Examples:
  npm run generate-docs                    # Generate competition documentation
  npm run generate-docs -- --help         # Show this help

Process:
  1. Reads competition data from ${COMPETITIONS_FILE}
  2. Categorizes competitions by type (Men's, Women's, Midweek, Juniors)
  3. Generates markdown documentation with Google Calendar links
  4. Saves output to ${OUTPUT_FILE}

Requirements:
  • ${COMPETITIONS_FILE} must exist (run npm run scrape-competitions first)
  • Google Calendars should be created (run npm run create-calendars)

Output Format:
  • Organized by competition category
  • Table format with competition names and calendar subscribe links
  • Competitions maintain order from JSON file
`);
}

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        help: false
    };
    
    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        }
    }
    
    return options;
}

/**
 * Main execution
 */
async function main() {
    const options = parseArguments();
    
    if (options.help) {
        showHelp();
        return;
    }
    
    await generateDocs();
}

// Run if called directly
if (process.argv[1] === __filename) {
    await withErrorHandling(main, 'generate-docs')();
}

export { generateDocs, categorizeCompetitions };