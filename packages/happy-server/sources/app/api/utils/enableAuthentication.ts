import { Fastify } from "../types";
import { log } from "@/utils/log";
import { auth } from "@/app/auth/auth";
import { activityCache } from "@/app/presence/sessionCache";

const MACHINE_ID_HEADER = "x-happy-machine-id";

export function enableAuthentication(app: Fastify) {
    app.decorate("authenticate", async function (request: any, reply: any) {
        try {
            const verified = await verifyBearerRequest(request);
            if (!verified) {
                log({ module: "auth-decorator" }, `Auth failed - invalid token for ${request.url}`);
                return reply.code(401).send({ error: "Invalid token" });
            }

            request.userId = verified.userId;
        } catch (error) {
            return reply.code(401).send({ error: "Authentication failed" });
        }
    });

    app.decorate("authenticateMachineScopedCallback", async function (request: any, reply: any) {
        try {
            const authHeader = request.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - missing or invalid header for ${request.url}`);
                return reply.code(401).send({ error: "Missing authorization header" });
            }

            const token = authHeader.substring(7);
            const verified = await auth.verifySupervisorCallbackToken(token);
            if (!verified) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - invalid callback token for ${request.url}`);
                return reply.code(401).send({ error: "Invalid callback token" });
            }

            const machineIdHeader = request.headers[MACHINE_ID_HEADER];
            const machineId = Array.isArray(machineIdHeader) ? machineIdHeader[0] : machineIdHeader;
            if (!machineId || typeof machineId !== "string") {
                log({ module: "auth-decorator" }, `Machine callback auth failed - missing machine id for ${request.url}`);
                return reply.code(401).send({ error: "Missing machine id header" });
            }
            if (machineId !== verified.machineId) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - machine header mismatch for ${request.url}`);
                return reply.code(403).send({ error: "Machine mismatch" });
            }

            const isValidMachine = await activityCache.isMachineValid(machineId, verified.userId);
            if (!isValidMachine) {
                log({ module: "auth-decorator" }, `Machine callback auth failed - invalid machine ${machineId} for ${request.url}`);
                return reply.code(403).send({ error: "Invalid machine" });
            }

            request.userId = verified.userId;
            request.machineId = machineId;
            request.supervisorCallbackAuth = verified;
        } catch (error) {
            return reply.code(401).send({ error: "Authentication failed" });
        }
    });
}

async function verifyBearerRequest(request: any): Promise<{ userId: string; extras?: any } | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        log({ module: "auth-decorator" }, `Auth failed - missing or invalid header for ${request.url}`);
        return null;
    }

    const token = authHeader.substring(7);
    return await auth.verifyToken(token);
}
