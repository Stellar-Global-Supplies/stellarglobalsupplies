import React from 'react';

interface FlowStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const DataFlowDiagram: React.FC = () => {
  const flowSteps: FlowStep[] = [
    {
      id: 'upload',
      label: 'Data Upload',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      ),
      description: 'CSV/JSON files',
    },
    {
      id: 's3',
      label: 'S3 Storage',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      ),
      description: 'Raw & processed',
    },
    {
      id: 'lambda',
      label: 'Lambda',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      description: 'ETL & API',
    },
    {
      id: 'dynamodb',
      label: 'DynamoDB',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      ),
      description: 'Single table',
    },
    {
      id: 'bedrock',
      label: 'Bedrock AI',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      description: 'Claude Sonnet 4.5',
    },
    {
      id: 'supabase',
      label: 'Supabase',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
      ),
      description: 'Analytics DB',
    },
    {
      id: 'frontend',
      label: 'Frontend',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      description: 'React PWA',
    },
  ];

  return (
    <div className="w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-xl p-6 shadow-2xl border border-slate-700">
      <h3 className="text-xl font-bold text-white mb-6 text-center">
        Live Data Flow Architecture
      </h3>

      <div className="relative overflow-x-auto">
        <div className="flex items-center justify-between min-w-[1200px] px-4">
          {flowSteps.map((step, index) => (
            <React.Fragment key={step.id}>
              {/* Step Node */}
              <div className="flex flex-col items-center relative">
                {/* Animated pulse ring */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 opacity-20 animate-ping" />
                </div>

                {/* Main icon container */}
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/50 z-10">
                  <div className="text-white">
                    {step.icon}
                  </div>
                </div>

                {/* Label */}
                <div className="mt-3 text-center">
                  <div className="text-white font-semibold text-sm">{step.label}</div>
                  <div className="text-slate-400 text-xs">{step.description}</div>
                </div>
              </div>

              {/* Animated connection line */}
              {index < flowSteps.length - 1 && (
                <div className="flex-1 relative h-1 mx-2">
                  {/* Base line */}
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/50 to-blue-500/50 rounded-full" />

                  {/* Animated flowing dots */}
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="animate-flow w-3 h-3 rounded-full bg-cyan-400 shadow-lg shadow-cyan-400/75" />
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-slate-700">
        <div className="flex flex-wrap gap-4 justify-center text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
            <span>Live data flow</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span>AI Processing (Bedrock)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-600" />
            <span>Storage (DynamoDB/S3)</span>
          </div>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes flow {
          0% {
            transform: translateX(-100%);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(400%);
            opacity: 0;
          }
        }

        .animate-flow {
          animation: flow 3s linear infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .animate-flow,
          .animate-ping {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
};

export default DataFlowDiagram;