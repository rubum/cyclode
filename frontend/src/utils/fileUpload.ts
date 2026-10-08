/**
 * Utility functions for recursive directory traversal, noise filtering,
 * and multi-file attachment management across Cyclode.
 */

export interface UploadableItem {
  id: string;
  file: File;
  name: string;
  size: number;
  relativePath: string;
  isFolder?: boolean;
  rootFolder?: string;
  status: 'ready' | 'uploading' | 'error';
  error?: string;
  pastedDoc?: any;
}

export interface FolderSummary {
  rootFolder: string;
  fileCount: number;
  totalSize: number;
  items: UploadableItem[];
}

const IGNORED_FOLDER_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'vendor',
  '.pnpm-store',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  '.DS_Store',
  'Thumbs.db',
]);

/**
 * Checks if a relative path contains any ignored folder names.
 */
export function isIgnoredPath(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/);
  for (const part of parts) {
    if (IGNORED_FOLDER_NAMES.has(part)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively reads a FileSystemEntry (file or directory).
 * Handles Chromium's 100-item chunk limit for readEntries().
 */
async function readEntryRecursively(
  entry: any,
  basePath: string = ''
): Promise<{ file: File; relativePath: string }[]> {
  if (!entry) return [];

  const currentPath = basePath ? `${basePath}/${entry.name}` : entry.name;

  if (isIgnoredPath(currentPath)) {
    return [];
  }

  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file: File) => {
          resolve([{ file, relativePath: currentPath }]);
        },
        (err: any) => {
          console.warn(`Failed to read dropped file entry ${currentPath}:`, err);
          resolve([]);
        }
      );
    });
  }

  if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const allEntries: any[] = [];

    // Chromium readEntries() reads in batches of at most 100 items.
    // Must call in a loop until an empty batch is returned.
    const readBatch = (): Promise<any[]> => {
      return new Promise((resolve) => {
        dirReader.readEntries(
          (entries: any[]) => {
            if (entries.length === 0) {
              resolve([]);
            } else {
              allEntries.push(...entries);
              readBatch().then(resolve);
            }
          },
          (err: any) => {
            console.warn(`Error reading directory batch ${currentPath}:`, err);
            resolve([]);
          }
        );
      });
    };

    await readBatch();

    const results: { file: File; relativePath: string }[] = [];
    for (const childEntry of allEntries) {
      const childFiles = await readEntryRecursively(childEntry, currentPath);
      results.push(...childFiles);
    }
    return results;
  }

  return [];
}

/**
 * Traverses dropped DataTransfer items recursively via the FileSystem API.
 * Falls back to standard flat DataTransfer.files if FileSystem API is unavailable.
 */
export async function readDroppedFileSystemEntries(
  dataTransfer: DataTransfer
): Promise<UploadableItem[]> {
  const items = dataTransfer.items;
  const collected: { file: File; relativePath: string }[] = [];

  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const entryPromises: Promise<{ file: File; relativePath: string }[]>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          entryPromises.push(readEntryRecursively(entry, ''));
        }
      }
    }
    const nested = await Promise.all(entryPromises);
    for (const arr of nested) {
      collected.push(...arr);
    }
  } else if (dataTransfer.files && dataTransfer.files.length > 0) {
    // Fallback for browsers without webkitGetAsEntry
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const f = dataTransfer.files[i];
      const rel = (f as any).webkitRelativePath || f.name;
      if (!isIgnoredPath(rel)) {
        collected.push({ file: f, relativePath: rel });
      }
    }
  }

  return collected.map(({ file, relativePath }) => {
    const parts = relativePath.split(/[/\\]/);
    const rootFolder = parts.length > 1 ? parts[0] : undefined;
    return {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      file,
      name: file.name,
      size: file.size,
      relativePath,
      rootFolder,
      status: 'ready',
    };
  });
}

/**
 * Extracts files from input elements (supports both multi-file and webkitdirectory).
 */
export function extractFilesFromInput(fileList: FileList | File[]): UploadableItem[] {
  const filesArray = Array.from(fileList);
  const result: UploadableItem[] = [];

  for (const f of filesArray) {
    const rel = (f as any).webkitRelativePath || f.name;
    if (isIgnoredPath(rel)) {
      continue;
    }
    const parts = rel.split(/[/\\]/);
    const rootFolder = parts.length > 1 ? parts[0] : undefined;

    result.push({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      file: f,
      name: f.name,
      size: f.size,
      relativePath: rel,
      rootFolder,
      status: 'ready',
    });
  }

  return result;
}

/**
 * Groups items by rootFolder for summary badge displays.
 */
export function groupAttachmentsByFolder(
  items: UploadableItem[]
): { folders: FolderSummary[]; standaloneFiles: UploadableItem[] } {
  const folderMap = new Map<string, UploadableItem[]>();
  const standaloneFiles: UploadableItem[] = [];

  for (const item of items) {
    if (item.rootFolder) {
      const existing = folderMap.get(item.rootFolder) || [];
      existing.push(item);
      folderMap.set(item.rootFolder, existing);
    } else {
      standaloneFiles.push(item);
    }
  }

  const folders: FolderSummary[] = [];
  folderMap.forEach((folderItems, rootFolder) => {
    folders.push({
      rootFolder,
      fileCount: folderItems.length,
      totalSize: folderItems.reduce((acc, cur) => acc + cur.size, 0),
      items: folderItems,
    });
  });

  return { folders, standaloneFiles };
}

/**
 * Recursively reads a FileSystemDirectoryHandle (Modern File System Access API).
 */
async function readDirectoryHandleRecursively(
  dirHandle: any,
  basePath: string = ''
): Promise<{ file: File; relativePath: string }[]> {
  const currentPath = basePath ? `${basePath}/${dirHandle.name}` : dirHandle.name;
  if (isIgnoredPath(currentPath)) {
    return [];
  }

  const results: { file: File; relativePath: string }[] = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          const rel = `${currentPath}/${entry.name}`;
          if (!isIgnoredPath(rel)) {
            results.push({ file, relativePath: rel });
          }
        } catch (fileErr) {
          console.warn(`Could not read file ${entry.name}:`, fileErr);
        }
      } else if (entry.kind === 'directory') {
        const childFiles = await readDirectoryHandleRecursively(entry, currentPath);
        results.push(...childFiles);
      }
    }
  } catch (err) {
    console.warn(`Error reading directory handle ${currentPath}:`, err);
  }
  return results;
}

/**
 * Triggers native directory picker via window.showDirectoryPicker() if supported.
 * Returns UploadableItem[] or null if showDirectoryPicker is not supported or not permitted.
 */
export async function openNativeFolderPicker(): Promise<UploadableItem[] | null> {
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'read',
      });
      if (!dirHandle) return [];
      const collected = await readDirectoryHandleRecursively(dirHandle, '');
      return collected.map(({ file, relativePath }) => {
        const parts = relativePath.split(/[/\\]/);
        const rootFolder = parts.length > 1 ? parts[0] : undefined;
        return {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          file,
          name: file.name,
          size: file.size,
          relativePath,
          rootFolder,
          status: 'ready',
        };
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return []; // User intentionally cancelled
      }
      console.warn('showDirectoryPicker failed or not permitted, fallback to input:', err);
      return null;
    }
  }
  return null;
}

