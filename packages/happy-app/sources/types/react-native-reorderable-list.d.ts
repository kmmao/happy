declare module "react-native-reorderable-list" {
    import type { ComponentType } from "react";
    import type { FlatListProps } from "react-native";

    export interface ReorderableListReorderEvent {
        from: number;
        to: number;
    }

    export interface ReorderableListProps<T> extends Omit<FlatListProps<T>, "onDragEnd"> {
        onReorder: (event: ReorderableListReorderEvent) => void;
    }

    export function useReorderableDrag(): () => void;

    const ReorderableList: ComponentType<ReorderableListProps<any>>;
    export default ReorderableList;
}
