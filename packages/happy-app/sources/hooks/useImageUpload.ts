import * as React from "react";
import { Platform } from "react-native";
import { Modal } from "@/modal";
import { t } from "@/text";
import {
  pickAndUploadImages,
  uploadBase64Image,
  blobToResizedBase64,
  MAX_IMAGES,
} from "@/utils/imageUpload";
import { uploadRawFile, MAX_BASE64_SIZE } from "@/utils/imageUpload.shared";
import { captureAndUploadPhoto } from "@/utils/cameraCapture";
import { pickAndUploadFiles } from "@/utils/filePicker";
import { encodeBase64 } from "@/encryption/base64";
import { useHappyAction } from "@/hooks/useHappyAction";
import { AsyncLock } from "@/utils/lock";
import { log } from '@/log';

export interface UseImageUploadResult {
  pendingImagePaths: string[];
  /** Displayable URIs parallel to pendingImagePaths (local asset URIs or data URIs). */
  pendingImageUris: string[];
  /** Map from remote path to original filename (for non-image files). */
  fileNameMap: ReadonlyMap<string, string>;
  isPickingImage: boolean;
  isProcessingImage: boolean;
  /** Current paths ref — always reflects the latest value for use in callbacks. */
  pendingImagePathsRef: React.RefObject<string[]>;
  doPickImage: () => void;
  doTakePhoto: () => void;
  doPickFile: () => void;
  handleImagePaste: ((blob: Blob) => void) | undefined;
  handleFilePaste: ((file: File) => void) | undefined;
  setPendingImagePaths: React.Dispatch<React.SetStateAction<string[]>>;
  /** Remove an image by its remote path, keeping pendingImageUris in sync. */
  removeImageByPath: (path: string) => void;
  /** Clear all pending images (both paths and URIs) in sync. */
  clearImages: () => void;
}

/**
 * Encapsulates image upload state: picking, pasting, processing, and pending paths.
 *
 * Uses an AsyncLock to serialize pick and paste operations, preventing races where
 * a paste during an open picker could exceed MAX_IMAGES or silently discard uploads.
 *
 * Uses a dual-tracking pattern for processing state:
 * - `isProcessingImage` (state): drives UI loading indicators
 * - The AsyncLock provides the synchronous mutual exclusion guarantee.
 */
// Module-level cache keyed by sessionId: survives component unmount when the
// user switches sessions, so images are restored when they switch back.
// Cleared when the user sends (clearImages) or removes all images.
type CachedImageState = {
  paths: string[];
  uris: string[];
  fileNameMap: Map<string, string>;
};
const imageStateCache = new Map<string, CachedImageState>();

function getCached(id: string): CachedImageState {
  return imageStateCache.get(id) ?? { paths: [], uris: [], fileNameMap: new Map() };
}

/**
 * Compute a fast fingerprint from a Blob for deduplication.
 * Uses the first 8KB of content + total size to avoid reading large blobs fully.
 */
export async function computeBlobHash(blob: Blob): Promise<string> {
  const SAMPLE_SIZE = 8192;
  const sample = blob.slice(0, Math.min(blob.size, SAMPLE_SIZE));
  const buffer = await sample.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Simple FNV-1a 32-bit hash — fast and sufficient for dedup within a session
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${blob.size}:${(hash >>> 0).toString(36)}`;
}

export function useImageUpload(sessionId: string): UseImageUploadResult {
  const cached = getCached(sessionId);
  const [pendingImagePaths, setPendingImagePaths] = React.useState<string[]>(cached.paths);
  const [pendingImageUris, setPendingImageUris] = React.useState<string[]>(cached.uris);
  const [fileNameMap, setFileNameMap] = React.useState<ReadonlyMap<string, string>>(cached.fileNameMap);
  const [isProcessingImage, setIsProcessingImage] = React.useState(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Track content hashes of already-pasted image blobs to deduplicate.
  // Prevents repeated pastes when Chrome clipboard retains old items
  // or the user Cmd+V without the clipboard having updated yet.
  const pastedHashesRef = React.useRef(new Set<string>());

  // Keep the module-level cache in sync so state survives session switches.
  React.useEffect(() => {
    if (pendingImagePaths.length === 0 && pendingImageUris.length === 0) {
      imageStateCache.delete(sessionId);
    } else {
      imageStateCache.set(sessionId, {
        paths: pendingImagePaths,
        uris: pendingImageUris,
        fileNameMap: fileNameMap instanceof Map ? fileNameMap : new Map(fileNameMap),
      });
    }
  }, [sessionId, pendingImagePaths, pendingImageUris, fileNameMap]);

  // Serialize pick and paste operations to prevent concurrent races
  const uploadLockRef = React.useRef(new AsyncLock());

  // Ref kept in sync with state so callbacks always read the latest value.
  // Updated in useEffect to be safe under React concurrent mode.
  const pendingImagePathsRef = React.useRef(pendingImagePaths);
  React.useEffect(() => {
    pendingImagePathsRef.current = pendingImagePaths;
  }, [pendingImagePaths]);

  // Pick images from gallery/file picker
  const [isPickingImage, doPickImage] = useHappyAction(
    React.useCallback(async () => {
      await uploadLockRef.current.inLock(async () => {
        const result = await pickAndUploadImages(
          sessionId,
          pendingImagePathsRef.current.length,
        );
        if (!mountedRef.current) return;
        if (result) {
          const remaining = MAX_IMAGES - pendingImagePathsRef.current.length;
          if (remaining <= 0) return;
          setPendingImagePaths((prev) => [
            ...prev,
            ...result.paths.slice(0, remaining),
          ]);
          setPendingImageUris((prev) => [
            ...prev,
            ...result.displayUris.slice(0, remaining),
          ]);
          if (result.failedCount > 0) {
            const total = result.paths.length + result.failedCount;
            const details = result.errorDetails?.length
              ? `\n\n[Debug] ${result.errorDetails.join("; ")}`
              : "";
            Modal.alert(
              t("common.error"),
              t("session.imageUploadFailed", {
                failed: result.failedCount,
                total,
              }) + details,
            );
          }
        }
      });
    }, [sessionId]),
  );

  // Handle clipboard image paste (web only)
  const handleImagePaste = React.useCallback(
    async (blob: Blob) => {
      try {
        if (pendingImagePathsRef.current.length >= MAX_IMAGES) return;

        // Deduplicate: compute a fast content hash from the blob's first 8KB + size.
        // Skips re-uploading the same image when Chrome clipboard retains old items.
        const hashKey = await computeBlobHash(blob);
        if (pastedHashesRef.current.has(hashKey)) {
          log.log("handleImagePaste: skipped duplicate blob", hashKey);
          return;
        }

        await uploadLockRef.current.inLock(async () => {
          // Re-check under lock — a concurrent pick may have filled it
          if (pendingImagePathsRef.current.length >= MAX_IMAGES) return;
          if (!mountedRef.current) return;
          // Re-check dedup under lock (another paste may have added it)
          if (pastedHashesRef.current.has(hashKey)) return;
          setIsProcessingImage(true);
          try {
            const base64 = await blobToResizedBase64(blob);
            if (pendingImagePathsRef.current.length >= MAX_IMAGES) return;
            const path = await uploadBase64Image(sessionId, base64);
            if (!mountedRef.current) return;
            pastedHashesRef.current.add(hashKey);
            setPendingImagePaths((prev) =>
              prev.length >= MAX_IMAGES ? prev : [...prev, path],
            );
            setPendingImageUris((prev) =>
              prev.length >= MAX_IMAGES
                ? prev
                : [...prev, `data:image/jpeg;base64,${base64}`],
            );
          } catch (err) {
            if (!mountedRef.current) return;
            const errorMessage =
              err instanceof Error
                ? err.message
                : t("session.couldNotAttachFile");
            Modal.alert(t("common.error"), errorMessage);
          } finally {
            if (mountedRef.current) {
              setIsProcessingImage(false);
            }
          }
        });
      } catch (e) {
        // Swallow lock-acquisition or unexpected errors — paste failures should not crash the UI
        log.error("handleImagePaste failed:", e);
      }
    },
    [sessionId],
  );

  // Handle clipboard file paste (web only)
  const handleFilePaste = React.useCallback(
    async (file: File) => {
      try {
        if (pendingImagePathsRef.current.length >= MAX_IMAGES) return;
        await uploadLockRef.current.inLock(async () => {
          if (pendingImagePathsRef.current.length >= MAX_IMAGES) return;
          if (!mountedRef.current) return;
          setIsProcessingImage(true);
          try {
            const maxRawSize = Math.floor(MAX_BASE64_SIZE * 3 / 4);
            if (file.size > maxRawSize) {
              Modal.alert(t("common.error"), t("session.fileTooLarge"));
              return;
            }
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const base64 = encodeBase64(bytes);
            const name = file.name || "file";
            const path = await uploadRawFile(sessionId, base64, name);
            if (!mountedRef.current) return;
            setPendingImagePaths((prev) =>
              prev.length >= MAX_IMAGES ? prev : [...prev, path],
            );
            setPendingImageUris((prev) =>
              prev.length >= MAX_IMAGES
                ? prev
                : [...prev, URL.createObjectURL(file)],
            );
            setFileNameMap((prev) => {
              const next = new Map(prev);
              next.set(path, name);
              return next;
            });
          } catch (err) {
            if (!mountedRef.current) return;
            const errorMessage =
              err instanceof Error
                ? err.message
                : t("session.couldNotAttachFile");
            Modal.alert(t("common.error"), errorMessage);
          } finally {
            if (mountedRef.current) {
              setIsProcessingImage(false);
            }
          }
        });
      } catch (e) {
        log.error("handleFilePaste failed:", e);
      }
    },
    [sessionId],
  );

  // Take photo from camera
  const [isTakingPhoto, doTakePhoto] = useHappyAction(
    React.useCallback(async () => {
      await uploadLockRef.current.inLock(async () => {
        const result = await captureAndUploadPhoto(
          sessionId,
          pendingImagePathsRef.current.length,
        );
        if (!mountedRef.current) return;
        if (result) {
          const remaining = MAX_IMAGES - pendingImagePathsRef.current.length;
          if (remaining <= 0) return;
          setPendingImagePaths((prev) => [
            ...prev,
            ...result.paths.slice(0, remaining),
          ]);
          setPendingImageUris((prev) => [
            ...prev,
            ...result.displayUris.slice(0, remaining),
          ]);
          if (result.failedCount > 0) {
            const total = result.paths.length + result.failedCount;
            Modal.alert(
              t("common.error"),
              t("session.imageUploadFailed", {
                failed: result.failedCount,
                total,
              }),
            );
          }
        }
      });
    }, [sessionId]),
  );

  // Pick files from document picker
  const [isPickingFile, doPickFile] = useHappyAction(
    React.useCallback(async () => {
      await uploadLockRef.current.inLock(async () => {
        const result = await pickAndUploadFiles(
          sessionId,
          pendingImagePathsRef.current.length,
        );
        if (!mountedRef.current) return;
        if (result) {
          const remaining = MAX_IMAGES - pendingImagePathsRef.current.length;
          if (remaining <= 0) return;
          setPendingImagePaths((prev) => [
            ...prev,
            ...result.paths.slice(0, remaining),
          ]);
          setPendingImageUris((prev) => [
            ...prev,
            ...result.displayUris.slice(0, remaining),
          ]);
          // Track original filenames for display
          if (result.fileNames?.length) {
            setFileNameMap((prev) => {
              const next = new Map(prev);
              const added = result.paths.slice(0, remaining);
              const names = result.fileNames.slice(0, remaining);
              added.forEach((p, i) => next.set(p, names[i]));
              return next;
            });
          }
          if (result.failedCount > 0) {
            const total = result.paths.length + result.failedCount;
            Modal.alert(
              t("common.error"),
              t("session.fileUploadFailed", {
                failed: result.failedCount,
                total,
              }),
            );
          }
        }
      });
    }, [sessionId]),
  );

  const removeImageByPath = React.useCallback((path: string) => {
    setPendingImagePaths((prev) => {
      const idx = prev.indexOf(path);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    setPendingImageUris((prev) => {
      const paths = pendingImagePathsRef.current;
      const idx = paths.indexOf(path);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    setFileNameMap((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const clearImages = React.useCallback(() => {
    imageStateCache.delete(sessionId);
    pastedHashesRef.current.clear();
    setPendingImagePaths([]);
    setPendingImageUris([]);
    setFileNameMap(new Map());
  }, [sessionId]);

  return {
    pendingImagePaths,
    pendingImageUris,
    fileNameMap,
    isPickingImage: isPickingImage || isTakingPhoto || isPickingFile,
    isProcessingImage,
    pendingImagePathsRef,
    doPickImage,
    doTakePhoto,
    doPickFile,
    handleImagePaste: Platform.OS === "web" ? handleImagePaste : undefined,
    handleFilePaste: Platform.OS === "web" ? handleFilePaste : undefined,
    setPendingImagePaths,
    removeImageByPath,
    clearImages,
  };
}
