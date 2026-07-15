/**
 * DocumentsDrive.tsx
 * 
 * Google Drive-style document manager for Stellar Global Supplies Ops Control Center.
 * 
 * Features:
 *  - Browse folders & files (S3 + DynamoDB backed)
 *  - Create folders
 *  - Upload files (via pre-signed S3 URL)
 *  - Download files (via pre-signed S3 URL)
 *  - Preview PDFs, images, text files inline
 *  - Delete files / folders
 *  - Breadcrumb navigation
 *  - Grid / List view toggle
 *  - Search
 * 
 * Backend expected routes (all via VITE_API_BASE_URL):
 *   GET    /docs/list?prefix=<folder-path>
 *   POST   /docs/folder           { folderPath: string }
 *   POST   /docs/presign-upload   { key: string, contentType: string }
 *   POST   /docs/presign-download { key: string }
 *   DELETE /docs/delete           { key: string }
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Folder,
  FileText,
  Image,
  File,
  Upload,
  FolderPlus,
  Download,
  Trash2,
  Eye,
  ChevronRight,
  Home,
  Grid3X3,
  List,
  Search,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  MoreVertical,
  FileArchive,
  FileSpreadsheet,
  Film,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DriveItem {
  key: string;           // Full S3 key
  name: string;          // Display name
  type: 'folder' | 'file';
  size?: number;         // bytes
  lastModified?: string; // ISO string
  contentType?: string;
}

interface Breadcrumb {
  label: string;
  prefix: string;
}

type ViewMode = 'grid' | 'list';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_BASE_URL ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function getFileIcon(item: DriveItem) {
  if (item.type === 'folder') return <Folder size={20} className="text-[#00B98E]" />;
  const ct = item.contentType ?? '';
  const name = item.name.toLowerCase();
  if (ct.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(name))
    return <Image size={20} className="text-indigo-400" />;
  if (ct === 'application/pdf' || name.endsWith('.pdf'))
    return <FileText size={20} className="text-red-400" />;
  if (/\.(xls|xlsx|csv)$/.test(name))
    return <FileSpreadsheet size={20} className="text-emerald-400" />;
  if (/\.(zip|tar|gz|rar|7z)$/.test(name))
    return <FileArchive size={20} className="text-amber-400" />;
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(name))
    return <Film size={20} className="text-purple-400" />;
  if (/\.(txt|md|json|xml|yaml|yml|ts|js|py|sh|env)$/.test(name))
    return <FileText size={20} className="text-slate-300" />;
  return <File size={20} className="text-slate-400" />;
}

function isPreviewable(item: DriveItem): boolean {
  if (item.type === 'folder') return false;
  const ct = item.contentType ?? '';
  const name = item.name.toLowerCase();
  return (
    ct.startsWith('image/') ||
    ct === 'application/pdf' ||
    ct.startsWith('text/') ||
    /\.(png|jpg|jpeg|gif|webp|svg|pdf|txt|md|json|csv)$/.test(name)
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ onUpload, onNewFolder }: { onUpload: () => void; onNewFolder: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(0,185,142,0.08)', border: '1.5px solid rgba(0,185,142,0.18)' }}>
        <Folder size={36} className="text-[#00B98E]" />
      </div>
      <p className="text-slate-300 font-medium text-sm">This folder is empty</p>
      <p className="text-slate-500 text-xs">Upload a file or create a folder to get started</p>
      <div className="flex gap-3 mt-2">
        <button onClick={onUpload}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-xl border border-[#00B98E]/30 text-[#00B98E] hover:bg-[#00B98E]/10 transition-colors">
          <Upload size={14} /> Upload
        </button>
        <button onClick={onNewFolder}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">
          <FolderPlus size={14} /> New Folder
        </button>
      </div>
    </div>
  );
}

function PreviewModal({
  item,
  url,
  onClose,
}: {
  item: DriveItem;
  url: string;
  onClose: () => void;
}) {
  const name = item.name.toLowerCase();
  const ct = item.contentType ?? '';
  const isImage = ct.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(name);
  const isPDF = ct === 'application/pdf' || name.endsWith('.pdf');
  const isText = ct.startsWith('text/') || /\.(txt|md|json|csv|yaml|yml)$/.test(name);

  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    if (isText) {
      fetch(url).then(r => r.text()).then(setTextContent).catch(() => setTextContent('Could not load file.'));
    }
  }, [url, isText]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="glass-card flex flex-col w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            {getFileIcon(item)}
            <span className="text-sm font-medium text-slate-200 truncate max-w-xs">{item.name}</span>
            {item.size && (
              <span className="text-xs text-slate-500 ml-1">{formatBytes(item.size)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a href={url} download={item.name}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#00B98E]/10 text-[#00B98E] rounded-lg border border-[#00B98E]/20 hover:bg-[#00B98E]/20 transition-colors">
              <Download size={13} /> Download
            </a>
            <button onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
          {isImage && (
            <img src={url} alt={item.name}
              className="max-w-full max-h-full object-contain rounded-xl" />
          )}
          {isPDF && (
            <iframe src={url} title={item.name}
              className="w-full h-[70vh] rounded-xl border border-slate-700" />
          )}
          {isText && (
            textContent === null
              ? <Loader2 size={24} className="animate-spin text-[#00B98E]" />
              : <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap w-full bg-slate-900 rounded-xl p-4 border border-slate-800 overflow-auto max-h-[65vh]">{textContent}</pre>
          )}
          {!isImage && !isPDF && !isText && (
            <p className="text-slate-400 text-sm">Preview not available for this file type.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextMenu({
  item,
  pos,
  onDownload,
  onPreview,
  onDelete,
  onClose,
}: {
  item: DriveItem;
  pos: { x: number; y: number };
  onDownload: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [onClose]);

  return (
    <div
      className="fixed z-50 glass-card py-1 w-44 shadow-2xl"
      style={{ top: pos.y, left: pos.x }}>
      {item.type === 'file' && isPreviewable(item) && (
        <button onClick={onPreview}
          className="flex items-center gap-2.5 w-full px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 transition-colors">
          <Eye size={13} /> Preview
        </button>
      )}
      {item.type === 'file' && (
        <button onClick={onDownload}
          className="flex items-center gap-2.5 w-full px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 transition-colors">
          <Download size={13} /> Download
        </button>
      )}
      <div className="border-t border-slate-800 my-1" />
      <button onClick={onDelete}
        className="flex items-center gap-2.5 w-full px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DocumentsDrive() {
  const [currentPrefix, setCurrentPrefix] = useState('');           // current folder path
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ label: 'My Drive', prefix: '' }]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // New folder modal
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderCreating, setFolderCreating] = useState(false);

  // Preview
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ item: DriveItem; x: number; y: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch items ──────────────────────────────────────────────────────────────
  const fetchItems = useCallback(async (prefix: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ items: DriveItem[] }>(
        `/docs/list?prefix=${encodeURIComponent(prefix)}`
      );
      setItems(data.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(currentPrefix); }, [currentPrefix, fetchItems]);

  // ── Navigation ───────────────────────────────────────────────────────────────
  function navigateTo(item: DriveItem) {
    if (item.type !== 'folder') return;
    const newPrefix = item.key;
    setCurrentPrefix(newPrefix);
    const parts = newPrefix.split('/').filter(Boolean);
    const crumbs: Breadcrumb[] = [{ label: 'My Drive', prefix: '' }];
    let acc = '';
    for (const part of parts) {
      acc += part + '/';
      crumbs.push({ label: part, prefix: acc });
    }
    setBreadcrumbs(crumbs);
  }

  function navigateToCrumb(crumb: Breadcrumb) {
    setCurrentPrefix(crumb.prefix);
    const idx = breadcrumbs.findIndex(c => c.prefix === crumb.prefix);
    setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
  }

  // ── Upload ───────────────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const key = currentPrefix + file.name;
      setUploadProgress(`Uploading ${file.name}…`);
      try {
        const { url } = await apiFetch<{ url: string }>('/docs/presign-upload', {
          method: 'POST',
          body: JSON.stringify({ key, contentType: file.type || 'application/octet-stream' }),
        });
        await fetch(url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch {
        setUploadProgress(`Failed to upload ${file.name}`);
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await fetchItems(currentPrefix);
  }

  // ── Download ─────────────────────────────────────────────────────────────────
  async function handleDownload(item: DriveItem) {
    try {
      const { url } = await apiFetch<{ url: string }>('/docs/presign-download', {
        method: 'POST',
        body: JSON.stringify({ key: item.key }),
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = item.name;
      a.click();
    } catch (e) {
      alert('Download failed: ' + (e as Error).message);
    }
  }

  // ── Preview ──────────────────────────────────────────────────────────────────
  async function handlePreview(item: DriveItem) {
    try {
      const { url } = await apiFetch<{ url: string }>('/docs/presign-download', {
        method: 'POST',
        body: JSON.stringify({ key: item.key }),
      });
      setPreviewUrl(url);
      setPreviewItem(item);
    } catch (e) {
      alert('Preview failed: ' + (e as Error).message);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDelete(item: DriveItem) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch('/docs/delete', {
        method: 'DELETE',
        body: JSON.stringify({ key: item.key }),
      });
      await fetchItems(currentPrefix);
    } catch (e) {
      alert('Delete failed: ' + (e as Error).message);
    }
  }

  // ── New folder ────────────────────────────────────────────────────────────────
  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderCreating(true);
    try {
      await apiFetch('/docs/folder', {
        method: 'POST',
        body: JSON.stringify({ folderPath: currentPrefix + name + '/' }),
      });
      setShowNewFolder(false);
      setNewFolderName('');
      await fetchItems(currentPrefix);
    } catch (e) {
      alert('Failed to create folder: ' + (e as Error).message);
    } finally {
      setFolderCreating(false);
    }
  }

  // ── Filtered items ────────────────────────────────────────────────────────────
  const filtered = items.filter(it =>
    it.name.toLowerCase().includes(search.toLowerCase())
  );
  const folders = filtered.filter(it => it.type === 'folder');
  const files = filtered.filter(it => it.type === 'file');

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-7xl animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Folder size={22} className="text-[#00B98E]" />
            Documents Drive
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Upload, organise, and access company documents — backed by S3
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => fetchItems(currentPrefix)}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors">
            <FolderPlus size={13} />
            New Folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{ background: '#00B98E', color: '#020617' }}>
            {uploading
              ? <Loader2 size={13} className="animate-spin" />
              : <Upload size={13} />}
            {uploading ? 'Uploading…' : 'Upload Files'}
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {/* ── Upload progress toast ── */}
      {uploadProgress && (
        <div className="glass-card px-4 py-3 flex items-center gap-3 border-l-2 border-[#00B98E]">
          <Loader2 size={14} className="animate-spin text-[#00B98E] shrink-0" />
          <span className="text-xs text-slate-300">{uploadProgress}</span>
        </div>
      )}

      {/* ── Main card ── */}
      <div className="glass-card overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 flex-wrap">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-1 flex-1 min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.prefix} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={14} className="text-slate-600 shrink-0" />}
                <button
                  onClick={() => navigateToCrumb(crumb)}
                  className={`flex items-center gap-1.5 text-xs px-1.5 py-1 rounded transition-colors ${
                    i === breadcrumbs.length - 1
                      ? 'text-slate-200 font-medium'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  {i === 0 && <Home size={12} />}
                  {crumb.label}
                </button>
              </span>
            ))}
          </nav>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/60 rounded-lg border border-slate-700 w-52">
            <Search size={13} className="text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder="Search files…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none" />
            {search && (
              <button onClick={() => setSearch('')}>
                <X size={12} className="text-slate-500 hover:text-slate-300" />
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 text-xs transition-colors ${viewMode === 'grid' ? 'bg-slate-700 text-slate-100' : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'}`}>
              <Grid3X3 size={14} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 text-xs transition-colors ${viewMode === 'list' ? 'bg-slate-700 text-slate-100' : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'}`}>
              <List size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-[#00B98E]" />
            </div>
          ) : error ? (
            <div className="glass-card p-8 flex flex-col items-center gap-4">
              <AlertCircle size={32} className="text-red-400" />
              <p className="text-sm text-slate-300">{error}</p>
              <button onClick={() => fetchItems(currentPrefix)}
                className="px-4 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors">
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              onUpload={() => fileInputRef.current?.click()}
              onNewFolder={() => setShowNewFolder(true)} />
          ) : viewMode === 'grid' ? (
            /* ── Grid View ── */
            <div className="space-y-5">
              {folders.length > 0 && (
                <div>
                  <p className="text-2xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                    Folders
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {folders.map(item => (
                      <GridItem
                        key={item.key}
                        item={item}
                        onOpen={() => navigateTo(item)}
                        onContextMenu={(x, y) => setContextMenu({ item, x, y })}
                        onDownload={() => handleDownload(item)}
                        onPreview={() => handlePreview(item)}
                        onDelete={() => handleDelete(item)} />
                    ))}
                  </div>
                </div>
              )}
              {files.length > 0 && (
                <div>
                  <p className="text-2xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                    Files
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {files.map(item => (
                      <GridItem
                        key={item.key}
                        item={item}
                        onOpen={() => isPreviewable(item) ? handlePreview(item) : handleDownload(item)}
                        onContextMenu={(x, y) => setContextMenu({ item, x, y })}
                        onDownload={() => handleDownload(item)}
                        onPreview={() => handlePreview(item)}
                        onDelete={() => handleDelete(item)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── List View ── */
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-left border-b border-slate-800">
                  <th className="px-4 py-3 font-medium text-2xs uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 font-medium text-2xs uppercase tracking-wider hidden sm:table-cell">Modified</th>
                  <th className="px-4 py-3 font-medium text-2xs uppercase tracking-wider hidden md:table-cell text-right">Size</th>
                  <th className="px-4 py-3 font-medium text-2xs uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...folders, ...files].map(item => (
                  <tr key={item.key}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => item.type === 'folder' ? navigateTo(item) : (isPreviewable(item) ? handlePreview(item) : handleDownload(item))}
                        className="flex items-center gap-3 text-slate-200 hover:text-[#00B98E] transition-colors text-left">
                        {getFileIcon(item)}
                        <span className="truncate max-w-xs">{item.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {formatDate(item.lastModified)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell text-right tabular-nums">
                      {item.type === 'folder' ? '—' : formatBytes(item.size ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        {item.type === 'file' && isPreviewable(item) && (
                          <button onClick={() => handlePreview(item)}
                            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                            title="Preview">
                            <Eye size={13} />
                          </button>
                        )}
                        {item.type === 'file' && (
                          <button onClick={() => handleDownload(item)}
                            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                            title="Download">
                            <Download size={13} />
                          </button>
                        )}
                        <button onClick={() => handleDelete(item)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                          title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer stats */}
        {!loading && !error && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-4">
            <span className="text-2xs text-slate-500">{folders.length} folder{folders.length !== 1 ? 's' : ''}</span>
            <span className="text-2xs text-slate-600">·</span>
            <span className="text-2xs text-slate-500">{files.length} file{files.length !== 1 ? 's' : ''}</span>
            {files.length > 0 && (
              <>
                <span className="text-2xs text-slate-600">·</span>
                <span className="text-2xs text-slate-500">
                  {formatBytes(files.reduce((s, f) => s + (f.size ?? 0), 0))} total
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── New Folder Modal ── */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(6px)' }}>
          <div className="glass-card w-full max-w-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-100">New Folder</h3>
            <input
              type="text"
              placeholder="Folder name"
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolder(false); }}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-[#00B98E]/50 transition-colors" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                className="px-4 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreateFolder} disabled={!newFolderName.trim() || folderCreating}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{ background: '#00B98E', color: '#020617' }}>
                {folderCreating ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Context Menu ── */}
      {contextMenu && (
        <ContextMenu
          item={contextMenu.item}
          pos={{ x: contextMenu.x, y: contextMenu.y }}
          onDownload={() => { handleDownload(contextMenu.item); setContextMenu(null); }}
          onPreview={() => { handlePreview(contextMenu.item); setContextMenu(null); }}
          onDelete={() => { handleDelete(contextMenu.item); setContextMenu(null); }}
          onClose={() => setContextMenu(null)} />
      )}

      {/* ── Preview Modal ── */}
      {previewItem && previewUrl && (
        <PreviewModal
          item={previewItem}
          url={previewUrl}
          onClose={() => { setPreviewItem(null); setPreviewUrl(''); }} />
      )}
    </div>
  );
}

// ─── Grid Item ────────────────────────────────────────────────────────────────

function GridItem({
  item,
  onOpen,
  onContextMenu,
  onDownload,
  onPreview,
  onDelete,
}: {
  item: DriveItem;
  onOpen: () => void;
  onContextMenu: (x: number, y: number) => void;
  onDownload: () => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="group relative flex flex-col items-center gap-2 p-3 rounded-xl border border-transparent hover:border-slate-700 hover:bg-slate-800/40 transition-all cursor-pointer select-none"
      onDoubleClick={onOpen}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e.clientX, e.clientY); }}>

      {/* Icon */}
      <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
        item.type === 'folder' ? 'bg-[#00B98E]/10' : 'bg-slate-800'
      }`}>
        <span className="scale-150">{getFileIcon(item)}</span>
      </div>

      {/* Name */}
      <span className="text-xs text-slate-300 text-center leading-tight line-clamp-2 w-full px-1">
        {item.name}
      </span>

      {/* Size */}
      {item.type === 'file' && item.size !== undefined && (
        <span className="text-2xs text-slate-600">{formatBytes(item.size)}</span>
      )}

      {/* Actions button - visible on hover */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition-colors">
          <MoreVertical size={12} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-7 glass-card py-1 w-36 shadow-xl z-20"
            onMouseLeave={() => setMenuOpen(false)}>
            {item.type === 'folder' && (
              <button onClick={() => { onOpen(); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                <Folder size={12} /> Open
              </button>
            )}
            {item.type === 'file' && isPreviewable(item) && (
              <button onClick={() => { onPreview(); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                <Eye size={12} /> Preview
              </button>
            )}
            {item.type === 'file' && (
              <button onClick={() => { onDownload(); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                <Download size={12} /> Download
              </button>
            )}
            <div className="border-t border-slate-800 my-1" />
            <button onClick={() => { onDelete(); setMenuOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
