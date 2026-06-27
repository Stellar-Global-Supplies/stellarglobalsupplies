import { useState } from 'react';
import { Linkedin, Image, Send, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

type LinkedInPostData = {
  content: string;
  imageUrl?: string;
};

export default function LinkedInPostWidget() {
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const postMutation = useMutation({
    mutationFn: async (data: LinkedInPostData) => {
      // TODO: Implement LinkedIn API call
      // This will require:
      // 1. LinkedIn OAuth integration (similar to Google OAuth)
      // 2. Store LinkedIn access tokens in DynamoDB
      // 3. Call LinkedIn UGC API to create post
      
      console.log('Posting to LinkedIn:', data);
      
      // Mock success for now
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true, postId: 'mock-post-id' });
        }, 1000);
      });
    },
    onSuccess: () => {
      alert('LinkedIn post published successfully!');
      setContent('');
      setImageUrl('');
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
      imageUrl: imageUrl.trim() || undefined,
    });
  };

  const isValid = content.trim().length > 0;

  return (
    <div className="agent-card p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Linkedin size={18} className="text-blue-400" />
        LinkedIn Post
      </h2>

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

        {/* Image URL (optional) */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Image URL (Optional)
          </label>
          <div className="flex items-center gap-2">
            <Image size={14} className="text-slate-400" />
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none transition-colors"
            />
          </div>
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