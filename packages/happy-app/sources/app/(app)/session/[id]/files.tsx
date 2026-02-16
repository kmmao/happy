import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Legacy /files route — redirects to the unified /git page.
 * Kept for backward compatibility with old links / navigation history.
 */
export default function FilesRedirect() {
    const { id } = useLocalSearchParams<{ id: string }>();
    return <Redirect href={`/session/${id}/git`} />;
}
