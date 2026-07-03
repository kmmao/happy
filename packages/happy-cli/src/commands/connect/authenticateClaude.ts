/**
 * Anthropic authentication helper
 * 
 * Provides OAuth authentication flow for Anthropic Claude
 * Uses local callback server to handle OAuth redirect
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { openBrowser } from '@/utils/browser';
import { ClaudeAuthTokens } from './types';
import { generatePKCE, findAvailablePort, isPortAvailable } from './oauthUtils';
import { logger } from '@/ui/logger';

// Anthropic OAuth Configuration for Claude.ai
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_AI_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const DEFAULT_PORT = 54545;
const SCOPE = 'user:inference';

/**
 * Generate random state for OAuth security
 */
function generateState(): string {
    return randomBytes(32).toString('base64url');
}

/**
 * Exchange authorization code for tokens
 * The Anthropic SDK actually creates an API key, not standard OAuth tokens
 */
async function exchangeCodeForTokens(
    code: string,
    verifier: string,
    port: number,
    state: string
): Promise<ClaudeAuthTokens> {

    // Exchange code for tokens
    const tokenResponse = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: `http://localhost:${port}/callback`,
            client_id: CLIENT_ID,
            code_verifier: verifier,
            state: state,
        }),
    });
    if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    // {
    //     token_type: 'Bearer',
    //     access_token: string,
    //     expires_in: number,
    //     refresh_token: string,
    //     scope: 'user:inference',
    //     organization: {
    //       uuid: string,
    //       name: string
    //     },
    //     account: {
    //       uuid: string,
    //       email_address: string
    //     }
    //   }
    const tokenData = await tokenResponse.json() as any;

    return {
        raw: tokenData,
        token: tokenData.access_token,
        expires: Date.now() + tokenData.expires_in * 1000,
    };
}

/**
 * Start local server to handle OAuth callback
 */
async function startCallbackServer(
    state: string,
    verifier: string,
    port: number
): Promise<ClaudeAuthTokens> {
    return new Promise((resolve, reject) => {
        const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url!, `http://localhost:${port}`);

            if (url.pathname === '/callback') {
                const code = url.searchParams.get('code');
                const receivedState = url.searchParams.get('state');

                if (receivedState !== state) {
                    res.writeHead(400);
                    res.end('Invalid state parameter');
                    server.close();
                    reject(new Error('Invalid state parameter'));
                    return;
                }

                if (!code) {
                    res.writeHead(400);
                    res.end('No authorization code received');
                    server.close();
                    reject(new Error('No authorization code received'));
                    return;
                }

                try {
                    // Exchange code for tokens
                    const tokens = await exchangeCodeForTokens(code, verifier, port, state);

                    // Redirect to Anthropic's success page
                    res.writeHead(302, {
                        'Location': 'https://console.anthropic.com/oauth/code/success?app=claude-code'
                    });
                    res.end();

                    server.close();
                    resolve(tokens);
                } catch (error) {
                    res.writeHead(500);
                    res.end('Token exchange failed');
                    server.close();
                    reject(error);
                }
            }
        });

        server.listen(port, '127.0.0.1', () => {
        });

        // Timeout after 5 minutes
        setTimeout(() => {
            server.close();
            reject(new Error('Authentication timeout'));
        }, 5 * 60 * 1000);
    });
}

/**
 * Authenticate with Anthropic Claude and return tokens
 * 
 * This function handles the complete OAuth flow:
 * 1. Generates PKCE codes and state
 * 2. Starts local callback server
 * 3. Opens browser for authentication
 * 4. Handles callback and token exchange
 * 5. Returns complete token object
 * 
 * @returns Promise resolving to AnthropicAuthTokens with all token information
 */
export async function authenticateClaude(): Promise<ClaudeAuthTokens> {
    logger.print('🚀 Starting Anthropic Claude authentication...');

    // Generate PKCE codes and state
    const { verifier, challenge } = generatePKCE();
    const state = generateState();

    // Try to use default port, or find an available one
    let port = DEFAULT_PORT;
    const portAvailable = await isPortAvailable(port);

    if (!portAvailable) {
        logger.print(`Port ${port} is in use, finding an available port...`);
        port = await findAvailablePort();
    }

    logger.print(`📡 Using callback port: ${port}`);

    // Start callback server FIRST (before opening browser)
    const serverPromise = startCallbackServer(state, verifier, port);

    // Wait a moment to ensure server is listening
    await new Promise(resolve => setTimeout(resolve, 100));

    // Build authorization URL
    const redirect_uri = `http://localhost:${port}/callback`;

    // Build authorization URL with code=true for Claude.ai
    const params = new URLSearchParams({
        code: 'true',  // This tells Claude.ai to show the code AND redirect
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirect_uri,
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: state,
    });

    const authUrl = `${CLAUDE_AI_AUTHORIZE_URL}?${params}`;

    logger.print('📋 Opening browser for authentication...');
    logger.print('If browser doesn\'t open, visit this URL:');
    logger.print();
    logger.print(`${authUrl}`);
    logger.print();

    // Open browser AFTER server is running
    await openBrowser(authUrl);

    // Wait for authentication and return tokens
    try {
        const tokens = await serverPromise;

        logger.print('🎉 Authentication successful!');
        logger.print('✅ OAuth tokens received');

        return tokens;
    } catch (error) {
        logger.printError('\n❌ Failed to authenticate with Anthropic');
        throw error;
    }
}