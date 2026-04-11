export function getFavoriteItemActions(hasReferenceAction: boolean): Array<"reference" | "remove"> {
    return hasReferenceAction ? ["reference", "remove"] : ["remove"];
}
