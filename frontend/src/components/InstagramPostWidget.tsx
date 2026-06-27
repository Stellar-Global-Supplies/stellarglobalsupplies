import { useState, useCallback } from 'react';
import { Instagram, Upload, Send, Loader2, XCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

type InstagramPostData = {
  caption: string;
  imageFile?: File;
};

export default function InstagramPostWidget() {
  const [caption, setCaption] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

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
    mutationFn: async (data: InstagramPostData) => {
      // TODO: Implement Instagram API call
      // This will require:
      // 1. Instagram Basic Display API or Instagram Graph API
      // 2. Facebook Developer account
      // 3. Instagram Business/Creator account
      // 4. Store access tokens in DynamoDB
      // 5. Upload image and create post
      
      console.log('Posting to Instagram:', data);
      
      // Mock success for now
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true, postId: 'mock-instagram-post-id' });
        }, 1000);
      });
    },
    onSuccess: () => {
      alert('Instagram post published successfully!');
      setCaption('');
      setImageFile(null);
      setImagePreview(null);
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
    if (!imageFile) {
      alert('Please upload an image (required for Instagram)');
      return;
    }

    postMutation.mutate({
      caption: caption.trim(),
      imageFile: imageFile,
    });
  };

  const isValid = caption.trim().length > 0 && imageFile !== null;

  return (
    <div className="agent-card p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Instagram size={18} className="text-pink-400" />
        Instagram Post
      </h2>

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

        {/* Image Upload (required) */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Image (Required)
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
                required
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
            Image is required for Instagram posts
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