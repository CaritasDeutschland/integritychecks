import AbstractTool, {PugTemplate} from "./AbstractTool.js";

class User extends AbstractTool {
  constructor() {
    super('GET');
  }

  async run(params: any): Promise<PugTemplate> {
    return {
      type: 'pug',
      template: 'user/user',
      payload: {
        title: 'User',
      }
    };
  }
}

export default User;
