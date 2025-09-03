import fs from 'fs/promises';
import path from 'path';
import { downloadAllCalendars } from './calendar-downloader.js';
import { processAllCalendars } from './calendar-processor.js';
import { uploadAllCalendars } from './google-calendar.js';

// Import shared utilities
import { loadCompetitionData } from '../shared/competition-utils.js';
import { logSuccess, logWarning, logInfo } from '../shared/error-utils.js';

// Step result tracking
import { TEMP_DIR } from '../shared/config.js';
const STEPS_FILE = path.join(TEMP_DIR, 'step-results.json');

/**
 * Save step results for later use
 */
async function saveStepResults(stepName, results, competitions) {
    const stepData = {
        stepName,
        completedAt: new Date().toISOString(),
        competitions: competitions.length,
        results,
        totalCompetitions: competitions.length
    };
    
    await fs.mkdir(path.dirname(STEPS_FILE), { recursive: true });
    
    let allSteps = {};
    try {
        const existingData = await fs.readFile(STEPS_FILE, 'utf8');
        allSteps = JSON.parse(existingData);
    } catch (error) {
        // File doesn't exist yet, start fresh
    }
    
    allSteps[stepName] = stepData;
    await fs.writeFile(STEPS_FILE, JSON.stringify(allSteps, null, 2), 'utf8');
    
    logSuccess(`Step results saved to ${STEPS_FILE}`);
}

/**
 * Load step results from previous runs and verify files exist
 */
async function loadStepResults(stepName) {
    try {
        const data = await fs.readFile(STEPS_FILE, 'utf8');
        const allSteps = JSON.parse(data);
        
        if (allSteps[stepName]) {
            // Verify that the actual files still exist
            const stepData = allSteps[stepName];
            
            if (stepName === 'download') {
                // Check if download files exist
                const hasValidFiles = await verifyDownloadFiles(stepData.results);
                if (!hasValidFiles) {
                    logWarning(`Previous ${stepName} results found but files are missing. Will re-run.`);
                    return null;
                }
            } else if (stepName === 'process') {
                // Check if processed files exist
                const hasValidFiles = await verifyProcessedFiles(stepData.results);
                if (!hasValidFiles) {
                    logWarning(`Previous ${stepName} results found but files are missing. Will re-run.`);
                    return null;
                }
            }
            
            logInfo(`Found previous ${stepName} results from ${stepData.completedAt}`);
            return stepData;
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Verify download files exist
 */
async function verifyDownloadFiles(downloadResults) {
    try {
        for (const result of Object.values(downloadResults)) {
            if (result.success && result.path) {
                try {
                    await fs.access(result.path);
                } catch {
                    return false; // File doesn't exist
                }
            }
        }
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Verify processed files exist
 */
async function verifyProcessedFiles(processResults) {
    try {
        for (const result of Object.values(processResults)) {
            if (result.success && result.processedPath) {
                try {
                    await fs.access(result.processedPath);
                } catch {
                    return false; // File doesn't exist
                }
            }
        }
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        steps: null, // null means interactive mode
        force: false,
        help: false,
        all: false,
        interactive: true
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--steps' && i + 1 < args.length) {
            options.steps = args[i + 1].split(',').map(s => s.trim());
            options.interactive = false;
            i++; // Skip next argument
        } else if (arg === '--all') {
            options.steps = ['download', 'process', 'upload'];
            options.all = true;
            options.interactive = false;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        }
    }
    
    return options;
}

/**
 * Display help information
 */
function showHelp() {
    console.log(`
📖 Hockey Victoria Fixture Processor Usage:

npm run process-fixture [-- options]

Options:
  --all             Run all steps (download, process, upload)
  --steps <steps>   Comma-separated list of steps to run
                    Available: download, process, upload
  --force          Force re-run of steps even if previous results exist
  --help, -h       Show this help message

Examples:
  npm run process-fixture                                # Interactive mode (default)
  npm run process-fixture -- --all                      # Run all steps
  npm run process-fixture -- --steps download           # Download fixtures only
  npm run process-fixture -- --steps process            # Process fixtures only  
  npm run process-fixture -- --steps upload             # Upload to Google Calendar only
  npm run process-fixture -- --steps download,process   # Download and process only
  npm run process-fixture -- --all --force              # Force re-run all steps
  npm run process-fixture -- --steps process --force    # Force re-run process step

Modes:
  • No arguments: Interactive menu to choose steps
  • --all: Run all steps automatically
  • --steps: Run specific steps

Step Dependencies:
  • download: No dependencies (reads competition data)
  • process: Requires download results (or --force to re-download)
  • upload: Requires process results (or --force to re-download & process)

Previous step results are automatically loaded when available.
Use --force to ignore cached results and re-run from scratch.
`);
}

/**
 * Interactive step selection
 */
async function selectStepsInteractively() {
    const readline = await import('readline');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    console.log('\n🎯 Hockey Victoria Fixture Processor');
    console.log('=====================================');
    console.log('');
    console.log('What would you like to do?');
    console.log('');
    console.log('1. Download Fixtures');
    console.log('2. Process Fixtures');
    console.log('3. Upload Fixtures');
    console.log('4. Exit');
    console.log('');
    
    return new Promise((resolve) => {
        rl.question('Enter your choice (1-4): ', (answer) => {
            rl.close();
            
            const choice = parseInt(answer);
            
            switch (choice) {
                case 1:
                    resolve({ steps: ['download'], interactive: true });
                    break;
                case 2:
                    resolve({ steps: ['process'], interactive: true });
                    break;
                case 3:
                    resolve({ steps: ['upload'], interactive: true });
                    break;
                case 4:
                    console.log('👋 Goodbye!');
                    process.exit(0);
                    break;
                default:
                    console.log('❌ Invalid choice. Please try again.');
                    resolve(selectStepsInteractively());
            }
        });
    });
}


/**
 * Download step - Download all fixture calendars
 */
async function runDownloadStep(competitions, options) {
    console.log('\n=== STEP 1: Downloading Fixtures ===\n');
    
    // Check if we should skip this step
    if (!options.force) {
        const previousResults = await loadStepResults('download');
        if (previousResults) {
            logInfo('Previous download results found. Use --force to re-download.');
            return previousResults.results;
        }
    }
    
    const downloadDir = path.join('./temp', 'downloads');
    await fs.mkdir(downloadDir, { recursive: true });
    
    const downloadResults = await downloadAllCalendars(competitions, downloadDir);
    
    // Check download results
    const downloadedCount = Object.values(downloadResults).filter(r => r.success).length;
    logSuccess(`Downloaded ${downloadedCount}/${competitions.length} calendars successfully`);
    
    // Save results for next steps
    await saveStepResults('download', downloadResults, competitions);
    
    return downloadResults;
}

/**
 * Process step - Process downloaded calendars
 */
async function runProcessStep(downloadResults, competitions, options) {
    console.log('\n=== STEP 2: Processing Fixtures ===\n');
    
    let actualDownloadResults = downloadResults;
    
    // If no download results provided, try to load from previous step
    if (!actualDownloadResults) {
        if (!options.force) {
            const previousResults = await loadStepResults('process');
            if (previousResults) {
                console.log('⏭️  Previous process results found. Use --force to re-process.');
                return previousResults.results;
            }
        }
        
        // Try to load download results
        const downloadStepData = await loadStepResults('download');
        if (downloadStepData) {
            actualDownloadResults = downloadStepData.results;
            console.log('📂 Using previous download results for processing');
        } else {
            // If no download results, create download results structure from competitions
            console.log('📥 No download results found. Creating download structure from competition data...');
            
            const downloadDir = path.join('./temp', 'downloads');
            await fs.mkdir(downloadDir, { recursive: true });
            
            // Download calendars first
            actualDownloadResults = await downloadAllCalendars(competitions, downloadDir);
            
            // Save download results for future use
            await saveStepResults('download', actualDownloadResults, competitions);
            
            const downloadedCount = Object.values(actualDownloadResults).filter(r => r.success).length;
            console.log(`📥 Downloaded ${downloadedCount}/${competitions.length} calendars for processing`);
        }
    }
    
    const processedDir = path.join('./temp', 'processed');
    await fs.mkdir(processedDir, { recursive: true });
    
    const processResults = await processAllCalendars(actualDownloadResults, processedDir);
    
    // Check process results
    const processedCount = Object.values(processResults).filter(r => r.success).length;
    console.log(`\n📊 Processed ${processedCount}/${competitions.length} calendars successfully`);
    
    // Save results for next steps
    await saveStepResults('process', processResults, competitions);
    
    return processResults;
}

/**
 * Upload step - Upload processed calendars to Google Calendar
 */
async function runUploadStep(processResults, competitions, options) {
    console.log('\n=== STEP 3: Uploading to Google Calendar ===\n');
    
    // Check if Google Calendar upload is configured
    try {
        await fs.access('service-account-key.json');
    } catch (error) {
        console.log('⚠️  service-account-key.json file not found');
        console.log('Skipping Google Calendar upload step');
        return null;
    }
    
    let actualProcessResults = processResults;
    
    // If no process results provided, try to load from previous step
    if (!actualProcessResults) {
        if (!options.force) {
            const previousResults = await loadStepResults('upload');
            if (previousResults) {
                console.log('⏭️  Previous upload results found. Use --force to re-upload.');
                return previousResults.results;
            }
        }
        
        // Try to load process results
        const processStepData = await loadStepResults('process');
        if (processStepData) {
            actualProcessResults = processStepData.results;
            console.log('📂 Using previous process results for upload');
        } else {
            throw new Error('No process results available. Run process step first or use --steps download,process,upload');
        }
    }
    
    const uploadResults = await uploadAllCalendars(actualProcessResults);
    
    // Save results
    await saveStepResults('upload', uploadResults, competitions);
    
    return uploadResults;
}

/**
 * Generate summary report
 */
function generateSummaryReport(uploadResults) {
    if (!uploadResults) {
        return;
    }
    
    console.log('\n========================================');
    console.log('SUMMARY REPORT');
    console.log('========================================\n');
    
    let totalSuccess = 0;
    let totalFailed = 0;
    
    for (const [name, result] of Object.entries(uploadResults)) {
        if (result.success) {
            totalSuccess++;
            console.log(`✅ ${name}: Successfully uploaded`);
            if (result.calendars) {
                for (const cal of result.calendars) {
                    if (cal.success) {
                        console.log(`   - ${cal.calendarId}: ${cal.imported} events`);
                    } else {
                        console.log(`   - ${cal.calendarId}: FAILED - ${cal.error}`);
                    }
                }
            }
        } else {
            totalFailed++;
            console.log(`❌ ${name}: Failed - ${result.error}`);
        }
    }
    
    console.log('\n----------------------------------------');
    console.log(`Total: ${totalSuccess} succeeded, ${totalFailed} failed`);
}

/**
 * Main orchestration function
 */
async function main() {
    console.log('========================================');
    console.log('Hockey Victoria Fixture Processor');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    // Parse command line arguments
    let options = parseArguments();
    
    if (options.help) {
        showHelp();
        return;
    }
    
    // Handle interactive mode
    if (options.interactive) {
        const interactiveResult = await selectStepsInteractively();
        
        // Merge interactive selection with parsed options
        options = {
            ...options,
            steps: interactiveResult.steps,
            interactive: false
        };
    }
    
    // Validate steps
    const validSteps = ['download', 'process', 'upload'];
    const invalidSteps = options.steps ? options.steps.filter(step => !validSteps.includes(step)) : [];
    
    if (invalidSteps.length > 0) {
        console.error(`❌ Invalid steps: ${invalidSteps.join(', ')}`);
        console.error(`Valid steps: ${validSteps.join(', ')}`);
        process.exit(1);
    }
    
    console.log(`🎯 Running steps: ${options.steps.join(', ')}`);
    if (options.force) {
        console.log('🔄 Force mode: Ignoring cached results');
    }
    console.log('');
    
    try {
        // Load competition data - try new format first, fall back to legacy
        let competitions;
        try {
            logInfo('Loading competitions from config/competitions.json...');
            const competitionData = await loadCompetitionData();
            competitions = competitionData.competitions;
        } catch (error) {
            throw new Error(`Could not load competitions${error.message}`);
        }
        
        // Create temp directory
        await fs.mkdir(TEMP_DIR, { recursive: true });
        
        // Execute steps in order
        let downloadResults = null;
        let processResults = null;
        let uploadResults = null;
        
        // Step 1: Download
        if (options.steps.includes('download')) {
            downloadResults = await runDownloadStep(competitions, options);
        }
        
        // Step 2: Process
        if (options.steps.includes('process')) {
            processResults = await runProcessStep(downloadResults, competitions, options);
        }
        
        // Step 3: Upload
        if (options.steps.includes('upload')) {
            uploadResults = await runUploadStep(processResults, competitions, options);
        }
        
        // Generate summary report if upload was run
        if (options.steps.includes('upload')) {
            generateSummaryReport(uploadResults);
        }
        
        // Show step completion summary
        console.log('\n========================================');
        console.log('STEP COMPLETION SUMMARY');
        console.log('========================================\n');
        
        for (const step of options.steps) {
            const stepData = await loadStepResults(step);
            if (stepData) {
                const successCount = Object.values(stepData.results).filter(r => r.success).length;
                console.log(`✅ ${step}: ${successCount}/${stepData.totalCompetitions} successful (${stepData.completedAt})`);
            } else {
                console.log(`❌ ${step}: No results found`);
            }
        }
        
        // Clean up temp files only if explicitly requested
        const shouldCleanup = process.env.CLEANUP_TEMP === 'true';
        
        if (shouldCleanup) {
            console.log('\nCleaning up temporary files...');
            await fs.rm('./temp/downloads', { recursive: true, force: true });
            await fs.rm('./temp/processed', { recursive: true, force: true });
            console.log('✅ Temporary files cleaned up');
        } else {
            console.log('\n💡 Temporary files preserved in ./temp/ for step resumption');
            console.log('   Use CLEANUP_TEMP=true to enable automatic cleanup');
        }
        
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