import inxmailService from "../../helper/inxmailService.js";
import AbstractTool, {Redirect} from "../AbstractTool.js";

const endpoint = '/blacklist';

class BlacklistDelete extends AbstractTool {
  constructor() {
    super('POST', undefined, [
      {
        name: '_method',
        description: 'delete',
        optional: false,
        type: 'string',
      }, {
        name: 'email',
        description: 'a single email address. Example: blacklist@domain.invalid',
        optional: true,
        type: 'string',
      }
    ]);

    this.deps = ['inxmail'];
    this.path = '/inxmail';
  }

  async run(params: any, body: any, query: any): Promise<boolean | Redirect> {
    if (body._method !== 'delete') {
      throw new Error('Method must be delete');
    }

    if (body.email) {
      await inxmailService.delete(`${endpoint}/${body.email}`, params);
      return {
        type: 'redirect',
        url: '/inxmail/blacklist',
      };
    }
    
    for (const blocked of (await inxmailService.get(endpoint, params)).data._embedded.blocklist) {
      await inxmailService.delete(`${endpoint}/${blocked.email}`, params);
    }

    return {
      type: 'redirect',
      url: '/inxmail/blacklist',
    };
  }
}

export default BlacklistDelete;
