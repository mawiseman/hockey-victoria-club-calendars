/**
 * Shared error handling utilities for setup scripts
 */

/**
 * Check if error is due to Google API limits
 * @param {Error} error - The error object
 * @returns {boolean} - True if it's an API limit error
 */
export function isApiLimitError(error) {
    if (!error.response) return false;
    
    const status = error.response.status;
    const data = error.response.data;
    
    // Check for various API limit scenarios
    if (status === 429) return true; // Too Many Requests
    if (status === 403 && data?.error?.errors) {
        const errors = data.error.errors;
        return errors.some(err => 
            err.reason === 'rateLimitExceeded' ||
            err.reason === 'userRateLimitExceeded' ||
            err.reason === 'quotaExceeded' ||
            err.reason === 'dailyLimitExceeded'
        );
    }
    
    return false;
}

/**
 * Get detailed error message with context
 * @param {Error} error - The error object
 * @param {string} context - Optional context description
 * @returns {string} - Detailed error message
 */
export function getDetailedError(error, context = '') {
    const prefix = context ? `[${context}] ` : '';
    
    if (isApiLimitError(error)) {
        return `${prefix}🚫 Google Calendar API limit exceeded: ${error.message}. Please wait and try again later.`;
    }
    
    if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        switch (status) {
            case 404:
                return `${prefix}❌ Resource not found: ${error.message}`;
            case 401:
                return `${prefix}🔐 Authentication failed: ${error.message}`;
            case 403:
                return `${prefix}⛔ Permission denied: ${error.message}`;
            case 400:
                return `${prefix}📝 Bad request: ${data?.error?.message || error.message}`;
            default:
                return `${prefix}📡 API error (${status}): ${data?.error?.message || error.message}`;
        }
    }
    
    // File system errors
    if (error.code === 'ENOENT') {
        return `${prefix}📁 File not found: ${error.path || error.message}`;
    }
    if (error.code === 'EACCES') {
        return `${prefix}🔒 Permission denied: ${error.path || error.message}`;
    }
    
    return `${prefix}💥 Unexpected error: ${error.message}`;
}

/**
 * Handle common setup script errors
 * @param {Error} error - The error object
 * @param {string} scriptName - Name of the script for context
 * @param {boolean} exitOnError - Whether to exit process on error
 */
export function handleScriptError(error, scriptName = 'Script', exitOnError = true) {
    const detailedError = getDetailedError(error, scriptName);
    console.error(`❌ ${detailedError}`);
    
    if (isApiLimitError(error)) {
        console.log('\n💡 Tip: API limits usually reset within minutes. Try again later.');
    }
    
    if (error.code === 'ENOENT' && error.path && error.path.includes('service-account-key.json')) {
        console.log('\n💡 Tip: Make sure service-account-key.json exists in the project root.');
        console.log('   Download it from Google Cloud Console and place it in the project directory.');
    }
    
    if (exitOnError) {
        process.exit(1);
    }
}

/**
 * Wrap async function with error handling
 * @param {Function} asyncFn - Async function to wrap
 * @param {string} context - Context for error messages
 * @returns {Function} - Wrapped function
 */
export function withErrorHandling(asyncFn, context = '') {
    return async (...args) => {
        try {
            return await asyncFn(...args);
        } catch (error) {
            handleScriptError(error, context, true);
        }
    };
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<any>} - Function result
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt === maxRetries) {
                break; // Don't wait after final attempt
            }
            
            if (isApiLimitError(error)) {
                const delay = baseDelay * Math.pow(2, attempt);
                console.log(`⏳ API limit hit. Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error; // Don't retry non-API-limit errors
            }
        }
    }
    
    throw lastError;
}

/**
 * Log warning message with formatting
 * @param {string} message - Warning message
 * @param {string} context - Optional context
 */
export function logWarning(message, context = '') {
    const prefix = context ? `[${context}] ` : '';
    console.warn(`⚠️  ${prefix}${message}`);
}

/**
 * Log success message with formatting
 * @param {string} message - Success message
 * @param {string} context - Optional context
 */
export function logSuccess(message, context = '') {
    const prefix = context ? `[${context}] ` : '';
    console.log(`✅ ${prefix}${message}`);
}

/**
 * Log info message with formatting
 * @param {string} message - Info message
 * @param {string} context - Optional context
 */
export function logInfo(message, context = '') {
    const prefix = context ? `[${context}] ` : '';
    console.log(`ℹ️  ${prefix}${message}`);
}