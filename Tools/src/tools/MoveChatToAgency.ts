import logger from "../helper/logger.js";
import rocketChatService from "../helper/rocketChatService.js";
import ToolsError from "../helper/ToolsError.js";
import {mysqlFn} from "../index.js";
import AbstractTool from "./AbstractTool.js";

class MoveChatToAgency extends AbstractTool {
    constructor() {
        super('POST', undefined, [
            { name: 'roomId', description: 'The roomId of the session or chat to move.', type: 'string' },
            { name: 'agencyId', description: 'The agencyId to move the session or chat to.', type: 'number' },
        ]);
    }

    async run(params: {}, body: { roomId: string, agencyId: number }): Promise<boolean> {
        return await moveChatToAgency(body.roomId, body.agencyId);
    }
}

export default MoveChatToAgency;

const moveChatToAgency = async (roomId: string, targetAgencyId: number) => {
    const sessions = await mysqlFn<any>(
        'query',
        `SELECT * FROM userservice.session WHERE rc_group_id = "${roomId}" or rc_feedback_group_id = "${roomId}"`
    );
    const chats = await mysqlFn<any>(
        'query',
        `SELECT * FROM userservice.chat WHERE rc_group_id = "${roomId}"`
    );

    if (sessions.length === 0 && chats.length === 0) {
        throw new ToolsError(`No session or chat found for roomId "${roomId}".`);
    } else if (sessions.length >= 1 && chats.length >= 1) {
        throw new ToolsError(`Sessions and chats found for roomId "${roomId}". Please pass a sessionId instead of a roomId!`);
    } else if (sessions.length > 1) {
        throw new ToolsError(`Multiple sessions found for roomId "${roomId}". Please pass a sessionId instead of a roomId!`);
    } else if (chats.length > 1) {
        throw new ToolsError(`Multiple chats found for roomId "${roomId}". Please pass a sessionId instead of a roomId!`);
    } else if (chats.length === 1) {
        throw new ToolsError(`Move of group chats is currently not supported!`);
    }

    const session = sessions[0];

    if (session.rc_feedback_group_id) {
        throw new ToolsError(`Move sessions with attached feedback chat is currently not supported.`);
    }

    if (session.consultant_id) {
        throw new ToolsError(`Move already assigned sessions is currently not supported.`);
    }

    const currentAgencyId = session.agency_id;
    if (currentAgencyId === targetAgencyId) {
        throw new ToolsError(`Session is already assigned to target agency "${targetAgencyId}".`);
    }

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

    const sourceAgency = await loadAgencyData(currentAgencyId);
    const targetAgency = await loadAgencyData(targetAgencyId);

    // Add all targetAgency consultants to the chat
    for (const consultant of targetAgency.consultants) {
        try {
            await logger.info(`Adding consultant ${consultant.consultant_id} to chat ${roomId} ...`);
            await rocketChatService.post('groups.invite', {
                userId: consultant.rc_user_id,
                roomId,
            });
        } catch (e) {
            throw new ToolsError(`Error adding user to group!`);
        }
    }

    // Now open the chat with a consultant from the source agency

    try {
        // Add technical user to room
        await rocketChatService.post('groups.invite', {
            userId: rocketChatService.currentLogin?.userId,
            roomId
        });

        // Check if group is e2e encrypted and if so, if all consultants have a e2ee key
        const groupInfo = await rocketChatService.get('groups.info', { roomId });
        if (groupInfo.group.e2eKeyId) {
            // Check if all new consultants have a e2ee key
            const usersOfRoomWithoutKey = await rocketChatService.get('e2e.getUsersOfRoomWithoutKey', {
                rid: roomId
            });
            if (!targetAgency.consultants.every(
                (consultant: {rc_user_id: string}) => !usersOfRoomWithoutKey.users.find((user: {_id: string}) => user._id === consultant.rc_user_id)
            )) {
                throw new ToolsError(`Not all consultants of target agency have a e2ee key! Open the chat with a source agency consultant!`);
            }
        }

        // Switch agency in MariaDB
        await mysqlFn<any>(
            'query',
            `UPDATE userservice.session 
                    SET agency_id = ${targetAgency.agency.id},
                    consulting_type = ${targetAgency.agency.consulting_type}
                    WHERE id = ${session.id}`
        );

        // Remove all sourceAgency consultants from the chat
        for (const consultant of sourceAgency.consultants) {
            await logger.info(`Removing consultant ${consultant.consultant_id} to chat ${roomId} ...`);
            await rocketChatService.post('groups.kick', {
                userId: consultant.rc_user_id,
                roomId,
            });
        }
    } catch (e) {
        // Remove technical user from room
        await rocketChatService.post('groups.leave', { roomId });
        throw e;
    }
    return true;
}