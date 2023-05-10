import KcAdminClient from '@keycloak/keycloak-admin-client';
import mysql, {Connection} from 'mysql';
import {Db, MongoClient} from 'mongodb';
import axios from 'axios';
import {FileHandle} from "fs/promises";
import * as fs from "fs";
import { v4 as uuidv4 } from 'uuid';
import { Client }  from '@opensearch-project/opensearch';
import config from './config/config.js';
import rocketChatService from "./helper/rocketChatService.js";

import * as checks from './checks/index.js';
import logger from "./helper/logger.js";

let kcAdminRefreshInterval: NodeJS.Timer;
let mysqlKeepAliveInterval: NodeJS.Timer;
export let kcAdminClient: KcAdminClient;
let opensearchClient: Client;
let opensearchIndex: string;
let rcUserId: string;
export let mysqlConn: Connection;
export let mongoClient: MongoClient;
export let database: Db;
let logDateString: string;
export let logReportFileHandle: FileHandle;
export let logResultFileHandle: FileHandle | null;

export const mysqlFn = async<T>(fn: 'query' | 'end' | 'connect', ...args: [any?]): Promise<T> => {
    return await new Promise((resolve, reject) => {
        const fnArgs: any[] = [
            ...args,
            (err: any, ...args: [any?]) => err ? reject(err) : resolve(...args)
        ];
        // @ts-ignore
        mysqlConn[fn](...fnArgs);
    });
}

const bootup = async () => {
    await logger.info("Bootup ...");

    if (config.logPath) {
        try {
            await fs.promises.stat(config.logPath);
        } catch (e) {
            await fs.promises.mkdir(config.logPath);
        }
        const date = new Date();
        logDateString = date.toISOString().replace('T', '_').replace(/\..+/, '').replace(/:/g, '-');
        logReportFileHandle = await fs.promises.open(`${config.logPath}/report_${logDateString}.log`, 'w');
    }

    await logger.info("Check config ...");
    if (!config.mysql.password) {
        await logger.error("No MYSQL_PASSWORD set in config");
        process.exit(1);
    }
    if (!config.keycloak.password) {
        await logger.error("No KEYCLOAK_PASSWORD set in config");
        process.exit(1);
    }
    if (!config.mongo.db) {
        await logger.error("No DB set in config");
        process.exit(1);
    }
    if (!config.mongo.uri) {
        await logger.error("No URI set in config");
        process.exit(1);
    }
    if (!config.rocketChat.username) {
        await logger.error("No ROCKETCHAT_USER set in config");
        process.exit(1);
    }
    if (!config.rocketChat.password) {
        await logger.error("No ROCKETCHAT_PASSWORD set in config");
        process.exit(1);
    }

    await logger.info("Started");

    /* Keycloak */
    await logger.info("Start keycloak client ...");
    kcAdminClient = new KcAdminClient({
        baseUrl: `${config.keycloak.protocol}://${config.keycloak.host}:${config.keycloak.port}${config.keycloak.path}`,
        realmName: 'master',
        requestOptions: {}
    });
    await logger.info("Authorization ...");
    await kcAdminClient.auth({
        username: config.keycloak.username,
        password: config.keycloak.password,
        grantType: config.keycloak.grantType,
        clientId: config.keycloak.clientId,
    });
    kcAdminRefreshInterval = setInterval(async () => {
        await kcAdminClient.auth({
            grantType: 'refresh_token',
            refreshToken: kcAdminClient.refreshToken,
            clientId: config.keycloak.clientId,
        });
    }, 58 * 1000);
    await logger.info("Authorized");

    /* MongoDB */
    await logger.info("Start mongodb ...");
    mongoClient = new MongoClient(config.mongo.uri);
    database = mongoClient.db(config.mongo.db);
    await database.command({ ping: 1 });
    await logger.info("Connected");

    /* MySQL */
    mysqlConn = mysql.createConnection({
        host: config.mysql.host,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.db,
        port: config.mysql.port,
    });

    await logger.info("Connect ...");
    await mysqlFn<void>('connect');
    mysqlKeepAliveInterval = setInterval(async () => {
        await mysqlFn("query", "SELECT 1;");
    }, 5 * 60 * 1000);
    await logger.info("Connected ...");

    /* Opensearch */
    if (
        config.opensearch.host &&
        config.opensearch.username &&
        config.opensearch.password
    ) {
        await logger.info("Start opensearch client ...");
        const indexDate = new Date();
        opensearchIndex = `${config.opensearch.index}-${indexDate.toJSON().split('T')[0].replace(/-/g, '.')}`;
        const settings = {
            settings: {
                index: {
                    number_of_shards: 1,
                    number_of_replicas: 1,
                },
            },
        };

        opensearchClient = new Client({
            node: `${config.opensearch.protocol}://${config.opensearch.username}:${config.opensearch.password}@${config.opensearch.host}:${config.opensearch.port}`,
            ssl: {
                rejectUnauthorized: false,
            },
        });

        if (!(await opensearchClient.indices.exists({ index: opensearchIndex })).body) {
            await logger.info(`Creating index ${opensearchIndex} ...`);
            await opensearchClient.indices.create({
                index: opensearchIndex,
                body: settings,
            });
        }
    }
    /* Rocket.chat */
    await logger.info("Start rocket.chat service ...");
    await rocketChatService.login();
}

const teardown = async () => {
    await logger.info("Tearing down ...");
    clearInterval(kcAdminRefreshInterval);
    clearInterval(mysqlKeepAliveInterval);
    await mysqlFn('end');
    await mongoClient.close();
    await rocketChatService.logout();
    await logger.info("Done!");
    if (logReportFileHandle) {
        await logReportFileHandle.close();
    }
}

async function run(force: boolean = false, limit: number | null = null, skip: number | null = null) {
    await logger.info("Run ...");

    for (const checkName of config.activeChecks) {
        if (!checks[checkName]) {
            return;
        }
        await logger.info(`Run check ${checkName} ...`);

        try {
            const correlationId = uuidv4();
            const start = new Date();
            const check = new checks[checkName]();

            if (config.logPath) {
                logResultFileHandle = await fs.promises.open(`${config.logPath}/result_${check.name}_${logDateString}.csv`, 'w');
                await logResultFileHandle.write([
                    ...check.logHeader(),
                    "\n"
                ].join(';'));
            }

            if (await check.run(force, limit, skip)) {
                continue;
            }

            if (config.teamsWebhookUrl) {
                await logger.info(`Sending teams webhook notification ...`);
                const data = {
                    "@type": "MessageCard",
                    "@context": "http://schema.org/extensions",
                    "themeColor": "FF0000",
                    "summary": check.getError(),
                    "title": `Inconsistency detected in ${check.name}`,
                    "sections": [
                        {
                            "activityTitle": `Inconsistency detected in ${check.name}`,
                            "activitySubtitle": check.getError(),
                            "facts": [
                                {
                                    "name": "Started",
                                    "value": start.toLocaleString()
                                },
                                {
                                    "name": "End",
                                    "value": (new Date()).toLocaleString()
                                },
                                opensearchClient ? {
                                    "name": "CorrelationId OpenSearch",
                                    "value": correlationId
                                } : {},
                                {
                                    "name": "Results",
                                    "value": check.results.slice(0, 10).map((result) => result.error).join('\n') +
                                        (check.results.length > 10 ? `\n... and ${check.results.length - 10} more` : '')
                                },
                            ],
                            "markdown": true
                        }
                    ]
                };

                await axios.post(config.teamsWebhookUrl, data, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                    .catch((err) => {
                        logger.error(err);
                    });
            }

            if (opensearchClient) {
                await logger.info(`Sending bulk errors to opensearch ...`);
                const result = await opensearchClient.helpers.bulk({
                    refresh: true,
                    datasource: check.results.map((result) => (
                        {
                            name: check.name,
                            error: {
                                level: 'WARN',
                                type: result.error.type,
                                msg: result.error.message,
                            }
                        }
                    )),
                    onDocument (doc) {
                        return [
                            {
                                index: {
                                    _index: opensearchIndex,
                                },
                            },
                            {
                                ...doc,
                                correlationId,
                                '@timestamp': (new Date()).toISOString(),
                            }
                        ]
                    }
                });

                if (result.failed > 0) {
                    await logger.error('Publishing errors to opensearch failed!');
                    await logger.error(result);
                }
            }

            for(const r in check.results) {
                await logger.info(`[${check.results[r].error.type}] ${check.results[r].error.message}`);

                if (logResultFileHandle) {
                    await logResultFileHandle.write([
                        ...check.logResult(check.results[r]),
                        "\n"
                    ].join(';'));
                }
            }

            if (logResultFileHandle) {
                await logResultFileHandle.close();
                logResultFileHandle = null;
            }
        } catch (e: unknown) {
            await logger.error('Unknown error!');
            await logger.error(e);
            if (e instanceof Error) {
                if (e.stack) {
                    process.stdout.write(e.stack)
                }
            }
            break;
        }
    }
}

(async () => {
    let force: boolean = config.force;
    const forceArg = process.argv.findIndex((arg) => arg === '-f' || arg === '--force');
    if (forceArg >= 0) {
        force = true;
    }

    let limit: number | null = null;
    const limitArg = process.argv.findIndex((arg) => arg === '--limit');
    if (limitArg >= 0) {
        limit = parseInt(process.argv[limitArg + 1]);
    }

    let skip: number | null = null;
    const skipArg = process.argv.findIndex((arg) => arg === '--skip');
    if (skipArg >= 0) {
        skip = parseInt(process.argv[skipArg + 1]);
    }

    logger.silent = process.argv.findIndex((arg) => arg === '-s') >= 0;

    const verboseArg = process.argv.findIndex((arg) => arg.startsWith('-v'));
    if (verboseArg >= 0) {
        logger.verbosity = process.argv[verboseArg].split('v').length - 1;
    }

    await logger.info("Force: ", force);
    await logger.info("Silent: ", logger.silent);
    await logger.info("Verbosity: ", logger.verbosity);
    await logger.info("Limit: ", limit);
    await logger.info("Skip: ", skip);

    try {
        await bootup();
        await run(force, limit, skip);
    } catch (e: any) {
        await logger.error("Error: ", e.message);
    }

    await teardown();
})();

process.on('unhandledRejection', (err) => {
    logger.error(err);
    process.exit(1);
})
