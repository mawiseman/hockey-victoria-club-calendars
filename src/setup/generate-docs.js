import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ical from 'ical';

// Import shared utilities
import { loadCompetitionData, categorizeCompetitions } from '../lib/competition-utils.js';
import { OUTPUT_DIR, COMPETITIONS_FILE, getSettings, getClubName } from '../lib/config.js';
import { withErrorHandling, logSuccess, logInfo } from '../lib/error-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'competitions.md');
const OUTPUT_FILE_MOBILE = path.join(OUTPUT_DIR, 'competitions-mobile.md');

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
    const clubName = await getClubName();
    const lastUpdated = competitionsData.lastUpdated || competitionsData.scrapedAt || new Date().toISOString();

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
 * Generate mobile-friendly markdown with card-style layout
 */
async function generateMobileMarkdown(competitionsData, categories, activeCompetitions) {
    const clubName = await getClubName();
    const lastUpdated = competitionsData.lastUpdated || competitionsData.scrapedAt || new Date().toISOString();

    let md = `# ${clubName}\n\n`;
    md += `**${activeCompetitions.length} Active Competitions** | Updated ${new Date(lastUpdated).toLocaleDateString()}\n\n`;

    // Combined calendar link
    const combinedUrl = await buildCombinedCalendarUrlWithMixedColors(categories);
    if (combinedUrl) {
        md += `> **<a href="${combinedUrl}" target="_blank">View All Competitions Calendar</a>**\n\n`;
    }

    // Table of contents
    for (const [categoryName, competitions] of Object.entries(categories)) {
        if (competitions.length === 0) continue;
        const anchor = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
        md += `**[${categoryName}](#${anchor})**  \n`;
        const sorted = competitions;
        for (const comp of sorted) {
            const compAnchor = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
            md += `- [${comp.name}](#${compAnchor})  \n`;
        }
        md += `\n`;
    }

    md += `---\n\n`;

    let categoryIndex = 0;
    for (const [categoryName, competitions] of Object.entries(categories)) {
        if (competitions.length === 0) continue;

        md += `## ${categoryName}\n\n`;

        // Combined category calendar link
        const categoryUrl = await buildCombinedCalendarUrl(competitions, categoryIndex);
        if (categoryUrl) {
            md += `> 📅 **<a href="${categoryUrl}" target="_blank">View All ${categoryName} Fixtures</a>**\n\n`;
        }

        // Sort competitions by name
        const sorted = competitions;

        for (const comp of sorted) {
            md += `### ${comp.name}\n\n`;

            // Links line
            const links = [];
            if (comp.fixtureUrl) {
                links.push(`<a href="${comp.fixtureUrl}" target="_blank">🏑 Fixture</a>`);
            }
            if (comp.competitionUrl) {
                links.push(`<a href="${comp.competitionUrl}" target="_blank">🏆 Competition</a>`);
            }
            if (comp.googleCalendar?.publicUrl) {
                links.push(`<a href="${comp.googleCalendar.publicUrl}" target="_blank">📅 Google Calendar</a>`);
            }
            if (links.length > 0) {
                md += links.join(' | ') + '\n\n';
            }

            // Subscribe link with instructions
            if (comp.googleCalendar?.icalUrl) {
                md += `<details><summary>Subscribe using iOS Calendar</summary>\n\n`;
                md += `1. Go to **Settings > Calendar > Accounts**\n`;
                md += `2. Tap **Add Account > Other**\n`;
                md += `3. Tap **Add Subscribed Calendar**\n`;
                md += `4. Paste the URL below and tap **Next**\n\n`;
                md += `\`\`\`\n${comp.googleCalendar.icalUrl}\n\`\`\`\n\n`;
                md += `</details>\n\n`;
                md += `<details><summary>Subscribe using Google Calendar</summary>\n\n`;
                md += `1. Open the <a href="${comp.googleCalendar.publicUrl}" target="_blank">Google Calendar link</a>\n`;
                md += `2. On mobile, tap the **+** button in the bottom right corner\n`;
                md += `3. On desktop, click **Add to Google Calendar** at the bottom of the page\n\n`;
                md += `</details>\n\n`;
            }
        }

        md += `---\n\n`;
        categoryIndex++;
    }

    md += `*Automatically generated from competitions.json*\n`;

    return md;
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
    let table = `| Competition | Fixture | Competition | Google Calendar | Subscribe |\n`;
    table += `|-------------|----------|-------------|----------|----------------|\n`;

    for (const competition of competitions) {
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
        let subscribeCol;
        if (competition.googleCalendar) {
            if (competition.googleCalendar.publicUrl) {
                webViewCol = `<a href="${competition.googleCalendar.publicUrl}" target="_blank">📅 View</a>`;
            } else {
                webViewCol = `*Not available*`;
            }

            if (competition.googleCalendar.publicUrl || competition.googleCalendar.icalUrl) {
                let subscribeHtml = `<details><summary>📲 Subscribe</summary>`;
                if (competition.googleCalendar.publicUrl) {
                    subscribeHtml += `<br><b>Google Calendar:</b><br>1. Open the <a href="${competition.googleCalendar.publicUrl}" target="_blank">Google Calendar link</a><br>2. On mobile, tap the <b>+</b> button in the bottom right corner<br>3. On desktop, click <b>Add to Google Calendar</b> at the bottom of the page<br>`;
                }
                if (competition.googleCalendar.icalUrl) {
                    subscribeHtml += `<br><b>iOS Calendar:</b><br>1. Go to <b>Settings > Calendar > Accounts</b><br>2. Tap <b>Add Account > Other</b><br>3. Tap <b>Add Subscribed Calendar</b><br>4. Paste the URL below and tap <b>Next</b><br><code>${competition.googleCalendar.icalUrl}</code><br>`;
                }
                subscribeHtml += `</details>`;
                subscribeCol = subscribeHtml;
            } else {
                subscribeCol = `*Not available*`;
            }
        } else {
            webViewCol = `*Not configured*`;
            subscribeCol = `*Not configured*`;
        }

        table += `| ${name} | ${fixtureCol} | ${competitionCol} | ${webViewCol} | ${subscribeCol} |\n`;
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

    // Group competitions by name prefix (Men's, Women's, Midweek, Juniors)
    const categorized = categorizeCompetitions(activeCompetitions);
    const categories = {};
    if (categorized.mens.length > 0) categories["Men's"] = categorized.mens;
    if (categorized.womens.length > 0) categories["Women's"] = categorized.womens;
    if (categorized.midweek.length > 0) categories["Midweek"] = categorized.midweek;
    if (categorized.juniors.length > 0) categories["Juniors"] = categorized.juniors;

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

    // Generate mobile-friendly markdown
    logInfo('Generating mobile-friendly markdown...');
    const mobileMarkdown = await generateMobileMarkdown(competitionsData, categories, activeCompetitions);
    await fs.writeFile(OUTPUT_FILE_MOBILE, mobileMarkdown, 'utf8');
    logSuccess(`Mobile documentation generated: ${OUTPUT_FILE_MOBILE}`);

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