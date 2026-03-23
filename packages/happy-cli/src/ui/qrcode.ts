import qrcode from 'qrcode-terminal';
import { logger } from '@/ui/logger';

/**
 * Display a QR code in the terminal for the given URL
 */
export function displayQRCode(url: string): void {
  logger.print('='.repeat(80));
  logger.print('📱 To authenticate, scan this QR code with your mobile device:');
  logger.print('='.repeat(80));
  qrcode.generate(url, { small: true }, (qr) => {
    for (let l of qr.split('\n')) {
      logger.print(' '.repeat(10) + l);
    }
  });
  logger.print('='.repeat(80));
} 