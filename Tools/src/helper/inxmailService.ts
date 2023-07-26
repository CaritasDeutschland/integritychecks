import axios from 'axios';
import config from '../config/config.js';
export const host = config.inxmail.url;

const inxmailService = axios.create({
  baseURL: host,
  headers: {
    'Content-Type': 'application/json',
  },
  auth: {
    username: config.inxmail.id,
    password: config.inxmail.key,
  }
});

export default inxmailService;