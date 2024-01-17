import AbstractTool, {Methods, PugTemplate} from "../AbstractTool.js";
import {mysqlFn} from "../../index.js";
import rocketChatService from "../../helper/rocketChatService.js";
import ToolsError from "../../helper/ToolsError.js";
import { AxiosError } from "axios";
import logger from "../../helper/logger.js";

type Counts = {
  session: {
    added: number,
    already: number,
    skipped: number,
  },
  feedback: {
    added: number,
    already: number,
    skipped: number,
  }
};

class ReassignRCRoomsToUser extends AbstractTool {
  constructor() {
    super(['GET', 'POST'], undefined, [
      { name: 'userId', description: 'The userId (mariadb) of the consultant to reassign sessions.', type: 'string', optional: true },
      { name: 'force', description: 'Assign sessions.', type: 'boolean', optional: true },
    ]);

    this.deps = ['mysql', 'rocketchat'];
    this.path = '/user';
  }

  async run(params: any, body: any, query: any, method: Methods): Promise<PugTemplate> {
    let payload = {};

    if (method === "POST") {
      try {
        const counts = await this.post(body.userId, body.dryrun !== 'on');
        payload = {
          success: [
            `Sessions update: ${counts.session.added} added / ${counts.session.already} already / ${counts.session.skipped} skipped`,
            `Sessions update: ${counts.feedback.added} added / ${counts.feedback.already} already / ${counts.feedback.skipped} skipped`,
          ],
        };
      } catch (e) {
        payload = {
          error: e,
        };
      }
    }

    return {
      type: 'pug',
      template: 'user/reassignRCRoomsToUser',
      payload: {
        title: `Reassign user to rc rooms`,
        userId: body.userId || '',
        dryRun: body.dryrun === 'on',
        ...payload
      }
    };
  }

  async loadAgencyData(agencyId: number) {
    const data: any = {};

    // Load agency
    const agencies = await mysqlFn<any>(
      'query',
      `SELECT * FROM agencyservice.agency WHERE id = "${agencyId}"`
    );
    if (agencies.length === 0) {
      throw new ToolsError(`No agency found for agencyId "${agencyId}".`);
    }
    data.agency = agencies[0];

    const agencyConsultants = await mysqlFn<any>(
      'query',
      `SELECT c.* FROM userservice.consultant_agency ca
                    INNER JOIN userservice.consultant c ON ca.consultant_id = c.consultant_id 
                    WHERE ca.agency_id = "${agencyId}"`
    );
    if (agencyConsultants.length === 0) {
      throw new ToolsError(`No consultants assigned to agency "${agencyId}".`);
    }

    data.consultants = agencyConsultants;

    return data;
  }

  async assignRoom<T>(roomId: string, id: number, consultant: any, force: boolean = false): Promise<T> {
    try {
      // Add technical user to room
      await rocketChatService.post('groups.invite', {
        userId: rocketChatService.currentLogin?.userId,
        roomId,
      });
    } catch (e: unknown) {
      if (e instanceof AxiosError) {
        if (e.response?.data?.errorType === 'error-room-not-found') {
          await logger.error(`Room "${roomId}" of consultant "${consultant.rc_user_id}" not found in rocket.chat.`);
          return 'skipped' as T;
        }
        await logger.error(`Error assigning technical user to "${roomId}" of consultant "${consultant.rc_user_id}".`, JSON.stringify(e.response?.data || "{}"));
      }
      throw e;
    }

    const { members } = await rocketChatService.get('groups.members', { roomId, offset: 0, count: 0 });
    if (members.find((member: {_id: string}) => member._id === consultant.rc_user_id)) {
      await logger.info(`Consultant "${consultant.rc_user_id}" already member of session "${roomId}" / "${id}".`);
      // Remove technical user from room
      await rocketChatService.post('groups.leave', { roomId });
      return 'already' as T;
    }

    await logger.info(`Adding consultant "${consultant.rc_user_id}" to session "${roomId}" / "${id}".`);
    if (force) {
      await rocketChatService.post('groups.invite', {
        userId: consultant.rc_user_id,
        roomId
      });
    } else {
      await logger.info(`Doing nothing. Force is not set`);
    }

    // Remove technical user from room
    await rocketChatService.post('groups.leave', { roomId });
    return 'added' as T;
  }

  async post(userId: string, force: boolean = false): Promise<Counts> {
    const counts = {
      session: {
        added: 0,
        already: 0,
        skipped: 0,
      },
      feedback: {
        added: 0,
        already: 0,
        skipped: 0,
      }
    };

    const consultants = await mysqlFn<any>(
      'query',
      `SELECT * FROM userservice.consultant WHERE consultant_id = "${userId}"`
    );

    if (consultants.length === 0) {
      throw new ToolsError(`No consultant found for userId "${userId}".`);
    } else if (consultants.length > 1) {
      throw new ToolsError(`Multiple consultants found for userId "${userId}".`);
    }

    const consultant = consultants[0];

    const consultantAgencies = await mysqlFn<any>(
      'query',
      `SELECT * FROM userservice.consultant_agency 
                WHERE consultant_id = "${consultant.consultant_id}"
                AND delete_date IS NULL
                `
    );

    if (consultantAgencies.length === 0) {
      throw new ToolsError(`No consultant agency found for consultant "${userId}".`);
    } else if (consultantAgencies.length > 1) {
      throw new ToolsError(`Multiple consultant agencies currently not supported!`);
    }

    const consultantAgency = consultantAgencies[0];

    const agencyData = await this.loadAgencyData(consultantAgency.agency_id);

    let agencySessions = [];
    if (agencyData.agency.is_team_agency) {
      agencySessions = await mysqlFn<any>(
        'query',
        `SELECT s.* FROM userservice.session s
                    WHERE s.agency_id = "${agencyData.agency.id}"`
      );
    } else {
      agencySessions = await mysqlFn<any>(
        'query',
        `SELECT s.* FROM userservice.session s
                    WHERE (s.consultant_id IS NULL AND s.status = 1 AND s.agency_id = "${agencyData.agency.id}") 
                    OR s.consultant_id = "${userId}" AND s.agency_id = "${agencyData.agency.id}"`
      );
    }

    if (agencySessions.length === 0) {
      throw new ToolsError(`No sessions found for agency "${agencyData.agency.id}".`);
    }

    for (const agencySession of agencySessions) {
      try {
        const sRes = await this.assignRoom<keyof Counts['session']>(agencySession.rc_group_id, agencySession.id, consultant, force);
        counts.session[sRes]++;

        if (agencySession.rc_feedback_group_id) {
          const fRes = await this.assignRoom<keyof Counts['feedback']>(agencySession.rc_feedback_group_id, agencySession.id, consultant, force);
          counts.feedback[fRes]++;
        }
      } catch (e) {
        // Remove technical user from room
        await rocketChatService.post('groups.leave', { roomId: agencySession.rc_group_id });
        throw e;
      }
    }

    return counts;
  }
}

export default ReassignRCRoomsToUser;
