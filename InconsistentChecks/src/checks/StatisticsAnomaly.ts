import AbstractCheck from "./AbstractCheck.js";
import {databases} from "../index.js";
import CheckError from "../types/CheckError";
import CheckResult from "../types/CheckResult";
import logger from "../helper/logger.js";

const ERROR_TO_LESS_STATS: string = 'not_found';
class ToLessStatsError extends Error implements CheckError {
    type: string = ERROR_TO_LESS_STATS;
}

const HOURS = 1;

const defaultWorkdayHours = {
    0: 5,
    7: 10,
    9: 20,
    18: 10,
    21: 5,
    23: 0,
};

const defaultWeekendHours = {
    0: 0,
};

const defaultDays = {
    0: defaultWeekendHours, // 0 = Sunday
    1: defaultWorkdayHours, // 1 = Monday
    6: defaultWeekendHours, // 6 = Saturday
};

type EVENTS = |
    "START_VIDEO_CALL" |
    "STOP_VIDEO_CALL" |
    "REGISTRATION" |
    "BOOKING_CANCELLED" |
    "BOOKING_CREATED" |
    "BOOKING_RESCHEDULED" |
    "CREATE_MESSAGE" |
    "ARCHIVE_SESSION" |
    "ASSIGN_SESSION";

const EVENT_TYPES: {[key in EVENTS]: any} = {
    'START_VIDEO_CALL': defaultDays,
    'STOP_VIDEO_CALL': defaultDays,
    'REGISTRATION': defaultDays,
    'BOOKING_CANCELLED': defaultDays,
    'BOOKING_CREATED': defaultDays,
    'BOOKING_RESCHEDULED': defaultDays,
    'CREATE_MESSAGE': defaultDays,
    'ARCHIVE_SESSION': defaultDays,
    'ASSIGN_SESSION': defaultDays,
};

class StatisticsAnomaly extends AbstractCheck {
    constructor() {
        super('StatisticsAnomaly');
    }

    getError(): string {
        return `To less stats found: ${this.results.map(result => `${result.payload.event}: ${result.payload.statisticsCount}/${result.payload.statisticLimit}`)}`;
    }

    async run(): Promise<boolean> {
        let success = true;
        const statisticCollection = databases.statistics.collection('statistics_event');

        const endDate = new Date();
        const startDate = new Date();
        startDate.setHours(startDate.getHours() - HOURS);

        for (const event of Object.keys(EVENT_TYPES) as (keyof typeof EVENT_TYPES)[]) {
            await logger.debug(`Checking stats for  ${event} ...`);
            const statisticsFilter = {
                eventType: event,
                "$and": [
                    {
                        timestamp: {
                            '$gte': startDate,
                        }
                    }, {
                        timestamp: {
                            '$lte': endDate,
                        }
                    }
                ]
            };
            const statisticsCount = await statisticCollection.countDocuments(statisticsFilter);
            let statisticLimit = null;
            for (const day of Object.keys(EVENT_TYPES[event])) {
                if (parseInt(day) > endDate.getDay()) {
                    continue;
                }

                for (const hour of Object.keys(EVENT_TYPES[event][day])) {
                    if (parseInt(hour) > endDate.getHours()) {
                        continue;
                    }
                    statisticLimit = EVENT_TYPES[event][day][hour];
                }
            }

            if (statisticLimit === null) {
                await logger.debug(`No limit found!`);
                continue;
            }

            if (statisticLimit < statisticsCount) {
                await logger.debug(`Statistics found!`);
                continue;
            }

            success = false;
            await logger.debug(`There are less than ${statisticLimit} ${event} events in the last ${HOURS} hours. (Found: ${statisticsCount})`);
            this.results.push({
                error: new ToLessStatsError(`There are less than ${statisticLimit} ${event} events in the last ${HOURS} hours. (Found: ${statisticsCount})`),
                payload: {
                    event,
                    hours: HOURS,
                    statisticLimit,
                    statisticsCount,
                }
            });
        }

        return success;
    }

    logHeader(): string[] {
        return [
            "Error",
            "Error Type",
            "Event",
            "Hours",
            "Min",
            "Current",
        ];
    }

    logResult(result: CheckResult): string[] {
        return [
            result.error.message,
            result.error.type,
            result.payload.event,
            result.payload.hours,
            result.payload.statisticLimit,
            result.payload.statisticsCount
        ];
    }
}

export default StatisticsAnomaly;