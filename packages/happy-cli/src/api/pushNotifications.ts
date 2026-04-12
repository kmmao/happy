import axios from 'axios'
import { logger } from '@/ui/logger'

export class PushNotificationClient {
    private readonly token: string
    private readonly baseUrl: string

    constructor(token: string, baseUrl: string = 'https://happyserve.xycloud.info') {
        this.token = token
        this.baseUrl = baseUrl
    }

    /**
     * Send a push notification to all registered devices for the user.
     * Delegates to the server so all token management and deduplication
     * happens in one place.
     */
    sendToAllDevices(title: string, body: string, data?: Record<string, unknown>): void {
        logger.debug(`[PUSH] sendToAllDevices called with title: "${title}", body: "${body}"`)

        ;(async () => {
            try {
                await axios.post(
                    `${this.baseUrl}/v1/push/send`,
                    { title, body, data },
                    {
                        headers: {
                            'Authorization': `Bearer ${this.token}`,
                            'Content-Type': 'application/json',
                        },
                    },
                )
                logger.debug('[PUSH] Push notification sent successfully via server')
            } catch (error) {
                logger.debug('[PUSH] Error sending push notification:', error)
            }
        })()
    }
}
