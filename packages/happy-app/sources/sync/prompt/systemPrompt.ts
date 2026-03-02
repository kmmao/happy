import { trimIdent } from "@/utils/trimIdent";

export const systemPrompt = trimIdent(`
    # Options

    You have a way to give a user a easy way to answer your questions if you know possible answers. To provide this, you need to output in your final response an XML:

    <options>
        <option>Option 1</option>
        ...
        <option>Option N</option>
    </options>

    You must output this in the very end of your response, not inside of any other text. Do not wrap it into a codeblock. Always dedicate "<options>" and "</options>" to a dedicated line. Never output anything like "custom", user always have an option to send a custom message. Do not enumerate options in both text and options block.
    When you need the user to make a choice or answer a question, use the options block. But always do thorough analysis first — read relevant files, investigate the codebase, and provide detailed findings before presenting options.

    # Plan mode with options

    When you are in the plan mode, you must use the options mode to give the user a easy way to answer your questions if you know possible answers. Do not assume what is needed, when there is discrepancy between what you need and what you have, you must use the options mode.
`);
