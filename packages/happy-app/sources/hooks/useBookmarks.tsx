import * as React from "react";
import {
  loadSessionBookmarks,
  saveSessionBookmarks,
} from "@/sync/persistence";

interface BookmarkContextValue {
  bookmarkedOptions: ReadonlySet<string>;
  toggleBookmark: (option: string) => void;
  isBookmarked: (option: string) => boolean;
}

const defaultValue: BookmarkContextValue = {
  bookmarkedOptions: new Set(),
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
  const [bookmarkedOptions, setBookmarkedOptions] = React.useState<
    ReadonlySet<string>
  >(() => new Set(loadSessionBookmarks(sessionId)));

  // Sync to MMKV whenever bookmarks change
  React.useEffect(() => {
    saveSessionBookmarks(sessionId, Array.from(bookmarkedOptions));
  }, [sessionId, bookmarkedOptions]);

  const toggleBookmark = React.useCallback((option: string) => {
    setBookmarkedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(option)) {
        next.delete(option);
      } else {
        next.add(option);
      }
      return next;
    });
  }, []);

  const isBookmarked = React.useCallback(
    (option: string) => bookmarkedOptions.has(option),
    [bookmarkedOptions],
  );

  const value = React.useMemo(
    () => ({ bookmarkedOptions, toggleBookmark, isBookmarked }),
    [bookmarkedOptions, toggleBookmark, isBookmarked],
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
