import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertCircle,
  BarChart3,
  ExternalLink,
  Eye,
  Facebook,
  Globe2,
  Heart,
  Instagram,
  Megaphone,
  MousePointerClick,
  RefreshCw,
  Send,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fetchMetaAnalytics } from '@/api/client';
import type { AnalyticsPeriod, GeoEntry, MetaAnalyticsData, TopPage } from '@/types';
import { useNavStore } from '@/store';

type Channel = 'facebook' | 'instagram' | 'ads';
type NativeMetricPoint = { date: string; value: number };
type NativeMetaData = MetaAnalyticsData & {
  instagram?: {
    profile?: { name?: string; username?: string; followers?: number; following?: number; media_count?: number };
    summary?: { total_impressions?: number; total_reach?: number; profile_views?: number; website_clicks?: number; avg_daily_reach?: number; engagement_rate?: number };
    daily_reach?: NativeMetricPoint[];
    daily_impressions?: NativeMetricPoint[];
    daily_profile_views?: NativeMetricPoint[];
    age_gender?: Record<string, number>;
    city?: Record<string, number>;
    online_hours?: Record<string, number>;
    top_posts?: Array<{ id?: string; caption?: string; media_type?: string; impressions?: number; reach?: number; engagements?: number; likes?: number; comments?: number }>;
  };
  facebook?: {
    profile?: { name?: string; fans?: number; followers?: number; talking_about?: number; category?: string };
    summary?: { total_reach?: number; total_engagements?: number; total_page_views?: number; fans_added?: number; fans_removed?: number; video_views?: number };
    daily_reach?: NativeMetricPoint[];
    daily_engagements?: NativeMetricPoint[];
    fan_net_daily?: NativeMetricPoint[];
    fan_age_gender?: Record<string, number>;
    fan_cities?: Record<string, number>;
    top_posts?: Array<{ id?: string; message?: string; impressions?: number; reach?: number; engagements?: number; likes?: number; comments?: number }>;
  };
  ads?: {
    summary?: { total_spend?: number; impressions?: number; clicks?: number; ctr?: number; cpc?: number; cpm?: number; reach?: number; frequency?: number; link_clicks?: number; landing_views?: number; leads?: number; post_engagement?: number; roas?: number };
    daily_trend?: Array<{ date: string; spend?: number; clicks?: number; impressions?: number; reach?: number }>;
    campaigns?: Array<{ name?: string; campaign_name?: string; impressions?: number; clicks?: number; spend?: number; ctr?: number }>;
    age_gender?: Record<string, number>;
    regions?: Record<string, number>;
    placements?: Record<string, number>;
  };
  insights?: {
    ctr_status?: string;
    best_campaign?: string;
    best_region?: string;
    top_ig_post_type?: string;
    ig_engagement_rate?: number;
    fb_fan_growth?: number;
    recommendation?: string;
  };
};

const CHANNELS: Record<Channel, {
  label: string;
  eyebrow: string;
  Icon: LucideIcon;
  accent: string;
  soft: string;
  hero: string;
}> = {
  facebook: {
    label: 'Facebook',
    eyebrow: 'Facebook Page',
    Icon: Facebook,
    accent: '#1877f2',
    soft: '#eaf3ff',
    hero: 'linear-gradient(110deg,#07142d 0%,#0d2455 58%,#143b86 100%)',
  },
  instagram: {
    label: 'Instagram',
    eyebrow: 'Instagram',
    Icon: Instagram,
    accent: '#e1306c',
    soft: '#fff0f6',
    hero: 'linear-gradient(110deg,#2a0718 0%,#56113b 58%,#8b1d5d 100%)',
  },
  ads: {
    label: 'Ads',
    eyebrow: 'Ad Campaigns',
    Icon: Megaphone,
    accent: '#1677ff',
    soft: '#eef5ff',
    hero: 'linear-gradient(110deg,#061528 0%,#0c2854 58%,#153d83 100%)',
  },
};

const GEO_COLORS = ['#1677ff', '#10b981', '#f59e0b', '#8b5cf6', '#ef476f', '#64748b'];
const DARK_TOOLTIP = {
  contentStyle: {
    backgroundColor: 'rgba(15,23,42,0.96)',
    border: '1px solid rgba(148,163,184,0.22)',
    borderRadius: '14px',
    boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
    fontSize: '12px',
    color: '#e2e8f0',
  },
  labelStyle: { color: '#94a3b8' },
};

function emptyMetaData(period: AnalyticsPeriod): MetaAnalyticsData {
  return {
    period,
    label: period === 'monthly' ? 'Last 30 Days' : 'Last 7 Days',
    generated_at: new Date().toISOString(),
    summary: {
      total_requests: 0,
      unique_ips: 0,
      avg_daily: 0,
      top_country: 'N/A',
      mobile_pct: 0,
      desktop_pct: 0,
      bounce_rate: 0,
      peak_hour: 'N/A',
    },
    traffic_over_time: [],
    top_pages: [],
    geo_distribution: [],
    device_split: [],
    peak_hours: Array.from({ length: 24 }, (_, hour) => ({ hour, requests: 0 })),
    meta_insights: {
      recommended_objective: 'Awareness',
      top_locations: [],
      best_placement: 'Feed + Right Column',
      best_ad_time: 'N/A',
      warm_audience_size: 0,
      high_intent_visits: 0,
    },
  };
}

function normalizeMetaData(input: unknown, period: AnalyticsPeriod): MetaAnalyticsData {
  const fallback = emptyMetaData(period);
  const value = (input && typeof input === 'object') ? input as Partial<MetaAnalyticsData> : {};
  const summary = value.summary ?? fallback.summary;
  const insights = value.meta_insights ?? fallback.meta_insights;

  return {
    ...fallback,
    ...value,
    period: String(value.period ?? fallback.period),
    label: String(value.label ?? fallback.label),
    generated_at: String(value.generated_at ?? fallback.generated_at),
    summary: {
      ...fallback.summary,
      ...summary,
      total_requests: Number(summary.total_requests ?? 0),
      unique_ips: Number(summary.unique_ips ?? 0),
      avg_daily: Number(summary.avg_daily ?? 0),
      top_country: String(summary.top_country ?? 'N/A'),
      mobile_pct: Number(summary.mobile_pct ?? 0),
      desktop_pct: Number(summary.desktop_pct ?? 0),
      bounce_rate: Number(summary.bounce_rate ?? 0),
      peak_hour: String(summary.peak_hour ?? 'N/A'),
    },
    traffic_over_time: Array.isArray(value.traffic_over_time) ? value.traffic_over_time : [],
    top_pages: Array.isArray(value.top_pages) ? value.top_pages : [],
    geo_distribution: Array.isArray(value.geo_distribution) ? value.geo_distribution : [],
    device_split: Array.isArray(value.device_split) ? value.device_split : [],
    peak_hours: Array.isArray(value.peak_hours) && value.peak_hours.length > 0
      ? value.peak_hours
      : fallback.peak_hours,
    meta_insights: {
      ...fallback.meta_insights,
      ...insights,
      recommended_objective: String(insights.recommended_objective ?? fallback.meta_insights.recommended_objective),
      top_locations: Array.isArray(insights.top_locations) ? insights.top_locations : [],
      best_placement: String(insights.best_placement ?? fallback.meta_insights.best_placement),
      best_ad_time: String(insights.best_ad_time ?? fallback.meta_insights.best_ad_time),
      warm_audience_size: Number(insights.warm_audience_size ?? 0),
      high_intent_visits: Number(insights.high_intent_visits ?? 0),
    },
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

function money(n: number): string {
  return `Rs.${Math.round(n).toLocaleString()}`;
}

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

function asNative(data: MetaAnalyticsData): NativeMetaData {
  return data as NativeMetaData;
}

function nativeInsights(data: MetaAnalyticsData) {
  const native = asNative(data);
  return {
    recommendation: native.insights?.recommendation ?? 'Use the strongest channel signals to plan the next campaign.',
    bestRegion: native.insights?.best_region ?? data.meta_insights?.top_locations?.[0] ?? 'N/A',
    bestCampaign: native.insights?.best_campaign ?? 'N/A',
    bestPlacement: data.meta_insights?.best_placement ?? 'Feed + Right Column',
    bestTime: data.meta_insights?.best_ad_time ?? 'N/A',
  };
}

function mapValuesToGeo(values?: Record<string, number>): GeoEntry[] {
  const total = Object.values(values ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);
  return Object.entries(values ?? {})
    .sort((a, b) => Number(b[1] ?? 0) - Number(a[1] ?? 0))
    .slice(0, 8)
    .map(([country, requests]) => ({
      country,
      requests: Number(requests ?? 0),
      pct: total > 0 ? Math.round((Number(requests ?? 0) / total) * 100) : 0,
    }));
}

function mergeDaily(primary: NativeMetricPoint[] = [], secondary: NativeMetricPoint[] = []) {
  const dates = Array.from(new Set([...primary.map((d) => d.date), ...secondary.map((d) => d.date)])).sort();
  return dates.map((date) => ({
    date,
    label: format(parseISO(date), 'MMM d'),
    volume: Number(primary.find((d) => d.date === date)?.value ?? 0),
    trend: Number(secondary.find((d) => d.date === date)?.value ?? 0),
  }));
}

function channelGeo(data: MetaAnalyticsData, channel: Channel): GeoEntry[] {
  const native = asNative(data);
  if (native.facebook || native.instagram || native.ads) {
    if (channel === 'instagram') return mapValuesToGeo(native.instagram?.city);
    if (channel === 'facebook') return mapValuesToGeo(native.facebook?.fan_cities);
    return mapValuesToGeo(native.ads?.regions);
  }
  return data.geo_distribution ?? [];
}

function channelPages(data: MetaAnalyticsData, channel: Channel): TopPage[] {
  const native = asNative(data);
  if (native.facebook || native.instagram || native.ads) {
    if (channel === 'ads') {
       return (native.ads?.campaigns ?? []).slice(0, 8).map((campaign: { name?: string; campaign_name?: string; clicks?: number; impressions?: number; spend?: number }, index: number) => ({
         page: campaign.name ?? campaign.campaign_name ?? `Campaign ${index + 1}`,
         visits: Number(campaign.clicks ?? campaign.impressions ?? campaign.spend ?? 0),
         bounce_pct: 0,
       }));
     }
     if (channel === 'instagram') {
       return (native.instagram?.top_posts ?? []).slice(0, 8).map((post: { id?: string; caption?: string; media_type?: string; impressions?: number; reach?: number; engagements?: number; likes?: number }, index: number) => ({
         page: post.caption || post.media_type || post.id || `Instagram post ${index + 1}`,
         visits: Number(post.engagements ?? post.reach ?? post.impressions ?? post.likes ?? 0),
         bounce_pct: 0,
       }));
     }
     return (native.facebook?.top_posts ?? []).slice(0, 8).map((post: { id?: string; message?: string; impressions?: number; reach?: number; engagements?: number; likes?: number }, index: number) => ({
       page: post.message || post.id || `Facebook post ${index + 1}`,
       visits: Number(post.engagements ?? post.reach ?? post.impressions ?? post.likes ?? 0),
       bounce_pct: 0,
     }));
  }
  return data.top_pages ?? [];
}

function channelHours(data: MetaAnalyticsData, channel: Channel) {
  const native = asNative(data);
  if (channel === 'instagram' && native.instagram?.online_hours) {
    return Object.entries(native.instagram.online_hours)
      .map(([hour, requests]) => ({
        hour: `${String(hour).padStart(2, '0')}:00`,
        requests: Number(requests ?? 0),
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));
  }
  return data.peak_hours.map((hour) => ({
    hour: `${String(hour.hour).padStart(2, '0')}:00`,
    requests: hour.requests,
  }));
}

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`agent-skeleton ${className}`}
      style={{
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }}
      aria-hidden="true"
    />
  );
}

function PeriodToggle({ value, onChange }: { value: AnalyticsPeriod; onChange: (p: AnalyticsPeriod) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl bg-white/5 p-1 border border-white/10 backdrop-blur">
      {(['weekly', 'monthly'] as AnalyticsPeriod[]).map((period) => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={`h-9 px-4 rounded-xl text-xs font-semibold transition-colors ${
            value === period
              ? 'bg-[rgba(0,185,142,0.18)] text-emerald-100 shadow-[0_0_24px_rgba(0,185,142,0.14)]'
              : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
          }`}
        >
          {period === 'weekly' ? 'Weekly' : 'Monthly'}
        </button>
      ))}
    </div>
  );
}

function ChannelTabs({ value, onChange }: { value: Channel; onChange: (channel: Channel) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl bg-white/5 border border-white/10 p-1 shadow-2xl backdrop-blur">
      {(Object.keys(CHANNELS) as Channel[]).map((channel) => {
        const cfg = CHANNELS[channel];
        const active = value === channel;
        return (
          <button
            key={channel}
            onClick={() => onChange(channel)}
            className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              active ? 'text-white shadow-[0_0_24px_rgba(255,255,255,0.08)]' : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
            }`}
            style={{ backgroundColor: active ? cfg.accent : 'transparent' }}
          >
            <cfg.Icon size={13} />
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

function metricModel(data: MetaAnalyticsData, channel: Channel) {
  const native = asNative(data);
  const insights = nativeInsights(data);

  if (native.facebook || native.instagram || native.ads) {
    if (channel === 'facebook') {
      const profile = native.facebook?.profile;
      const summary = native.facebook?.summary;
      const reach = Number(summary?.total_reach ?? 0);
      const engagements = Number(summary?.total_engagements ?? 0);
      const fansAdded = Number(summary?.fans_added ?? 0);
      const fansRemoved = Number(summary?.fans_removed ?? 0);
      const netFans = fansAdded - fansRemoved;

      return {
        heroTitle: `${profile?.name ?? 'Stellar Global Supplies'} - Facebook Intelligence`,
        heroSub: `${fmt(profile?.fans ?? 0)} fans | ${fmt(profile?.followers ?? 0)} followers | ${fmt(profile?.talking_about ?? 0)} talking about this`,
        pills: [`Net fans ${netFans >= 0 ? '+' : ''}${netFans}`, `Reach ${fmt(reach)}`, `Engagements ${fmt(engagements)}`, `Video views ${fmt(summary?.video_views ?? 0)}`],
        cards: [
          { label: 'Total Fans', value: fmt(profile?.fans ?? 0), sub: `Followers ${fmt(profile?.followers ?? 0)}`, Icon: Users, color: '#1877f2' },
          { label: 'Page Reach', value: fmt(reach), sub: 'Unique reach', Icon: Eye, color: '#10b981' },
          { label: 'Engagements', value: fmt(engagements), sub: 'Likes, shares, comments', Icon: Heart, color: '#8b5cf6' },
          { label: 'Video Views', value: fmt(summary?.video_views ?? 0), sub: `Page views ${fmt(summary?.total_page_views ?? 0)}`, Icon: Activity, color: '#f59e0b' },
        ],
        primaryTitle: 'Daily Reach & Engagements',
        primarySub: 'Page visibility and audience interaction over time',
        volumeKey: 'volume',
        trendKey: 'trend',
      };
    }

    if (channel === 'instagram') {
      const profile = native.instagram?.profile;
      const summary = native.instagram?.summary;
      const reach = Number(summary?.total_reach ?? 0);
      const impressions = Number(summary?.total_impressions ?? 0);

      return {
        heroTitle: `@${profile?.username ?? 'stellarglobalsupplies'} - Instagram Insights`,
        heroSub: `${fmt(profile?.followers ?? 0)} followers | ${fmt(profile?.media_count ?? 0)} posts | engagement ${pct(Number(summary?.engagement_rate ?? 0))}`,
        pills: [`Eng. ${pct(Number(summary?.engagement_rate ?? 0))}`, `Reach ${fmt(reach)}`, `Profile views ${fmt(summary?.profile_views ?? 0)}`, `Web clicks ${fmt(summary?.website_clicks ?? 0)}`],
        cards: [
          { label: 'Followers', value: fmt(profile?.followers ?? 0), sub: `Following ${fmt(profile?.following ?? 0)}`, Icon: Instagram, color: '#e1306c' },
          { label: 'Total Reach', value: fmt(reach), sub: `${fmt(summary?.avg_daily_reach ?? 0)} avg/day`, Icon: Eye, color: '#8b5cf6' },
          { label: 'Impressions', value: fmt(impressions), sub: 'Total views', Icon: BarChart3, color: '#0ea5e9' },
          { label: 'Website Clicks', value: fmt(summary?.website_clicks ?? 0), sub: `Profile views ${fmt(summary?.profile_views ?? 0)}`, Icon: MousePointerClick, color: '#10b981' },
        ],
        primaryTitle: 'Daily Reach & Impressions',
        primarySub: 'Unique accounts reached vs total views per day',
        volumeKey: 'volume',
        trendKey: 'trend',
      };
    }

    const summary = native.ads?.summary;
    return {
      heroTitle: 'Meta Ads Performance - Campaign Planner',
      heroSub: `Across all campaigns | best campaign ${insights.bestCampaign}`,
      pills: [`CTR ${pct(Number(summary?.ctr ?? 0))}`, `CPC ${money(Number(summary?.cpc ?? 0))}`, `Freq ${Number(summary?.frequency ?? 0).toFixed(2)}x`, `Best ${insights.bestRegion}`],
      cards: [
        { label: 'Impressions', value: fmt(summary?.impressions ?? 0), sub: `Reach ${fmt(summary?.reach ?? 0)}`, Icon: Eye, color: '#1677ff' },
        { label: 'Clicks', value: fmt(summary?.clicks ?? 0), sub: `Link ${fmt(summary?.link_clicks ?? 0)}`, Icon: MousePointerClick, color: '#10b981' },
        { label: 'Total Spend', value: money(Number(summary?.total_spend ?? 0)), sub: `CPM ${money(Number(summary?.cpm ?? 0))}`, Icon: Megaphone, color: '#f59e0b' },
        { label: 'CTR', value: pct(Number(summary?.ctr ?? 0)), sub: String(native.insights?.ctr_status ?? 'status'), Icon: TrendingUp, color: '#8b5cf6' },
        { label: 'Leads', value: fmt(summary?.leads ?? 0), sub: `Landing ${fmt(summary?.landing_views ?? 0)}`, Icon: Target, color: '#ef476f' },
      ],
      primaryTitle: 'Daily Spend & Clicks Trend',
      primarySub: 'Budget pacing and click volume over the selected period',
      volumeKey: 'volume',
      trendKey: 'trend',
    };
  }

  const total = data.summary?.total_requests ?? 0;
  const unique = data.summary?.unique_ips ?? 0;
  const avg = data.summary?.avg_daily ?? 0;
  const warm = data.meta_insights?.warm_audience_size ?? 0;
  const intent = data.meta_insights?.high_intent_visits ?? 0;
  const topPageVisits = data.top_pages?.[0]?.visits ?? 0;
  const clicks = Math.max(intent, Math.round(topPageVisits * 0.12));
  const spend = Math.round(clicks * 38);
  const impressions = channel === 'ads' ? Math.round(total * 1.8) : total;
  const reach = channel === 'instagram' ? unique : total;
  const engagements = Math.round((warm + intent) * (channel === 'instagram' ? 0.12 : 0.08));
  const ctr = safeDiv(clicks, impressions) * 100;

  if (channel === 'facebook') {
    return {
      heroTitle: 'Stellar Global Supplies - Facebook Intelligence',
      heroSub: `${fmt(unique)} unique visitors | ${fmt(warm)} retargetable audience | ${data.summary?.top_country ?? 'N/A'} leads traffic`,
      pills: [`Net fans +${Math.round(unique * 0.01)}`, `Reach ${fmt(reach)}`, `Engagements ${fmt(engagements)}`, `Video views ${fmt(Math.round(total * 0.06))}`],
      cards: [
        { label: 'Audience Pool', value: fmt(unique), sub: 'Unique visitors', Icon: Users, color: '#1877f2' },
        { label: 'Page Reach', value: fmt(reach), sub: `${fmt(avg)} avg/day`, Icon: Eye, color: '#10b981' },
        { label: 'Engagements', value: fmt(engagements), sub: 'Modeled likes, shares, comments', Icon: Heart, color: '#8b5cf6' },
        { label: 'Video Views', value: fmt(Math.round(total * 0.06)), sub: 'Creative opportunity', Icon: Activity, color: '#f59e0b' },
      ],
      primaryTitle: 'Daily Reach & Engagements',
      primarySub: 'Website audience signals translated into Facebook-ready reach planning',
      volumeKey: 'reach',
      trendKey: 'engagement',
    };
  }

  if (channel === 'instagram') {
    return {
      heroTitle: '@stellarglobalsupplies - Instagram Insights',
      heroSub: `${fmt(warm)} warm visitors | ${fmt(intent)} high-intent sessions | engagement ${pct(safeDiv(engagements, Math.max(reach, 1)) * 100)}`,
      pills: [`Eng. ${pct(safeDiv(engagements, Math.max(reach, 1)) * 100)}`, `Reach ${fmt(reach)}`, `Profile views ${fmt(Math.round(warm * 0.18))}`, `Web clicks ${fmt(clicks)}`],
      cards: [
        { label: 'Followers Pool', value: fmt(warm), sub: 'Retargetable users', Icon: Instagram, color: '#e1306c' },
        { label: 'Total Reach', value: fmt(reach), sub: `${fmt(avg)} avg/day`, Icon: Eye, color: '#8b5cf6' },
        { label: 'Impressions', value: fmt(impressions), sub: 'Total views', Icon: BarChart3, color: '#0ea5e9' },
        { label: 'Website Clicks', value: fmt(clicks), sub: 'High intent link clicks', Icon: MousePointerClick, color: '#10b981' },
      ],
      primaryTitle: 'Daily Reach & Impressions',
      primarySub: 'Unique accounts reached vs total views per day',
      volumeKey: 'impressions',
      trendKey: 'reach',
    };
  }

  return {
    heroTitle: 'Meta Ads Performance - Campaign Planner',
    heroSub: `Across all modeled campaigns | best placement ${data.meta_insights?.best_placement ?? 'N/A'}`,
    pills: [`CTR ${pct(ctr)}`, `CPC ${clicks ? money(spend / clicks) : 'Rs.-'}`, `Freq ${pct(safeDiv(impressions, Math.max(reach, 1)))}`, `Best ${data.summary?.top_country ?? 'N/A'}`],
    cards: [
      { label: 'Impressions', value: fmt(impressions), sub: `Reach ${fmt(reach)}`, Icon: Eye, color: '#1677ff' },
      { label: 'Clicks', value: fmt(clicks), sub: 'Website intent clicks', Icon: MousePointerClick, color: '#10b981' },
      { label: 'Modeled Spend', value: money(spend), sub: `CPM ${money(safeDiv(spend, impressions) * 1000)}`, Icon: Megaphone, color: '#f59e0b' },
      { label: 'CTR', value: pct(ctr), sub: ctr > 1 ? 'Healthy' : 'Needs creative tests', Icon: TrendingUp, color: '#8b5cf6' },
      { label: 'Leads', value: fmt(intent), sub: 'High-intent sessions', Icon: Target, color: '#ef476f' },
    ],
    primaryTitle: 'Daily Spend & Clicks Trend',
    primarySub: 'Budget pacing and click volume modeled from live audience signals',
    volumeKey: 'spend',
    trendKey: 'clicks',
  };
}

function buildTrend(data: MetaAnalyticsData, channel: Channel) {
  const native = asNative(data);
  if (native.facebook || native.instagram || native.ads) {
    if (channel === 'facebook') {
      return mergeDaily(native.facebook?.daily_reach, native.facebook?.daily_engagements);
    }
    if (channel === 'instagram') {
      return mergeDaily(native.instagram?.daily_impressions, native.instagram?.daily_reach);
    }
    const adTrend = native.ads?.daily_trend ?? [];
    return adTrend.map((day) => ({
      date: day.date,
      label: format(parseISO(day.date), 'MMM d'),
      volume: Number(day.spend ?? 0),
      trend: Number(day.clicks ?? 0),
    }));
  }

  return (data.traffic_over_time ?? []).map((day) => {
    const reach = channel === 'instagram' ? Math.round(day.requests * 0.62) : day.requests;
    const impressions = channel === 'ads' ? Math.round(day.requests * 1.8) : Math.round(day.requests * 1.18);
    const engagement = Math.round(day.requests * (channel === 'instagram' ? 0.055 : 0.038));
    const clicks = Math.max(0, Math.round(day.requests * 0.018));
    const spend = Math.round(clicks * 38);
    return {
      date: day.date,
      label: format(parseISO(day.date), 'MMM d'),
      reach,
      impressions,
      engagement,
      clicks,
      spend,
    };
  });
}

function CardGrid({ cards }: { cards: ReturnType<typeof metricModel>['cards'] }) {
  return (
    <div className={`grid gap-4 ${cards.length === 5 ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-5' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}`}>
      {cards.map((card) => (
        <div key={card.label} className="agent-card relative overflow-hidden p-5 min-h-[124px] hover:-translate-y-0.5 hover:border-white/20">
          <div className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: card.color }} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-2xs uppercase tracking-wide text-slate-400 font-semibold">{card.label}</p>
              <p className="text-2xl font-black text-slate-50 mt-3 tabular-nums">{card.value}</p>
              <span className="agent-chip mt-2 border-white/10 bg-white/5 text-slate-400">
                {card.sub}
              </span>
            </div>
            <div className="h-10 w-10 rounded-2xl flex items-center justify-center border border-white/10" style={{ backgroundColor: `${card.color}18`, color: card.color }}>
              <card.Icon size={18} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Hero({ data, channel }: { data: MetaAnalyticsData; channel: Channel }) {
  const cfg = CHANNELS[channel];
  const model = metricModel(data, channel);
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] p-6 text-white shadow-2xl border border-white/10" style={{ background: cfg.hero }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.16),transparent_28%),linear-gradient(90deg,rgba(255,255,255,0.05),transparent)]" aria-hidden="true" />
      <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center" style={{ color: cfg.accent }}>
            <cfg.Icon size={25} />
          </div>
          <div>
            <h3 className="text-base font-bold">{model.heroTitle}</h3>
            <p className="text-sm text-white/60 mt-1">{model.heroSub}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {model.pills.map((pill, index) => (
            <span key={pill} className={`rounded-full border px-3 py-2 text-xs font-semibold ${index === 0 ? 'text-amber-200 border-amber-300/30 bg-amber-300/10' : 'text-white/70 border-white/10 bg-white/10'}`}>
              {pill}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const tooltipStyle = DARK_TOOLTIP;

function PrimaryTrend({ data, channel }: { data: MetaAnalyticsData; channel: Channel }) {
  const cfg = CHANNELS[channel];
  const model = metricModel(data, channel);
  const trend = buildTrend(data, channel);
  return (
    <Panel title={model.primaryTitle} subtitle={model.primarySub} className="lg:col-span-2">
      <ResponsiveContainer width="100%" height={290}>
        <ComposedChart data={trend} margin={{ top: 8, right: 18, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tickFormatter={(v: number) => channel === 'ads' && model.volumeKey === 'spend' ? money(v) : fmt(v)} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={58} />
          <Tooltip
            {...tooltipStyle}
            formatter={(value: number, name: string) => [
              name === 'spend' ? money(value) : fmt(value),
              name === model.volumeKey ? 'Volume' : 'Trend',
            ]}
          />
          <Legend verticalAlign="top" height={32} formatter={(value) => <span className="text-xs text-slate-400">{value === model.volumeKey ? 'Volume' : 'Trend'}</span>} />
          <Bar dataKey={model.volumeKey} fill={`${cfg.accent}2a`} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line type="monotone" dataKey={model.trendKey} stroke={cfg.accent} strokeWidth={3} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function Panel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`agent-card p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-100">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function GeoChart({ geo }: { geo: GeoEntry[] }) {
  const rows = geo.slice(0, 6);
  return (
    <Panel title="Top Locations" subtitle="Where the audience is coming from">
      <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-4 items-center">
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie data={rows} cx="50%" cy="50%" innerRadius={46} outerRadius={72} dataKey="requests" strokeWidth={0}>
              {rows.map((_, index) => <Cell key={index} fill={GEO_COLORS[index % GEO_COLORS.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(value: number) => [fmt(value), 'Requests']} />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-2">
          {rows.map((entry, index) => (
            <div key={entry.country}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: GEO_COLORS[index % GEO_COLORS.length] }} />
                  <span className="text-slate-300 truncate">{entry.country}</span>
                </span>
                <span className="font-semibold text-slate-400">{entry.pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${entry.pct}%`, backgroundColor: GEO_COLORS[index % GEO_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function PagesChart({ pages }: { pages: TopPage[] }) {
  const rows = pages.slice(0, 7).map((page) => ({
    page: page.page.length > 26 ? `${page.page.slice(0, 25)}...` : page.page,
    visits: page.visits,
  }));
  return (
    <Panel title="High-Intent Pages" subtitle="Pages driving remarketing audiences">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.14)" horizontal={false} />
          <XAxis type="number" tickFormatter={fmt} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="page" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={126} />
          <Tooltip {...tooltipStyle} formatter={(value: number) => [fmt(value), 'Visits']} />
          <Bar dataKey="visits" fill="#1677ff" radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function HourChart({ data, channel }: { data: MetaAnalyticsData; channel: Channel }) {
  const rows = channelHours(data, channel);
  const insights = nativeInsights(data);
  return (
    <Panel title="Best Time To Advertise" subtitle={`${insights.bestTime} from daily analytics`}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="hourFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
          <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
          <YAxis tickFormatter={fmt} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
          <Tooltip {...tooltipStyle} formatter={(value: number) => [fmt(value), 'Requests']} />
          <Area type="monotone" dataKey="requests" stroke="#10b981" strokeWidth={2} fill="url(#hourFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function DeviceAndPlan({ data, channel }: { data: MetaAnalyticsData; channel: Channel }) {
  const setSection = useNavStore((s) => s.setSection);
  const cfg = CHANNELS[channel];
  const insights = nativeInsights(data);
  const locations = channelGeo(data, channel).map((entry) => entry.country);
  const devices = data.device_split.length > 0 ? data.device_split : [{ device: 'Desktop', pct: data.summary.desktop_pct }];
  const topLocations = locations.length > 0
    ? locations.slice(0, 2).join(' and ')
    : data.meta_insights.top_locations.length > 0
    ? data.meta_insights.top_locations.slice(0, 2).join(' and ')
    : insights.bestRegion !== 'N/A'
    ? insights.bestRegion
    : 'your strongest available regions';
  const recommendations = [
    `Run ${CHANNELS[channel].label} awareness ads in ${topLocations}.`,
    `Use ${insights.bestPlacement} placements during ${insights.bestTime}.`,
    insights.recommendation,
  ];
  return (
    <Panel title="Media Plan" subtitle="Recommended next actions">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {devices.map((device) => (
            <div key={device.device} className="rounded-2xl bg-white/5 border border-white/10 p-3">
              <p className="text-2xs uppercase tracking-wide text-slate-400 font-semibold">{device.device}</p>
              <p className="text-xl font-black text-slate-50 mt-2">{device.pct}%</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {recommendations.map((item) => (
            <div key={item} className="flex items-start gap-2 text-xs text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: cfg.accent }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            setSection('agents');
            window.dispatchEvent(new CustomEvent('prefill-agent', {
              detail: {
                agentId: 'marketing-manager',
                message: `Create a ${CHANNELS[channel].label} campaign plan for Stellar Global Supplies using ${data.label}, top locations ${locations.join(', ') || data.meta_insights.top_locations.join(', ') || topLocations}, ${fmt(data.meta_insights.warm_audience_size)} warm visitors, and best ad time ${insights.bestTime}.`,
              },
            }));
          }}
          className="h-10 px-3 rounded-xl text-xs font-semibold text-white flex items-center gap-2 shadow-lg hover:-translate-y-0.5"
          style={{ backgroundColor: cfg.accent }}
        >
          <Send size={14} />
          Brief Marketing Manager
        </button>
      </div>
    </Panel>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="agent-card p-6 flex items-center gap-4">
      <AlertCircle size={24} className="text-red-500 shrink-0" />
      <div>
        <p className="text-sm font-bold text-slate-100">Could not load Meta analytics</p>
        <p className="text-xs text-slate-400 mt-1">{message}</p>
      </div>
      <button onClick={onRetry} className="agent-button-secondary ml-auto h-9 text-xs">
        Retry
      </button>
    </div>
  );
}

export default function MetaMarketingDashboard() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('monthly');
  const [channel, setChannel] = useState<Channel>('facebook');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['meta-analytics', period],
    queryFn: () => fetchMetaAnalytics(period),
    select: (response) => normalizeMetaData(response, period),
    staleTime: 30 * 60 * 1000,
    retry: 2,
  });

  const safeData = data ?? emptyMetaData(period);
  const model = useMemo(() => metricModel(safeData, channel), [safeData, channel]);
  const cfg = CHANNELS[channel];
  const geoRows = useMemo(() => channelGeo(safeData, channel), [safeData, channel]);
  const pageRows = useMemo(() => channelPages(safeData, channel), [safeData, channel]);
  const insights = useMemo(() => nativeInsights(safeData), [safeData]);

  return (
    <div className="max-w-7xl">
      <div className="workspace-frame -m-1 md:m-0 min-h-[calc(100vh-var(--header-height)-2rem)]">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-black tracking-normal text-slate-50">Meta Intelligence</h2>
              <span className="agent-chip" style={{ color: cfg.accent, backgroundColor: `${cfg.accent}16`, borderColor: `${cfg.accent}44` }}>
                {cfg.label}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              {safeData.label} | {cfg.eyebrow}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <ChannelTabs value={channel} onChange={setChannel} />
            <span className="agent-chip text-slate-400">
              {safeData.generated_at ? `Updated ${format(parseISO(safeData.generated_at), 'HH:mm')}` : 'Updates daily'}
            </span>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-slate-100 hover:bg-white/10 flex items-center justify-center shadow-sm disabled:opacity-50"
              aria-label="Refresh Meta analytics"
            >
              <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
            </button>
            <PeriodToggle value={period} onChange={setPeriod} />
          </div>
        </div>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-28" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
            </div>
            <Skeleton className="h-80" />
          </div>
        )}

        {isError && (
          <ErrorCard message={(error as Error)?.message ?? 'Unknown error'} onRetry={() => refetch()} />
        )}

        {!isLoading && !isError && (
          <div className="space-y-5">
            <Hero data={safeData} channel={channel} />
            <CardGrid cards={model.cards} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <PrimaryTrend data={safeData} channel={channel} />
              <DeviceAndPlan data={safeData} channel={channel} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <GeoChart geo={geoRows} />
              <PagesChart pages={pageRows} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <HourChart data={safeData} channel={channel} />
              <Panel title="Audience Quality" subtitle="Signals available from the S3 Meta analytics JSON">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                    <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wide">
                      <Users size={14} />
                      Warm Audience
                    </div>
                    <p className="text-2xl font-black text-slate-50 mt-3">{fmt(safeData.meta_insights.warm_audience_size)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                    <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wide">
                      <Target size={14} />
                      High Intent
                    </div>
                    <p className="text-2xl font-black text-slate-50 mt-3">{fmt(safeData.meta_insights.high_intent_visits)}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 p-4 bg-white/5">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-cyan-400/10 text-cyan-300 border border-cyan-300/20 flex items-center justify-center shrink-0">
                      <Globe2 size={17} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-100">Recommended Objective: {safeData.meta_insights.recommended_objective}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {insights.recommendation} Prioritize {geoRows.map((entry) => entry.country).join(', ') || safeData.meta_insights.top_locations.join(', ') || insights.bestRegion || 'your strongest regions'} for the next campaign flight.
                      </p>
                    </div>
                    <ExternalLink size={14} className="text-slate-500 ml-auto shrink-0" />
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
