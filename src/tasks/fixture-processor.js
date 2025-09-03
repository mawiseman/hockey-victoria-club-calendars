import fs from 'fs/promises';
import path from 'path';
import { downloadAllCalendars } from './calendar-downloader.js';
import { processAllCalendars } from './calendar-processor.js';
import { uploadAllCalendars } from './google-calendar.js';

// Import shared utilities
import { TEMP_DIR } from '../lib/config.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';

// Step result tracking
const STEPS_FILE = path.join(TEMP_DIR, 'step-results.json');

/**
 * Save step results for later use
 */
export async function saveStepResults(stepName, results, competitions) {
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
export async function loadStepResults(stepName) {
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
 * Download step - Download fixture calendars
 */
export async function runDownloadStep(competitions, options) {
    console.log('\n=== STEP 1: Downloading Fixtures ===\n');
    
    // Check if we should skip this step
    if (!options.force) {
        const previousResults = await loadStepResults('download');
        if (previousResults) {
            logInfo('Previous download results found. Use --force to re-download.');
            return previousResults.results;
        }
    }
    
    const downloadDir = path.join(TEMP_DIR, 'downloads');
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
export async function runProcessStep(downloadResults, competitions, options) {
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
            
            const downloadDir = path.join(TEMP_DIR, 'downloads');
            await fs.mkdir(downloadDir, { recursive: true });
            
            // Download calendars first
            actualDownloadResults = await downloadAllCalendars(competitions, downloadDir);
            
            // Save download results for future use
            await saveStepResults('download', actualDownloadResults, competitions);
            
            const downloadedCount = Object.values(actualDownloadResults).filter(r => r.success).length;
            console.log(`📥 Downloaded ${downloadedCount}/${competitions.length} calendars for processing`);
        }
    }
    
    const processedDir = path.join(TEMP_DIR, 'processed');
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
export async function runUploadStep(processResults, competitions, options) {
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
export function generateSummaryReport(uploadResults) {
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
 * Process fixtures for given competitions
 */
export async function processFixtures(competitions, options) {
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
        await fs.rm(path.join(TEMP_DIR, 'downloads'), { recursive: true, force: true });
        await fs.rm(path.join(TEMP_DIR, 'processed'), { recursive: true, force: true });
        console.log('✅ Temporary files cleaned up');
    } else {
        console.log('\n💡 Temporary files preserved in ./temp/ for step resumption');
        console.log('   Use CLEANUP_TEMP=true to enable automatic cleanup');
    }
}