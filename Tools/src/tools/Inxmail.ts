import inxmailService from "./../helper/inxmailService.js";
import AbstractTool, {PugTemplate} from "./AbstractTool.js";

class Inxmail extends AbstractTool {
  constructor() {
    super('GET');

    this.deps = ['inxmail'];
  }

  async run(params: any): Promise<PugTemplate> {
    return {
      type: 'pug',
      template: 'inxmail/Inxmail',
      payload: {
        title: 'Inxmail',
      }
    };
  }
}

export default Inxmail;
