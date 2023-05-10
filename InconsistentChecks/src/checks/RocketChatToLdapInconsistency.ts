import { timesLimit, every } from 'async';
import AbstractCheck from "./AbstractCheck.js";
import {database, kcAdminClient, mysqlFn} from "../index.js";
import {decodeUsername} from "../helper/user.js";
import config from "../config/config.js";
import CheckError from "../types/CheckError";
import CheckResult from "../types/CheckResult";
import rocketChatService from "../helper/rocketChatService.js";
import logger from "../helper/logger.js";

const CHUNK_SIZE: number = 100;
const PARALLEL: number = 25;
const VERIFY_MISSING_USERS: boolean = true; // Slows down the process a little bit

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

    kcUsers: {[key: string]: (string | undefined)[]} = {};

    async loadKcUsers(): Promise<void> {
        const usersCount = Math.max(await kcAdminClient.users.count({ realm: config.keycloak.realm }), 0);
        const chunks = Math.max(Math.ceil(usersCount / 100), 0);

        let count = 0;
        await timesLimit(chunks, 6, async (c: number) => {
            const keycloakUsers = await kcAdminClient.users.find({
                first: c * 100,
                max: 100,
                realm: config.keycloak.realm
            });

            count += keycloakUsers.length;
            logger.process(`Loading keycloak users: ${count}/${usersCount}`);
            await logger.info(`Loading keycloak users ${count}/${usersCount}`);

            for(const kc in keycloakUsers) {
                const kcUser = keycloakUsers[kc];
                if (!kcUser || !kcUser.username) continue;
                if (!this.kcUsers[kcUser.username]) {
                    this.kcUsers[kcUser.username] = [];
                }
                this.kcUsers[kcUser.username].push(kcUser.id);
            }
        });
    }

    async run(force: boolean, limit: number | null, skip: number | null): Promise<boolean> {
        let success = true;
        const userCollection = database.collection('users');
        const subscriptionCollection = database.collection('rocketchat_subscription');

        await logger.info("Load users ...");
        const userFilter = {};
        const rcUsersCount = Math.max(await userCollection.countDocuments(userFilter) - (skip || 0), 0);
        await logger.info(`Users: ${rcUsersCount}`);

        const chunks = Math.max(Math.ceil(rcUsersCount / CHUNK_SIZE), 0);

        // Preload kcUser
        await this.loadKcUsers();

        let count = 0;
        await timesLimit(chunks, PARALLEL, async (c: number) => {
            const rcUsers = await userCollection.find(userFilter, {
                limit: CHUNK_SIZE,
                skip: (skip || 0) + c * CHUNK_SIZE,
            });
            while(await rcUsers.hasNext()) {
                logger.process(`Checking users ${(skip || 0) + ++count}/${rcUsersCount}`);
                await logger.info(`Checking users ${(skip || 0) + count}/${rcUsersCount}`);

                const rcUser = await rcUsers.next();
                if (!rcUser || !rcUser.ldap) continue;

                if (this.kcUsers[rcUser.username]?.length === 1) continue;

                success = false;
                let error = new NotFoundError(`User not found in Keycloak: ${decodeUsername(rcUser.username)} / ${rcUser.username} / ${rcUser._id}`);
                if (this.kcUsers[rcUser.username]?.length > 1) {
                    error = new MultipleFoundError(`Multiple users found in Keycloak: ${decodeUsername(rcUser.username)} / ${rcUser.username} / ${rcUser._id}`);
                }
                await logger.debug(error.message);

                const rcSubscriptionFilter = {'u._id': rcUser._id};
                const rcSubscriptionsCount = await subscriptionCollection.countDocuments(rcSubscriptionFilter);
                const rcSubscriptionsOwnerCount = await subscriptionCollection.countDocuments({
                    ...rcSubscriptionFilter,
                    'roles': 'owner'
                });

                await logger.debug(`Subscription count: ${rcSubscriptionsCount} Owner count: ${rcSubscriptionsOwnerCount}`);
                this.results.push({
                    error,
                    payload: {
                        username: decodeUsername(rcUser.username),
                        rcUser,
                        subscriptionsCount: rcSubscriptionsCount,
                        subscriptionsOwnerCount: rcSubscriptionsOwnerCount,
                    }
                });
            }
            return;
        });
        logger.finish();

        if (!force) {
            return success;
        }

        // Remove users without rooms
        const usersToDelete = this.results.filter(result =>
            result.error.type === ERROR_NOT_FOUND
        );

        await logger.info(`Removing ${usersToDelete.length} users without subscriptions`);
        const usersToDeleteIds = usersToDelete.map((user) => user.payload.rcUser._id);

        count = 0;
        for(const user of usersToDelete) {
            logger.process(`Removing user ${++count}/${usersToDelete.length}`);
            await logger.info(`Removing user ${count}/${usersToDelete.length} (${ user.payload.rcUser._id})       `);

            try {
                if (user.payload.subscriptionsCount > 0) {
                    const rcSubscriptions = await subscriptionCollection.find({
                        'u._id': user.payload.rcUser._id,
                        'rid': { '$ne': 'GENERAL' }
                    });

                    // Check if all subscriptions have no other members in room
                    if (!await every(rcSubscriptions.clone(), async (subscription) => {
                        const subscriptionsCount = await subscriptionCollection.countDocuments({
                            'rid': subscription.rid,
                            'u._id': { '$nin': [
                                    ...usersToDeleteIds,
                                    user.payload.rcUser._id,
                                    rocketChatService.currentLogin?.userId
                            ] },
                            'u.username': { '$ne': 'System' },
                        });

                        // If no other users in the room delete the room of
                        // if the user is owner he could delete the room but we will ensure the room is invalid in the next check
                        return (subscriptionsCount === 0 || subscription?.roles?.includes('owner'));
                    })) {
                        await logger.error(`User has subscriptions with multiple users in a valid room! Skipping...`);
                        continue;
                    }

                    // Check if room does not exist in mariadb anymore
                    if (!await every(rcSubscriptions.clone(), async (subscription) => {
                        const sessionCount = await mysqlFn<any>(
                            'query',
                            `SELECT count(*) as count FROM session WHERE rc_group_id = "${subscription.rid}" or rc_feedback_group_id = "${subscription.rid}"`
                        );
                        const chatCount = await mysqlFn<any>(
                            'query',
                            `SELECT count(*) as count FROM chat WHERE rc_group_id = "${subscription.rid}"`
                        );
                        return (sessionCount[0].count + chatCount[0].count) <= 0;
                    })) {
                        await logger.error(`Some user subscription rooms are still in DB! Skipping...`);
                        continue;
                    }

                    // Get failed user from keycloak again to ensure there was no loading error on preload of keycloak users
                    if (VERIFY_MISSING_USERS) {
                        const keycloakUsers = await kcAdminClient.users.find({
                            exact: true,
                            username: user.payload.rcUser.username,
                            realm: config.keycloak.realm
                        });
                        if (keycloakUsers.length >= 1) continue;
                    }

                    while(await rcSubscriptions.hasNext()) {
                        const rcSubscription = await rcSubscriptions.next();
                        if (!rcSubscription) continue;
                        try {
                            // Add technical user to room
                            await rocketChatService.post('groups.invite', {
                                userId: rocketChatService.currentLogin?.userId,
                                roomId: rcSubscription.rid
                            });
                            await rocketChatService.post('groups.delete', { roomId: rcSubscription.rid });
                        } catch (e) {
                            await logger.error(`Error deleting user subscription: ${rcSubscription._id}`, e);
                            throw e;
                        }
                    }
                }

                try {
                    await rocketChatService.post('users.delete', { userId: user.payload.rcUser._id });
                    this.results = this.results.filter(result => result.payload.rcUser._id !== user.payload.rcUser._id);
                } catch (e) {
                    await logger.error(`Error deleting user: ${user.payload.rcUser._id}`, e);
                }
            } catch (e) {
                process.exit(1);
            }
        }

        return success;
    }

    logHeader(): string[] {
        return [
            "Error",
            "Error Type",
            "Id",
            "Username",
            "Username (decoded)",
            "Subscriptions count",
            "Subscriptions owner count",
        ];
    }

    logResult(result: CheckResult): string[] {
        return [
            result.error.message,
            result.error.type,
            result.payload.rcUser._id,
            result.payload.rcUser.username,
            result.payload.username,
            result.payload.subscriptionsCount,
            result.payload.subscriptionsOwnerCount,
        ];
    }
}

export default RocketChatToLdapInconsistency;