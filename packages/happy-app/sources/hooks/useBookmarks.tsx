import * as React from "react";
import {
  BookmarkItem,
  loadSessionBookmarks,
  saveSessionBookmarks,
} from "@/sync/persistence";

type BookmarkSource = "ai" | "user";

interface BookmarkContextValue {
  bookmarks: readonly BookmarkItem[];
  toggleBookmark: (text: string, source: BookmarkSource) => void;
  isBookmarked: (text: string) => boolean;
}

const defaultValue: BookmarkContextValue = {
  bookmarks: [],
  toggleBookmark: () => {},
  isBookmarked: () => false,
};

const BookmarkContext = React.createContext<BookmarkContextValue>(defaultValue);

export function BookmarkProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  const [bookmarks, setBookmarks] = React.useState<readonly BookmarkItem[]>(
    () => loadSessionBookmarks(sessionId),
  );

  // Sync to MMKV whenever bookmarks change
  React.useEffect(() => {
    saveSessionBookmarks(sessionId, [...bookmarks]);
  }, [sessionId, bookmarks]);

  const toggleBookmark = React.useCallback(
    (text: string, source: BookmarkSource) => {
      setBookmarks((prev) => {
        const exists = prev.some((b) => b.text === text);
        if (exists) {
          return prev.filter((b) => b.text !== text);
        }
        return [...prev, { text, source }];
      });
    },
    [],
  );

  const isBookmarked = React.useCallback(
    (text: string) => bookmarks.some((b) => b.text === text),
    [bookmarks],
  );

  const value = React.useMemo(
    () => ({ bookmarks, toggleBookmark, isBookmarked }),
    [bookmarks, toggleBookmark, isBookmarked],
  );

  return (
    <BookmarkContext.Provider value={value}>
      {children}
    </BookmarkContext.Provider>
  );
}

export function useBookmarks(): BookmarkContextValue {
  return React.useContext(BookmarkContext);
}
