import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { log } from '@/log';

const AUTH_KEY = 'auth_credentials';

// SECURITY: Web platform uses sessionStorage which is accessible to any JS running in the
// same origin (XSS risk). Native platforms use expo-secure-store (hardware-backed keychain).
// sessionStorage is preferred over localStorage: credentials are cleared when the tab closes,
// reducing the exposure window. A fully secure web solution would require httpOnly cookies
// with server-side session management — out of scope while web remains a secondary platform.

// Cache for synchronous access
let credentialsCache: string | null = null;

export interface AuthCredentials {
    token: string;
    secret: string;
}

export const TokenStorage = {
    async getCredentials(): Promise<AuthCredentials | null> {
        if (Platform.OS === 'web') {
            return sessionStorage.getItem(AUTH_KEY) ? JSON.parse(sessionStorage.getItem(AUTH_KEY)!) as AuthCredentials : null;
        }
        try {
            const stored = await SecureStore.getItemAsync(AUTH_KEY);
            if (!stored) return null;
            credentialsCache = stored; // Update cache
            return JSON.parse(stored) as AuthCredentials;
        } catch (error) {
            log.error('Error getting credentials:', error);
            return null;
        }
    },

    async setCredentials(credentials: AuthCredentials): Promise<boolean> {
        if (Platform.OS === 'web') {
            sessionStorage.setItem(AUTH_KEY, JSON.stringify(credentials));
            return true;
        }
        try {
            const json = JSON.stringify(credentials);
            await SecureStore.setItemAsync(AUTH_KEY, json);
            credentialsCache = json; // Update cache
            return true;
        } catch (error) {
            log.error('Error setting credentials:', error);
            return false;
        }
    },

    async removeCredentials(): Promise<boolean> {
        if (Platform.OS === 'web') {    
            sessionStorage.removeItem(AUTH_KEY);
            return true;
        }
        try {
            await SecureStore.deleteItemAsync(AUTH_KEY);
            credentialsCache = null; // Clear cache
            return true;
        } catch (error) {
            log.error('Error removing credentials:', error);
            return false;
        }
    },
};