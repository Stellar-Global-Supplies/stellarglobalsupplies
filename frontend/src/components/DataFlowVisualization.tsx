import { useState, useEffect } from 'react';
import { Activity, Database, Cloud, Server, ArrowRight, Zap, RefreshCw } from 'lucide-react';

interface DataFlowNode {
  id: string;
  label: string;
  icon: 'source' | 'process' | 'storage' | 'output';
  status: 'active' | 'idle' | 'processing';
  description?: string;
}

interface DataFlowEdge {
  from: string;
  to: string;
  label: string;
  active: boolean;
  speed?: 'slow' | 'medium' | 'fast';
}

interface DataFlowDiagramProps {
  title: string;
  subtitle?: string;
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
  refreshInterval?: number;
}

function NodeIcon({ type, status }: { type: DataFlowNode['icon']; status: DataFlowNode['status'] }) {
  const iconClass = status === 'active' ? 'text-emerald-400' : status === 'processing' ? 'text-amber-400 animate-pulse' : 'text-slate-500';
  
  switch (type) {
    case 'source':
      return <Database className={iconClass} size={24} />;
    case 'process':
      return <Activity className={iconClass} size={24} />;
    case 'storage':
      return <Cloud className={iconClass} size={24} />;
    case 'output':
      return <Server className={iconClass} size={24} />;
  }
}

function AnimatedArrow({ active, speed = 'medium', label }: { active: boolean; speed?: 'slow' | 'medium' | 'fast'; label: string }) {
  const speedClasses = {
    slow: 'animate-pulse',
    medium: 'animate-bounce',
    fast: 'animate-ping'
  };

  return (
    <div className="flex flex-col items-center gap-1 min-w-[80px]">
      <div className="relative flex items-center gap-1">
        {active ? (
          <>
            <div className={`flex items-center ${speedClasses[speed]}`}>
              <Zap className="text-amber-400" size={16} />
            </div>
            <ArrowRight className="text-emerald-400 animate-pulse" size={20} />
            <div className={`flex items-center ${speedClasses[speed]}`} style={{ animationDelay: '0.5s' }}>
              <Zap className="text-amber-400" size={16} />
            </div>
          </>
        ) : (
          <ArrowRight className="text-slate-600" size={20} />
        )}
      </div>
      {label && (
        <span className={`text-2xs font-medium ${active ? 'text-emerald-400' : 'text-slate-500'}`}>
          {label}
        </span>
      )}
    </div>
  );
}

export default function DataFlowVisualization({ 
  title, 
  subtitle, 
  nodes, 
  edges, 
  refreshInterval = 2000 
}: DataFlowDiagramProps) {
  const [activeEdges, setActiveEdges] = useState<Set<string>>(new Set());
  const [processingNodes, setProcessingNodes] = useState<Set<string>>(new Set());

  // Simulate data flow animation
  useEffect(() => {
    const interval = setInterval(() => {
      // Randomly activate edges to simulate data flow
      const newActiveEdges = new Set<string>();
      const newProcessingNodes = new Set<string>();

      edges.forEach((edge, index) => {
        // Stagger activation based on index for waterfall effect
        if (Math.random() > 0.3) {
          newActiveEdges.add(`${edge.from}-${edge.to}`);
          
          // Mark source node as processing
          if (edge.active) {
            newProcessingNodes.add(edge.from);
            setTimeout(() => newProcessingNodes.delete(edge.from), 1000);
          }
        }
      });

      setActiveEdges(newActiveEdges);
      setProcessingNodes(newProcessingNodes);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [edges, refreshInterval]);

  // Build node positions (simple horizontal flow)
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const columns: DataFlowNode[][] = [];
  const visited = new Set<string>();

  // Group nodes by their position in the flow
  const startNodes = nodes.filter(n => !edges.some(e => e.to === n.id));
  if (startNodes.length === 0) columns.push([nodes[0]]);
  else columns.push(startNodes);

  let currentColumn = startNodes;
  while (currentColumn.length > 0) {
    const nextColumn: DataFlowNode[] = [];
    currentColumn.forEach(node => {
      edges
        .filter(e => e.from === node.id)
        .forEach(edge => {
          const nextNode = nodeMap.get(edge.to);
          if (nextNode && !visited.has(nextNode.id)) {
            visited.add(nextNode.id);
            nextColumn.push(nextNode);
          }
        });
    });
    if (nextColumn.length > 0) columns.push(nextColumn);
    currentColumn = nextColumn;
  }

  return (
    <div className="agent-card p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
          <Activity className="text-blue-400" size={22} />
          {title}
        </h3>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="flex items-center gap-4 min-w-max">
          {columns.map((column, colIndex) => (
            <div key={colIndex} className="flex flex-col gap-4">
              {column.map((node) => (
                <div
                  key={node.id}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                    processingNodes.has(node.id)
                      ? 'bg-amber-900/20 border-amber-500/50 shadow-lg shadow-amber-500/20'
                      : node.status === 'active'
                      ? 'bg-emerald-900/20 border-emerald-500/30'
                      : 'bg-slate-800/50 border-slate-700'
                  }`}
                  style={{ minWidth: '140px' }}
                >
                  <NodeIcon type={node.icon} status={processingNodes.has(node.id) ? 'processing' : node.status} />
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-200">{node.label}</p>
                    {node.description && (
                      <p className="text-2xs text-slate-400 mt-1">{node.description}</p>
                    )}
                  </div>
                  {processingNodes.has(node.id) && (
                    <div className="flex items-center gap-1 text-2xs text-amber-400">
                      <RefreshCw size={10} className="animate-spin" />
                      <span>Processing</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Add arrows between columns */}
              {colIndex < columns.length - 1 && (
                <div className="flex items-center justify-center py-2">
                  {edges
                    .filter(e => column.some(n => n.id === e.from) && columns[colIndex + 1].some(n => n.id === e.to))
                    .map((edge, idx) => {
                      const edgeKey = `${edge.from}-${edge.to}`;
                      const isActive = activeEdges.has(edgeKey);
                      return (
                        <AnimatedArrow
                          key={idx}
                          active={isActive && edge.active}
                          speed={edge.speed}
                          label={edge.label}
                        />
                      );
                    })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-slate-700">
        <div className="flex flex-wrap items-center gap-4 text-2xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
            <span>Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse"></div>
            <span>Processing</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-600"></div>
            <span>Idle</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Zap className="text-amber-400" size={12} />
            <span>Data flowing</span>
          </div>
        </div>
      </div>
    </div>
  );
}