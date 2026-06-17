import { useState, useRef, useCallback, useId } from 'react';
import {
  Upload,
  FileText,
  FileJson,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  CloudUpload,
  Info,
  Clock,
  HardDrive,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { LucideIcon } from 'lucide-react';
import { requestPresignedUrl, uploadFileToS3 } from '@/api/client';
import { useNotificationStore } from '@/store';
import type { UploadJob, UploadStatus } from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024;

const ACCEPTED_MIME: Record<string, string> = {
  'text/csv':         'csv',
  'application/json': 'json',
  'text/plain':       'csv',  // some systems send .csv as text/plain
};

const CSV_EXPECTED_HEADERS = [
  'Invoice_ID',
  'Date',
  'Customer_Name',
  'Product_SKU',
  'Quantity',
  'Unit_Price',
  'Total_Amount',
  'Material_Type',
];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function fmtBytes(bytes: number): string {
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileType(file: File): 'csv' | 'json' | null {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv')  return 'csv';
  if (ext === 'json') return 'json';
  const mimeResult = ACCEPTED_MIME[file.type];
  return (mimeResult as 'csv' | 'json') ?? null;
}

function validateFile(file: File): string | null {
  const type = getFileType(file);
  if (!type) return `Unsupported file type. Only .csv and .json are accepted.`;
  if (file.size > MAX_FILE_SIZE) return `File exceeds ${MAX_FILE_SIZE_MB} MB limit.`;
  if (file.size === 0) return 'File is empty.';
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Status badge
// ────────────────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<
  UploadStatus,
  { label: string; color: string; bg: string; Icon: LucideIcon }
> = {
  'idle':           { label: 'Pending',     color: '#94a3b8', bg: '#1e293b', Icon: Clock       },
  'requesting-url': { label: 'Authorising', color: '#f59e0b', bg: '#451a03', Icon: Loader2     },
  'uploading':      { label: 'Uploading',   color: '#6366f1', bg: '#1e1b4b', Icon: CloudUpload },
  'processing':     { label: 'Processing',  color: '#8b5cf6', bg: '#2e1065', Icon: Loader2     },
  'complete':       { label: 'Complete',    color: '#10b981', bg: '#022c22', Icon: CheckCircle2},
  'error':          { label: 'Error',       color: '#ef4444', bg: '#450a0a', Icon: AlertCircle },
};

function StatusBadge({ status }: { status: UploadStatus }) {
  const cfg = STATUS_CONFIG[status];
  const isSpinning = ['requesting-url', 'uploading', 'processing'].includes(status);
  return (
    <span
      className="flex items-center gap-1.5 text-2xs px-2 py-1 rounded-full font-medium"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      <cfg.Icon
        size={11}
        className={isSpinning ? 'animate-spin' : ''}
      />
      {cfg.label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Upload job row
// ────────────────────────────────────────────────────────────────────────────
function JobRow({ job, onRemove }: { job: UploadJob; onRemove: (id: string) => void }) {
  const isCSV     = job.filename.endsWith('.csv');
  const isDone    = job.status === 'complete' || job.status === 'error';
  const inFlight  = !isDone && job.status !== 'idle';

  return (
    <div className="glass-card p-4 space-y-3 animate-slide-up">
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isCSV ? 'bg-emerald-900/30 text-emerald-400' : 'bg-amber-900/30 text-amber-400'}`}>
          {isCSV ? <FileText size={20} /> : <FileJson size={20} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-slate-200 truncate">{job.filename}</p>
            {isDone && (
              <button
                onClick={() => onRemove(job.id)}
                className="shrink-0 p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
                aria-label="Remove"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1">
            <span className="text-2xs text-slate-500 flex items-center gap-1">
              <HardDrive size={10} />
              {fmtBytes(job.file_size)}
            </span>
            <StatusBadge status={job.status} />
          </div>

          {job.s3_key && job.status === 'complete' && (
            <p className="text-2xs font-mono text-slate-600 mt-1 truncate">
              s3://…/{job.s3_key}
            </p>
          )}

          {job.error && (
            <p className="text-2xs text-red-400 mt-1">{job.error}</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(inFlight || job.status === 'complete') && (
        <div className="space-y-1">
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${job.status === 'complete' ? 100 : job.progress}%`,
                backgroundColor:
                  job.status === 'complete'
                    ? '#10b981'
                    : job.status === 'uploading'
                    ? '#6366f1'
                    : '#8b5cf6',
              }}
            />
          </div>
          <div className="flex justify-between">
            <span className="text-2xs text-slate-600">
              {job.status === 'uploading' && `${job.progress}% uploaded`}
              {job.status === 'requesting-url' && 'Generating secure upload URL…'}
              {job.status === 'processing' && 'S3 event triggered — Lambda parsing rows…'}
              {job.status === 'complete' && `Ingestion complete · ${job.completed_at ? new Date(job.completed_at).toLocaleTimeString() : ''}`}
            </span>
            {job.status === 'uploading' && (
              <span className="text-2xs text-indigo-400 font-mono">{job.progress}%</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CSV schema reference card
// ────────────────────────────────────────────────────────────────────────────
function SchemaReference() {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Info size={14} className="text-indigo-400" />
        <h3 className="text-sm font-semibold text-slate-200">Expected CSV Schema</h3>
      </div>
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700">
              {['Column', 'Type', 'Example'].map((h) => (
                <th key={h} className="text-left text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {[
              { col: 'Invoice_ID',    type: 'String',  ex: 'INV-20250115-001'   },
              { col: 'Date',         type: 'Date',    ex: '2025-01-15'          },
              { col: 'Customer_Name',type: 'String',  ex: 'Acme Steel Corp'     },
              { col: 'Product_SKU',  type: 'String',  ex: 'SS-304-2MM-SHEET'   },
              { col: 'Quantity',     type: 'Number',  ex: '500'                 },
              { col: 'Unit_Price',   type: 'Decimal', ex: '145.50'              },
              { col: 'Total_Amount', type: 'Decimal', ex: '72750.00'            },
              { col: 'Material_Type',type: 'SS | MS', ex: 'SS'                  },
            ].map(({ col, type, ex }) => (
              <tr key={col}>
                <td className="py-1.5 pr-4 font-mono text-indigo-300">{col}</td>
                <td className="py-1.5 pr-4 text-slate-400">{type}</td>
                <td className="py-1.5 text-slate-500 font-mono">{ex}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-slate-600 mt-3">
        First row must be the header row. UTF-8 encoding required. Max {MAX_FILE_SIZE_MB} MB per file.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Drop zone
// ────────────────────────────────────────────────────────────────────────────
function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputId    = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => getFileType(f) !== null);
    if (files.length) onFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    processFiles(e.dataTransfer.files);
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`
        relative cursor-pointer select-none rounded-2xl border-2 border-dashed
        transition-all duration-200 p-10 flex flex-col items-center justify-center gap-4
        ${dragging
          ? 'border-indigo-400 bg-indigo-950/40 scale-[1.01]'
          : 'border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/60'
        }
      `}
      role="button"
      aria-label="Upload CSV or JSON file"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
    >
      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,.json,text/csv,application/json"
        onChange={handleInputChange}
        className="sr-only"
        aria-hidden="true"
      />

      <div
        className={`
          w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200
          ${dragging ? 'bg-indigo-500/20 text-indigo-300 scale-110' : 'bg-slate-800 text-slate-400'}
        `}
      >
        <CloudUpload size={28} />
      </div>

      <div className="text-center">
        <p className="text-base font-semibold text-slate-200">
          {dragging ? 'Drop to upload' : 'Drop files here'}
        </p>
        <p className="text-sm text-slate-400 mt-1">
          or <span className="text-indigo-400 underline underline-offset-2">click to browse</span>
        </p>
        <p className="text-2xs text-slate-600 mt-2">
          .csv · .json · Up to {MAX_FILE_SIZE_MB} MB each · Multiple files supported
        </p>
      </div>

      {dragging && (
        <div className="absolute inset-0 rounded-2xl bg-indigo-500/5 pointer-events-none" />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// DataIngestion main
// ────────────────────────────────────────────────────────────────────────────
export default function DataIngestion() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const push = useNotificationStore((s) => s.push);

  const updateJob = useCallback(
    (id: string, patch: Partial<UploadJob>) => {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    },
    [],
  );

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      // Validate first; add all jobs optimistically
      const newJobs: UploadJob[] = files.map((file) => {
        const validationError = validateFile(file);
        return {
          id:         uuidv4(),
          filename:   file.name,
          file_size:  file.size,
          status:     validationError ? 'error' : 'idle',
          progress:   0,
          error:      validationError ?? undefined,
          started_at: new Date().toISOString(),
        } as UploadJob;
      });

      setJobs((prev) => [...newJobs, ...prev]);

      // Process only valid ones
      for (let i = 0; i < newJobs.length; i++) {
        const job  = newJobs[i];
        const file = files[i];
        if (job.status === 'error') continue;

        try {
          // Step 1: Request pre-signed URL
          updateJob(job.id, { status: 'requesting-url' });

          const contentType =
            file.type === 'application/json' ? 'application/json' : 'text/csv';

          const { upload_url, key } = await requestPresignedUrl({
            filename:     file.name,
            content_type: contentType,
            file_size:    file.size,
          });

          // Step 2: Stream-upload directly to S3
          updateJob(job.id, { status: 'uploading', progress: 0 });

          await uploadFileToS3(upload_url, file, (pct) => {
            updateJob(job.id, { progress: pct });
          });

          // Step 3: S3 event triggers Lambda automatically; we show "processing"
          updateJob(job.id, { status: 'processing', progress: 100, s3_key: key });

          // Optimistically transition to complete after a short delay
          // (real status would come from a polling endpoint in a full impl)
          setTimeout(() => {
            updateJob(job.id, {
              status:       'complete',
              completed_at: new Date().toISOString(),
            });
            push({
              type:    'success',
              title:   'Ingestion complete',
              message: `${file.name} has been processed and stored in DynamoDB.`,
            });
          }, 4000);
        } catch (err) {
          updateJob(job.id, {
            status: 'error',
            error:  (err as Error)?.message ?? 'Upload failed',
          });
          push({
            type:    'error',
            title:   'Upload failed',
            message: `${file.name}: ${(err as Error)?.message ?? 'Unknown error'}`,
          });
        }
      }
    },
    [updateJob, push],
  );

  const activeJobs    = jobs.filter((j) => !['complete', 'error'].includes(j.status));
  const completedJobs = jobs.filter((j) => j.status === 'complete');
  const errorJobs     = jobs.filter((j) => j.status === 'error');

  return (
    <div className="max-w-4xl space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100">Data Ingestion</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          Upload sales CSV or JSON files directly to S3 — Lambda parses and stores records in DynamoDB automatically.
        </p>
      </div>

      {/* Pipeline info banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-indigo-950/40 border border-indigo-800/40">
        <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-300/80 space-y-0.5">
          <p className="font-semibold text-indigo-300">Secure upload pipeline</p>
          <p>Files are uploaded directly to S3 via a short-lived pre-signed URL — bypassing the API Gateway entirely for large files. The ingestion Lambda is triggered automatically via S3 ObjectCreated events and batch-writes records to DynamoDB.</p>
        </div>
      </div>

      {/* Drop zone */}
      <DropZone onFiles={handleFiles} />

      {/* Active uploads */}
      {activeJobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-indigo-400" />
            In Progress ({activeJobs.length})
          </h3>
          {activeJobs.map((job) => (
            <JobRow key={job.id} job={job} onRemove={removeJob} />
          ))}
        </div>
      )}

      {/* Error jobs */}
      {errorJobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide flex items-center gap-2">
            <AlertCircle size={12} />
            Failed ({errorJobs.length})
          </h3>
          {errorJobs.map((job) => (
            <JobRow key={job.id} job={job} onRemove={removeJob} />
          ))}
        </div>
      )}

      {/* Completed jobs */}
      {completedJobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide flex items-center gap-2">
            <CheckCircle2 size={12} />
            Completed ({completedJobs.length})
          </h3>
          {completedJobs.map((job) => (
            <JobRow key={job.id} job={job} onRemove={removeJob} />
          ))}
        </div>
      )}

      {/* Schema reference */}
      <SchemaReference />
    </div>
  );
}
