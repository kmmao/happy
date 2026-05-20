import type { FastifyReply, FastifyRequest } from "fastify";
import { Fastify } from "../types";
import { log } from "@/utils/log";
import { auth } from "@/app/auth/auth";
import { activityCache } from "@/app/presence/sessionCache";
import { apiError } from "./apiError";

const MACHINE_ID_HEADER = "x-happy-machine-id";

export function enableAuthentication(app: Fastify) {
    app.decorate("authenticate", async function (request: FastifyRequest, reply: FastifyReply) {
        try {
            const verified = await verifyBearerRequest(request);
            if (!verified) {
                log({ module: "auth-decorator" }, `Auth failed - invalid token for ${request.url}`);
                return reply.code(401).send(apiError('invalid-token', 'Invalid token'));
            }

            request.userId = verified.userId;
        } catch (error) {
            return reply.code(401).send(apiError('authentication-failed', 'Authentication failed'));
        }
    });

    app.decorate("authenticateMachineScopedCallback", async function (request: FastifyRequest, reply: FastifyReply) {
        try {
            const authHeader = request.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - missing or invalid header for ${request.url}`);
                return reply.code(401).send(apiError('missing-authorization', 'Missing authorization header'));
            }

            const token = authHeader.substring(7);
            const verified = await auth.verifySupervisorCallbackToken(token);
            if (!verified) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - invalid callback token for ${request.url}`);
                return reply.code(401).send(apiError('invalid-callback-token', 'Invalid callback token'));
            }

            const machineIdHeader = request.headers[MACHINE_ID_HEADER];
            const machineId = Array.isArray(machineIdHeader) ? machineIdHeader[0] : machineIdHeader;
            if (!machineId || typeof machineId !== "string") {
                log({ module: "auth-decorator" }, `Machine callback auth failed - missing machine id for ${request.url}`);
                return reply.code(401).send(apiError('missing-machine-id', 'Missing machine id header'));
            }
            if (machineId !== verified.machineId) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - machine header mismatch for ${request.url}`);
                return reply.code(403).send(apiError('machine-mismatch', 'Machine mismatch'));
            }

            const isValidMachine = await activityCache.isMachineValid(machineId, verified.userId);
            if (!isValidMachine) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - invalid machine ${machineId} for ${request.url}`);
                return reply.code(403).send(apiError('invalid-machine', 'Invalid machine'));
            }

            request.userId = verified.userId;
            request.machineId = machineId;
            request.supervisorCallbackAuth = verified;
        } catch (error) {
            return reply.code(401).send(apiError('authentication-failed', 'Authentication failed'));
        }
    });
}

async function verifyBearerRequest(request: FastifyRequest): Promise<{ userId: string; uuid?: string; extras?: any } | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        log({ module: "auth-decorator" }, `Auth failed - missing or invalid header for ${request.url}`);
        return null;
    }

    const token = authHeader.substring(7);
    return await auth.verifyToken(token);
}
