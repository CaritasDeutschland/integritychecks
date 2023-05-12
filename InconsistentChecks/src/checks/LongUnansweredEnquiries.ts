import AbstractCheck from "./AbstractCheck.js";
import {mysqlFn} from "../index.js";
import CheckResult from "../types/CheckResult";
import logger from "../helper/logger.js";
import CheckError from "../types/CheckError";

const UNANSWERED_SINCE: number = 14;

const ERROR_LONG_UNANSWERED: string = 'long_unanswered';
class LongUnansweredError extends Error implements CheckError {
    type: string = ERROR_LONG_UNANSWERED;
}

class LongUnansweredEnquiries extends AbstractCheck {
    constructor() {
        super('LongUnansweredEnquiries');
    }

    getError(): string {
        return `Found ${this.results.length} agencies with ${this.results.reduce((acc, curr) => acc + curr.payload.unansweredCount, 0)} enquiries which haven't been answered for more than ${UNANSWERED_SINCE} days!`;
    }

    async run(force: boolean, limit: number | null, skip: number | null): Promise<boolean> {
        await logger.info(`Loading agencies with unanswered enquiries ...`);
        const agencies = await mysqlFn<any>(
            'query',
            `SELECT a.id, a.name, count(s.id) as unansweredCount, 
                    GROUP_CONCAT(s.id) as sessionIds, GROUP_CONCAT(s.rc_group_id) as groupIds FROM agencyservice.agency a
                    INNER JOIN userservice.session s
                    ON s.agency_id = a.id
                    WHERE (s.status = 0 OR s.status = 1)
                    AND a.is_offline = 0
                    AND s.create_date < DATE_SUB(NOW(), INTERVAL ${UNANSWERED_SINCE} DAY)
                    GROUP BY a.id`
        );

        let count = 0;
        for(const a in agencies) {
            logger.process(`Handling agency ${agencies[a].id} with ${agencies[a].unansweredCount} unanswered enquiries: ${++count}/${agencies.length}            `);
            await logger.error(`Handling agency ${agencies[a].id} with ${agencies[a].unansweredCount} unanswered enquiries: ${++count}/${agencies.length}`);
            this.results.push({
                error: new LongUnansweredError(`Agency ${agencies[a].id} has ${agencies[a].unansweredCount} unanswered enquiries!`),
                payload: {
                    agency: {
                        id: agencies[a].id,
                        name: agencies[a].name
                    },
                    unansweredCount: agencies[a].unansweredCount,
                    sessionIds: agencies[a].sessionIds,
                    groupIds: agencies[a].groupIds,
                }
            });
        }

        return agencies.length === 0;
    }

    logHeader(): string[] {
        return [
            "Error",
            "Error Type",
            "Id",
            "Name",
            "Unanswered count",
        ];
    }

    logResult(result: CheckResult): string[] {
        return [
            result.error.message,
            result.error.type,
            result.payload.agency.id,
            result.payload.agency.name,
            result.payload.agency.unansweredCount,
        ];
    }
}

export default LongUnansweredEnquiries;