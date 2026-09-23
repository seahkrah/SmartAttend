import { axiosClient } from '../utils/axiosClient';

/**
 * Document storage.
 *
 * The tenant is never sent. It is resolved server-side from the authenticated
 * identity, so nothing here takes a tenant id and nothing here could send one.
 *
 * Note that a file's type is decided by the server from its bytes, not from
 * what the browser reports. A `File` picked from a disk carries whatever type
 * the operating system guessed, and that guess is not authoritative — so the
 * type shown after an upload may differ from the one shown before it, and the
 * server's answer is the correct one.
 */

export type FileCategory =
  | 'profile_photo' | 'application_document' | 'leave_document'
  | 'attendance_evidence' | 'fee_receipt' | 'incident_attachment'
  | 'report' | 'other';

export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  category: FileCategory;
  ownerType: string | null;
  ownerId: string | null;
  uploadedBy: string | null;
  uploadedByName?: string | null;
  scanStatus: 'skipped' | 'pending' | 'clean' | 'infected';
  createdAt: string;
  downloadUrl: string;
}

export interface StorageQuota {
  quotaBytes: number;
  usedBytes: number;
  fileCount: number;
  remainingBytes: number;
}

export interface UploadLimits {
  accepted: Array<{ contentType: string; extensions: string[]; label: string }>;
  refused: Array<{ extensions: string[]; reason: string }>;
  maxBytesByCategory: Record<FileCategory, number>;
  quota: StorageQuota;
}

export interface AccessEntry {
  action: 'download' | 'view' | 'denied';
  ip_address: string | null;
  occurred_at: string;
  actor_name: string | null;
}

/** Bytes as something a person reads. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export const filesService = {
  async limits(): Promise<UploadLimits> {
    const { data } = await axiosClient.get('/files/limits');
    return data;
  },

  /**
   * Sends one file.
   *
   * Content-Type is deliberately left for the browser to set, because it has
   * to include the multipart boundary; setting it by hand produces a body the
   * server cannot parse.
   */
  async upload(
    file: File,
    input: { category: FileCategory; ownerType?: string; ownerId?: string },
    onProgress?: (percent: number) => void
  ): Promise<{ file: StoredFile; deduplicated: boolean }> {
    const form = new FormData();
    form.append('file', file);
    form.append('category', input.category);
    if (input.ownerType) form.append('ownerType', input.ownerType);
    if (input.ownerId) form.append('ownerId', input.ownerId);

    const { data } = await axiosClient.post('/files', form, {
      onUploadProgress: (event) => {
        if (!onProgress || !event.total) return;
        onProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
    return data;
  },

  async list(filters?: {
    category?: FileCategory;
    ownerType?: string;
    ownerId?: string;
  }): Promise<{ files: StoredFile[]; quota: StorageQuota }> {
    const { data } = await axiosClient.get('/files', { params: filters });
    return data;
  },

  async get(id: string): Promise<StoredFile> {
    const { data } = await axiosClient.get(`/files/${id}`);
    return data.file;
  },

  /**
   * Fetches the bytes as a blob.
   *
   * The download route needs the Authorization header, so a plain anchor
   * pointing at it would come back 401. The bytes are fetched, handed to the
   * browser as an object URL, and the URL revoked afterwards — leaving them
   * un-revoked is a memory leak that grows with every download.
   */
  async download(file: StoredFile, inline = false): Promise<void> {
    const { data } = await axiosClient.get(
      `/files/${file.id}/download${inline ? '?inline=true' : ''}`,
      { responseType: 'blob' }
    );
    const url = URL.createObjectURL(data as Blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /** An object URL for showing an image inline. The caller revokes it. */
  async objectUrl(fileId: string): Promise<string> {
    const { data } = await axiosClient.get(`/files/${fileId}/download?inline=true`, {
      responseType: 'blob',
    });
    return URL.createObjectURL(data as Blob);
  },

  async remove(id: string, reason: string): Promise<void> {
    await axiosClient.delete(`/files/${id}`, { data: { reason } });
  },

  async accessLog(id: string): Promise<AccessEntry[]> {
    const { data } = await axiosClient.get(`/files/${id}/access-log`);
    return data.access;
  },

  async purge(olderThanDays = 30): Promise<number> {
    const { data } = await axiosClient.post('/files/purge', { olderThanDays });
    return data.purged;
  },
};
