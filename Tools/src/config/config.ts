import * as dotenv from 'dotenv';
import path from 'path';
import {GrantTypes} from "@keycloak/keycloak-admin-client/lib/utils/auth";
dotenv.config({ path: path.resolve('.env')});

const config: {
    logPath: string | null,
    teamsWebhookUrl: string | null,
    verbosity: number,
    port: number,
    mysql: {
        db: string,
        host: string,
        port: number,
        user: string,
        password: string,
    },
    opensearch: {
        host: string | null,
        protocol: string,
        port: number,
        username: string | null,
        password: string | null,
        index: string,
    },
    keycloak: {
        host: string,
        protocol: string,
        path: string,
        port: number,
        realm: string,
        clientId: string,
        grantType: GrantTypes,
        username: string,
        password: string,
    },
    mongo: {
        db: string,
        uri: string,
    },
    rocketChat: {
        username: string,
        password: string,
        host: string,
        useSsl: boolean
    },
    inxmail: {
        url: string,
        id: string,
        key: string,
    }
} = {
    logPath: process.env.LOG_PATH && process.env.LOG_PATH !== '' ? path.resolve(process.env.LOG_PATH) : null,
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL ?? null,
    verbosity: process.env.VERBOSITY ? parseInt(process.env.VERBOSITY) : 0,
    mysql: {
        db: process.env.MYSQL_DB || 'userservice',
        host: process.env.MYSQL_HOST || 'localhost',
        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
        user: process.env.MYSQL_USER || 'userservice',
        password: process.env.MYSQL_PASSWORD || '',
    },
    opensearch: {
        host: process.env.OPENSEARCH_HOST || null,
        protocol: process.env.OPENSEARCH_PROTOCOL || 'http',
        port: parseInt(process.env.OPENSEARCH_PORT || "9200"),
        username: process.env.OPENSEARCH_USER || null,
        password: process.env.OPENSEARCH_PASSWORD || null,
        index: process.env.OPENSEARCH_INDEX_PREFIX || 'inconsistency',
    },
    keycloak: {
        host: process.env.KEYCLOAK_HOST || 'localhost',
        protocol: process.env.KEYCLOAK_PROTOCOL || 'https',
        path: process.env.KEYCLOAK_PATH || '/auth',
        port: process.env.KEYCLOAK_PORT ? parseInt(process.env.KEYCLOAK_PORT) : 8080,
        realm: process.env.KEYCLOAK_REALM || 'online-beratung',
        clientId: process.env.KEYCLOAK_CLIENT || 'admin-cli',
        grantType: process.env.KEYCLOAK_GRANTTYPE as GrantTypes || 'password',
        username: process.env.KEYCLOAK_USER || 'admin',
        password: process.env.KEYCLOAK_PASSWORD || '',
    },
    mongo: {
        db: process.env.MONGO_DB || 'rocketchat',
        uri: `mongodb://${encodeURIComponent(process.env.MONGODB_USER ?? '')}:${encodeURIComponent(process.env.MONGODB_PASSWORD ?? '')}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT || 27017}/${process.env.MONGO_DB || 'rocketchat'}?retryWrites=true&w=majority&authMechanism=SCRAM-SHA-1&directConnection=true`
    },
    rocketChat: {
        username: process.env.ROCKETCHAT_USER || 'bot',
        password: process.env.ROCKETCHAT_PASSWORD || 'pass',
        host: process.env.ROCKETCHAT_URL || 'localhost:3000',
        useSsl: (process.env.ROCKETCHAT_USE_SSL)
            ? ((process.env.ROCKETCHAT_USE_SSL || '').toString().toLowerCase() === 'true')
            : ((process.env.ROCKETCHAT_URL || '').toString().toLowerCase().startsWith('https'))
    },
    inxmail: {
        url: process.env.INXMAIL_API_URL || 'https://{spaceid}.api.inxmail-commerce.com/api-service/v1',
        id: process.env.INXMAIL_API_ID || '',
        key: process.env.INXMAIL_API_KEY || '',
    }
};

export default config;