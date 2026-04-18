import { type FileChangeEditEntry } from "@/components/tools/fileChangeEditKey";

export interface FileChange {
  filePath: string;
  displayPath: string;
  edits: FileChangeEditEntry[];
  totalAdditions: number;
  totalDeletions: number;
}
