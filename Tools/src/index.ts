import KcAdminClient from '@keycloak/keycloak-admin-client';
import mysql, {Connection} from 'mysql';
import {Db, MongoClient} from 'mongodb';
import { Client }  from '@opensearch-project/opensearch';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/config.js';
import rocketChatService from "./helper/rocketChatService.js";
import logger from "./helper/logger.js";

import * as tools from './tools/index.js';
import AbstractTool, {BodyParam, Deps, Methods, Param} from "./tools/AbstractTool";
import ToolsError from "./helper/ToolsError.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let kcAdminRefreshInterval: NodeJS.Timer;
let mysqlKeepAliveInterval: NodeJS.Timer;
export let kcAdminClient: KcAdminClient;
let opensearchClient: Client;
let opensearchIndex: string;
export let mysqlConn: Connection;
export let mongoClient: MongoClient;
export let database: Db;

const SERVER_TIMEOUT_IN_MINUTES = 30;

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
app.use(bodyParser.urlencoded());
app.set('view engine', 'pug');
app.set('views', __dirname + '/views');

const bootup = async (deps: Deps[]) => {
    await logger.info("Check config ...");

    /* MySQL */
    if (deps.includes('mysql')) {
        if (!config.mysql.password) {
            throw new ToolsError("No MYSQL_PASSWORD set in config");
        }
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
    }

    /* Keycloak */
    if (deps.includes('keycloak')) {
        if (!config.keycloak.password) {
            throw new ToolsError("No KEYCLOAK_PASSWORD set in config");
        }
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
    }

    /* MongoDB */
    if (deps.includes('mongo')) {
        if (!config.mongo.db) {
            throw new ToolsError("No DB set in config");
        }
        if (!config.mongo.uri) {
            throw new ToolsError("No URI set in config");
        }
        await logger.info("Start mongodb ...");
        mongoClient = new MongoClient(config.mongo.uri);
        database = mongoClient.db(config.mongo.db);
        await database.command({ ping: 1 });
        await logger.info("Connected");
    }

    /* Rocket.chat */
    if (deps.includes('rocketchat')) {
        if (!config.rocketChat.username) {
            throw new ToolsError("No ROCKETCHAT_USER set in config");
        }
        if (!config.rocketChat.password) {
            throw new ToolsError("No ROCKETCHAT_PASSWORD set in config");
        }
        await logger.info("Start rocket.chat service ...");
        await rocketChatService.login();
        await logger.info("Started");
    }

    /* Opensearch */
    if (deps.includes('opensearch')) {
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
    }
}

const teardown = async (deps: Deps[]) => {
    await logger.info("Tearing down ...");

    if (deps.includes('keycloak')) {
        clearInterval(kcAdminRefreshInterval);
    }

    if (deps.includes('mysql')) {
        clearInterval(mysqlKeepAliveInterval);
        await mysqlFn('end');
    }

    if (deps.includes('mongo')) {
        await mongoClient.close();
    }

    if (deps.includes('rocketchat')) {
        await rocketChatService.logout();
    }

    await logger.info("Done!");
}

const docs: {
    name: keyof typeof tools,
    url: string,
    method: Methods[],
    urlParams: Param[],
    bodyParams: BodyParam[],
    getParams: Param[],
}[] = [];

let orderedTools: {
    name: keyof typeof tools,
    tool: AbstractTool
}[] = [];
for (const name in tools) {
    orderedTools.push({
        name: name as keyof typeof tools,
        tool: new tools[name as keyof typeof tools]() as AbstractTool
    });
}
orderedTools.sort((a, b) =>
  a.tool.getUrl().length < b.tool.getUrl().length ? 1 : -1);

for (const i in orderedTools) {
    const tool = orderedTools[i].tool;

    docs.push({
        name: orderedTools[i].name,
        url: tool.getUrl(),
        method: tool.method,
        urlParams: tool.urlParams,
        bodyParams: tool.bodyParams,
        getParams: tool.getParams,
    });

    app.use(tool.getUrl(), async (req, res, next) => {
        if (!tool.method.includes(req.method as Methods)) {
            return next();
        }

        if (!tool.bodyParams.every((param) => param.optional || req.body[param.name] !== undefined && req.body[param.name] !== null)) {
            const missingParams = tool.bodyParams.filter((param) =>
                req.body[param.name] === undefined || req.body[param.name] === null
            );
            return res.status(400).send(`Missing params: ${missingParams.map((param) => param.name).join(', ')}`);
        }

        if (!tool.bodyParams.every((param) => !req.body[param.name] || typeof req.body[param.name] === param.type)) {
            const missingParams = tool.bodyParams.filter((param) =>
                typeof req.body[param.name] !== param.type
            );
            return res.status(400).send(`Wrong param type: ${missingParams.map((param) => `${param.name} must be ${param.type}`).join(', ')}`);
        }

        if (!tool.getParams.every((param) => param.optional || req.query[param.name] !== undefined && req.query[param.name] !== null)) {
            const missingParams = tool.getParams.filter((param) =>
              req.query[param.name] === undefined || req.query[param.name] === null
            );
            return res.status(400).send(`Missing params: ${missingParams.map((param) => param.name).join(', ')}`);
        }

        try {
            await bootup(tool.getDeps());
            const result = await tool.run(req.params, req.body, req.query, req.method as Methods);
            await teardown(tool.getDeps());

            if (typeof result === 'object' && result.type === 'pug') {
                res.render(result.template, result.payload)
            } else if (typeof result === 'object' && result.type === 'redirect') {
                res.redirect(result.url);
            } else if (typeof result === 'string') {
                res.send(result);
            } else {
                res.send('OK');
            }
        } catch (e: any) {
            await teardown(tool.getDeps());
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

    const server = app.listen(config.port, () => {
        console.log(`Tools listening on port ${config.port}`)
    });
    server.setTimeout(SERVER_TIMEOUT_IN_MINUTES * 60 * 1000);
})();

process.on('unhandledRejection', (err) => {
    console.log(err);
    logger.error(err);
    process.exit(1);
})
