import React from "react";
import { Eye, MessageSquare, Send, Sparkles, Zap } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../../lib/utils";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  username?: string;
}

export type SafeQueryAiMode = "gemini" | "groq";
export type CompareProvider = "gemini" | "groq";

interface CurrentUser {
  name: string;
  role: string;
  token: string;
}

interface ChatPageProps {
  currentUser: CurrentUser | null;
  selectedChatTarget: string;
  isAdminViewingOtherChat: boolean;
  aiMode: SafeQueryAiMode;
  compareProviders: CompareProvider[];
  staffOptions: string[];
  chatScopeKey: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  loading: boolean;
  input: string;
  onAiModeChange: (mode: SafeQueryAiMode) => void;
  onToggleCompareProvider: (provider: CompareProvider) => void;
  onChatTargetChange: (target: string) => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  usersList?: { id: number; name: string; username: string }[];
}

const getChatTargetLabel = (target: string) => {
  if (target === "admin") return "Admin";
  if (target === "guest") return "Guest";
  if (target.startsWith("staff:")) return target.replace("staff:", "");
  if (target.startsWith("user:")) return `User (ID: ${target.replace("user:", "")})`;
  return target;
};

export const ChatPage = ({
  currentUser,
  selectedChatTarget,
  isAdminViewingOtherChat,
  aiMode,
  chatScopeKey,
  scrollRef,
  messages,
  loading,
  input,
  onAiModeChange,
  onChatTargetChange,
  onInputChange,
  onSend,
  usersList = [],
}: ChatPageProps) => (
  <div className="max-w-4xl mx-auto px-4">
    <div className="flex flex-col h-[700px] border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-lg">
      {/* Header */}
      <div className="p-4 border-b border-zinc-100 bg-zinc-50/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-accent/10 flex items-center justify-center">
            <Zap size={16} className="text-[#00ADC6]" />
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-800">SynoHub AI Assistant</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ADC6] animate-pulse" /> Cog-Ops Neural Link
            </div>
          </div>
        </div>
      </div>

      {/* Chat Controls */}
      {currentUser && (
        <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-zinc-700">
            {currentUser.role === "admin" ? (
              <>
                <Eye size={14} className="text-zinc-500" />
                <span>Viewing chat: <span className="text-[#00ADC6] font-bold">{getChatTargetLabel(selectedChatTarget)}</span></span>
                {isAdminViewingOtherChat && (
                  <span className="ml-2 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-600">
                    Read Only
                  </span>
                )}
              </>
            ) : (
              <>
                <Sparkles size={14} className="text-zinc-500" />
                <span>Signed in as: <span className="text-[#00ADC6] font-bold">{currentUser.name}</span></span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {usersList.length > 0 && (
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-zinc-500" />
                <span className="text-zinc-500 font-medium">Channel:</span>
                <select
                  value={selectedChatTarget}
                  onChange={(e) => onChatTargetChange(e.target.value)}
                  className="bg-white border border-zinc-200 rounded px-2 py-1 text-xs text-zinc-800 font-bold focus:outline-none focus:border-teal-accent/50 cursor-pointer shadow-xs"
                >
                  {usersList.map((u) => (
                    <option key={u.id} value={`user:${u.id}`}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-zinc-500" />
              <span className="text-zinc-500 font-medium">AI Mode:</span>
              <select
                value={aiMode}
                onChange={(e) => onAiModeChange(e.target.value as SafeQueryAiMode)}
                className="bg-white border border-zinc-200 rounded px-2 py-1 text-xs text-zinc-800 font-bold focus:outline-none focus:border-teal-accent/50 cursor-pointer shadow-xs"
              >
                <option value="gemini">Gemini</option>
                <option value="groq">Groq (Grok)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div key={chatScopeKey} ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide bg-zinc-50/30">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-center p-8 space-y-4">
             <MessageSquare size={44} className="opacity-15 text-[#00ADC6]" />
             <div className="text-xs font-medium text-zinc-500 max-w-[280px]">
               Hi there! Ask any query to start a streamlined operational conversation. (Try: "summary" or "ongoing tickets").
             </div>
          </div>
        )}
        {messages.map((m, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={`msg-${idx}`}
            className={cn(
              "flex flex-col min-w-0 max-w-[85%] gap-1.5",
              m.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
            )}
          >
            <div className={cn(
              "max-w-full p-4 rounded-2xl text-xs leading-relaxed shadow-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
              m.role === "user" 
                ? "bg-zinc-800 text-white rounded-br-none" 
                : "bg-white text-zinc-700 rounded-bl-none border border-zinc-100"
            )}>
              {m.content}
            </div>
            <span className="text-[9px] text-zinc-400 uppercase tracking-tight px-1 font-bold">
              {m.role === "user" ? "You" : "SynoAI Officer"}
            </span>
          </motion.div>
        ))}
        {loading && (
          <div className="flex gap-1.5 p-3.5 bg-white border border-zinc-100 w-fit rounded-2xl shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-[#00ADC6] animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#00ADC6] animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#00ADC6] animate-bounce" />
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="p-4 bg-white border-t border-zinc-100">
        <div className="relative">
          <input 
            type="text" 
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSend()}
            disabled={isAdminViewingOtherChat}
            placeholder={isAdminViewingOtherChat ? "Read-only view. Switch to Admin to chat." : "Type your message..."} 
            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl py-3.5 pl-4 pr-12 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-teal-accent/50 transition-all font-medium disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
          />
          <button 
            onClick={onSend}
            disabled={isAdminViewingOtherChat || loading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 text-zinc-400 hover:text-[#00ADC6] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  </div>
);
