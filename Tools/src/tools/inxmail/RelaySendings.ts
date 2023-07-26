import AbstractTool, {PugTemplate} from "../AbstractTool.js";
import inxmailPagination from "../../helper/inxmailPagination.js";

const endpoint = '/relaysendings';

class RelaySendings extends AbstractTool {
  constructor() {
    super('GET', undefined, undefined, [
      {
        name: 'email',
        description: 'filters by the recipient email address (case insensitive, specify without personal part). Example: recipient@fullbounce.invalid',
        optional: true,
      }, {
        name: 'begin',
        description: 'filters sendings starting from this timestamp, in ISO-8601 format. Example: 2015-10-21T11:00:33.000Z',
        optional: true,
      }, {
        name: 'end',
        description: 'filters sendings starting from this timestamp, in ISO-8601 format. Example: 2015-10-21T11:00:33.000Z',
        optional: true,
      }, {
        name: 'size',
        description: 'number of elements returned in a single response page (max. 500). Default: 200 Example: 200',
        optional: true,
      }, {
        name: 'page',
        description: 'result page number, if the request returns more results than the page size. Default: 0 Example: 0',
        optional: true,
      }
    ]);

    this.deps = ['inxmail'];
    this.path = '/inxmail';
  }

  async run(params: any, body: any, query: any): Promise<PugTemplate> {
    const { begin, end, hasContent, prevLink, nextLink, results } = await inxmailPagination(endpoint, query);
    const sortedResults = results.sort((a, b) => new Date(a.sendDate) > new Date(b.sendDate) ? -1 : 1);

    return {
      type: 'pug',
      template: 'inxmail/relaysendings',
      payload: {
        title: `Relay-Sendings (${begin.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} - ${end.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })})`,
        results: sortedResults,
        hasContent,
        prevLink: prevLink && `/inxmail/relaysendings/${prevLink}`,
        nextLink: nextLink && `/inxmail/relaysendings/${nextLink}`,
      }
    };
  }
}

export default RelaySendings;
