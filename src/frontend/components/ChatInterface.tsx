import { useEffect, useRef, useState } from "react";
import { fetchChatHistory, sendChatMessage } from "../api/chatApi";
import { REQUESTED_PEOPLE } from "../constants/options";
import { ChatPage, type CompareProvider, type SafeQueryAiMode } from "../pages/ChatPage";
import type { Message } from "../types";

interface CurrentUser {
  name: string;
  role: string;
  token: string;
}

interface ChatInterfaceProps {
  onRecordSaved?: (savedRecord?: any) => void;
  forcedInput?: string;
  onInputLoaded?: () => void;
  userKey?: string;
  currentUser?: CurrentUser | null;
  staffOptions?: string[];
}

export const ChatInterface = ({
  onRecordSaved,
  forcedInput,
  onInputLoaded,
  userKey,
  currentUser,
  staffOptions = REQUESTED_PEOPLE,
}: ChatInterfaceProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeChatScopeRef = useRef("");
  const historyRequestRef = useRef(0);
  const [selectedChatTarget, setSelectedChatTarget] = useState("admin");
  const [aiMode, setAiMode] = useState<SafeQueryAiMode>(() => {
    const saved = localStorage.getItem("synohub-ai-mode");
    return (saved === "gemini" || saved === "groq") ? saved : "gemini";
  });
  const compareProviders: CompareProvider[] = ["gemini", "groq"];
  const isAdminViewingOtherChat = currentUser?.role === "admin" && selectedChatTarget !== "admin" && !selectedChatTarget.startsWith("user:");
  const chatScopeKey = `${userKey || ""}|${currentUser?.role || ""}|${selectedChatTarget}|${aiMode}`;
  const [usersList, setUsersList] = useState<{ id: number; name: string; username: string }[]>([]);

  const getBaseChatChannel = (target: string) => {
    if (target.startsWith("user:")) return target;
    if (!currentUser) return "";
    if (currentUser.role === "admin") return target || "admin";
    return `staff:${currentUser.name.trim()}`;
  };

  const getModeChatChannel = (mode: SafeQueryAiMode, target = selectedChatTarget) => {
    return `${getBaseChatChannel(target)}|ai:${mode}`;
  };

  const filterModeMessages = (items: Message[], mode: SafeQueryAiMode, target: string) => {
    const expectedChannel = getModeChatChannel(mode, target);
    return items.filter(item => !item.username || item.username === expectedChannel);
  };

  const toggleCompareProvider = (_provider: CompareProvider) => {};

  useEffect(() => {
    if (!currentUser) return;
    fetch("/api/users", {
      headers: {
        Authorization: `Bearer ${currentUser.token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setUsersList(data);
          const matched = data.find(u => u.name.trim().toLowerCase() === currentUser.name.trim().toLowerCase() || u.username.trim().toLowerCase() === currentUser.name.trim().toLowerCase());
          if (matched) {
            setSelectedChatTarget(`user:${matched.id}`);
          } else if (data.length > 0) {
            setSelectedChatTarget(`user:${data[0].id}`);
          }
        }
      })
      .catch(err => console.error("Failed to load users:", err));
  }, [currentUser]);

  useEffect(() => {
    activeChatScopeRef.current = chatScopeKey;
    setMessages([]);
    fetchHistory(chatScopeKey, aiMode, selectedChatTarget, currentUser?.role);
  }, [chatScopeKey, aiMode, selectedChatTarget, currentUser?.role]);

  useEffect(() => {
    if (forcedInput) {
      setInput(forcedInput);
      if (onInputLoaded) onInputLoaded();
    }
  }, [forcedInput, onInputLoaded]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchHistory = async (
    scopeKey: string,
    mode: SafeQueryAiMode,
    target: string,
    role?: string,
  ) => {
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    try {
      const history = await fetchChatHistory({
        ...(role === "admin" ? { target } : {}),
        aiMode: mode,
        cacheBust: Date.now(),
      });
      if (historyRequestRef.current !== requestId || activeChatScopeRef.current !== scopeKey) return;
      setMessages(filterModeMessages(Array.isArray(history) ? history : [], mode, target));
    } catch (e) {
      console.error("Failed to fetch chat history", e);
    }
  };

  const handleSend = async () => {
    if (isAdminViewingOtherChat) return;
    if (!input.trim() || loading) return;
    const userMsg = input;
    const messageChannel = getModeChatChannel(aiMode, selectedChatTarget);
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg, username: messageChannel }]);
    setLoading(true);
    const sendScopeKey = chatScopeKey;

    try {
      const payload: any = { message: userMsg, aiMode };
      if (currentUser?.role === "admin") {
        payload.selectedChatTarget = selectedChatTarget;
      }
      const res: any = await sendChatMessage(payload);
      if (activeChatScopeRef.current !== sendScopeKey) return;
      setMessages(prev => [...prev, { role: "assistant", content: res.answer || res.reply, username: messageChannel }]);
      if (res.savedRecord) {
        if (onRecordSaved) {
          onRecordSaved(res.savedRecord);
        }
      }
    } catch (e) {
      if (activeChatScopeRef.current !== sendScopeKey) return;
      const errorMessage = (e as any)?.response?.data?.error || (e as Error).message || "I'm experiencing high traffic. Please try again in 30s.";
      setMessages(prev => [...prev, { role: "assistant", content: errorMessage, username: messageChannel }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ChatPage
      currentUser={currentUser ?? null}
      selectedChatTarget={selectedChatTarget}
      isAdminViewingOtherChat={isAdminViewingOtherChat}
      aiMode={aiMode}
      compareProviders={compareProviders}
      staffOptions={staffOptions}
      chatScopeKey={chatScopeKey}
      scrollRef={scrollRef}
      messages={messages}
      loading={loading}
      input={input}
      onAiModeChange={(mode) => {
        setAiMode(mode);
        localStorage.setItem("synohub-ai-mode", mode);
      }}
      onToggleCompareProvider={toggleCompareProvider}
      onChatTargetChange={setSelectedChatTarget}
      onInputChange={setInput}
      onSend={handleSend}
      usersList={usersList}
    />
  );
};
