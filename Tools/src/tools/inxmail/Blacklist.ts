import AbstractTool, {PugTemplate} from "../AbstractTool.js";
import inxmailPagination from "../../helper/inxmailPagination.js";

const endpoint = '/blacklist';

class Blacklist extends AbstractTool {
  constructor() {
    super('GET', [
      {
        name: 'email',
        description: 'a single email address. Example: blocked@domain.invalid',
        optional: true,
      }
    ], undefined, [
      {
        name: 'begin',
        description: 'filters blocked addresses starting from this timestamp, in ISO-8601 format. Example: 2015-10-21T11:00:33.000Z',
        optional: true,
      },
      {
        name: 'end',
        description: 'filters blocked addresses until this timestamp, in ISO-8601 format. Example: 2015-10-21T11:00:33.000Z',
        optional: true,
      },
      {
        name: 'size',
        description: 'number of elements returned in a single response page (max. 500). Example: 200 Default: 200',
        optional: true,
      },
      {
        name: 'page',
        description: 'result page number, if the request returns more results than the page size. Example: 0 Default: 0',
        optional: true,
      },
    ]);

    this.deps = ['inxmail'];
    this.path = '/inxmail';
  }

  async run(params: any, body: any, query: any): Promise<PugTemplate> {
    const { begin, end, hasContent, prevLink, nextLink, results } = await inxmailPagination(endpoint, query);
    const sortedResults = results.sort((a, b) => new Date(a.sendDate) > new Date(b.sendDate) ? -1 : 1);

    return {
      type: 'pug',
      template: 'inxmail/blacklist',
      payload: {
        title: `Blacklist (${begin.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} - ${end.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })})`,
        results: sortedResults,
        hasContent,
        prevLink: prevLink && `/inxmail/blacklist/${prevLink}`,
        nextLink: nextLink && `/inxmail/blacklist/${nextLink}`,
      }
    };
  }
}

export default Blacklist;
