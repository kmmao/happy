import chalk from 'chalk';
import type { SDKMessage, SDKAssistantMessage, SDKResultMessage, SDKSystemMessage, SDKUserMessage } from '@/claude/sdk';
import { logger } from './logger';

export type OnAssistantResultCallback = (result: SDKResultMessage) => void | Promise<void>;

/**
 * Formats Claude SDK messages for terminal display
 */
export function formatClaudeMessage(
    message: SDKMessage,
    onAssistantResult?: OnAssistantResultCallback
): void {
    logger.debugLargeJson('[CLAUDE] Message from non interactive & remote mode:', message)

    switch (message.type) {
        case 'system': {
            const sysMsg = message as SDKSystemMessage;
            if (sysMsg.subtype === 'init') {
                logger.print(chalk.gray('─'.repeat(60)));
                logger.print(chalk.blue.bold('🚀 Session initialized:'), chalk.cyan(sysMsg.session_id ?? 'pending'));
                logger.print(chalk.gray(`  Model: ${sysMsg.model}`));
                logger.print(chalk.gray(`  CWD: ${sysMsg.cwd}`));
                if (sysMsg.tools && sysMsg.tools.length > 0) {
                    logger.print(chalk.gray(`  Tools: ${sysMsg.tools.join(', ')}`));
                }
                logger.print(chalk.gray('─'.repeat(60)));
            }
            break;
        }

        case 'user': {
            const userMsg = message as SDKUserMessage;
            // Handle different types of user message content
            if (userMsg.message && typeof userMsg.message === 'object' && 'content' in userMsg.message) {
                const content = userMsg.message.content;
                
                // Handle string content
                if (typeof content === 'string') {
                    logger.print(chalk.magenta.bold('\n👤 User:'), content);
                } 
                // Handle array content (can contain text blocks and tool result blocks)
                else if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === 'text') {
                            logger.print(chalk.magenta.bold('\n👤 User:'), block.text);
                        } else if (block.type === 'tool_result') {
                            logger.print(chalk.green.bold('\n✅ Tool Result:'), chalk.gray(`(Tool ID: ${block.tool_use_id})`));
                            if (block.content) {
                                const outputStr = typeof block.content === 'string' 
                                    ? block.content 
                                    : JSON.stringify(block.content, null, 2);
                                const maxLength = 200;
                                if (outputStr.length > maxLength) {
                                    logger.print(outputStr.substring(0, maxLength) + chalk.gray('\n... (truncated)'));
                                } else {
                                    logger.print(outputStr);
                                }
                            }
                        }
                    }
                }
                // Handle other content types
                else {
                    logger.print(chalk.magenta.bold('\n👤 User:'), JSON.stringify(content, null, 2));
                }
            }
            break;
        }

        case 'assistant': {
            const assistantMsg = message as SDKAssistantMessage;
            if (assistantMsg.message && assistantMsg.message.content) {
                logger.print(chalk.cyan.bold('\n🤖 Assistant:'));
                
                // Handle content array (can contain text blocks and tool use blocks)
                for (const block of assistantMsg.message.content) {
                    if (block.type === 'text') {
                        logger.print(block.text);
                    } else if (block.type === 'tool_use') {
                        logger.print(chalk.yellow.bold(`\n🔧 Tool: ${block.name}`));
                        if (block.input) {
                            const inputStr = JSON.stringify(block.input, null, 2);
                            const maxLength = 500;
                            if (inputStr.length > maxLength) {
                                logger.print(chalk.gray('Input:'), inputStr.substring(0, maxLength) + chalk.gray('\n... (truncated)'));
                            } else {
                                logger.print(chalk.gray('Input:'), inputStr);
                            }
                        }
                    }
                }
            }
            break;
        }

        case 'result': {
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.subtype === 'success') {
                if ('result' in resultMsg && resultMsg.result) {
                    logger.print(chalk.green.bold('\n✨ Summary:'));
                    logger.print(resultMsg.result);
                }
                
                // Show usage stats
                if (resultMsg.usage) {
                    logger.print(chalk.gray('\n📊 Session Stats:'));
                    logger.print(chalk.gray(`  • Turns: ${resultMsg.num_turns}`));
                    logger.print(chalk.gray(`  • Input tokens: ${resultMsg.usage.input_tokens}`));
                    logger.print(chalk.gray(`  • Output tokens: ${resultMsg.usage.output_tokens}`));
                    if (resultMsg.usage.cache_read_input_tokens) {
                        logger.print(chalk.gray(`  • Cache read tokens: ${resultMsg.usage.cache_read_input_tokens}`));
                    }
                    if (resultMsg.usage.cache_creation_input_tokens) {
                        logger.print(chalk.gray(`  • Cache creation tokens: ${resultMsg.usage.cache_creation_input_tokens}`));
                    }
                    logger.print(chalk.gray(`  • Cost: $${resultMsg.total_cost_usd.toFixed(4)}`));
                    logger.print(chalk.gray(`  • Duration: ${resultMsg.duration_ms}ms`));

                    // Show instructions how to take over terminal control
                    logger.print(chalk.gray('\n👀 Back already?'));
                    logger.print(chalk.green('👉 Press any key to continue your session in `claude`'));

                    // Call the assistant result callback after showing instructions
                    if (onAssistantResult) {
                        Promise.resolve(onAssistantResult(resultMsg)).catch(err => {
                            logger.debug('Error in onAssistantResult callback:', err);
                        });
                    }
                }
            } else if (resultMsg.subtype === 'error_max_turns') {
                logger.print(chalk.red.bold('\n❌ Error: Maximum turns reached'));
                logger.print(chalk.gray(`Completed ${resultMsg.num_turns} turns`));
            } else if (resultMsg.subtype === 'error_during_execution') {
                logger.print(chalk.red.bold('\n❌ Error during execution'));
                logger.print(chalk.gray(`Completed ${resultMsg.num_turns} turns before error`));
                logger.debugLargeJson('[RESULT] Error during execution', resultMsg)
            }
            break;
        }

        default: {
            // Handle other message types
            if (process.env.DEBUG) {
                logger.print(chalk.gray(`[Unknown message type: ${message.type}]`));
            }
        }
    }
}

/**
 * Prints a divider in the terminal
 */
export function printDivider(): void {
    logger.print(chalk.gray('═'.repeat(60)));
}

/**
 * Prints a status message
 */
export function printStatus(message: string): void {
    logger.print(chalk.blue.bold(`ℹ️  ${message}`));
}