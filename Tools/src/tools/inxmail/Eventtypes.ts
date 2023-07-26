import inxmailService from "../../helper/inxmailService.js";
import AbstractTool, {PugTemplate} from "../AbstractTool.js";

const endpoint = '/eventtypes';

class Eventtypes extends AbstractTool {
  constructor() {
    super('GET', [
      {
        name: 'eventTypeId',
        description: 'The eventTypeId.',
        optional: true,
      },
    ]);

    this.deps = ['inxmail'];
    this.path = '/inxmail';
  }

  async run(params: any, body: any, query: any): Promise<PugTemplate> {
    let results: any[] = [];
    let load = true;
    let page = 0;
    let hasContent = false;
    while(load) {
      const result = (await inxmailService.get(endpoint, {
        params: {
          ...query,
          size: 500,
          page: page++,
        }
      })).data;
      hasContent = result.page.totalElements > 0;
      results = results.concat(result._embedded[Object.keys(result._embedded)[0]]);
      if (!result._links.next) {
        load = false;
      }
    }

    return {
      type: 'pug',
      template: 'inxmail/eventtypes',
      payload: {
        title: `EventTypes`,
        results,
        hasContent,
      }
    };
  }
}

export default Eventtypes;
