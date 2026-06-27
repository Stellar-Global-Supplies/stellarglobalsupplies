import { useState, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";

// ── Real data from processed CUR (awscost-00001.csv.gz) ─────────────────────
const COSTS_DATA = [{"date":"2026-06-01","service":"AWSCloudFormation","serviceName":"AWS CloudFormation","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":7,"recordCount":2},{"date":"2026-06-01","service":"AWSCostExplorer","serviceName":"AWS Cost Explorer","region":"us-east-1","totalCost":0.09,"totalBlendedCost":0.09,"totalUsage":1,"recordCount":1},{"date":"2026-06-01","service":"AWSDataTransfer","serviceName":"AWS Data Transfer","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":11,"recordCount":11},{"date":"2026-06-01","service":"AWSGlue","serviceName":"AWS Glue","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":118.863889,"recordCount":6},{"date":"2026-06-01","service":"AWSLambda","serviceName":"AWS Lambda","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":1689.552043,"recordCount":6},{"date":"2026-06-01","service":"AWSQueueService","serviceName":"Amazon Simple Queue Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":4,"recordCount":2},{"date":"2026-06-01","service":"AWSSecretsManager","serviceName":"AWS Secrets Manager","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":4,"recordCount":2},{"date":"2026-06-01","service":"AmazonApiGateway","serviceName":"Amazon API Gateway","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0.0015,"recordCount":1},{"date":"2026-06-01","service":"AmazonBedrock","serviceName":"Amazon Bedrock","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-01","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":25212.240709,"recordCount":78},{"date":"2026-06-01","service":"AmazonCloudWatch","serviceName":"AmazonCloudWatch","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":9.613826,"recordCount":8},{"date":"2026-06-01","service":"AmazonDynamoDB","serviceName":"Amazon DynamoDB","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-01","service":"AmazonRoute53","serviceName":"Amazon Route 53","region":"us-east-1","totalCost":0.593956,"totalBlendedCost":0.593956,"totalUsage":14800,"recordCount":24},{"date":"2026-06-01","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.043025,"totalBlendedCost":0.043025,"totalUsage":74553.073994,"recordCount":92},{"date":"2026-06-01","service":"AmazonSNS","serviceName":"Amazon Simple Notification Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":4,"recordCount":2},{"date":"2026-06-01","service":"awskms","serviceName":"AWS Key Management Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":506,"recordCount":8},{"date":"2026-06-02","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-02","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.000029,"totalBlendedCost":0.000029,"totalUsage":0.041636,"recordCount":1},{"date":"2026-06-03","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-03","service":"AmazonRoute53","serviceName":"Amazon Route 53","region":"us-east-1","totalCost":0.000003,"totalBlendedCost":0.000003,"totalUsage":3,"recordCount":1},{"date":"2026-06-04","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-04","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.000355,"totalBlendedCost":0.000355,"totalUsage":0.053611,"recordCount":1},{"date":"2026-06-04","service":"awskms","serviceName":"AWS Key Management Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-05","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-05","service":"AmazonRoute53","serviceName":"Amazon Route 53","region":"us-east-1","totalCost":0.000002,"totalBlendedCost":0.000002,"totalUsage":2,"recordCount":1},{"date":"2026-06-06","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-07","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-10","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-11","service":"AmazonApiGateway","serviceName":"Amazon API Gateway","region":"us-east-1","totalCost":0.000112,"totalBlendedCost":0.000112,"totalUsage":112,"recordCount":1},{"date":"2026-06-11","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-11","service":"AmazonDynamoDB","serviceName":"Amazon DynamoDB","region":"us-east-1","totalCost":0.000519,"totalBlendedCost":0.000519,"totalUsage":477.5,"recordCount":3},{"date":"2026-06-11","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-12","service":"AWSCloudShell","serviceName":"AWS CloudShell","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0.010642,"recordCount":5},{"date":"2026-06-12","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-12","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.000013,"totalBlendedCost":0.000013,"totalUsage":0.01875,"recordCount":1},{"date":"2026-06-13","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-14","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-14","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.00003,"totalBlendedCost":0.00003,"totalUsage":0.042917,"recordCount":1},{"date":"2026-06-15","service":"AmazonRoute53","serviceName":"Amazon Route 53","region":"us-east-1","totalCost":0.000005,"totalBlendedCost":0.000005,"totalUsage":5,"recordCount":1},{"date":"2026-06-15","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.00037,"totalBlendedCost":0.00037,"totalUsage":0.52963,"recordCount":1},{"date":"2026-06-16","service":"AmazonRoute53","serviceName":"Amazon Route 53","region":"us-east-1","totalCost":0.000002,"totalBlendedCost":0.000002,"totalUsage":2,"recordCount":1},{"date":"2026-06-17","service":"AmazonApiGateway","serviceName":"Amazon API Gateway","region":"us-east-1","totalCost":0.000878,"totalBlendedCost":0.000878,"totalUsage":800,"recordCount":2},{"date":"2026-06-17","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-17","service":"AmazonCloudWatch","serviceName":"AmazonCloudWatch","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-17","service":"AmazonDynamoDB","serviceName":"Amazon DynamoDB","region":"us-east-1","totalCost":0.00146,"totalBlendedCost":0.00146,"totalUsage":6000,"recordCount":4},{"date":"2026-06-17","service":"AmazonRoute53","serviceName":"Amazon Route 53","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-17","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.0013,"totalBlendedCost":0.0013,"totalUsage":1.860878,"recordCount":2},{"date":"2026-06-17","service":"awskms","serviceName":"AWS Key Management Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-18","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.000245,"totalBlendedCost":0.000245,"totalUsage":0.350236,"recordCount":1},{"date":"2026-06-19","service":"AWSCloudFormation","serviceName":"AWS CloudFormation","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-19","service":"AWSGlue","serviceName":"AWS Glue","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-19","service":"AWSQueueService","serviceName":"Amazon Simple Queue Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-19","service":"AWSSecretsManager","serviceName":"AWS Secrets Manager","region":"us-east-1","totalCost":0.000015,"totalBlendedCost":0.000015,"totalUsage":4,"recordCount":1},{"date":"2026-06-19","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.000987,"totalBlendedCost":0.000987,"totalUsage":1.411999,"recordCount":1},{"date":"2026-06-19","service":"AmazonSNS","serviceName":"Amazon Simple Notification Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-19","service":"awskms","serviceName":"AWS Key Management Service","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-22","service":"AmazonRoute53","serviceName":"Amazon Route 53","region":"us-east-1","totalCost":0.000028,"totalBlendedCost":0.000028,"totalUsage":28,"recordCount":1},{"date":"2026-06-23","service":"AmazonCloudFront","serviceName":"Amazon CloudFront","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-26","service":"AWSCostExplorer","serviceName":"AWS Cost Explorer","region":"us-east-1","totalCost":0.52,"totalBlendedCost":0.52,"totalUsage":52,"recordCount":2},{"date":"2026-06-26","service":"AmazonBedrock","serviceName":"Amazon Bedrock","region":"us-east-1","totalCost":0.034042,"totalBlendedCost":0.034042,"totalUsage":28.487,"recordCount":3},{"date":"2026-06-26","service":"AmazonCloudWatch","serviceName":"AmazonCloudWatch","region":"us-east-1","totalCost":0,"totalBlendedCost":0,"totalUsage":0,"recordCount":1},{"date":"2026-06-26","service":"AmazonS3","serviceName":"Amazon Simple Storage Service","region":"us-east-1","totalCost":0.000006,"totalBlendedCost":0.000006,"totalUsage":0.008456,"recordCount":1}];

const SERVICE_COLORS = {
  AWSCostExplorer: "#3b82f6",
  AmazonRoute53: "#10b981",
  AmazonS3: "#f59e0b",
  AmazonBedrock: "#8b5cf6",
  AmazonApiGateway: "#f97316",
  AmazonDynamoDB: "#06b6d4",
  AmazonCloudFront: "#ec4899",
  AWSLambda: "#84cc16",
  Others: "#6b7280",
};

const SERVICE_LABELS = {
  AWSCostExplorer: "Cost Explorer",
  AmazonRoute53: "Route 53",
  AmazonS3: "S3",
  AmazonBedrock: "Bedrock",
  AmazonApiGateway: "API GW",
  AmazonDynamoDB: "DynamoDB",
  AmazonCloudFront: "CloudFront",
  AWSLambda: "Lambda",
  AWSSecretsManager: "Secrets Manager",
  AWSCloudFormation: "CloudFormation",
  AWSDataTransfer: "Data Transfer",
  AWSGlue: "Glue",
  AWSQueueService: "SQS",
  AmazonCloudWatch: "CloudWatch",
  AmazonSNS: "SNS",
  awskms: "KMS",
  AWSCloudShell: "CloudShell",
};

function fmt(n) {
  if (n === 0) return "$0.0000";
  if (n < 0.001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function fmtUsage(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(1);
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  // Aggregate all costs
  const svcTotals = useMemo(() => {
    const map = {};
    COSTS_DATA.forEach(r => {
      if (!map[r.service]) map[r.service] = { service: r.service, serviceName: r.serviceName, totalCost: 0, totalUsage: 0, recordCount: 0 };
      map[r.service].totalCost += r.totalCost;
      map[r.service].totalUsage += r.totalUsage;
      map[r.service].recordCount += r.recordCount;
    });
    return Object.values(map).sort((a, b) => b.totalCost - a.totalCost);
  }, []);

  const totalCost = useMemo(() => svcTotals.reduce((s, r) => s + r.totalCost, 0), [svcTotals]);
  const totalRecords = useMemo(() => svcTotals.reduce((s, r) => s + r.recordCount, 0), [svcTotals]);
  const activeServices = useMemo(() => svcTotals.filter(s => s.totalCost > 0).length, [svcTotals]);

  // Days in month: Jun 1–26
  const allDays = useMemo(() => {
    const days = [];
    for (let d = 1; d <= 26; d++) {
      days.push(`2026-06-${String(d).padStart(2, "0")}`);
    }
    return days;
  }, []);

  const dailyCosts = useMemo(() => {
    const byDay = {};
    const byDaySvc = {};
    COSTS_DATA.forEach(r => {
      byDay[r.date] = (byDay[r.date] || 0) + r.totalCost;
      if (!byDaySvc[r.date]) byDaySvc[r.date] = {};
      byDaySvc[r.date][r.service] = (byDaySvc[r.date][r.service] || 0) + r.totalCost;
    });
    return allDays.map(d => {
      const label = `Jun ${parseInt(d.split("-")[2])}`;
      const row = { date: label, total: byDay[d] || 0 };
      ["AWSCostExplorer", "AmazonRoute53", "AmazonS3", "AmazonBedrock", "AmazonApiGateway"].forEach(s => {
        row[s] = byDaySvc[d]?.[s] || 0;
      });
      row.Others = (byDay[d] || 0) - ["AWSCostExplorer","AmazonRoute53","AmazonS3","AmazonBedrock","AmazonApiGateway"].reduce((s,k) => s + (byDaySvc[d]?.[k]||0), 0);
      row.Others = Math.max(0, row.Others);
      return row;
    });
  }, [allDays]);

  const spendSoFar = totalCost;
  const daysElapsed = 26;
  const daysInMonth = 30;
  const dailyAvg = spendSoFar / daysElapsed;
  const projected = dailyAvg * daysInMonth;
  const forecastAvgLine = dailyAvg;

  // Pie data
  const topServices = svcTotals.filter(s => s.totalCost > 0);
  const pieData = useMemo(() => {
    const top = topServices.slice(0, 5);
    const othersAmt = topServices.slice(5).reduce((s, r) => s + r.totalCost, 0);
    const data = top.map(s => ({ name: SERVICE_LABELS[s.service] || s.service, value: s.totalCost, service: s.service }));
    if (othersAmt > 0) data.push({ name: "Others", value: othersAmt, service: "Others" });
    return data;
  }, [topServices]);

  // Forecast
  const forecast3 = projected * 3;
  const forecast6 = projected * 6;
  const forecast12 = projected * 12;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
        <div style={{ color: "#94a3b8", marginBottom: 4 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.fill || p.color || "#e2e8f0", display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>{p.name}</span>
            <span style={{ fontWeight: 600 }}>{fmt(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const PieTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const pct = ((payload[0].value / totalCost) * 100).toFixed(1);
    return (
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
        <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{payload[0].name}</div>
        <div style={{ color: "#94a3b8" }}>{fmt(payload[0].value)} · {pct}%</div>
      </div>
    );
  };

  const tabs = ["overview", "services", "forecast"];

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} />
            <span style={{ color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Account 471112840461</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>AWS Cost Dashboard</h1>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>June 2026 · Billing Period</div>
        </div>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "#94a3b8" }}>
          CUR: awscost-00001.csv.gz
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#1e293b", padding: 4, borderRadius: 10, width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ padding: "6px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.15s",
              background: activeTab === t ? "#3b82f6" : "transparent",
              color: activeTab === t ? "#fff" : "#64748b" }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Current Month Spend", value: fmt(spendSoFar), sub: `June 2026 (${daysElapsed} days)`, accent: "#3b82f6" },
              { label: "Projected Month Total", value: fmt(projected), sub: `Based on daily avg ${fmt(dailyAvg)}`, accent: "#10b981" },
              { label: "Active Services", value: activeServices, sub: "With non-zero cost", accent: "#f59e0b" },
              { label: "Total Usage Records", value: totalRecords.toLocaleString(), sub: "Jun 1 – Jun 26", accent: "#8b5cf6" },
            ].map((k, i) => (
              <div key={i} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: k.accent, lineHeight: 1 }}>{k.value}</div>
                <div style={{ color: "#475569", fontSize: 11, marginTop: 5 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Daily Trend */}
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "20px", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", textTransform: "uppercase", letterSpacing: "0.06em" }}>Daily Cost Trend — June 2026</div>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#64748b" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 3, background: "#3b82f6", display: "inline-block", borderRadius: 2 }}/>Daily cost</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 2, background: "#f59e0b", display: "inline-block", borderRadius: 2, borderTop: "2px dashed #f59e0b" }}/>Forecast avg</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyCosts} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false}
                  interval={2} />
                <YAxis tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => v === 0 ? "$0.00" : `$${v.toFixed(2)}`} width={52} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Daily cost" />
                <Line type="monotone" dataKey={() => forecastAvgLine} stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Forecast avg" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie + Top Services */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Service-Wise Cost Breakdown</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {pieData.map(p => (
                  <span key={p.service} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#94a3b8" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: SERVICE_COLORS[p.service] || "#6b7280", display: "inline-block" }}/>
                    {p.name}
                  </span>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                    dataKey="value" nameKey="name" strokeWidth={2} stroke="#0f172a">
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={SERVICE_COLORS[entry.service] || "#6b7280"} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Stacked Daily */}
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Stacked Daily Cost by Service</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {["AWSCostExplorer","AmazonRoute53","AmazonS3","AmazonBedrock","AmazonApiGateway","Others"].map(s => (
                  <span key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#94a3b8" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: SERVICE_COLORS[s] || "#6b7280", display: "inline-block" }}/>
                    {SERVICE_LABELS[s] || s}
                  </span>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyCosts} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9 }} axisLine={false} tickLine={false} interval={3} />
                  <YAxis tick={{ fill: "#475569", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(2)}`} width={48} />
                  <Tooltip content={<CustomTooltip />} />
                  {["AWSCostExplorer","AmazonRoute53","AmazonS3","AmazonBedrock","AmazonApiGateway","Others"].map(s => (
                    <Bar key={s} dataKey={s} stackId="a" fill={SERVICE_COLORS[s] || "#6b7280"} name={SERVICE_LABELS[s] || s} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* ── SERVICES TAB ────────────────────────────────────────────── */}
      {activeTab === "services" && (
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #334155" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", textTransform: "uppercase", letterSpacing: "0.06em" }}>Service Usage Table</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                {["Service", "Product Code", "Cost (USD)", "Usage", "% of Total"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: h === "Cost (USD)" || h === "Usage" || h === "% of Total" ? "right" : "left", fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {svcTotals.map((s, i) => {
                const pct = totalCost > 0 ? (s.totalCost / totalCost) * 100 : 0;
                return (
                  <tr key={s.service} style={{ borderTop: "1px solid #1e3a5f", background: i % 2 === 0 ? "transparent" : "#0f1e33" }}>
                    <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500, color: "#e2e8f0" }}>
                      {SERVICE_LABELS[s.service] ? (
                        <span>{s.serviceName}</span>
                      ) : s.serviceName}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ background: "#1e3a5f", color: SERVICE_COLORS[s.service] || "#94a3b8", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontFamily: "monospace" }}>
                        {s.service}
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontSize: 13, fontWeight: 600, color: s.totalCost > 0 ? "#f1f5f9" : "#475569" }}>
                      {fmt(s.totalCost)}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, color: "#94a3b8" }}>
                      {fmtUsage(s.totalUsage)}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                        <div style={{ width: 64, height: 4, background: "#1e3a5f", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: SERVICE_COLORS[s.service] || "#6b7280", borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, color: pct > 0 ? "#94a3b8" : "#334155", minWidth: 36, textAlign: "right" }}>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── FORECAST TAB ────────────────────────────────────────────── */}
      {activeTab === "forecast" && (
        <>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Cost Forecast</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
              Based on daily avg {fmt(dailyAvg)} from {daysElapsed} days of June 2026. Low/High = ±20% variance band.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { label: "3 months", value: forecast3, lo: forecast3 * 0.8, hi: forecast3 * 1.2 },
                { label: "6 months", value: forecast6, lo: forecast6 * 0.8, hi: forecast6 * 1.2 },
                { label: "12 months", value: forecast12, lo: forecast12 * 0.8, hi: forecast12 * 1.2 },
              ].map(f => (
                <div key={f.label} style={{ background: "#0f172a", borderRadius: 10, padding: "16px 20px", border: "1px solid #334155" }}>
                  <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{f.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#3b82f6", lineHeight: 1 }}>{fmt(f.value)}</div>
                  <div style={{ color: "#475569", fontSize: 11, marginTop: 6 }}>{fmt(f.lo)} – {fmt(f.hi)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Forecast trend chart */}
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Projected Monthly Spend</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[
                { month: "Jun '26 (act)", cost: spendSoFar },
                { month: "Jul '26", cost: projected },
                { month: "Aug '26", cost: projected },
                { month: "Sep '26", cost: projected },
                { month: "Oct '26", cost: projected },
                { month: "Nov '26", cost: projected },
                { month: "Dec '26", cost: projected },
              ]} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(2)}`} width={56} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="cost" name="Cost" radius={[4, 4, 0, 0]}
                  fill="#3b82f6"
                  label={{ position: "top", formatter: v => fmt(v), fontSize: 9, fill: "#64748b" }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ marginTop: 20, textAlign: "center", color: "#334155", fontSize: 11 }}>
        stellarglobal-costing-bucket · processed from CUR awscost/awscost/20260601-20260701/awscost-00001.csv.gz
      </div>
    </div>
  );
}