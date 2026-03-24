import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = {
    serverUrl: string;
    webappUrl: string;
    homeDir: string;
    credentialPath: string;
};

export function loadConfig(): Config {
    const serverUrl = (process.env.HAPPY_SERVER_URL ?? 'https://happyserve.xycloud.info').replace(/\/+$/, '');
    const webappUrl = (process.env.HAPPY_WEBAPP_URL ?? 'https://happyapp.xycloud.info').replace(/\/+$/, '');
    const homeDir = process.env.HAPPY_HOME_DIR ?? join(homedir(), '.happy');
    const credentialPath = join(homeDir, 'agent.key');
    return { serverUrl, webappUrl, homeDir, credentialPath };
}
