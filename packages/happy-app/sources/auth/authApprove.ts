
import axios from 'axios';
import { encodeBase64 } from "../encryption/base64";
import { getServerUrl } from "@/sync/serverConfig";
import { log } from '@/log';

export interface AuthRequestStatus {
    status: 'not_found' | 'pending' | 'authorized';
    supportsV2: boolean;
}

export interface AuthApprovalResponses {
    responseV1?: Uint8Array | null;
    responseV2?: Uint8Array | null;
}

export async function getTerminalAuthRequestStatus(publicKey: Uint8Array): Promise<AuthRequestStatus> {
    const API_ENDPOINT = getServerUrl();
    const publicKeyBase64 = encodeBase64(publicKey);
    const statusResponse = await axios.get<AuthRequestStatus>(
        `${API_ENDPOINT}/v1/auth/request/status`,
        {
            params: {
                publicKey: publicKeyBase64,
            },
        },
    );
    return statusResponse.data;
}

function selectApprovalResponse(
    status: AuthRequestStatus,
    responses: AuthApprovalResponses,
): string {
    if (status.supportsV2) {
        if (!responses.responseV2) {
            throw new Error("missing V2 response for terminal auth approval");
        }
        return encodeBase64(responses.responseV2);
    }

    if (!responses.responseV1) {
        throw new Error("missing V1 response for terminal auth approval");
    }

    return encodeBase64(responses.responseV1);
}

export async function authApprove(
    token: string,
    publicKey: Uint8Array,
    responses: AuthApprovalResponses,
) {
    const API_ENDPOINT = getServerUrl();
    const publicKeyBase64 = encodeBase64(publicKey);
    const { status, supportsV2 } = await getTerminalAuthRequestStatus(publicKey);

    // Handle different status cases
    if (status === 'not_found') {
        // Already authorized, no need to approve again
        log.log('Auth request already authorized or not found');
        return;
    }
    
    if (status === 'authorized') {
        // Already authorized, no need to approve again
        log.log('Auth request already authorized');
        return;
    }
    
    // Handle pending status
    if (status === 'pending') {
        const response = selectApprovalResponse({ status, supportsV2 }, responses);
        await axios.post(`${API_ENDPOINT}/v1/auth/response`, {
            publicKey: publicKeyBase64,
            response,
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
    }
}
