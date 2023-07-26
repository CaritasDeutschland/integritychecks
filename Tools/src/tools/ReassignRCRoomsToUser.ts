import logger from "../helper/logger.js";
import rocketChatService from "../helper/rocketChatService.js";
import ToolsError from "../helper/ToolsError.js";
import {mysqlFn} from "../index.js";
import AbstractTool from "./AbstractTool.js";
import {AxiosError} from "axios";

class ReassignRCRoomsToUser extends AbstractTool {
    constructor() {
        super('POST', undefined, [
            { name: 'userId', description: 'The userId (mariadb) of the consultant to reassign sessions.', type: 'string' },
            { name: 'force', description: 'Assign sessions.', type: 'boolean', optional: true },
        ]);

        this.deps = ['mysql', 'rocketchat'];
    }

    async run(params: {}, body: { userId: string, force: boolean }): Promise<boolean> {
        return await reassignRCRoomsToUser(body.userId, body.force);
    }
}

export default ReassignRCRoomsToUser;

const reassignRCRoomsToUser = async (userId: string, force: boolean = false) => {
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
        console.log(consultantAgencies);
        throw new ToolsError(`Multiple consultant agencies currently not supported!`);
    }

    const consultantAgency = consultantAgencies[0];

    const loadAgencyData = async (agencyId: number) => {
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

    const agencyData = await loadAgencyData(consultantAgency.agency_id);

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

    const assignRoom = async (roomId: string, id: number, force: boolean = false) => {
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
                    return false;
                }
            }
            throw e;
        }

        const { members } = await rocketChatService.get('groups.members', { roomId, offset: 0, count: 0 });
        if (members.find((member: {_id: string}) => member._id === consultant.rc_user_id)) {
            await logger.info(`Consultant "${consultant.rc_user_id}" already member of session "${roomId}" / "${id}".`);
            // Remove technical user from room
            await rocketChatService.post('groups.leave', { roomId });
            return false;
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
    }

    for (const agencySession of agencySessions) {
        try {
            await assignRoom(agencySession.rc_group_id, agencySession.id, force);
            
            if (agencySession.rc_feedback_group_id) {
                await assignRoom(agencySession.rc_feedback_group_id, agencySession.id, force);
            }
        } catch (e) {
            // Remove technical user from room
            await rocketChatService.post('groups.leave', { roomId: agencySession.rc_group_id });
            throw e;
        }
    }

    return true;
}
