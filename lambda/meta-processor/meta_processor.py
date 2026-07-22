"""
stellar-meta-processor Lambda — writes to Supabase
----------------------------------------------
Fetches Instagram, Facebook, and Meta Ads insights and writes to Supabase.

Uses existing SSM parameters:
  /sgs-quote/supabase_url
  /sgs-quote/supabase_service_role_key
  /stellar-wf/facebook/page_id
  /stellar-wf/instagram/access_token
  /stellar-wf/instagram/account_id
  /stellar-wf/facebook/access_token
"""

import json
import os
import urllib.request
import urllib.parse
import boto3
from datetime import datetime, timezone
from collections import defaultdict

# SSM client for fetching credentials
ssm = boto3.client('ssm', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

def get_ssm_param(name):
    """Fetch parameter from SSM Parameter Store."""
    try:
        resp = ssm.get_parameter(Name=name, WithDecryption=True)
        return resp['Parameter']['Value']
    except Exception as e:
        print(f"SSM get_parameter failed for {name}: {e}")
        return ''

# Supabase config
SUPABASE_URL = get_ssm_param('/sgs-quote/supabase_url')
SUPABASE_KEY = get_ssm_param('/sgs-quote/supabase_service_role_key')
SUPABASE_TABLE = 'observe_meta_analytics_cache'

# Meta API config
TOKEN = get_ssm_param('/stellar-wf/facebook/access_token')
IG_ID = get_ssm_param('/stellar-wf/instagram/account_id')
AD_ACT = get_ssm_param('/stellar-wf/ad_account_id')
PAGE_ID = get_ssm_param('/stellar-wf/facebook/page_id')
API_VER = os.environ.get('GRAPH_API_VERSION', 'v19.0')
BASE = f'https://graph.facebook.com/{API_VER}'


# ─────────────────────────────────────────
# HTTP HELPER
# ─────────────────────────────────────────
def graph_get(path, params=None, token_override=None):
    p = {'access_token': token_override or TOKEN}
    if params:
        p.update(params)
    url = f"{BASE}/{path}?{urllib.parse.urlencode(p)}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"Graph API HTTP {e.code} [{path}]: {body[:400]}")
        return {}, body
    except Exception as e:
        print(f"Graph API error [{path}]: {e}")
        return {}, str(e)


def get(path, params=None, token_override=None):
    """Convenience — return data dict only, ignore error string."""
    data, _ = graph_get(path, params, token_override)
    return data


def safe_list(d, key='data'):
    return d.get(key, []) if isinstance(d, dict) else []


def since_until(period_days):
    now = datetime.now(timezone.utc)
    return (now - __import__('datetime').timedelta(days=period_days)).strftime('%Y-%m-%d'), now.strftime('%Y-%m-%d')


def flt(d, k):
    try:
        return float(d.get(k, 0))
    except:
        return 0.0


def action_val(actions, action_type):
    for a in (actions or []):
        if a.get('action_type') == action_type:
            try:
                return int(a.get('value', 0))
            except:
                return 0
    return 0


# ─────────────────────────────────────────
# PAGE ACCESS TOKEN EXCHANGE
# ─────────────────────────────────────────
def get_page_token(page_id):
    """
    Exchange the User Access Token for a Page Access Token.
    Page insights (demographics especially) REQUIRE a Page token.
    """
    resp = get(page_id, {'fields': 'access_token,name'})
    page_token = resp.get('access_token', '')
    if page_token:
        print(f"Got Page Access Token for: {resp.get('name', page_id)}")
    else:
        print(f"WARNING: Could not get Page Access Token — falling back to User Token. Demographics may fail.")
        page_token = TOKEN
    return page_token


# ─────────────────────────────────────────
# 1. INSTAGRAM INSIGHTS
# ─────────────────────────────────────────
def fetch_instagram(period_days):
    since, until = since_until(period_days)

    # Profile snapshot
    profile = get(IG_ID, {'fields': 'followers_count,follows_count,media_count,name,username'})

    # REACH: only metric valid for period=day WITHOUT metric_type=total_value
    reach_resp, _ = graph_get(f"{IG_ID}/insights", {
        'metric': 'reach',
        'period': 'day',
        'since': since,
        'until': until,
    })

    # ALL other time-series metrics require metric_type=total_value in v19+
    totals_resp, _ = graph_get(f"{IG_ID}/insights", {
        'metric': 'profile_views,accounts_engaged,total_interactions,website_clicks',
        'period': 'day',
        'metric_type': 'total_value',
        'since': since,
        'until': until,
    })

    # Build ts_map from both responses
    ts_map = {}
    for resp in [reach_resp, totals_resp]:
        for item in safe_list(resp):
            name = item.get('name')
            vals = item.get('values', [])
            if not vals:
                tv = item.get('total_value', {})
                if isinstance(tv, (int, float)):
                    vals = [{'value': tv, 'end_time': until}]
                elif isinstance(tv, dict) and 'value' in tv:
                    vals = [{'value': tv['value'], 'end_time': until}]
            ts_map[name] = vals

    def sum_m(name):
        return sum(v.get('value', 0) for v in ts_map.get(name, []))

    def daily_s(name):
        return [{'date': v.get('end_time', '')[:10], 'value': v.get('value', 0)}
                for v in ts_map.get(name, [])]

    # Follower demographics — age+gender
    age_gender = {}
    demo_age, _ = graph_get(f"{IG_ID}/insights", {
        'metric': 'follower_demographics',
        'period': 'lifetime',
        'timeframe': 'last_90_days',
        'breakdown': 'age,gender',
        'metric_type': 'total_value',
    })
    for item in safe_list(demo_age):
        if item.get('name') == 'follower_demographics':
            for b in item.get('total_value', {}).get('breakdowns', []):
                for r in b.get('results', []):
                    key = ' '.join(str(x) for x in r.get('dimension_values', []))
                    age_gender[key] = r.get('value', 0)

    city_data = {}
    demo_city, _ = graph_get(f"{IG_ID}/insights", {
        'metric': 'follower_demographics',
        'period': 'lifetime',
        'timeframe': 'last_90_days',
        'breakdown': 'city',
        'metric_type': 'total_value',
    })
    for item in safe_list(demo_city):
        if item.get('name') == 'follower_demographics':
            for b in item.get('total_value', {}).get('breakdowns', []):
                for r in b.get('results', []):
                    key = ' '.join(str(x) for x in r.get('dimension_values', []))
                    city_data[key] = r.get('value', 0)

    # Online followers heatmap
    online_resp, _ = graph_get(f"{IG_ID}/insights", {'metric': 'online_followers', 'period': 'lifetime'})
    online_hours = {}
    for item in safe_list(online_resp):
        if item.get('name') == 'online_followers':
            vals = item.get('values', [])
            if vals:
                raw = vals[-1].get('value', {})
                online_hours = {str(h): raw.get(str(h), 0) for h in range(24)}

    # Top media posts
    media = get(f"{IG_ID}/media", {
        'fields': 'id,media_type,timestamp,like_count,comments_count,reach,permalink,caption',
        'limit': 50,
    })
    posts = []
    for m in safe_list(media):
        ts_post = m.get('timestamp', '')[:10]
        if ts_post >= since:
            posts.append({
                'id': m.get('id'),
                'type': m.get('media_type', 'IMAGE'),
                'date': ts_post,
                'likes': m.get('like_count', 0),
                'comments': m.get('comments_count', 0),
                'reach': m.get('reach', 0),
                'engagement': m.get('like_count', 0) + m.get('comments_count', 0),
                'permalink': m.get('permalink', ''),
                'caption': (m.get('caption', '') or '')[:80],
            })
    posts_sorted = sorted(posts, key=lambda x: -x['engagement'])[:10]

    type_perf = defaultdict(lambda: {'count': 0, 'engagement': 0, 'reach': 0})
    for p in posts:
        t = p['type']
        type_perf[t]['count'] += 1
        type_perf[t]['engagement'] += p['engagement']
        type_perf[t]['reach'] += p['reach']

    total_reach = sum_m('reach')
    followers_now = profile.get('followers_count', 0)

    return {
        'profile': {
            'name': profile.get('name', ''),
            'username': profile.get('username', ''),
            'followers': followers_now,
            'following': profile.get('follows_count', 0),
            'media_count': profile.get('media_count', 0),
        },
        'summary': {
            'total_impressions': sum_m('total_interactions'),
            'total_reach': total_reach,
            'profile_views': sum_m('profile_views'),
            'website_clicks': sum_m('website_clicks'),
            'avg_daily_reach': total_reach // period_days if period_days else 0,
            'engagement_rate': round(
                sum(p['engagement'] for p in posts) / max(followers_now, 1) * 100, 2
            ) if posts else 0,
        },
        'daily_reach': daily_s('reach'),
        'daily_impressions': daily_s('total_interactions'),
        'daily_profile_views': daily_s('profile_views'),
        'top_posts': posts_sorted,
        'post_type_perf': {k: dict(v) for k, v in type_perf.items()},
        'age_gender': dict(sorted(age_gender.items(), key=lambda x: -x[1])[:15]),
        'city': dict(sorted(city_data.items(), key=lambda x: -x[1])[:10]),
        'online_hours': {str(h): online_hours.get(str(h), 0) for h in range(24)},
    }


# ─────────────────────────────────────────
# 2. META ADS CAMPAIGNS
# ─────────────────────────────────────────
def fetch_ads(period_days):
    since, until = since_until(period_days)
    preset = 'last_7d' if period_days == 7 else 'last_30d'

    # Test for 403 upfront — if no permission, return empty struct
    acct_resp, err = graph_get(f"{AD_ACT}/insights", {
        'fields': 'impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions',
        'date_preset': preset, 'level': 'account',
    })
    if err and '200' in str(err) and 'ads_management' in str(err):
        print("ADS PERMISSION ERROR: Token lacks ads_read/ads_management on this ad account.")
        print("Fix: In Meta Business Manager → Ad Account Settings → Users → add your app/token with Advertiser role.")
        return {'summary': {}, 'daily_trend': [], 'campaigns': [], 'age_gender': {}, 'regions': {}, 'placements': {}, 'error': 'ads_permission_denied'}

    acct = safe_list(acct_resp)[0] if safe_list(acct_resp) else {}
    actions = acct.get('actions', [])
    total_spend = flt(acct, 'spend')

    daily_resp, _ = graph_get(f"{AD_ACT}/insights", {
        'fields': 'spend,impressions,clicks,ctr', 'time_increment': 1,
        'since': since, 'until': until, 'level': 'account',
    })
    daily_trend = [
        {'date': d.get('date_start', '')[:10], 'spend': round(flt(d, 'spend'), 2),
         'impressions': int(flt(d, 'impressions')), 'clicks': int(flt(d, 'clicks')), 'ctr': round(flt(d, 'ctr'), 4)}
        for d in safe_list(daily_resp)
    ]

    campaigns_resp, _ = graph_get(f"{AD_ACT}/campaigns", {'fields': 'id,name,status,objective', 'limit': 50})
    camp_list = []
    for c in safe_list(campaigns_resp):
        cid = c.get('id')
        ins_r, _ = graph_get(f"{cid}/insights", {'fields': 'impressions,clicks,spend,ctr,cpc,reach,actions', 'date_preset': preset})
        ci = safe_list(ins_r)[0] if safe_list(ins_r) else {}
        ca = ci.get('actions', [])
        camp_list.append({
            'name': c.get('name', ''), 'status': c.get('status', ''), 'objective': c.get('objective', ''),
            'spend': round(flt(ci, 'spend'), 2), 'impressions': int(flt(ci, 'impressions')),
            'clicks': int(flt(ci, 'clicks')), 'ctr': round(flt(ci, 'ctr'), 4),
            'cpc': round(flt(ci, 'cpc'), 2), 'reach': int(flt(ci, 'reach')),
            'leads': action_val(ca, 'lead'),
        })
    camp_list.sort(key=lambda x: -x['spend'])

    age_resp, _ = graph_get(f"{AD_ACT}/insights", {'fields': 'impressions,clicks,spend,ctr', 'breakdowns': 'age,gender', 'date_preset': preset, 'level': 'account'})
    region_resp, _ = graph_get(f"{AD_ACT}/insights", {'fields': 'impressions,clicks,spend', 'breakdowns': 'region', 'date_preset': preset, 'level': 'account'})
    place_resp, _ = graph_get(f"{AD_ACT}/insights", {'fields': 'impressions,clicks,spend,ctr', 'breakdowns': 'publisher_platform,platform_position', 'date_preset': preset, 'level': 'account'})

    age_gender = {}
    for row in safe_list(age_resp):
        key = f"{row.get('age','?')}, {row.get('gender','?')}"
        age_gender[key] = {'clicks': int(flt(row, 'clicks')), 'impressions': int(flt(row, 'impressions')), 'spend': round(flt(row, 'spend'), 2), 'ctr': round(flt(row, 'ctr'), 4)}

    regions = {row.get('region', 'Unknown'): int(flt(row, 'clicks')) for row in safe_list(region_resp)}
    placements = defaultdict(lambda: {'clicks': 0, 'spend': 0.0, 'impressions': 0})
    for row in safe_list(place_resp):
        key = f"{row.get('publisher_platform','?')}/{row.get('platform_position','?')}"
        placements[key]['clicks'] += int(flt(row, 'clicks'))
        placements[key]['spend'] += round(flt(row, 'spend'), 2)
        placements[key]['impressions'] += int(flt(row, 'impressions'))

    return {
        'summary': {
            'total_spend': round(total_spend, 2), 'impressions': int(flt(acct, 'impressions')),
            'clicks': int(flt(acct, 'clicks')), 'ctr': round(flt(acct, 'ctr'), 4),
            'cpc': round(flt(acct, 'cpc'), 2), 'cpm': round(flt(acct, 'cpm'), 2),
            'reach': int(flt(acct, 'reach')), 'frequency': round(flt(acct, 'frequency'), 2),
            'link_clicks': action_val(actions, 'link_click'),
            'landing_views': action_val(actions, 'landing_page_view'),
            'leads': action_val(actions, 'lead'),
            'post_engagement': action_val(actions, 'post_engagement'),
            'roas': round(action_val(actions, 'landing_page_view') / total_spend, 2) if total_spend > 0 else 0,
        },
        'daily_trend': daily_trend, 'campaigns': camp_list[:15],
        'age_gender': age_gender,
        'regions': dict(sorted(regions.items(), key=lambda x: -x[1])[:10]),
        'placements': {k: dict(v) for k, v in sorted(placements.items(), key=lambda x: -x[1]['clicks'])[:8]},
    }


# ─────────────────────────────────────────
# 3. FACEBOOK PAGE INSIGHTS
# ─────────────────────────────────────────
def fetch_facebook(period_days):
    since, until = since_until(period_days)

    # Exchange User Token for Page Access Token
    page_token = get_page_token(PAGE_ID)

    # Page profile snapshot
    page = get(PAGE_ID,
               {'fields': 'name,fan_count,followers_count,talking_about_count,category'},
               token_override=page_token)

    def fb_metric(metric_name, alt_name=None):
        """Fetch a single day-period metric. Returns list of {date, value}."""
        resp, err = graph_get(f"{PAGE_ID}/insights", {
            'metric': metric_name,
            'period': 'day',
            'since': since,
            'until': until,
        }, token_override=page_token)
        if err and alt_name:
            print(f"  {metric_name} failed, trying alt: {alt_name}")
            resp, err = graph_get(f"{PAGE_ID}/insights", {
                'metric': alt_name,
                'period': 'day',
                'since': since,
                'until': until,
            }, token_override=page_token)
        series_key = alt_name if (err is None and alt_name) else metric_name
        values = []
        for item in safe_list(resp):
            values = item.get('values', [])
            break
        result = []
        for v in values:
            val = v.get('value', 0)
            result.append({
                'date': v.get('end_time', '')[:10],
                'value': int(sum(val.values()) if isinstance(val, dict) else val),
            })
        return result

    daily_reach = fb_metric('page_impressions_unique')
    daily_eng = fb_metric('page_post_engagements')
    daily_views = fb_metric('page_views_total')

    # page_fan_adds/removes renamed in v17+
    fans_added = fb_metric('page_daily_follows_unique', alt_name='page_fan_adds')
    fans_removed = fb_metric('page_daily_unfollows_unique', alt_name='page_fan_removes')

    video_views = fb_metric('page_video_views')

    def sum_s(series_data):
        return sum(d['value'] for d in series_data)

    fan_net = []
    removed_map = {d['date']: d['value'] for d in fans_removed}
    for d in fans_added:
        fan_net.append({'date': d['date'], 'value': d['value'] - removed_map.get(d['date'], 0)})

    # Demographics
    fan_ages = {}
    fan_cities = {}

    def fb_lifetime(metric_name):
        """Fetch a lifetime metric silently — returns {} if unavailable."""
        resp, err = graph_get(f"{PAGE_ID}/insights", {
            'metric': metric_name,
            'period': 'lifetime',
        }, token_override=page_token)
        if err:
            print(f"  NOTE: {metric_name} unavailable (likely New Page Experience page — expected).")
            return {}
        for item in safe_list(resp):
            if item.get('name') == metric_name:
                vals = item.get('values', [])
                if vals:
                    return vals[-1].get('value', {})
        return {}

    fan_ages = fb_lifetime('page_fans_gender_age')
    fan_cities = fb_lifetime('page_fans_city')

    # Recent posts
    posts_raw, _ = graph_get(f"{PAGE_ID}/posts", {
        'fields': 'id,message,created_time,permalink_url,'
                  'likes.summary(true),comments.summary(true),shares',
        'limit': 50,
    }, token_override=page_token)

    posts = []
    for p in safe_list(posts_raw):
        post_date = p.get('created_time', '')[:10]
        if post_date < since:
            continue
        likes = p.get('likes', {}).get('summary', {}).get('total_count', 0)
        comments = p.get('comments', {}).get('summary', {}).get('total_count', 0)
        shares = p.get('shares', {}).get('count', 0)
        posts.append({
            'id': p.get('id'),
            'date': post_date,
            'message': (p.get('message', '') or '')[:80],
            'likes': likes,
            'comments': comments,
            'shares': shares,
            'engagement': likes + comments + shares,
            'reach': 0,
            'permalink': p.get('permalink_url', ''),
        })
    posts.sort(key=lambda x: -x['engagement'])

    return {
        'profile': {
            'name': page.get('name', ''),
            'fans': page.get('fan_count', 0),
            'followers': page.get('followers_count', 0),
            'talking_about': page.get('talking_about_count', 0),
            'category': page.get('category', ''),
        },
        'summary': {
            'total_reach': sum_s(daily_reach),
            'total_engagements': sum_s(daily_eng),
            'total_page_views': sum_s(daily_views),
            'fans_added': sum_s(fans_added),
            'fans_removed': sum_s(fans_removed),
            'video_views': sum_s(video_views),
        },
        'daily_reach': daily_reach,
        'daily_engagements': daily_eng,
        'fan_net_daily': fan_net,
        'top_posts': posts[:10],
        'fan_age_gender': dict(sorted(fan_ages.items(), key=lambda x: -x[1])[:15]),
        'fan_cities': dict(sorted(fan_cities.items(), key=lambda x: -x[1])[:10]),
    }


# ─────────────────────────────────────────
# ASSEMBLE + HANDLER
# ─────────────────────────────────────────
def build_full_report(period_days):
    now = datetime.now(timezone.utc)
    label = f"Last {period_days} Days"

    print(f"Fetching Instagram insights ({label})...")
    ig = fetch_instagram(period_days)
    print(f"Fetching Meta Ads insights ({label})...")
    ads = fetch_ads(period_days)
    print(f"Fetching Facebook Page insights ({label})...")
    fb = fetch_facebook(period_days)

    ad_s, ig_s, fb_s = ads.get('summary', {}), ig.get('summary', {}), fb.get('summary', {})
    ctr_good = ad_s.get('ctr', 0) > 0.01
    best_camp = max(ads.get('campaigns', [{}]), key=lambda x: x.get('ctr', 0), default={})
    best_region = max(ads.get('regions', {'—': 0}), key=lambda k: ads['regions'][k], default='—') if ads.get('regions') else '—'
    top_type = max(ig.get('post_type_perf', {'IMAGE': {'engagement': 0}}).items(), key=lambda x: x[1].get('engagement', 0), default=('IMAGE', {}))[0]

    return {
        'period': 'weekly' if period_days == 7 else 'monthly',
        'label': label,
        'generated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'instagram': ig,
        'ads': ads,
        'facebook': fb,
        'insights': {
            'ctr_status': 'good' if ctr_good else 'low',
            'best_campaign': best_camp.get('name', '—'),
            'best_region': best_region,
            'top_ig_post_type': top_type,
            'ig_engagement_rate': ig_s.get('engagement_rate', 0),
            'fb_fan_growth': fb_s.get('fans_added', 0) - fb_s.get('fans_removed', 0),
            'recommendation': _make_recommendation(ad_s, ig_s, fb_s, ctr_good, top_type),
        },
    }


def _make_recommendation(ad_s, ig_s, fb_s, ctr_good, top_type):
    lines = []
    if ad_s.get('error') == 'ads_permission_denied':
        lines.append("Meta Ads data unavailable — grant ads_read permission in Business Manager")
    elif not ctr_good:
        lines.append("CTR is below 1% — refresh ad creatives or narrow audience targeting")
    else:
        lines.append("CTR is healthy — consider increasing budget on top-performing campaigns")
    freq = ad_s.get('frequency', 0)
    if freq and freq > 3:
        lines.append(f"Ad frequency is {freq:.1f} — audience fatigue risk, expand targeting")
    eng = ig_s.get('engagement_rate', 0)
    if eng < 1:
        lines.append("Instagram engagement rate is low — post more Reels and carousel content")
    else:
        lines.append(f"Instagram engagement is strong ({eng}%) — boost top posts as ads")
    if top_type in ('VIDEO', 'REEL'):
        lines.append("Video content drives most IG engagement — prioritise video ad creatives")
    fan_growth = fb_s.get('fans_added', 0) - fb_s.get('fans_removed', 0)
    if fan_growth > 0:
        lines.append("Facebook page is growing — run Page Like campaigns to accelerate growth")
    return '. '.join(lines)


def persist_to_supabase(report, period):
    """
    Upsert the report to Supabase observe_meta_analytics_cache.
    Uses ON CONFLICT (period) DO UPDATE so there is always exactly one
    row per period rather than an ever-growing append log.
    Stores the `insights` block so the agent-router can return it
    alongside instagram/ads/facebook without recomputing.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("WARNING: Supabase credentials not configured")
        return

    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}"
    payload = {
        'cached_at': report.get('generated_at'),
        'period': period,
        'instagram': report.get('instagram', {}),
        'ads': report.get('ads', {}),
        'facebook': report.get('facebook', {}),
        'insights': report.get('insights', {}),
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
            # Upsert: if a row with this `period` already exists, update it.
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if 200 <= resp.status < 300:
                print(f"Upserted {period} meta analytics → Supabase:{SUPABASE_TABLE}")
            else:
                body = resp.read().decode('utf-8', errors='replace')
                print(f"Supabase upsert failed: HTTP {resp.status} — {body[:300]}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"Supabase upsert HTTP error {e.code}: {body[:300]}")
    except Exception as e:
        print(f"Supabase write error: {e}")


def handler(event, context):
    results = {}
    for period_days, period in [(7, 'weekly'), (30, 'monthly')]:
        try:
            report = build_full_report(period_days)
            persist_to_supabase(report, period)
            print(f"Saved {period} meta analytics")
            results[period] = 'ok'
        except Exception as e:
            print(f"Error building {period} meta analytics: {e}")
            results[period] = str(e)
    return {'statusCode': 200, 'body': json.dumps(results)}