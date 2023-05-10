import axios, {AxiosInstance} from 'axios';
import config from '../config/config.js';
export const host = config.rocketChat.host;
export const url = ((host.indexOf('http') === -1)
    ? host.replace(/^(\/\/)?/, 'http://')
    : host) + '/api/v1/';

/** Result object from an API login */
export interface ILoginResultAPI {
    status: string // e.g. 'success'
    data: { authToken: string, userId: string }
}

/** Structure for passing and keeping login credentials */
export interface ILoginCredentials {
    username: string,
    password: string
}

const rocketChatServiceAxios = axios.create({
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': 'test',
        'Cookie': 'CSRF-TOKEN=test',
    }
});

rocketChatServiceAxios.interceptors.request.use((config) => {
    if (rocketChatService.currentLogin) {
        config.headers.set('X-Auth-Token', rocketChatService.currentLogin.authToken);
        config.headers.set('X-User-Id', rocketChatService.currentLogin.userId);
    }
    return config;
});

rocketChatServiceAxios.interceptors.response.use((response) => {
    if (response?.data?.status === 'success' || response?.data?.success === true) {
        return response.data;
    }
    throw new Error('Request failed');
});

/** Convert payload data to query string for GET requests */
export function getQueryString (data: any) {
    if (!data || typeof data !== 'object' || !Object.keys(data).length) return ''
    return '?' + Object.keys(data).map((k) => {
        const value = (typeof data[k] === 'object')
            ? JSON.stringify(data[k])
            : encodeURIComponent(data[k])
        return `${encodeURIComponent(k)}=${value}`
    }).join('&')
}

const rocketChatService: {
    axios: AxiosInstance,
    currentLogin: {
        username: string,
        userId: string,
        authToken: string,
        result: ILoginResultAPI
    } | null,
    post: (endpoint: string, data: any) => Promise<any>,
    get: (endpoint: string, data?: any) => Promise<any>,
    login: (user?: ILoginCredentials) => Promise<ILoginResultAPI>,
    logout: () => Promise<void>
} = {
    axios: rocketChatServiceAxios,
    currentLogin: null,
    post: async (endpoint, data) => {
        return rocketChatService.axios.post(url + endpoint, data);
    },
    get: async (endpoint, data) => {
        return rocketChatService.axios.get(url + endpoint + getQueryString(data));
    },
    login: async (user = {
        username: config.rocketChat.username,
        password: config.rocketChat.password
    }): Promise<ILoginResultAPI> => {
        const result = await rocketChatService.post('login', user);
        if (result?.data?.authToken) {
            rocketChatService.currentLogin = {
                result: result.data, // keep to return if login requested again for same user
                username: user.username, // keep to compare with following login attempt
                authToken: result.data.authToken,
                userId: result.data.userId
            }
            return result
        } else {
            throw new Error(`[API] Login failed for ${user.username}`)
        }
    },
    logout: async () => {
        if (rocketChatService.currentLogin === null) {
            return;
        }
        return rocketChatService.get('logout', null)
            .then(() => {
                rocketChatService.currentLogin = null
            });
    }
};

export default rocketChatService;
