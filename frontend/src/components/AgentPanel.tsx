import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp,
  Target,
  BarChart2,
  Cloud,
  Megaphone,
  Calendar,
  Send,
  Trash2,
  ChevronRight,
  Bot,
  User,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Link2,
  Unlink,
  Mail,
  CalendarCheck,
  TrendingDown,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { LucideIcon } from 'lucide-react';
import {
  listAgents,
  sendChatMessage,
  getGoogleConnectUrl,
  getGoogleConnectionStatus,
  disconnectGoogleAccount,
} from '@/api/client';
import { useChatStore, useNotificationStore } from '@/store';
import type { AgentProfile, ChatMessage } from '@/types';

const CURRENT_USER_ID = 'manager-001';

// ────────────────────────────────────────────────────────────────────────────
// Icon map
// ────────────────────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, LucideIcon> = {
  TrendingUp,
  Target,
  BarChart2,
  Cloud,
  Megaphone,
  Calendar,
  TrendingDown,
};

function AgentIcon({ icon, size = 20, className = '' }: { icon: string; size?: number; className?: string }) {
  const Icon = ICON_MAP[icon] ?? Bot;
  return <Icon size={size} className={className} />;
}

// ────────────────────────────────────────────────────────────────────────────
// Skeleton
// ────────────────────────────────────────────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-slate-800 ${className}`}
      style={{
        backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }}
      aria-hidden="true"
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Suggested prompts per agent role
// ────────────────────────────────────────────────────────────────────────────
const SUGGESTED_PROMPTS: Record<string, string[]> = {
  'sales-analyst': [
    'What were our top 5 SKUs by revenue last month?',
    'Identify customers with declining order frequency.',
    'Forecast next quarter revenue based on current trends.',
    'Which material type — SS or MS — has the highest margin?',
  ],
  'sales-strategist': [
    'Draft a volume discount tier proposal for enterprise clients.',
    'Suggest a B2B outreach roadmap for new stainless steel buyers.',
    'What contract terms should we offer for annual steel supply agreements?',
    'Identify cross-sell opportunities between SS and MS product lines.',
  ],
  'business-analyst': [
    'Summarize our operational performance metrics for this quarter.',
    'Where are the current pipeline bottlenecks in our order fulfilment?',
    'Calculate our gross margin on MS products versus SS products.',
    'What operational improvements would most impact our EBITDA?',
  ],
  'cloud-engineer': [
    'Report the current system health and Lambda latency metrics.',
    'What are our estimated AWS costs this month?',
    'Are there any DynamoDB throttling events in the last 24 hours?',
    'Summarize the CloudFront cache hit ratio and bandwidth usage.',
  ],
  'marketing-manager': [
    'Draft a LinkedIn post announcing our new SS 316L sheet product launch.',
    'Write a B2B email newsletter for our Q1 steel pricing update.',
    'Generate SEO product copy for our Mild Steel flat bar catalogue.',
    'Suggest 5 content topics for our structural steel blog.',
  ],
  'executive-assistant': [
    'What\'s on my calendar for the rest of this week?',
    'Schedule a 30-minute sales review with the team tomorrow at 4pm.',
    'Summarize my 5 most recent emails.',
    'Draft a follow-up email to our top customer and send it.',
  ],
  'demand-forecasting': [
    'Forecast SS and MS demand for the next quarter based on historical trends.',
    'How will monsoon season (Jun-Sep) impact our construction material sales?',
    'Predict inventory requirements for Diwali season considering past patterns.',
    'What are the demand risks given our customer concentration?',
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Copy button with feedback
// ────────────────────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors opacity-0 group-hover:opacity-100"
      aria-label="Copy message"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Single chat message bubble
// ────────────────────────────────────────────────────────────────────────────
function MessageBubble({
  message,
  agentColor,
  agentIcon,
}: {
  message: ChatMessage;
  agentColor: string;
  agentIcon: string;
}) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'} items-start group animate-slide-up`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isUser ? 'order-2' : 'order-1'}`}
        style={
          isUser
            ? { backgroundColor: '#334155' }
            : { backgroundColor: `${agentColor}20`, color: agentColor }
        }
      >
        {isUser ? (
          <User size={15} className="text-slate-300" />
        ) : (
          <AgentIcon icon={agentIcon} size={15} />
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[78%] flex flex-col gap-1 ${isUser ? 'items-end order-1' : 'items-start order-2'}`}>
        <div
          className={`
            relative px-4 py-3 rounded-2xl text-sm leading-relaxed
            ${isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700'
            }
            ${message.isStreaming ? 'typing-cursor' : ''}
          `}
        >
          {/* Markdown-lite: render newlines and code blocks */}
          {message.content.split('\n').map((line, i, arr) => {
            const isCode = line.startsWith('```') || line.endsWith('```');
            return (
              <span key={i}>
                {isCode ? (
                  <code className="font-mono text-xs bg-black/30 px-1 py-0.5 rounded">
                    {line.replace(/```/g, '')}
                  </code>
                ) : (
                  line
                )}
                {i < arr.length - 1 && <br />}
              </span>
            );
          })}
        </div>

        <div className={`flex items-center gap-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-2xs text-slate-600">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {!isUser && <CopyButton text={message.content} />}
        </div>

        {!isUser && message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {message.toolsUsed.map((tool, i) => {
              const isCalendar = tool.includes('calendar');
              const Icon = isCalendar ? CalendarCheck : Mail;
              const label = {
                create_calendar_event:       'Created calendar event',
                list_upcoming_calendar_events: 'Checked calendar',
                send_email:                   'Sent email',
                list_recent_emails:           'Read recent emails',
              }[tool] ?? tool;

              return (
                <span
                  key={`${tool}-${i}`}
                  className="flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-800/40"
                >
                  <Icon size={10} />
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty chat state
// ────────────────────────────────────────────────────────────────────────────
function EmptyChatState({
  agent,
  onPrompt,
}: {
  agent: AgentProfile;
  onPrompt: (p: string) => void;
}) {
  const prompts = SUGGESTED_PROMPTS[agent.role] ?? [];

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-10 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
        style={{ backgroundColor: `${agent.color}20`, color: agent.color }}
      >
        <AgentIcon icon={agent.icon} size={28} />
      </div>
      <h3 className="text-base font-semibold text-slate-200 mb-1">{agent.name}</h3>
      <p className="text-sm text-slate-400 max-w-xs mb-6">{agent.description}</p>

      {prompts.length > 0 && (
        <div className="w-full max-w-md">
          <p className="text-xs text-slate-500 mb-3 uppercase tracking-wide">Try asking</p>
          <div className="grid grid-cols-1 gap-2">
            {prompts.map((p) => (
              <button
                key={p}
                onClick={() => onPrompt(p)}
                className="text-left text-xs p-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600 text-slate-300 transition-all duration-150"
              >
                <Sparkles size={11} className="inline mr-1.5 text-indigo-400" />
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Google Connection Banner — for Executive Assistant agent only
// ────────────────────────────────────────────────────────────────────────────
function GoogleConnectionBanner() {
  const push = useNotificationStore((s) => s.push);
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ['google-connection-status', CURRENT_USER_ID],
    queryFn:  () => getGoogleConnectionStatus(CURRENT_USER_ID),
    staleTime: 60 * 1000,
  });

  const [disconnecting, setDisconnecting] = useState(false);

  // Handle redirect back from the OAuth callback (?google_connected=true|false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('google_connected');
    if (connected === null) return;

    if (connected === 'true') {
      const email = params.get('email');
      push({
        type:    'success',
        title:   'Google account connected',
        message: email
          ? `Connected as ${email}. The Executive Assistant can now manage your calendar and email.`
          : 'The Executive Assistant can now manage your calendar and email.',
      });
    } else {
      const reason = params.get('reason') ?? 'unknown_error';
      push({
        type:    'error',
        title:   'Google connection failed',
        message: `Could not connect your Google account (${reason}). Please try again.`,
      });
    }

    // Clean up query params and refresh status
    const url = new URL(window.location.href);
    url.searchParams.delete('google_connected');
    url.searchParams.delete('reason');
    url.searchParams.delete('email');
    window.history.replaceState({}, '', url.toString());

    queryClient.invalidateQueries({ queryKey: ['google-connection-status', CURRENT_USER_ID] });
  }, [push, queryClient]);

  const handleConnect = () => {
    window.location.href = getGoogleConnectUrl(CURRENT_USER_ID);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectGoogleAccount(CURRENT_USER_ID);
      await queryClient.invalidateQueries({ queryKey: ['google-connection-status', CURRENT_USER_ID] });
      push({
        type:    'info',
        title:   'Google account disconnected',
        message: 'Calendar and Gmail access has been revoked.',
      });
    } catch (err) {
      push({
        type:    'error',
        title:   'Failed to disconnect',
        message: (err as Error)?.message ?? 'Unknown error',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-slate-900/40">
        <div className="h-4 w-48 bg-slate-800 rounded animate-pulse" />
      </div>
    );
  }

  if (status?.connected) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-emerald-950/30">
        <Link2 size={14} className="text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-emerald-300">
            Google Account Connected
            {status.google_email && (
              <span className="text-emerald-400/70 font-normal"> · {status.google_email}</span>
            )}
          </p>
          <p className="text-2xs text-emerald-400/60 mt-0.5">
            Calendar & Gmail access enabled — agent can schedule events and send email
          </p>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="flex items-center gap-1.5 px-2.5 py-1 text-2xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors disabled:opacity-50 shrink-0"
        >
          {disconnecting ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />}
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-amber-950/20">
      <CalendarCheck size={14} className="text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-amber-300">Connect your Google Account</p>
        <p className="text-2xs text-amber-400/60 mt-0.5">
          Enable the Executive Assistant to create calendar events and send emails on your behalf
        </p>
      </div>
      <button
        onClick={handleConnect}
        className="flex items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold bg-amber-500 hover:bg-amber-400 text-amber-950 rounded-lg transition-colors shrink-0"
      >
        <Link2 size={11} />
        Connect Google
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Chat panel (for a single selected agent)
// ────────────────────────────────────────────────────────────────────────────
function ChatPanel({
  agent,
  onBack,
}: {
  agent: AgentProfile;
  onBack: () => void;
}) {
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);

  const { appendMessage, updateLastMessage, clearSession, getOrCreateSession } = useChatStore();
  const session  = useChatStore((s) => s.sessions[agent.agent_id]);
  const messages = session?.messages ?? [];
  const push     = useNotificationStore((s) => s.push);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }

      // Ensure session exists
      const sess = getOrCreateSession(agent.agent_id, CURRENT_USER_ID);

      // Append user message
      const userMsg: ChatMessage = {
        message_id: uuidv4(),
        session_id: sess.session_id,
        role:       'user',
        content:    trimmed,
        timestamp:  new Date().toISOString(),
      };
      appendMessage(agent.agent_id, userMsg);

      // Placeholder assistant message (streaming indicator)
      const placeholderId = uuidv4();
      const placeholder: ChatMessage = {
        message_id:  placeholderId,
        session_id:  sess.session_id,
        role:        'assistant',
        content:     '',
        timestamp:   new Date().toISOString(),
        isStreaming: true,
      };
      appendMessage(agent.agent_id, placeholder);

      setLoading(true);

      try {
        const response = await sendChatMessage(agent.agent_id, {
          session_id: sess.session_id,
          message:    trimmed,
          user_id:    CURRENT_USER_ID,
        });

        updateLastMessage(agent.agent_id, {
          message_id:  response.message_id,
          content:     response.content,
          timestamp:   response.timestamp,
          isStreaming: false,
          toolsUsed:   response.context_used?.google_tools_used,
        });
      } catch (err) {
        updateLastMessage(agent.agent_id, {
          content:     '⚠ Failed to get a response. Please check your connection and try again.',
          isStreaming: false,
        });
        push({
          type:    'error',
          title:   'Agent error',
          message: (err as Error)?.message ?? 'Unknown error',
        });
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    },
    [agent.agent_id, loading, appendMessage, updateLastMessage, getOrCreateSession, push],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.header)-3rem)] min-h-[500px]">
      {/* Chat header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 shrink-0"
        style={{ borderTopColor: agent.color }}
      >
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors lg:hidden"
          aria-label="Back to agents"
        >
          <ChevronRight size={16} className="rotate-180" />
        </button>

        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${agent.color}20`, color: agent.color }}
        >
          <AgentIcon icon={agent.icon} size={18} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-200">{agent.name}</p>
          <p className="text-2xs text-slate-500">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-1"
              style={{ backgroundColor: loading ? '#f59e0b' : '#10b981' }}
            />
            {loading ? 'Thinking…' : 'Ready'}
          </p>
        </div>

        {messages.length > 0 && (
          <button
            onClick={() => clearSession(agent.agent_id)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
            aria-label="Clear chat"
            title="Clear conversation"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {/* Google connection banner — Executive Assistant only */}
      {agent.role === 'executive-assistant' && <GoogleConnectionBanner />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto chat-scroll px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <EmptyChatState agent={agent} onPrompt={sendMessage} />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.message_id}
                message={msg}
                agentColor={agent.color}
                agentIcon={agent.icon}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 py-3 border-t border-slate-800 bg-slate-950/50">
        <div className="flex items-end gap-2 bg-slate-800 rounded-xl border border-slate-700 focus-within:border-indigo-500/60 transition-colors px-3 py-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agent.name}… (Enter to send, Shift+Enter for new line)`}
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 resize-none outline-none disabled:opacity-50 py-1 max-h-40"
            aria-label="Chat message"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="
              mb-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0
              transition-all duration-150
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:scale-105 active:scale-95
            "
            style={{
              backgroundColor: input.trim() && !loading ? agent.color : '#334155',
            }}
            aria-label="Send message"
          >
            {loading ? (
              <Loader2 size={15} className="text-white animate-spin" />
            ) : (
              <Send size={15} className="text-white" />
            )}
          </button>
        </div>
        <p className="text-2xs text-slate-600 mt-1.5 text-center">
          AI responses are context-aware and grounded in your DynamoDB sales data.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Agent grid card
// ────────────────────────────────────────────────────────────────────────────
function AgentCard({
  agent,
  isSelected,
  onSelect,
}: {
  agent: AgentProfile;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const session  = useChatStore((s) => s.sessions[agent.agent_id]);
  const msgCount = session?.messages.filter((m) => m.role === 'user').length ?? 0;

  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left p-4 rounded-xl border transition-all duration-150 group
        ${isSelected
          ? 'border-opacity-60 bg-slate-800'
          : 'border-slate-700 bg-slate-800/40 hover:bg-slate-800/80 hover:border-slate-600'
        }
      `}
      style={{ borderColor: isSelected ? agent.color : undefined }}
      aria-selected={isSelected}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
          style={{ backgroundColor: `${agent.color}20`, color: agent.color }}
        >
          <AgentIcon icon={agent.icon} size={20} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-200 truncate">{agent.name}</p>
            {msgCount > 0 && (
              <span
                className="text-2xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${agent.color}25`, color: agent.color }}
              >
                {msgCount} msg{msgCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{agent.description}</p>
        </div>

        <ChevronRight
          size={16}
          className={`shrink-0 mt-1 transition-colors ${isSelected ? 'text-slate-300' : 'text-slate-600 group-hover:text-slate-400'}`}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-2xs text-slate-600 font-mono bg-slate-900/60 px-2 py-0.5 rounded">
          {agent.model}
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: agent.color }}
        />
        <span className="text-2xs text-slate-500">Ready</span>
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Agent Panel main
// ────────────────────────────────────────────────────────────────────────────
export default function AgentPanel() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const { data: agents = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['agents'],
    queryFn:  listAgents,
    staleTime: 10 * 60 * 1000,
  });

  const setActiveAgent = useChatStore((s) => s.setActiveAgent);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setActiveAgent(agentId);
  };

  const selectedAgent = agents.find((a) => a.agent_id === selectedAgentId) ?? null;

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-7xl">
        <div>
          <div className="h-7 w-40 bg-slate-800 rounded mb-1 animate-pulse" />
          <div className="h-4 w-64 bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card p-4 space-y-3">
              <div className="flex gap-3">
                <Skeleton className="w-10 h-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-md">
        <div className="glass-card p-8 flex flex-col items-center gap-4 text-center">
          <AlertCircle size={32} className="text-red-400" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Failed to load agents</p>
            <p className="text-xs text-slate-500 mt-1">{(error as Error)?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-lg transition-colors"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-100">AI Agent Workspace</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          {agents.length} agents · Each grounded in live DynamoDB business context
        </p>
      </div>

      <div className="flex gap-5 h-[calc(100vh-theme(spacing.header)-7rem)] min-h-[500px]">
        {/* Agent list — sidebar on desktop, full on mobile when no agent selected */}
        <div
          className={`
            flex-shrink-0 overflow-y-auto space-y-2 pr-1 scrollbar-hide
            ${selectedAgent
              ? 'w-0 overflow-hidden lg:w-80 lg:overflow-auto'
              : 'w-full lg:w-80'
            }
          `}
        >
          <div className="space-y-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.agent_id}
                agent={agent}
                isSelected={agent.agent_id === selectedAgentId}
                onSelect={() => handleSelectAgent(agent.agent_id)}
              />
            ))}
          </div>
        </div>

        {/* Chat panel */}
        {selectedAgent ? (
          <div className="flex-1 glass-card overflow-hidden">
            <ChatPanel
              agent={selectedAgent}
              onBack={() => setSelectedAgentId(null)}
            />
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center glass-card">
            <div className="text-center">
              <Bot size={40} className="mx-auto text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-400">Select an agent to start</p>
              <p className="text-xs text-slate-600 mt-1">Choose from the panel on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
