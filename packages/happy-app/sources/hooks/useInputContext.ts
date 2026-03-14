import { createContext, useContext } from "react";

interface InputContextValue {
    appendToInput: (text: string) => void;
}

const noop = () => {};

export const InputContext = createContext<InputContextValue>({
    appendToInput: noop,
});

export function useAppendToInput() {
    return useContext(InputContext).appendToInput;
}
