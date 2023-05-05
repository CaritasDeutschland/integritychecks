import { timesLimit } from 'async';
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

class RocketChatToLdapInconsistency extends AbstractCheck {
    constructor() {
        super('RocketChatToLdapInconsistency');
    }

    getError(): string {
        const usersNotFound = this.results.filter(result => result.error.type === ERROR_NOT_FOUND).length;
        const usersMultipleFound = this.results.filter(result => result.error.type === ERROR_MULTIPLE_FOUND).length;

        return `Inconsistency between Rocket.chat and Keycloak found. Missing users: ${usersNotFound}. Non unique users: ${usersMultipleFound}`;
    }

    async run(force: boolean, limit: number | null, skip: number | null): Promise<boolean> {
        let success = true;
        const userCollection = database.collection('users');
        const subscriptionCollection = database.collection('rocketchat_subscription');

        await log.info("Load users ...");
        const userFilter = {};
        const rcUsersCount = Math.max(await userCollection.countDocuments(userFilter) - (skip || 0), 0);
        await log.info(`Users: ${rcUsersCount}`);

        const chunks = Math.max(Math.ceil(rcUsersCount / CHUNK_SIZE), 0);

        let count = 0;
        await timesLimit(chunks, PARALLEL, async (c: number) => {
            const rcUsers = await userCollection.find(userFilter, {
                limit: CHUNK_SIZE,
                skip: (skip || 0) + c * CHUNK_SIZE,
            });
            while(await rcUsers.hasNext()) {
                log.process(`Checking users ${(skip || 0) + count++}/${rcUsersCount}`);
                await log.info(`Checking users ${(skip || 0) + count++}/${rcUsersCount}`);

                const rcUser = await rcUsers.next();
                if (!rcUser || !rcUser.ldap) continue;

                const keycloakUsers = await kcAdminClient.users.find({
                    username: rcUser.username,
                    realm: config.keycloak.realm
                });
                if (keycloakUsers.length === 1) continue;

                success = false;
                let error = new NotFoundError(`User not found in Keycloak: ${decodeUsername(rcUser.username)} / ${rcUser.username} / ${rcUser._id}`);
                if (keycloakUsers.length > 1) {
                    error = new MultipleFoundError(`Multiple users found in Keycloak: ${decodeUsername(rcUser.username)} / ${rcUser.username} / ${rcUser._id}`);
                }
                await log.debug(error.message);

                const rcSubscriptionFilter = {'u._id': rcUser._id};
                const rcSubscriptionsCount = await subscriptionCollection.countDocuments(rcSubscriptionFilter);
                const rcSubscriptionsOwnerCount = await subscriptionCollection.countDocuments({
                    ...rcSubscriptionFilter,
                    'roles': 'owner'
                });

                await log.debug(`Subscription count: ${rcSubscriptionsCount} Owner count: ${rcSubscriptionsOwnerCount}`);
                this.results.push({
                    error,
                    payload: {
                        username: decodeUsername(rcUser.username),
                        rcUser,
                        subscriptions: rcSubscriptionsCount,
                        subscriptionsOwner: rcSubscriptionsOwnerCount,
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
            result.payload.rcUser._id,
            result.payload.rcUser.username,
            result.payload.username,
        ];
    }
}

export default RocketChatToLdapInconsistency;