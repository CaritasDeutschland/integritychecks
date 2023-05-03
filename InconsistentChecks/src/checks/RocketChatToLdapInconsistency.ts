import AbstractCheck from "./AbstractCheck.js";
import {database, kcAdminClient, log} from "../index.js";
import {decodeUsername} from "../helper/user.js";
import config from "../config/config.js";
import CheckError from "../types/CheckError";
import CheckResult from "../types/CheckResult";

const CHUNK_SIZE: number = 100;

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
        const usersMultipleFound = this.results.filter(result => result.error.type === ERROR_NOT_FOUND).length;

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

        const rcChunks = Math.max(Math.ceil(rcUsersCount / CHUNK_SIZE), 0);

        for(let c = 0; c < rcChunks; c++) {
            let count = 0;
            log.process(`Checking users (Chunk: ${1 + c}/${rcChunks - 1}) User: ${(skip || 0) + c * CHUNK_SIZE}/${rcUsersCount}`);

            const rcUsers = await userCollection.find(userFilter, {
                limit: CHUNK_SIZE,
                skip: (skip || 0) + c * CHUNK_SIZE,
            });
            while(await rcUsers.hasNext()) {
                log.process(`Checking users (Chunk: ${1 + c}/${rcChunks - 1}) User: ${(skip || 0) + c * CHUNK_SIZE + count++}/${rcUsersCount}`);
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

                //const rcSubscriptions = await subscriptionCollection.find(rcSubscriptionFilter);
                //while(await rcSubscriptions.hasNext()) {
                //    const rcSubscription = await rcSubscriptions.next();
                //    if (!rcSubscription) continue;
                //}
                //

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
        }
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