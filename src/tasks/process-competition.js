import fs from 'fs/promises';
import readline from 'readline';
import { processFixtures } from './fixture-processor.js';

// Import shared utilities
import { loadCompetitionData } from '../lib/competition-utils.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';
import { TEMP_DIR } from '../lib/config.js';

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        steps: null,
        useCache: false,
        help: false,
        competition: null,
        list: false,
        includeInactive: false
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--steps' && i + 1 < args.length) {
            options.steps = args[i + 1].split(',').map(s => s.trim());
            i++; // Skip next argument
        } else if (arg === '--all') {
            options.steps = ['download', 'process', 'upload'];
        } else if (arg === '--use-cache') {
            options.useCache = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--list' || arg === '-l') {
            options.list = true;
        } else if (arg === '--include-inactive') {
            options.includeInactive = true;
        } else if (arg === '--competition' || arg === '-c') {
            if (i + 1 < args.length) {
                options.competition = args[i + 1];
                i++; // Skip next argument
            }
        } else if (!arg.startsWith('--') && !options.competition) {
            // Allow competition name without --competition flag
            options.competition = arg;
        }
    }
    
    // Default to all steps if not specified
    if (!options.steps) {
        options.steps = ['download', 'process', 'upload'];
    }
    
    return options;
}

/**
 * Display help information
 */
function showHelp() {
    console.log(`
📖 Hockey Victoria Single Competition Processor

Processes fixtures for a single competition from Hockey Victoria

Usage:
  npm run process-competition [-- options]
  npm run process-competition -- "Competition Name"
  npm run process-competition -- --competition "Competition Name" --steps download,process

Options:
  --competition, -c <name>  Competition name to update
  --all                     Run all steps (download, process, upload) [default]
  --steps <steps>           Comma-separated list of steps to run
                           Available: download, process, upload
  --use-cache              Use cached results from previous runs
  --include-inactive       Include inactive competitions in selection
  --list, -l               List all available competitions
  --help, -h               Show this help message

Examples:
  npm run process-competition                                              # Interactive selection
  npm run process-competition -- --list                                    # List all competitions
  npm run process-competition -- "Men's Premier League - 2025"            # Process specific competition
  npm run process-competition -- -c "Women's Pennant A - 2025"           # Process (default)
  npm run process-competition -- --competition "U16 Girls Shield - 2025" --steps download,process

Modes:
  • No competition specified: Interactive menu to select competition
  • Competition specified: Process that specific competition
  • --list: Display all available competitions

Step Dependencies:
  • download: Downloads the iCal file from Hockey Victoria
  • process: Processes and enriches calendar events
  • upload: Uploads to Google Calendar

By default, all steps are re-run from scratch.
Use --use-cache to reuse results from previous runs.
`);
}

/**
 * List all available competitions
 */
async function listCompetitions(competitions) {
    console.log('\n📋 Available Competitions:');
    console.log('=' .repeat(60));
    
    competitions.forEach((comp, index) => {
        const hasCalendar = comp.googleCalendar && comp.googleCalendar.calendarId;
        const calendarStatus = hasCalendar ? '✅' : '❌';
        console.log(`${index + 1}. ${calendarStatus} ${comp.name}`);
    });
    
    console.log('\n✅ = Has Google Calendar | ❌ = No Google Calendar');
    console.log('=' .repeat(60));
}

/**
 * Interactive competition selection
 */
async function selectCompetitionInteractively(competitions) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    console.log('\n🎯 Select Competition to Process');
    console.log('=' .repeat(60));
    
    // Group competitions by category
    const mens = competitions.filter(c => c.name.toLowerCase().includes("men's") && !c.name.toLowerCase().includes("women's"));
    const womens = competitions.filter(c => c.name.toLowerCase().includes("women's"));
    const midweek = competitions.filter(c => c.name.toLowerCase().includes('midweek'));
    const juniors = competitions.filter(c => c.name.match(/u\d+/i));
    
    let displayIndex = 1;
    const indexMap = {};
    
    const displayCategory = (title, comps) => {
        if (comps.length > 0) {
            console.log(`\n${title}:`);
            comps.forEach(comp => {
                const hasCalendar = comp.googleCalendar && comp.googleCalendar.calendarId;
                const calendarStatus = hasCalendar ? '✅' : '❌';
                console.log(`  ${displayIndex}. ${calendarStatus} ${comp.name}`);
                indexMap[displayIndex] = comp;
                displayIndex++;
            });
        }
    };
    
    displayCategory("Men's Competitions", mens);
    displayCategory("Women's Competitions", womens);
    displayCategory("Midweek Competitions", midweek);
    displayCategory("Junior Competitions", juniors);
    
    console.log('\n0. Exit');
    console.log('=' .repeat(60));
    
    return new Promise((resolve) => {
        rl.question('\nEnter competition number (1-' + (displayIndex - 1) + ') or 0 to exit: ', (answer) => {
            rl.close();
            
            const choice = parseInt(answer);
            
            if (choice === 0) {
                console.log('👋 Goodbye!');
                process.exit(0);
            } else if (choice > 0 && choice < displayIndex) {
                resolve(indexMap[choice]);
            } else {
                console.log('❌ Invalid choice. Please try again.');
                resolve(selectCompetitionInteractively(competitions));
            }
        });
    });
}

/**
 * Find competition by name (case-insensitive, partial match)
 */
function findCompetition(competitions, searchName) {
    const searchLower = searchName.toLowerCase();
    
    // First try exact match
    let competition = competitions.find(c => 
        c.name.toLowerCase() === searchLower
    );
    
    // If no exact match, try partial match
    if (!competition) {
        const matches = competitions.filter(c => 
            c.name.toLowerCase().includes(searchLower)
        );
        
        if (matches.length === 1) {
            competition = matches[0];
        } else if (matches.length > 1) {
            console.log(`\n⚠️  Multiple competitions match "${searchName}":`);
            matches.forEach((c, i) => {
                console.log(`  ${i + 1}. ${c.name}`);
            });
            console.log('\nPlease be more specific or use the exact name.');
            return null;
        }
    }
    
    if (!competition) {
        console.log(`\n❌ Competition not found: "${searchName}"`);
        console.log('Use --list to see all available competitions.');
    }
    
    return competition;
}

/**
 * Main orchestration function
 */
async function main() {
    console.log('========================================');
    console.log('Hockey Victoria Single Competition Processor');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    // Parse command line arguments
    const options = parseArguments();
    
    if (options.help) {
        showHelp();
        return;
    }
    
    try {
        // Load competition data
        logInfo('Loading competitions from config/competitions.json...');
        const competitionData = await loadCompetitionData();
        const allCompetitions = competitionData.competitions;

        // Filter competitions based on active status (unless includeInactive flag is set)
        const competitionsToShow = options.includeInactive ? allCompetitions : allCompetitions.filter(comp => comp.isActive !== false);
        if (!options.includeInactive) {
            logInfo(`Filtered to ${competitionsToShow.length} active competitions (${allCompetitions.length} total)`);
        } else {
            logInfo(`Showing all ${competitionsToShow.length} competitions (including inactive)`);
        }
        
        if (options.list) {
            await listCompetitions(competitionsToShow);
            return;
        }

        // Select competition
        let selectedCompetition = null;

        if (options.competition) {
            // Find competition by name (search in appropriate competitions based on includeInactive flag)
            selectedCompetition = findCompetition(competitionsToShow, options.competition);
            if (!selectedCompetition && !options.includeInactive) {
                // If not found in active competitions, check inactive ones and warn
                const inactiveMatch = findCompetition(allCompetitions, options.competition);
                if (inactiveMatch && inactiveMatch.isActive === false) {
                    console.log(`\n⚠️  Competition "${options.competition}" is marked as inactive.`);
                    console.log('Use --include-inactive flag to process inactive competitions, or run "npm run update-competition-status" to refresh status.');
                }
                process.exit(1);
            } else if (!selectedCompetition) {
                process.exit(1);
            }
        } else {
            // Interactive selection
            selectedCompetition = await selectCompetitionInteractively(competitionsToShow);
        }
        
        console.log(`\n🎯 Selected: ${selectedCompetition.name}`);
        
        // Check if competition has Google Calendar
        if (!selectedCompetition.googleCalendar || !selectedCompetition.googleCalendar.calendarId) {
            logWarning('This competition does not have a Google Calendar configured.');
            console.log('Run "npm run create-calendars" to create Google Calendars first.');
            
            // Still allow download and process steps
            if (options.steps.includes('upload')) {
                console.log('\n⚠️  Removing upload step as no calendar exists.');
                options.steps = options.steps.filter(s => s !== 'upload');
            }
            
            if (options.steps.length === 0) {
                console.log('No steps to run.');
                return;
            }
        }
        
        console.log(`🎯 Running steps: ${options.steps.join(', ')}`);
        if (options.force) {
            console.log('🔄 Force mode: Ignoring cached results');
        }
        console.log('');
        
        // Create temp directory
        await fs.mkdir(TEMP_DIR, { recursive: true });
        
        // Process only the selected competition
        await processFixtures([selectedCompetition], options);
        
        console.log('\n========================================');
        console.log(`Completed at: ${new Date().toISOString()}`);
        console.log('========================================');
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});