import { useState, useCallback, useEffect } from 'react';
import { Linkedin, Upload, Send, Loader2, XCircle, Link } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getLinkedInConnectUrl, getLinkedInStatus, disconnectLinkedIn, postToLinkedIn } from '@/api/client';

type LinkedInPostData = {
  content: string;
  imageUrl?: string;
};

export default function LinkedInPostWidget() {
  const [content, setContent] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | undefined>(undefined);

  // Get current user
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setUserId(session.user.id);
    });
  }, []);

  // Check LinkedIn connection status
  const { data: connectionStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['linkedin-status', userId],
    queryFn: () => getLinkedInStatus(userId),
    enabled: !!userId,
  });

  // Handle OAuth redirect (check for connected=true in URL)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('social') === 'linkedin') {
      if (params.get('connected') === 'true') {
        refetchStatus();
        window.history.replaceState({}, '', window.location.pathname);
      } else if (params.get('error')) {
        alert(`LinkedIn connection failed: ${params.get('error')}`);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [refetchStatus]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    e.target.value = '';
  }, []);

  const removeImage = useCallback(() => {
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    setImageFile(null);
    setImagePreview(null);
  }, [imagePreview]);

  const postMutation = useMutation({
    mutationFn: async (data: LinkedInPostData) => {
      if (!userId) throw new Error('Not authenticated');
      return postToLinkedIn(userId, data.content, data.imageUrl);
    },
    onSuccess: () => {
      setContent('');
      setImageFile(null);
      setImagePreview(null);
      setUploadedImageUrl(undefined);
    },
    onError: (error: any) => {
      alert(`Failed to post: ${error?.message ?? 'Unknown error'}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!content.trim()) {
      alert('Please enter post content');
      return;
    }

    postMutation.mutate({
      content: content.trim(),
      imageUrl: uploadedImageUrl,
    });
  };

  const isValid = content.trim().length > 0;

  return (
    <div className="agent-card p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Linkedin size={18} className="text-blue-400" />
        LinkedIn Post
      </h2>

      {/* Connection Status */}
      {userId && connectionStatus?.connected ? (
        <div className="flex items-center justify-between p-2 bg-emerald-900/30 border border-emerald-700/50 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-emerald-300">
              Connected: {connectionStatus.linkedin_page_name || 'LinkedIn Company Page'}
            </span>
          </div>
          <button
            type="button"
            onClick={async () => {
              await disconnectLinkedIn(userId);
              refetchStatus();
            }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Disconnect
          </button>
        </div>
      ) : userId ? (
        <div className="flex items-center justify-between p-2 bg-slate-800/50 border border-slate-700 rounded-lg mb-4">
          <span className="text-xs text-slate-400">Not connected to LinkedIn</span>
          <a
            href={getLinkedInConnectUrl(userId)}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          >
            <Link size={12} />
            Connect LinkedIn
          </a>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Post Content */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Post Content
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What do you want to share?&#10;&#10;Supports hashtags like #B2B #Steel #Manufacturing"
            rows={6}
            maxLength={3000}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors"
            required
          />
          <p className="text-2xs text-slate-500 mt-1">
            {content.length}/3000 characters
          </p>
        </div>

        {/* Image Upload (optional) */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Image (Optional)
          </label>
          {!imageFile ? (
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors">
              <Upload size={14} className="text-slate-400" />
              <span className="text-xs text-slate-300">Upload image</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
          ) : (
            <div className="relative bg-slate-800/50 border border-slate-700 rounded-lg p-2">
              <img
                src={imagePreview!}
                alt="Preview"
                className="w-full h-32 object-cover rounded"
              />
              <button
                type="button"
                onClick={removeImage}
                className="absolute top-2 right-2 p-1 bg-red-500/80 hover:bg-red-500 rounded-full"
              >
                <XCircle size={14} className="text-white" />
              </button>
            </div>
          )}
          <p className="text-2xs text-slate-500 mt-1">
            Add an image to make your post more engaging
          </p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!isValid || postMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
        >
          {postMutation.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Publishing...
            </>
          ) : (
            <>
              <Send size={16} />
              Publish Post
            </>
          )}
        </button>
      </form>
    </div>
  );
}