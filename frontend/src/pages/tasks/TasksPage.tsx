import { useState, useCallback } from 'react';
import { Mail, Upload, Paperclip, Send, CheckCircle, XCircle, Loader2, FileSpreadsheet, FileText, Trash2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { sendBulkEmail } from '@/api/client';

type Recipient = {
  email: string;
  name?: string;
  [key: string]: any; // Other columns from XLSX
};

type Attachment = {
  file: File;
  preview?: string;
};

export default function TasksPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [emailBody, setEmailBody] = useState('');
  const [subject, setSubject] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const sendEmailMutation = useMutation({
    mutationFn: sendBulkEmail,
    onSuccess: (data) => {
      alert(`Email campaign sent successfully!\n\nTotal: ${data.total}\nSuccess: ${data.success}\nFailed: ${data.failed}`);
      // Reset form
      setRecipients([]);
      setEmailBody('');
      setSubject('');
      setAttachments([]);
    },
    onError: (error: any) => {
      alert(`Failed to send emails: ${error?.message ?? 'Unknown error'}`);
    },
  });

  const handleXlsxUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadProgress('Reading XLSX file...');
    
    // For now, we'll parse CSV (XLSX parsing requires a library like xlsx)
    // In production, you'd use a library like 'xlsx' or 'papaparse'
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        // Assume first row is headers
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const emailIndex = headers.findIndex(h => h.includes('email'));
        
        if (emailIndex === -1) {
          alert('No "email" column found in the file');
          setUploadProgress(null);
          return;
        }

        const parsed: Recipient[] = lines.slice(1).map(line => {
          const values = line.split(',');
          const recipient: Recipient = {
            email: values[emailIndex]?.trim() || '',
          };
          
          // Add other columns
          headers.forEach((header, index) => {
            if (index !== emailIndex && values[index]) {
              recipient[header] = values[index].trim();
            }
          });
          
          return recipient;
        }).filter(r => r.email);

        setRecipients(parsed);
        setUploadProgress(null);
        alert(`Loaded ${parsed.length} recipients from ${file.name}`);
      } catch (error) {
        alert('Error parsing file. Please ensure it\'s a valid CSV/XLSX format.');
        setUploadProgress(null);
      }
    };
    
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  }, []);

  const handleAttachmentUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = files.map(file => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => {
      const removed = prev[index];
      if (removed?.preview) {
        URL.revokeObjectURL(removed.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (recipients.length === 0) {
      alert('Please upload recipients first');
      return;
    }
    if (!subject.trim()) {
      alert('Please enter a subject');
      return;
    }
    if (!emailBody.trim()) {
      alert('Please enter an email body');
      return;
    }

    sendEmailMutation.mutate({
      recipients: recipients.map(r => r.email),
      subject: subject.trim(),
      body: emailBody.trim(),
      attachments: attachments.map(a => a.file),
    });
  }, [recipients, subject, emailBody, attachments, sendEmailMutation]);

  const isValid = recipients.length > 0 && subject.trim() && emailBody.trim();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Mail size={24} className="text-emerald-400" />
          Email Campaigns
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Send bulk emails to your marketing recipients
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Recipients Upload */}
        <div className="agent-card p-6">
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-blue-400" />
            Recipients List
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Upload Recipients (CSV/XLSX)
              </label>
              <div className="flex items-center gap-3">
                <label className="flex-1">
                  <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 text-center hover:border-emerald-400/50 transition-colors cursor-pointer">
                    <Upload size={24} className="mx-auto text-slate-500 mb-2" />
                    <p className="text-sm text-slate-400">
                      Click to upload CSV or XLSX file
                    </p>
                    <p className="text-2xs text-slate-600 mt-1">
                      Must contain an "email" column
                    </p>
                  </div>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleXlsxUpload}
                    className="hidden"
                  />
                </label>
              </div>
              {uploadProgress && (
                <p className="text-2xs text-emerald-400 mt-2 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  {uploadProgress}
                </p>
              )}
            </div>

            {recipients.length > 0 && (
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-300">
                    {recipients.length} recipients loaded
                  </p>
                  <button
                    type="button"
                    onClick={() => setRecipients([])}
                    className="text-2xs text-red-400 hover:text-red-300 flex items-center gap-1"
                  >
                    <Trash2 size={12} />
                    Clear all
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {recipients.slice(0, 10).map((r, i) => (
                    <div key={i} className="text-2xs text-slate-400 flex items-center gap-2">
                      <CheckCircle size={10} className="text-emerald-400" />
                      {r.email}
                      {r.name && <span className="text-slate-500">({r.name})</span>}
                    </div>
                  ))}
                  {recipients.length > 10 && (
                    <p className="text-2xs text-slate-500 italic">
                      ...and {recipients.length - 10} more
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Email Content */}
        <div className="agent-card p-6">
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Mail size={18} className="text-indigo-400" />
            Email Content
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter email subject..."
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Email Body
              </label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                placeholder="Enter your email message here...&#10;&#10;You can use HTML tags for formatting:&#10;<b>bold</b>, <i>italic</i>, <a href='...'>link</a>"
                rows={12}
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors font-mono text-sm"
                required
              />
              <p className="text-2xs text-slate-500 mt-1">
                HTML formatting is supported
              </p>
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div className="agent-card p-6">
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Paperclip size={18} className="text-amber-400" />
            Attachments (Optional)
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Upload Files
              </label>
              <label className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors">
                <Upload size={16} className="text-slate-400" />
                <span className="text-sm text-slate-300">Choose files...</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={handleAttachmentUpload}
                  className="hidden"
                />
              </label>
              <p className="text-2xs text-slate-500 mt-1">
                Supported: Images, PDF, Word, Excel (max 10MB per file)
              </p>
            </div>

            {attachments.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {attachments.map((att, index) => (
                  <div
                    key={index}
                    className="relative bg-slate-800/50 border border-slate-700 rounded-lg p-3 group"
                  >
                    {att.preview ? (
                      <img
                        src={att.preview}
                        alt={att.file.name}
                        className="w-full h-20 object-cover rounded mb-2"
                      />
                    ) : (
                      <div className="w-full h-20 bg-slate-700/50 rounded mb-2 flex items-center justify-center">
                        {att.file.type.includes('pdf') ? (
                          <FileText size={24} className="text-red-400" />
                        ) : (
                          <FileText size={24} className="text-slate-400" />
                        )}
                      </div>
                    )}
                    <p className="text-2xs text-slate-300 truncate">{att.file.name}</p>
                    <p className="text-2xs text-slate-500">
                      {(att.file.size / 1024).toFixed(1)} KB
                    </p>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="absolute top-2 right-2 p-1 bg-red-500/80 hover:bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XCircle size={14} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between bg-slate-800/30 border border-slate-700 rounded-lg p-4">
          <div className="text-sm text-slate-400">
            {recipients.length > 0 && (
              <span>Ready to send to <strong className="text-slate-200">{recipients.length}</strong> recipients</span>
            )}
          </div>
          <button
            type="submit"
            disabled={!isValid || sendEmailMutation.isPending}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-lg transition-colors"
          >
            {sendEmailMutation.isPending ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send size={18} />
                Send Campaign
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}