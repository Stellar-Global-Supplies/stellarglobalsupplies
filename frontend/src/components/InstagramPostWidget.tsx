import { useState, useCallback } from 'react';
import { Instagram, Upload, Send, Loader2, XCircle } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getFacebookStatus, postToInstagram, uploadMediaForSocialPost } from '@/api/client';

export default function InstagramPostWidget() {
  const [caption, setCaption] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');

  // Check Facebook/Instagram connection status
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

  const [isUploading, setIsUploading] = useState(false);

  const postMutation = useMutation({
    mutationFn: async (data: { caption: string; mediaFile: File; mediaType: 'image' | 'video' }) => {
      setIsUploading(true);
      try {
        const mediaUrl = await uploadMediaForSocialPost(data.mediaFile);
        return await postToInstagram(data.caption, mediaUrl, data.mediaType);
      } finally {
        setIsUploading(false);
      }
    },
    onSuccess: () => {
      setCaption('');
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
    
    if (!caption.trim()) {
      alert('Please enter a caption');
      return;
    }
    if (!mediaFile) {
      alert('Please upload an image or video (required for Instagram)');
      return;
    }

    postMutation.mutate({
      caption: caption.trim(),
      mediaFile,
      mediaType,
    });
  };

  const isValid = caption.trim().length > 0 && mediaFile !== null;

  return (
    <div className="agent-card p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Instagram size={18} className="text-pink-400" />
        Instagram Post
      </h2>

      {/* Connection Status */}
      {connectionStatus?.connected ? (
        <div className="flex items-center p-2 bg-emerald-900/30 border border-emerald-700/50 rounded-lg mb-4">
          <div className="w-2 h-2 rounded-full bg-emerald-400 mr-2" />
          <span className="text-xs text-emerald-300">
            Connected: {connectionStatus.facebook_page_name || 'Instagram via Facebook'}
          </span>
        </div>
      ) : connectionStatus ? (
        <div className="p-2 bg-amber-900/30 border border-amber-700/50 rounded-lg mb-4">
          <span className="text-xs text-amber-300">Instagram not configured. Add Facebook page token to proceed.</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Caption */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Caption
          </label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write your caption...&#10;&#10;Add hashtags like #B2B #Steel #Manufacturing"
            rows={4}
            maxLength={2200}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors"
            required
          />
          <p className="text-2xs text-slate-500 mt-1">
            {caption.length}/2200 characters
          </p>
        </div>

        {/* Media Upload (required) */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Media (Image or Video Required)
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
                required
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
            {mediaType === 'video' ? 'Video is required for Instagram posts' : 'Image is required for Instagram posts'}
          </p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!isValid || postMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
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