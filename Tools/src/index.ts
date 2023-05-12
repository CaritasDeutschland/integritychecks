import KcAdminClient from '@keycloak/keycloak-admin-client';
import mysql, {Connection} from 'mysql';
import {Db, MongoClient} from 'mongodb';
import { Client }  from '@opensearch-project/opensearch';
import express from 'express';
import bodyParser from 'body-parser';

import config from './config/config.js';
import rocketChatService from "./helper/rocketChatService.js";
import logger from "./helper/logger.js";

import * as tools from './tools/index.js';
import AbstractTool, {BodyParam, Param} from "./tools/AbstractTool";
import ToolsError from "./helper/ToolsError.js";

let kcAdminRefreshInterval: NodeJS.Timer;
let mysqlKeepAliveInterval: NodeJS.Timer;
export let kcAdminClient: KcAdminClient;
let opensearchClient: Client;
let opensearchIndex: string;
export let mysqlConn: Connection;
export let mongoClient: MongoClient;
export let database: Db;

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

const app = express();
app.use(bodyParser.json());

const bootup = async () => {
    await logger.info("Check config ...");
    if (!config.mysql.password) {
        throw new ToolsError("No MYSQL_PASSWORD set in config");
    }
    if (!config.keycloak.password) {
        throw new ToolsError("No KEYCLOAK_PASSWORD set in config");
    }
    if (!config.mongo.db) {
        throw new ToolsError("No DB set in config");
    }
    if (!config.mongo.uri) {
        throw new ToolsError("No URI set in config");
    }
    if (!config.rocketChat.username) {
        throw new ToolsError("No ROCKETCHAT_USER set in config");
    }
    if (!config.rocketChat.password) {
        throw new ToolsError("No ROCKETCHAT_PASSWORD set in config");
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
}

const docs: {
    name: keyof typeof tools,
    url: string,
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    urlParams: Param[],
    bodyParams: BodyParam[],
}[] = [];

for (const name in tools) {
    const tool = new tools[name as keyof typeof tools]() as AbstractTool;

    docs.push({
        name: name as keyof typeof tools,
        url: tool.getUrl(),
        method: tool.method,
        urlParams: tool.urlParams,
        bodyParams: tool.bodyParams,
    });

    app.use(tool.getUrl(), async (req, res, next) => {
        if (req.method != tool.method) {
            return next();
        }

        if (!tool.bodyParams.every((param) => req.body[param.name] !== undefined && req.body[param.name] !== null)) {
            const missingParams = tool.bodyParams.filter((param) =>
                req.body[param.name] === undefined || req.body[param.name] === null
            );
            return res.status(400).send(`Missing params: ${missingParams.map((param) => param.name).join(', ')}`);
        }

        if (!tool.bodyParams.every((param) => typeof req.body[param.name] === param.type)) {
            const missingParams = tool.bodyParams.filter((param) =>
                typeof req.body[param.name] !== param.type
            );
            return res.status(400).send(`Wrong param type: ${missingParams.map((param) => `${param.name} must be ${param.type}`).join(', ')}`);
        }

        try {
            await bootup();
            await tool.run(req.params, req.body);
            res.send('OK');
        } catch (e: any) {
            await teardown();
            res.status(400).send(e);
        }
    });
}

app.get('*', (req, res) => {
    res.send(docs);
});


(async () => {
    const verboseArg = process.argv.findIndex((arg) => arg.startsWith('-v'));
    if (verboseArg >= 0) {
        logger.verbosity = process.argv[verboseArg].split('v').length - 1;
    }

    await logger.info("Verbosity: ", logger.verbosity);

    await app.listen(config.port, () => {
        console.log(`Tools listening on port ${config.port}`)
    });
})();

process.on('unhandledRejection', (err) => {
    console.log(err);
    logger.error(err);
    process.exit(1);
})
