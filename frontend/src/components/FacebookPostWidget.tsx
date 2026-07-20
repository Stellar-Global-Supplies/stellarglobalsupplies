import { useState, useCallback } from 'react';
import { Facebook, Upload, Send, Loader2, XCircle } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getFacebookStatus, postToFacebook, uploadMediaForSocialPost } from '@/api/client';

type FacebookPostData = {
  message: string;
  mediaFile?: File | null;
  mediaType?: 'image' | 'video';
};

export default function FacebookPostWidget() {
  const [message, setMessage] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [isUploading, setIsUploading] = useState(false);

  // Check Facebook connection status (static token - no OAuth)
  const { data: connectionStatus } = useQuery({
    queryKey: ['facebook-status'],
    queryFn: () => getFacebookStatus(),
  });

  const handleMediaUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      alert('Please select an image or video file');
      return;
    }

    setMediaFile(file);
    setMediaType(isVideo ? 'video' : 'image');
    setMediaPreview(URL.createObjectURL(file));
    e.target.value = '';
  }, []);

  const removeMedia = useCallback(() => {
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaFile(null);
    setMediaPreview(null);
    setMediaType('image');
  }, [mediaPreview]);

  const postMutation = useMutation({
    mutationFn: async (data: FacebookPostData) => {
      let mediaUrl: string | undefined;
      if (data.mediaFile) {
        setIsUploading(true);
        try {
          mediaUrl = await uploadMediaForSocialPost(data.mediaFile);
        } finally {
          setIsUploading(false);
        }
      }
      return postToFacebook(data.message, mediaUrl, data.mediaType);
    },
    onSuccess: () => {
      setMessage('');
      setMediaFile(null);
      setMediaPreview(null);
      setMediaType('image');
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
      mediaFile,
      mediaType,
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
      {connectionStatus?.connected ? (
        <div className="flex items-center p-2 bg-emerald-900/30 border border-emerald-700/50 rounded-lg mb-4">
          <div className="w-2 h-2 rounded-full bg-emerald-400 mr-2" />
          <span className="text-xs text-emerald-300">
            Connected: {connectionStatus.facebook_page_name || 'Facebook Page'}
          </span>
        </div>
      ) : connectionStatus ? (
        <div className="p-2 bg-amber-900/30 border border-amber-700/50 rounded-lg mb-4">
          <span className="text-xs text-amber-300">Facebook not configured. Add page token to proceed.</span>
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

        {/* Media Upload (optional) */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Media (Image or Video - Optional)
          </label>
          {!mediaFile ? (
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors">
              <Upload size={14} className="text-slate-400" />
              <span className="text-xs text-slate-300">Upload image or video</span>
              <input
                type="file"
                accept="image/*,video/*"
                onChange={handleMediaUpload}
                className="hidden"
              />
            </label>
          ) : (
            <div className="relative bg-slate-800/50 border border-slate-700 rounded-lg p-2">
              {mediaType === 'video' ? (
                <video
                  src={mediaPreview!}
                  controls
                  className="w-full h-32 object-cover rounded"
                />
              ) : (
                <img
                  src={mediaPreview!}
                  alt="Preview"
                  className="w-full h-32 object-cover rounded"
                />
              )}
              <button
                type="button"
                onClick={removeMedia}
                className="absolute top-2 right-2 p-1 bg-red-500/80 hover:bg-red-500 rounded-full"
              >
                <XCircle size={14} className="text-white" />
              </button>
            </div>
          )}
          <p className="text-2xs text-slate-500 mt-1">
            Add media to make your post more engaging
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
              {isUploading ? 'Uploading media...' : 'Publishing...'}
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