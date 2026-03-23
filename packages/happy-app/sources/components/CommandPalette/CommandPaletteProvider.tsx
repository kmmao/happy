import React, { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { Command } from './types';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { t } from '@/text';

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { logout } = useAuth();
    const sessions = storage(useShallow((state) => state.sessions));
    const commandPaletteEnabled = storage(useShallow((state) => state.localSettings.commandPaletteEnabled));
    const navigateToSession = useNavigateToSession();

    // Define available commands
    const commands = useMemo((): Command[] => {
        const cmds: Command[] = [
            // Navigation commands
            {
                id: 'new-session',
                title: t('commandPalette.newSession'),
                subtitle: t('commandPalette.newSessionSubtitle'),
                icon: 'add-circle-outline',
                category: t('commandPalette.categorySessions'),
                shortcut: '⌘N',
                action: () => {
                    router.push('/new');
                }
            },
            {
                id: 'sessions',
                title: t('commandPalette.viewAllSessions'),
                subtitle: t('commandPalette.viewAllSessionsSubtitle'),
                icon: 'chatbubbles-outline',
                category: t('commandPalette.categorySessions'),
                action: () => {
                    router.push('/');
                }
            },
            {
                id: 'settings',
                title: t('commandPalette.settings'),
                subtitle: t('commandPalette.settingsSubtitle'),
                icon: 'settings-outline',
                category: t('commandPalette.categoryNavigation'),
                shortcut: '⌘,',
                action: () => {
                    router.push('/settings');
                }
            },
            {
                id: 'account',
                title: t('commandPalette.account'),
                subtitle: t('commandPalette.accountSubtitle'),
                icon: 'person-circle-outline',
                category: t('commandPalette.categoryNavigation'),
                action: () => {
                    router.push('/settings/account');
                }
            },
            {
                id: 'connect',
                title: t('commandPalette.connectDevice'),
                subtitle: t('commandPalette.connectDeviceSubtitle'),
                icon: 'link-outline',
                category: t('commandPalette.categoryNavigation'),
                action: () => {
                    router.push('/terminal/connect');
                }
            },
        ];

        // Add session-specific commands
        const recentSessions = Object.values(sessions)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 5);

        recentSessions.forEach(session => {
            const sessionName = session.metadata?.name || `Session ${session.id.slice(0, 6)}`;
            cmds.push({
                id: `session-${session.id}`,
                title: sessionName,
                subtitle: session.metadata?.path || t('commandPalette.switchToSession'),
                icon: 'time-outline',
                category: t('commandPalette.categoryRecentSessions'),
                action: () => {
                    navigateToSession(session.id);
                }
            });
        });

        // System commands
        cmds.push({
            id: 'sign-out',
            title: t('commandPalette.signOut'),
            subtitle: t('commandPalette.signOutSubtitle'),
            icon: 'log-out-outline',
            category: t('commandPalette.categorySystem'),
            action: async () => {
                await logout();
            }
        });

        // Dev commands (if in development)
        if (__DEV__) {
            cmds.push({
                id: 'dev-menu',
                title: t('commandPalette.developerMenu'),
                subtitle: t('commandPalette.developerMenuSubtitle'),
                icon: 'code-slash-outline',
                category: t('commandPalette.categoryDeveloper'),
                action: () => {
                    router.push('/dev');
                }
            });
        }

        return cmds;
    }, [router, logout, sessions]);

    const showCommandPalette = useCallback(() => {
        if (Platform.OS !== 'web' || !commandPaletteEnabled) return;
        
        Modal.show({
            component: CommandPalette,
            props: {
                commands,
            }
        } as any);
    }, [commands, commandPaletteEnabled]);

    // Set up global keyboard handler only if feature is enabled
    useGlobalKeyboard(commandPaletteEnabled ? showCommandPalette : () => {});

    return <>{children}</>;
}