import config from "../config/config.js";
import {logReportFileHandle} from "../index.js";

const RESET = "\x1b[0m";
const FG_RED = "\x1b[31m";
const FG_GREEN = "\x1b[32m";
const FG_YELLOW = "\x1b[33m";
const FG_BLUE = "\x1b[34m";
const FG_CYAN = "\x1b[36m";

const logger = {
    inProcess: false,
    silent: false,
    verbosity: config.verbosity,
    info: async (...message: any[]) => {
        if (!logger.inProcess && logger.verbosity >= 2 && !logger.silent) {
            process.stdout.write(`${FG_YELLOW}[INFO]${RESET} ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}\n`);
        }
        if (logReportFileHandle) {
            await logReportFileHandle.write(`[INFO] ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}\n`);
        }
    },
    error: async (...message: any[]) => {
        if (logger.verbosity >= 0 && !logger.silent) {
            if (logger.inProcess) {
                logger.finish();
            }
            process.stdout.write(`${FG_RED}[ERROR] ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}${RESET}\n`);
        }
        if (logReportFileHandle) {
            await logReportFileHandle.write(`[ERROR] ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}\n`);
        }
    },
    debug: async (...message: any[]) => {
        if (!logger.inProcess && logger.verbosity >= 3 && !logger.silent) {
            process.stdout.write(`${FG_BLUE}[DEBUG]${RESET} ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}\n`);
        }
        if (logReportFileHandle) {
            await logReportFileHandle.write(`[DEBUG] ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}\n`);
        }
    },
    success: async (...message: any[]) => {
        if (!logger.inProcess && logger.verbosity >= 2 && !logger.silent) {
            process.stdout.write(`${FG_GREEN}[SUCCESS] ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}${RESET}\n`);
        }
        if (logReportFileHandle) {
            await logReportFileHandle.write(`[SUCCESS] ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}\n`);
        }
    },
    process: (...message: any[]) => {
        if (logger.verbosity == 1 && !logger.silent) {
            process.stdout.write(`${FG_CYAN}[PROCESS]${RESET} ${message.map((msg) => JSON.stringify(msg, null, 2)).join(' ')}\r`);
            logger.inProcess = true;
        }
    },
    finish: () => {
        if (logger.verbosity == 1 && !logger.silent) {
            process.stdout.write(`\n`);
            logger.inProcess = false;
        }
    },
}

export default logger;