import fs from 'fs/promises';
import puppeteer from 'puppeteer';

// Import shared utilities
import { COMPETITIONS_FILE, MAPPINGS_CLUB_FILE } from '../lib/config.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        help: false,
        dryRun: false
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--dry-run' || arg === '-d') {
            options.dryRun = true;
        }
    }
    
    return options;
}

/**
 * Display help information
 */
function showHelp() {
    console.log(`
📖 Hockey Victoria Club Mappings Updater

Scans ladder URLs from competitions.json and adds missing club names to mappings-club-names.json

Usage:
  npm run update-mappings-club-names [-- options]

Options:
  --dry-run, -d    Show what would be added without making changes
  --help, -h       Show this help message

Features:
  • Scrapes club names from Hockey Victoria ladder pages
  • Generates abbreviations automatically
  • Ensures abbreviations are unique
  • Updates mappings-club-names.json with new entries
  • Supports dry-run mode for preview

Examples:
  npm run update-mappings-club-names                    # Update mappings
  npm run update-mappings-club-names -- --dry-run      # Preview changes
  npm run update-mappings-club-names -- --dry-run      # Preview changes only
`);
}

/**
 * Load existing club mappings
 */
async function loadClubMappings() {
    try {
        const data = await fs.readFile(MAPPINGS_CLUB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logWarning(`Could not load club mappings: ${error.message}`);
        return { clubMappings: {} };
    }
}

/**
 * Load competition data
 */
async function loadCompetitions() {
    try {
        const data = await fs.readFile(COMPETITIONS_FILE, 'utf8');
        const competitionData = JSON.parse(data);
        return competitionData.competitions || [];
    } catch (error) {
        console.error(`❌ Could not load competitions: ${error.message}`);
        throw error;
    }
}

/**
 * Generate abbreviation from club name
 */
function generateAbbreviation(clubName, existingAbbreviations) {
    // Clean up the club name
    let cleanName = clubName
        .replace(/Hockey Club/gi, '')
        .replace(/HC/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Generate abbreviation from first letters of words
    let abbreviation = cleanName
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase())
        .join('');
    
    // Handle special cases
    if (abbreviation.length < 2) {
        abbreviation = cleanName.substring(0, 3).toUpperCase();
    }
    
    // Ensure abbreviation is unique
    let counter = 1;
    let originalAbbreviation = abbreviation;
    while (existingAbbreviations.includes(abbreviation)) {
        abbreviation = originalAbbreviation + counter;
        counter++;
    }
    
    return abbreviation;
}

/**
 * Scrape club names from a ladder URL
 */
async function scrapeClubNamesFromLadder(ladderUrl, browser) {
    const page = await browser.newPage();
    
    try {
        logInfo(`Scraping clubs from: ${ladderUrl}`);
        
        // Navigate to the ladder page
        await page.goto(ladderUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        // Wait for the ladder table to load
        await page.waitForSelector('table, .ladder-table, .points-table', { timeout: 10000 });
        
        // Extract club names from the ladder table
        const clubNames = await page.evaluate(() => {
            const clubs = new Set();
            
            // Look for table rows containing club names
            const tables = document.querySelectorAll('table');
            
            for (const table of tables) {
                const rows = table.querySelectorAll('tr');
                
                for (const row of rows) {
                    const cells = row.querySelectorAll('td, th');
                    
                    for (const cell of cells) {
                        const text = cell.textContent.trim();
                        
                        // Look for text that contains "Hockey Club" or similar patterns
                        if (text.match(/\b\w+.*Hockey Club\b/i) || 
                            text.match(/\b\w+.*HC\b/i) ||
                            text.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+.*\b/)) {
                            
                            // Clean up the text - remove leading numbers, dots, and whitespace
                            const cleanText = text
                                .replace(/^\d+\.?\s*/, '') // Remove leading numbers with optional dot
                                .replace(/\s+\d+$/, '')    // Remove trailing numbers
                                .replace(/\s+$/, '')       // Remove trailing whitespace
                                .trim();
                            
                            // Add if it looks like a club name
                            if (cleanText.length > 5 && !cleanText.match(/^\d+$/)) {
                                clubs.add(cleanText);
                            }
                        }
                    }
                }
            }
            
            return Array.from(clubs);
        });
        
        logInfo(`Found ${clubNames.length} potential club names`);
        return clubNames;
        
    } catch (error) {
        logWarning(`Failed to scrape ${ladderUrl}: ${error.message}`);
        return [];
    } finally {
        await page.close();
    }
}

/**
 * Update club mappings with new clubs
 */
async function updateClubMappings(newClubs, existingMappings, dryRun = false) {
    const updates = [];
    const existingClubNames = Object.keys(existingMappings.clubMappings);
    const existingAbbreviations = Object.values(existingMappings.clubMappings);
    
    for (const clubName of newClubs) {
        // Skip if club already exists
        if (existingClubNames.includes(clubName)) {
            continue;
        }
        
        // Generate abbreviation
        const abbreviation = generateAbbreviation(clubName, existingAbbreviations);
        
        updates.push({
            clubName,
            abbreviation
        });
        
        // Add to existing abbreviations to avoid duplicates
        existingAbbreviations.push(abbreviation);
    }
    
    if (updates.length === 0) {
        logInfo('No new clubs to add');
        return;
    }
    
    logInfo(`Found ${updates.length} new clubs to add:`);
    updates.forEach(({ clubName, abbreviation }) => {
        console.log(`  "${clubName}" -> "${abbreviation}"`);
    });
    
    if (dryRun) {
        logInfo('Dry run mode: No changes made');
        return;
    }
    
    // Add updates to mappings
    updates.forEach(({ clubName, abbreviation }) => {
        existingMappings.clubMappings[clubName] = abbreviation;
    });
    
    // Write back to file
    await fs.writeFile(MAPPINGS_CLUB_FILE, JSON.stringify(existingMappings, null, 2), 'utf8');
    
    logSuccess(`Added ${updates.length} new club mappings to ${MAPPINGS_CLUB_FILE}`);
}

/**
 * Main function
 */
async function main() {
    console.log('========================================');
    console.log('Hockey Victoria Club Mappings Updater');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    // Parse arguments
    const options = parseArguments();
    
    if (options.help) {
        showHelp();
        return;
    }
    
    let browser = null;
    
    try {
        // Load existing data
        logInfo('Loading existing club mappings...');
        const existingMappings = await loadClubMappings();
        
        logInfo('Loading competitions data...');
        const competitions = await loadCompetitions();
        
        // Filter competitions that have ladder URLs
        const competitionsWithLadders = competitions.filter(comp => 
            comp.ladderUrl && comp.ladderUrl.trim() !== ''
        );
        
        logInfo(`Found ${competitionsWithLadders.length} competitions with ladder URLs`);
        
        if (competitionsWithLadders.length === 0) {
            logWarning('No competitions with ladder URLs found');
            return;
        }
        
        // Launch browser
        logInfo('Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        // Collect all unique club names
        const allClubNames = new Set();
        let processedCount = 0;
        
        for (const competition of competitionsWithLadders) {
            try {
                logInfo(`Processing: ${competition.name}`);
                
                const clubNames = await scrapeClubNamesFromLadder(competition.ladderUrl, browser);
                
                clubNames.forEach(name => allClubNames.add(name));
                processedCount++;
                
                // Add delay between requests to be respectful
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                logWarning(`Failed to process ${competition.name}: ${error.message}`);
            }
        }
        
        logInfo(`Processed ${processedCount} competitions`);
        logInfo(`Found ${allClubNames.size} unique club names total`);
        
        // Update mappings
        await updateClubMappings(Array.from(allClubNames), existingMappings, options.dryRun);
        
        console.log('\n========================================');
        console.log(`Completed at: ${new Date().toISOString()}`);
        console.log('========================================');
        
    } catch (error) {
        console.error(`❌ Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Run the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});