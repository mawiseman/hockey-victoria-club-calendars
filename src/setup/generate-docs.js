import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import shared utilities
import { loadCompetitionData, categorizeCompetitions } from '../lib/competition-utils.js';
import { OUTPUT_DIR, COMPETITIONS_FILE } from '../lib/config.js';
import { withErrorHandling, logSuccess, logInfo } from '../lib/error-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'competitions.md');

/**
 * Generate index markdown content with all calendars
 */
function generateIndexMarkdown(competitionsData, categories) {
    const { clubName, totalCompetitions, lastUpdated } = competitionsData;
    
    let markdown = `# ${clubName} - Competition Calendars\n\n`;
    markdown += `**Total Competitions:** ${totalCompetitions}  \n`;
    markdown += `**Last Updated:** ${new Date(lastUpdated).toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Get all competitions with calendars for combined view
    const allCompetitions = [
        ...categories.mens,
        ...categories.womens, 
        ...categories.midweek,
        ...categories.juniors
    ];
    
    const competitionsWithCalendars = allCompetitions.filter(comp => 
        comp.googleCalendar && comp.googleCalendar.calendarId
    );
    
    // Combined calendar view of ALL competitions
    if (competitionsWithCalendars.length > 0) {
        markdown += `## All Competitions - Combined Calendar View\n\n`;
        
        const calendarSources = competitionsWithCalendars.map(comp => 
            `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`
        ).join('');
        
        const iframeUrl = `https://calendar.google.com/calendar/embed?height=600&wkst=2&ctz=Australia%2FMelbourne&showPrint=0&showTz=0${calendarSources}`;
        
        markdown += `<iframe src="${iframeUrl}" style="border:solid 1px #777" width="800" height="600" frameborder="0" scrolling="no"></iframe>\n\n`;
        markdown += `---\n\n`;
    }
    
    // Create navigation links to category pages
    markdown += `## Calendar Categories\n\n`;
    
    if (categories.mens.length > 0) {
        markdown += `### [Men's Competitions](mens-calendars.md) (${categories.mens.length})\n`;
        markdown += `Combined calendar view of all men's competitions.\n\n`;
    }
    
    if (categories.womens.length > 0) {
        markdown += `### [Women's Competitions](womens-calendars.md) (${categories.womens.length})\n`;
        markdown += `Combined calendar view of all women's competitions.\n\n`;
    }
    
    if (categories.midweek.length > 0) {
        markdown += `### [Midweek Competitions](midweek-calendars.md) (${categories.midweek.length})\n`;
        markdown += `Combined calendar view of all midweek competitions.\n\n`;
    }
    
    if (categories.juniors.length > 0) {
        markdown += `### [Junior Competitions](juniors-calendars.md) (${categories.juniors.length})\n`;
        markdown += `Combined calendar view of all junior competitions.\n\n`;
    }
    
    markdown += `---\n\n`;
    
    // Add individual competition sections for each category
    if (categories.mens.length > 0) {
        markdown += `## Men's Competitions\n\n`;
        markdown += formatCompetitionTable(categories.mens);
        markdown += `\n`;
    }
    
    if (categories.womens.length > 0) {
        markdown += `## Women's Competitions\n\n`;
        markdown += formatCompetitionTable(categories.womens);
        markdown += `\n`;
    }
    
    if (categories.midweek.length > 0) {
        markdown += `## Midweek Competitions\n\n`;
        markdown += formatCompetitionTable(categories.midweek);
        markdown += `\n`;
    }
    
    if (categories.juniors.length > 0) {
        markdown += `## Junior Competitions\n\n`;
        markdown += formatCompetitionTable(categories.juniors);
        markdown += `\n`;
    }
    
    // Footer
    markdown += `---\n\n`;
    markdown += `*This documentation is automatically generated from competitions.json*  \n`;
    markdown += `*To update calendars, run: \`npm run process-fixture\`*\n`;
    
    return markdown;
}

/**
 * Format competitions as a table
 */
function formatCompetitionTable(competitions) {
    let table = `| Competition | Web View | iCal Subscribe |\n`;
    table += `|-------------|----------|----------------|\n`;
    
    for (const competition of competitions) {
        const name = competition.name;
        
        // Google Calendar columns
        let webViewCol;
        let icalCol;
        if (competition.googleCalendar) {
            if (competition.googleCalendar.publicUrl) {
                webViewCol = `[📅 View](${competition.googleCalendar.publicUrl})`;
            } else {
                webViewCol = `*Not available*`;
            }
            
            if (competition.googleCalendar.icalUrl) {
                icalCol = `[📲 Subscribe](${competition.googleCalendar.icalUrl})`;
            } else {
                icalCol = `*Not available*`;
            }
        } else {
            webViewCol = `*Not configured*`;
            icalCol = `*Not configured*`;
        }
        
        table += `| ${name} | ${webViewCol} | ${icalCol} |\n`;
    }
    
    table += `\n`;
    return table;
}

/**
 * Generate category-specific markdown page with embedded calendars
 */
function generateCategoryMarkdown(categoryName, competitions, clubName) {
    const categoryTitle = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
    
    let markdown = `# ${clubName} - ${categoryTitle} Calendars\n\n`;
    markdown += `[← Back to All Calendars](competitions.md)\n\n`;
    markdown += `**${categoryTitle} Competitions:** ${competitions.length}\n\n`;
    markdown += `---\n\n`;
    
    // Filter competitions with calendars
    const competitionsWithCalendars = competitions.filter(comp => 
        comp.googleCalendar && comp.googleCalendar.calendarId
    );
    
    if (competitionsWithCalendars.length === 0) {
        markdown += `No calendars available for ${categoryTitle.toLowerCase()} competitions.\n`;
        return markdown;
    }
    
    // Generate combined calendar iframe
    markdown += `## Combined Calendar View\n\n`;
    const calendarSources = competitionsWithCalendars.map(comp => 
        `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`
    ).join('');
    
    const iframeUrl = `https://calendar.google.com/calendar/embed?height=600&wkst=2&ctz=Australia%2FMelbourne&showPrint=0&showTz=0${calendarSources}`;
    
    markdown += `<iframe src="${iframeUrl}" style="border:solid 1px #777" width="800" height="600" frameborder="0" scrolling="no"></iframe>\n\n`;
    
    // Individual competition links
    markdown += `## Individual Competitions\n\n`;
    markdown += `| Competition | Web View | iCal Subscribe |\n`;
    markdown += `|-------------|----------|----------------|\n`;
    
    for (const competition of competitions) {
        const name = competition.name;
        
        // Google Calendar columns
        let webViewCol;
        let icalCol;
        if (competition.googleCalendar) {
            if (competition.googleCalendar.publicUrl) {
                webViewCol = `[📅 View](${competition.googleCalendar.publicUrl})`;
            } else {
                webViewCol = `*Not available*`;
            }
            
            if (competition.googleCalendar.icalUrl) {
                icalCol = `[📲 Subscribe](${competition.googleCalendar.icalUrl})`;
            } else {
                icalCol = `*Not available*`;
            }
        } else {
            webViewCol = `*Not configured*`;
            icalCol = `*Not configured*`;
        }
        
        markdown += `| ${name} | ${webViewCol} | ${icalCol} |\n`;
    }
    
    markdown += `\n---\n\n`;
    markdown += `*This page is automatically generated from competitions.json*\n`;
    
    return markdown;
}

/**
 * Main function to generate documentation
 */
async function generateDocs() {
    logInfo('Starting documentation generation...');
    
    // Load competition data
    const competitionsData = await loadCompetitionData();
    
    logInfo(`Loaded ${competitionsData.competitions.length} competitions from ${COMPETITIONS_FILE}`);
    
    // Categorize competitions
    const categories = categorizeCompetitions(competitionsData.competitions);
    
    // Print category summary
    logInfo(`Found competitions:`);
    console.log(`  - Men's: ${categories.mens.length}`);
    console.log(`  - Women's: ${categories.womens.length}`);
    console.log(`  - Midweek: ${categories.midweek.length}`);
    console.log(`  - Juniors: ${categories.juniors.length}`);
    
    // Generate index markdown
    logInfo('Generating index markdown...');
    const indexMarkdown = generateIndexMarkdown(competitionsData, categories);
    
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // Write index markdown file
    await fs.writeFile(OUTPUT_FILE, indexMarkdown, 'utf8');
    logSuccess(`Index documentation generated: ${OUTPUT_FILE}`);
    
    // Generate category-specific pages
    const categoryPages = [
        { name: 'mens', competitions: categories.mens, filename: 'mens-calendars.md' },
        { name: 'womens', competitions: categories.womens, filename: 'womens-calendars.md' },
        { name: 'midweek', competitions: categories.midweek, filename: 'midweek-calendars.md' },
        { name: 'juniors', competitions: categories.juniors, filename: 'juniors-calendars.md' }
    ];
    
    for (const categoryPage of categoryPages) {
        if (categoryPage.competitions.length > 0) {
            logInfo(`Generating ${categoryPage.name} calendar page...`);
            const categoryMarkdown = generateCategoryMarkdown(
                categoryPage.name, 
                categoryPage.competitions, 
                competitionsData.clubName
            );
            
            const categoryOutputFile = path.join(OUTPUT_DIR, categoryPage.filename);
            await fs.writeFile(categoryOutputFile, categoryMarkdown, 'utf8');
            logSuccess(`${categoryPage.name} calendar page generated: ${categoryOutputFile}`);
        }
    }
    
    logInfo(`Total competitions documented: ${competitionsData.totalCompetitions}`);
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