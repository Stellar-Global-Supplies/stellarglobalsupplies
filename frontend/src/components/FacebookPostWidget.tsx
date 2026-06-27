import { useState, useCallback, useEffect } from 'react';
import { Facebook, Upload, Send, Loader2, XCircle, Link } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getFacebookConnectUrl, getFacebookStatus, disconnectFacebook, postToFacebook } from '@/api/client';

type FacebookPostData = {
  message: string;
  imageUrl?: string;
};

export default function FacebookPostWidget() {
  const [message, setMessage] = useState('');
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

  // Check Facebook connection status
  const { data: connectionStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['facebook-status', userId],
    queryFn: () => getFacebookStatus(userId),
    enabled: !!userId,
  });

  // Handle OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('social') === 'facebook') {
      if (params.get('connected') === 'true') {
        refetchStatus();
        window.history.replaceState({}, '', window.location.pathname);
      } else if (params.get('error')) {
        alert(`Facebook connection failed: ${params.get('error')}`);
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
    mutationFn: async (data: FacebookPostData) => {
      if (!userId) throw new Error('Not authenticated');
      return postToFacebook(userId, data.message, data.imageUrl);
    },
    onSuccess: () => {
      setMessage('');
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
    
    if (!message.trim()) {
      alert('Please enter a message');
      return;
    }

    postMutation.mutate({
      message: message.trim(),
      imageUrl: uploadedImageUrl,
    });
  };

  const isValid = message.trim().length > 0;

  return (
    <div className="agent-card p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Facebook size={18} className="text-blue-500" />
        Facebook Post
      </h2>

      {/* Connection Status */}
      {userId && connectionStatus?.connected ? (
        <div className="flex items-center justify-between p-2 bg-emerald-900/30 border border-emerald-700/50 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-emerald-300">
              Connected: {connectionStatus.facebook_page_name || 'Facebook Page'}
            </span>
          </div>
          <button
            type="button"
            onClick={async () => {
              await disconnectFacebook(userId);
              refetchStatus();
            }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Disconnect
          </button>
        </div>
      ) : userId ? (
        <div className="flex items-center justify-between p-2 bg-slate-800/50 border border-slate-700 rounded-lg mb-4">
          <span className="text-xs text-slate-400">Not connected to Facebook</span>
          <a
            href={getFacebookConnectUrl(userId)}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          >
            <Link size={12} />
            Connect Facebook
          </a>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Message */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What's on your mind?&#10;&#10;Share updates about your business..."
            rows={5}
            maxLength={63206}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors"
            required
          />
          <p className="text-2xs text-slate-500 mt-1">
            {message.length}/63206 characters
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