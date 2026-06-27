import { useState, useCallback } from 'react';
import { Mail, Upload, Paperclip, Send, XCircle, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { sendBulkEmail } from '@/api/client';

type Recipient = {
  email: string;
  name?: string;
  [key: string]: any;
};

type Attachment = {
  file: File;
  preview?: string;
};

export default function EmailCampaignWidget() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [emailBody, setEmailBody] = useState('');
  const [subject, setSubject] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const sendEmailMutation = useMutation({
    mutationFn: sendBulkEmail,
    onSuccess: (data) => {
      alert(`Email campaign sent successfully!\n\nTotal: ${data.total}\nSuccess: ${data.success}\nFailed: ${data.failed}`);
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

    setUploadProgress('Reading file...');
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
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
        alert('Error parsing file. Please ensure it\'s a valid CSV format.');
        setUploadProgress(null);
      }
    };
    
    reader.readAsText(file);
    e.target.value = '';
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
    <div className="agent-card p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Mail size={18} className="text-indigo-400" />
        Email Campaign
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Recipients Upload */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Recipients (CSV)
          </label>
          <p className="text-2xs text-slate-500 mb-2">
            Required: CSV file with "email" column (e.g., email,name,company)
          </p>
          <label className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors">
            <Upload size={14} className="text-slate-400" />
            <span className="text-xs text-slate-300">Upload CSV file</span>
            <input
              type="file"
              accept=".csv"
              onChange={handleXlsxUpload}
              className="hidden"
            />
          </label>
          {uploadProgress && (
            <p className="text-2xs text-emerald-400 mt-1 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              {uploadProgress}
            </p>
          )}
          {recipients.length > 0 && (
            <div className="mt-2 text-xs text-slate-400">
              {recipients.length} recipients loaded
            </div>
          )}
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter email subject..."
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors"
            required
          />
        </div>

        {/* Email Body */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Email Body (HTML supported)
          </label>
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder="Enter your email message..."
            rows={6}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors font-mono"
            required
          />
        </div>

        {/* Attachments */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Attachments (Optional)
          </label>
          <label className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors">
            <Paperclip size={14} className="text-slate-400" />
            <span className="text-xs text-slate-300">Add files</span>
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx"
              onChange={handleAttachmentUpload}
              className="hidden"
            />
          </label>
          {attachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {attachments.map((att, index) => (
                <div key={index} className="flex items-center justify-between bg-slate-800/30 rounded px-2 py-1">
                  <span className="text-2xs text-slate-300 truncate">{att.file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <XCircle size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!isValid || sendEmailMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-lg transition-colors text-sm"
        >
          {sendEmailMutation.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send size={16} />
              Send Campaign
            </>
          )}
        </button>
      </form>
    </div>
  );
}