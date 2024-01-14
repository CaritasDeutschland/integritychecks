import AbstractTool, {Methods, PugTemplate} from "../AbstractTool.js";
import {kcAdminClient, mysqlFn} from "../../index.js";
import rocketChatService from "../../helper/rocketChatService.js";
import config from "../../config/config.js";
import {decodeUsername, encodeUsername} from "../../helper/user.js";

class ChangeUsername extends AbstractTool {
  constructor() {
    super(['GET', 'POST'], undefined, [
      {
        name: 'userId',
        description: 'ID of user to update',
        optional: true,
        type: 'string'
      }, {
        name: 'username',
        description: 'New user-/name of user',
        optional: true,
        type: 'string'
      }
    ], undefined);

    this.deps = ['mysql', 'rocketchat', 'keycloak'];
    this.path = '/user';
  }

  async run(params: any, body: any, query: any, method: Methods): Promise<PugTemplate> {
    let payload = {};

    if (method === "POST") {
      if (body.username && body.userId) {
        payload = await this.post(body.userId, body.username, body.hasOwnProperty('confirm'), body.changeUsername === 'on');
      } else {
        if (!body.userId) {
          payload = {
            error: `User ID missing!`,
          }
        } else if (!body.username) {
          payload = {
            error: `Username missing!`,
          }
        }

      }
    }

    return {
      type: 'pug',
      template: 'user/changeUsername',
      payload: {
        title: `Change username`,
        confirm: body.hasOwnProperty('confirm'),
        userId: body.userId || '',
        username: body.username || '',
        usernameEnc: body.username ? encodeUsername(body.username) : '',
        ...payload
      }
    };
  }

  async post(userId: string, username: string, confirm: boolean, changeUsernameOnly: boolean): Promise<any> {
    let data = await this.loadUser(userId);

    if (!data || !data.user) {
      return {
        error: `Consultant with id "${userId}" not found!`,
      }
    }

    if (!data.rcUser) {
      return {
        ...data,
        error: `Rocket.chat user with id "${data.user.rcUserId}" not found!`,
      }
    }

    if (!data.keycloakUser) {
      return {
        ...data,
        error: `Keycloak user with id "${userId}" not found!`,
      }
    }

    if (confirm) {
      const success = [];
      const encUsername = encodeUsername(username, false);
      const encUsernameDB = encodeUsername(username, true);
      await rocketChatService.post('users.update', {
        userId: data.user.rc_user_id,
        data: {
          name: encUsername,
        }
      });
      success.push(`Updated rocket.chat name from ${decodeUsername(data.rcUser.name)} (${data.rcUser.name}) to ${username} (${encUsername})`);

      if (!changeUsernameOnly) {
        await rocketChatService.post('users.update', {
          userId: data.user.rc_user_id,
          data: {
            username: encUsername,
          }
        });
        success.push(`Updated rocket.chat username from ${decodeUsername(data.rcUser.username)} (${data.rcUser.username}) to ${username} (${encUsername})`);

        await kcAdminClient.users.update({
          id: userId,
          realm: config.keycloak.realm
        }, {
          username: encUsername
        });
        success.push(`Updated keycloak username from ${decodeUsername(data.keycloakUser.username)} (${data.keycloakUser.username}) to ${username} (${encUsername})`);

        await mysqlFn<any>(
          'query',
          `UPDATE userservice.consultant SET username = "${encUsernameDB}" WHERE consultant_id = "${userId}"`
        );
        success.push(`Updated database username from ${decodeUsername(data.user.username)} (${data.user.username}) to ${username} (${encUsernameDB})`);
      }

      return {
        ...data,
        success,
      }
    }

    return data;

    /*
    payload = {
      userId: body.userId,
      ...payload,
      ...data
    };
     */
    // progress = consultants && rcUser && keycloakUser ? 'confirm' : 'failed';
  }

  async loadUser(userId: string): Promise<{user: any, rcUser: any, keycloakUser: any} | null> {
    const users = await mysqlFn<any>(
      'query',
      `SELECT * FROM userservice.consultant WHERE consultant_id = "${userId}"`
    );

    if (!users.length) {
      return null;
    }
    const user = users[0];

    const rcUser = await rocketChatService.get('users.info', {
      userId: user.rc_user_id,
    });

    const keycloakUser = await kcAdminClient.users.findOne({
      id: userId,
      realm: config.keycloak.realm
    });

    return {
      user: {
        ...user,
        usernameDec: decodeUsername(user.username),
      },
      rcUser: rcUser?.user ? {
        ...rcUser.user,
        usernameDec: decodeUsername(rcUser.user.username),
        nameDec: decodeUsername(rcUser.user.name),
      } : null,
      keycloakUser: keycloakUser ? {
        ...keycloakUser,
        usernameDec: decodeUsername(keycloakUser.username),
      } : null
    };
  }
}

export default ChangeUsername;
