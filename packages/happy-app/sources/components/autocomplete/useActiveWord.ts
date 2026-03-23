import * as React from 'react';
import { findActiveWord } from "./findActiveWord";

export function useActiveWord(text: string, selection: { start: number; end: number }, prefixes: string[] = ['@', '/', ':']) {
    return React.useMemo(() => {
        let w = findActiveWord(text, selection, prefixes);
        if (w) {
            return w.activeWord;
        }
        return null;
    }, [text, selection.start, selection.end, prefixes]);
}