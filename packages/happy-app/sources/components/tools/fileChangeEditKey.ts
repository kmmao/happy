export interface FileChangeEditEntry {
    messageId: string | null;
    oldText: string;
    newText: string;
    toolName: string;
    editIndex: number;
}

export function createFileChangeEditEntry(
    messageId: string | null,
    toolName: string,
    oldText: string,
    newText: string,
    editIndex: number,
): FileChangeEditEntry {
    return {
        messageId,
        oldText,
        newText,
        toolName,
        editIndex,
    };
}

export function getFileChangeEditKey(edit: FileChangeEditEntry): string {
    if (edit.messageId) {
        return `${edit.messageId}:${edit.editIndex}`;
    }

    return `${edit.toolName}:${edit.oldText}:${edit.newText}:${edit.editIndex}`;
}
