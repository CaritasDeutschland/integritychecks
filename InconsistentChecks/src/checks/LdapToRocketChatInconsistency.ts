import { timesLimit } from "async";
import AbstractCheck from "./AbstractCheck.js";
import {database, kcAdminClient, log} from "../index.js";
import {decodeUsername} from "../helper/user.js";
import config from "../config/config.js";
import CheckError from "../types/CheckError";
import CheckResult from "../types/CheckResult";

const CHUNK_SIZE: number = 100;
const PARALLEL: number = 10;

const ERROR_NOT_FOUND: string = 'not_found';
class NotFoundError extends Error implements CheckError {
    type: string = ERROR_NOT_FOUND;
}
const ERROR_MULTIPLE_FOUND: string = 'multiple_found';
class MultipleFoundError extends Error implements CheckError {
    type: string = ERROR_MULTIPLE_FOUND;
}

class LdapToRocketChatInconsistency extends AbstractCheck {
    constructor() {
        super('LdapToRocketChatInconsistency');
    }

    getError(): string {
        const usersNotFound = this.results.filter(result => result.error.type === ERROR_NOT_FOUND).length;
        const usersMultipleFound = this.results.filter(result => result.error.type === ERROR_MULTIPLE_FOUND).length;

        return `Inconsistency between Keycloak and Rocket.chat found. Missing users: ${usersNotFound}. Non unique users: ${usersMultipleFound}`;
    }

    async run(force: boolean, limit: number | null, skip: number | null): Promise<boolean> {
        let success = true;

        await log.info("Load users ...");
        const usersCount = Math.max(await kcAdminClient.users.count({ realm: config.keycloak.realm }) - (skip || 0), 0);
        await log.info(`Users: ${usersCount}`);

        const chunks = Math.max(Math.ceil(usersCount / CHUNK_SIZE), 0);

        /*
        ToDo: Load all users by 100 chunks and build array with ids and then just check if userid is in array instad
         of querying each user from keycloak
         */

        let count = 0;
        await timesLimit(chunks, PARALLEL, async (c: number) => {
            const keycloakUsers = await kcAdminClient.users.find({
                first: (skip || 0) + c * CHUNK_SIZE,
                max: CHUNK_SIZE,
                realm: config.keycloak.realm
            });

            for(const kc in keycloakUsers) {
                log.process(`Checking users: ${(skip || 0) + count++}/${usersCount}`);
                await log.info(`Checking users ${(skip || 0) + count}/${usersCount}`);

                const kcUser = keycloakUsers[kc];
                if (!kcUser) continue;

                const userCollection = database.collection('users');
                const rcUsersCount = await userCollection.countDocuments({
                    username: kcUser.username,
                });

                if (rcUsersCount === 1) continue;

                success = false;
                let error = new NotFoundError(`User not found in Rocket.chat: ${decodeUsername(kcUser.username)}/${kcUser.username}/${kcUser.id}`);
                if (rcUsersCount > 1) {
                    error = new MultipleFoundError(`Multiple users found in Rocket.chat: ${decodeUsername(kcUser.username)}/${kcUser.username}/${kcUser.id}`);
                }
                await log.debug(error.message);

                this.results.push({
                    error,
                    payload: {
                        username: decodeUsername(kcUser.username),
                        kcUser,
                    }
                });
            }
            return;
        });
        log.finish();

        return success;
    }

    logHeader(): string[] {
        return [
            "Error",
            "Error Type",
            "Id",
            "Username",
            "Username (decoded)",
        ];
    }

    logResult(result: CheckResult): string[] {
        return [
            result.error.message,
            result.error.type,
            result.payload.kcUser.id,
            result.payload.kcUser.username,
            result.payload.username,
        ];
    }
}

export default LdapToRocketChatInconsistency;