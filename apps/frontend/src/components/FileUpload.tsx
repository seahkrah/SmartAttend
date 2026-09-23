import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, FileText, Image as ImageIcon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToastStore } from './Toast';
import { getErrorMessage } from '../utils/errorHandler';
import {
  filesService, formatBytes,
  type FileCategory, type StoredFile,
} from '../services/filesService';

/**
 * Picking and sending one file.
 *
 * The accept attribute and the size check here are conveniences: they save a
 * round trip for the obvious mistakes. They are not the validation. The
 * server reads the bytes and decides what a file is, which is the only check
 * that means anything — a renamed file passes every test a browser can run.
 *
 * So when the server refuses something this component accepted, that is the
 * system working, and the message is shown as it came back rather than
 * replaced with something vaguer.
 */

interface Props {
  category: FileCategory;
  ownerType?: string;
  ownerId?: string;
  /** Called with the stored file once the server has accepted it. */
  onUploaded: (file: StoredFile, deduplicated: boolean) => void;
  label?: string;
  /** Narrows the picker. The server's allowlist is still what decides. */
  accept?: string;
  maxBytes?: number;
  disabled?: boolean;
}

const DEFAULT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx';

const FileUpload: React.FC<Props> = ({
  category, ownerType, ownerId, onUploaded,
  label = 'Choose a file', accept, maxBytes, disabled,
}) => {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastStore();

  const send = useCallback(async (file: File) => {
    if (maxBytes && file.size > maxBytes) {
      addToast({
        type: 'error',
        title: 'That file is too large',
        message: `The limit here is ${formatBytes(maxBytes)}; this one is ${formatBytes(file.size)}.`,
      });
      return;
    }

    try {
      setBusy(true);
      setProgress(0);
      const { file: stored, deduplicated } = await filesService.upload(
        file, { category, ownerType, ownerId }, setProgress
      );

      onUploaded(stored, deduplicated);
      addToast({
        type: 'success',
        title: deduplicated ? 'Already held' : 'Uploaded',
        message: deduplicated
          ? 'An identical file was already stored, so that one is being reused.'
          // Worth saying when the two differ: the browser's guess was wrong,
          // and the person should know what was actually stored.
          : stored.contentType !== file.type && file.type
          ? `Stored as ${stored.contentType}, which is what the file actually is.`
          : undefined,
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not upload', message: getErrorMessage(error) });
    } finally {
      setBusy(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [category, ownerType, ownerId, onUploaded, maxBytes, addToast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void send(file);
  }, [disabled, busy, send]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled && !busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        dragging
          ? 'border-brand-500 bg-brand-500/5'
          : 'border-slate-700 hover:border-slate-600'
      } ${disabled || busy ? 'opacity-60' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? DEFAULT_ACCEPT}
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
        }}
        className="hidden"
        id={`upload-${category}-${ownerId ?? 'new'}`}
      />

      {busy ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">Uploading… {progress}%</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <Upload className="mx-auto h-6 w-6 text-slate-500" />
          <label
            htmlFor={`upload-${category}-${ownerId ?? 'new'}`}
            className={`mt-2 block text-sm font-medium ${
              disabled ? 'text-slate-500' : 'cursor-pointer text-brand-400 hover:text-brand-300'
            }`}
          >
            {label}
          </label>
          <p className="mt-1 text-xs text-slate-500">
            or drop it here · PDF, images, Word, Excel, text
          </p>
        </>
      )}
    </div>
  );
};

/** A stored file as a row, with the actions that apply to it. */
export const FileChip: React.FC<{
  file: StoredFile;
  onRemove?: (file: StoredFile) => void;
  compact?: boolean;
}> = ({ file, onRemove, compact }) => {
  const [busy, setBusy] = useState(false);
  const { addToast } = useToastStore();
  const isImage = file.contentType.startsWith('image/');

  const download = async () => {
    try {
      setBusy(true);
      await filesService.download(file);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not download', message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      {isImage
        ? <ImageIcon className="h-4 w-4 shrink-0 text-sky-400" />
        : <FileText className="h-4 w-4 shrink-0 text-slate-400" />}

      <button
        onClick={() => void download()}
        disabled={busy}
        className="min-w-0 flex-1 text-left disabled:opacity-60"
      >
        <p className="truncate text-sm text-slate-200 hover:text-brand-300">{file.name}</p>
        {!compact && (
          <p className="text-xs text-slate-500">
            {formatBytes(file.byteSize)} · {new Date(file.createdAt).toLocaleDateString()}
            {file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
          </p>
        )}
      </button>

      {/* No scanner is wired in, and the badge says exactly that rather than
          showing a reassuring tick for an inspection that never happened. */}
      {file.scanStatus === 'infected' ? (
        <span
          title="This file was flagged by a scan"
          className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300"
        >
          <AlertTriangle className="h-3 w-3" /> Flagged
        </span>
      ) : file.scanStatus === 'clean' ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> Scanned
        </span>
      ) : (
        <span
          title="No virus scanner is configured on this deployment, so this file has not been inspected"
          className="text-xs text-slate-600"
        >
          Not scanned
        </span>
      )}

      {onRemove && (
        <button
          onClick={() => onRemove(file)}
          title="Remove this file"
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-300"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default FileUpload;
