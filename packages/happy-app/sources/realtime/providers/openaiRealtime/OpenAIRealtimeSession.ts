import { storage } from '@/sync/storage';
import { config as appConfig } from '@/config';
import { createLiveCall } from '@/sync/apiLive';
import { realtimeClientTools } from '../../realtimeClientTools';
import type { VoiceSession, VoiceSessionConfig } from '../../types';
import {
    contextItemEvent,
    functionCallOutputEvent,
    parseServerEvent,
    responseCreateEvent,
    userTextItemEvent,
    type RealtimeServerEvent,
} from './events';
import { buildSessionConfig } from './sessionConfig';
import { createRealtimeTransport } from './transport';
import type { RealtimeTransport } from './transportTypes';

/**
 * Voice assistant backed by an OpenAI Realtime compatible gateway.
 *
 * Unlike the ElevenLabs provider, the prompt and the tool schemas live on the
 * client (see `sessionConfig.ts`), and every event travels over the WebRTC
 * `oai-events` data channel — the gateway's sideband WebSocket is not used.
 */

type ClientToolName = keyof typeof realtimeClientTools;

function isClientToolName(name: string): name is ClientToolName {
    return Object.prototype.hasOwnProperty.call(realtimeClientTools, name);
}

export class OpenAIRealtimeSession implements VoiceSession {
    private transport: RealtimeTransport | null = null;

    async startSession(config: VoiceSessionConfig): Promise<void> {
        if (this.transport) {
            await this.endSession();
        }

        // Settings win over the build-time defaults from EXPO_PUBLIC_* vars.
        const settings = storage.getState().settings;
        const baseUrl = settings.realtimeGatewayUrl?.trim() || appConfig.realtimeGatewayUrl?.trim();
        const apiKey =
            settings.realtimeGatewayApiKey?.trim() || appConfig.realtimeGatewayApiKey?.trim();
        if (!baseUrl || !apiKey) {
            throw new Error('Realtime gateway is not configured');
        }

        const session = buildSessionConfig({
            sessionId: config.sessionId,
            initialContext: config.initialContext,
            language: settings.voiceAssistantLanguage,
            voice: settings.realtimeVoice ?? appConfig.realtimeVoice,
        });

        storage.getState().setRealtimeStatus('connecting');

        const transport = createRealtimeTransport({
            onOpen: () => {
                storage.getState().setRealtimeStatus('connected');
                storage.getState().setRealtimeMode('idle', true);
            },
            onEvent: (raw) => this.handleEvent(raw),
            onError: (error) => {
                console.warn('Realtime voice error:', error.message);
                storage.getState().setRealtimeStatus('error');
            },
            onClose: () => {
                this.transport = null;
                storage.getState().clearRealtimeModeDebounce();
                storage.getState().setRealtimeMode('idle', true);
                if (storage.getState().realtimeStatus !== 'error') {
                    storage.getState().setRealtimeStatus('disconnected');
                }
            },
        });
        this.transport = transport;

        try {
            await transport.connect(async (offerSdp) => {
                const result = await createLiveCall({ baseUrl, apiKey, sdp: offerSdp, session });
                return result.answerSdp;
            });
        } catch (error) {
            transport.close();
            this.transport = null;
            storage.getState().setRealtimeStatus('error');
            throw error;
        }
    }

    async endSession(): Promise<void> {
        this.transport?.close();
        this.transport = null;
        storage.getState().setRealtimeStatus('disconnected');
    }

    sendTextMessage(message: string): void {
        if (!this.transport) return;
        this.transport.send(userTextItemEvent(message));
        this.transport.send(responseCreateEvent());
    }

    sendContextualUpdate(update: string): void {
        // Queued without `response.create` so background context never
        // interrupts whatever the user is saying.
        this.transport?.send(contextItemEvent(update));
    }

    private handleEvent(raw: string): void {
        const event = parseServerEvent(raw);
        if (!event) return;

        switch (event.type) {
            case 'input_audio_buffer.speech_started':
                storage.getState().setRealtimeMode('listening', true);
                break;
            case 'input_audio_buffer.speech_stopped':
                storage.getState().setRealtimeMode('thinking');
                break;
            case 'output_audio_buffer.started':
                storage.getState().setRealtimeMode('speaking', true);
                break;
            case 'output_audio_buffer.stopped':
            case 'output_audio_buffer.cleared':
                storage.getState().setRealtimeMode('idle');
                break;
            case 'response.function_call_arguments.done':
                void this.runClientTool(event);
                break;
            case 'error':
                console.warn(
                    'Realtime server error:',
                    event.error.message ?? event.error.code ?? event.error.type ?? 'unknown',
                );
                break;
            default:
                break;
        }
    }

    private async runClientTool(
        event: Extract<RealtimeServerEvent, { type: 'response.function_call_arguments.done' }>,
    ): Promise<void> {
        const output = await this.invokeTool(event.name, event.arguments);
        const transport = this.transport;
        if (!transport) return;
        transport.send(functionCallOutputEvent(event.call_id, output));
        transport.send(responseCreateEvent());
    }

    private async invokeTool(name: string, rawArguments: string): Promise<string> {
        if (!isClientToolName(name)) {
            return `error (unknown tool ${name})`;
        }

        let parameters: unknown;
        try {
            parameters = rawArguments ? JSON.parse(rawArguments) : {};
        } catch {
            return 'error (tool arguments were not valid JSON)';
        }

        try {
            return await realtimeClientTools[name](parameters);
        } catch (error) {
            console.error(`Realtime tool ${name} failed:`, error);
            return `error (tool ${name} failed)`;
        }
    }
}
