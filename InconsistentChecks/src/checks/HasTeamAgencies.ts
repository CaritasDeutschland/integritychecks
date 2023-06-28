import AbstractCheck from "./AbstractCheck.js";
import {mysqlFn} from "../index.js";
import CheckResult from "../types/CheckResult";
import logger from "../helper/logger.js";
import CheckError from "../types/CheckError";

const ERROR_HAS_TEAM_AGENCIES: string = 'has_team_agencies';
class HasTeamAgenciesError extends Error implements CheckError {
    type: string = ERROR_HAS_TEAM_AGENCIES;
}

class HasTeamAgencies extends AbstractCheck {
    constructor() {
        super('HasTeamAgencies');
    }

    getError(): string {
        return `Found ${this.results.length} agencies which set to team agencies!`;
    }

    async run(force: boolean, limit: number | null, skip: number | null): Promise<boolean> {
        await logger.info(`Loading agencies ...`);
        const agencies = await mysqlFn<any>(
            'query',
            `SELECT a.id, a.name 
                    FROM agencyservice.agency a
                    WHERE a.is_team_agency = 1`
        );

        for(const a in agencies) {
            logger.process(`Handling agency ${agencies[a].id}            `);
            await logger.error(`Handling agency ${agencies[a].id}`);
            this.results.push({
                error: new HasTeamAgenciesError(`Agency ${agencies[a].id} is set to team agency!`),
                payload: {
                    agency: {
                        id: agencies[a].id,
                        name: agencies[a].name
                    },
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
        ];
    }
}

export default HasTeamAgencies;