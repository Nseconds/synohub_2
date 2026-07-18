import { ChevronRight, Clock } from "lucide-react";
import { motion } from "motion/react";

interface Registration {
  id: number;
  customerName: string;
  contactName: string;
  region: string;
  status: string;
  salesPerson: string;
  requestedPerson?: string;
  projectValue?: string;
  newQty: number;
  migrateQty: number;
  tradingQty: number;
  serviceQty: number;
  otherQty: number;
}

interface DashboardPageProps {
  registrations: Registration[];
  showAllFeed: boolean;
  onSelectLead: (leadId: number) => void;
  onToggleShowAllFeed: () => void;
}

function formatCurrency(val: number) {
  if (val >= 1_000_000) {
    return `AED ${(val / 1_000_000).toFixed(2)}M`;
  }
  if (val >= 1_000) {
    return `AED ${(val / 1_000).toFixed(1)}K`;
  }
  return `AED ${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function DashboardPage({
  registrations,
  showAllFeed,
  onSelectLead,
  onToggleShowAllFeed,
}: DashboardPageProps) {
  const regs = registrations || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-6 w-full"
    >
      <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h3 className="font-bold text-zinc-955 text-sm tracking-tight flex items-center gap-2">
            <Clock size={16} className="text-[#00ADC6]" />
            Real-Time Activity Feed
          </h3>
          <p className="text-zinc-500 text-[11px] mt-0.5">
            Showing recent registrations and updates. Click to view form.
          </p>
        </div>

        <div className="grid gap-3">
          {regs.length === 0 ? (
            <div className="border border-dashed border-zinc-200 rounded-xl p-16 text-center text-zinc-400 text-xs">
              No recent activity logs found.
            </div>
          ) : (
            (() => {
              const sorted = regs;
              const visible = showAllFeed ? sorted : sorted.slice(0, 10);
              return (
                <>
                  {visible.map((reg, idx) => (
                    <div
                      key={`dash-reg-${reg.id || idx}-${idx}`}
                      onClick={() => onSelectLead(reg.id)}
                      className="flex items-center gap-5 p-4 border border-zinc-100 rounded-xl hover:border-[#00ADC6]/30 hover:bg-zinc-50/50 transition-all group shadow-xs cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center text-zinc-400 group-hover:bg-[#00ADC6] group-hover:text-white group-hover:border-[#00ADC6] transition-all">
                        <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-zinc-800 truncate group-hover:text-[#00ADC6] transition-colors">
                          {reg.customerName}
                        </h4>
                        <div className="flex items-center gap-3 mt-1 text-[10px]">
                          <span className="text-zinc-550 font-bold bg-zinc-100 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                            {reg.region || "DXB"}
                          </span>
                          <span className={`font-extrabold uppercase tracking-tighter ${
                            reg.status === 'Won' || reg.status === 'Completed' || reg.status === 'Approved' ? 'text-emerald-600' :
                            reg.status === 'Lost' ? 'text-red-500' :
                            'text-zinc-500'
                          }`}>
                            {reg.status}
                          </span>
                          <span className="text-zinc-400 font-semibold">
                            • Contract: {reg.projectValue ? formatCurrency(parseFloat(reg.projectValue)) : "—"}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col gap-1.5 justify-center min-w-[120px]">
                        <div>
                          <div className="text-[10px] font-bold text-zinc-900 leading-tight">Sales Person</div>
                          <p className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wider">
                            {reg.salesPerson || "Unassigned"}
                          </p>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-zinc-900 leading-tight">Requested Person</div>
                          <p className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wider">
                            {reg.requestedPerson || "Unassigned"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {regs.length > 10 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleShowAllFeed();
                      }}
                      className="w-full py-2.5 border border-dashed border-zinc-200 hover:border-[#00ADC6]/40 rounded-xl text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 hover:text-[#00ADC6] transition-all text-center mt-2 cursor-pointer"
                    >
                      {showAllFeed ? "Collapse Activity Feed" : `View All Saved Logs (${regs.length})`}
                    </button>
                  )}
                </>
              );
            })()
          )}
        </div>
      </div>
    </motion.div>
  );
}
