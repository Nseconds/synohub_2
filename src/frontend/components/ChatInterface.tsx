import { useEffect, useRef, useState } from "react";
import { REQUESTED_PEOPLE } from "../constants/options";
import { ChatPage, type CompareProvider, type SafeQueryAiMode } from "../pages/ChatPage";
import type { Message } from "../types";
import { SYSTEM_PROMPT } from "../constants/prompts";

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
  const [selectedChatTarget, setSelectedChatTarget] = useState("admin");
  const [aiMode, setAiMode] = useState<SafeQueryAiMode>(() => {
    const saved = localStorage.getItem("synohub-ai-mode");
    return saved === "groq" ? saved : "groq";
  });
  const compareProviders: CompareProvider[] = ["groq"];
  const isAdminViewingOtherChat = currentUser?.role === "admin" && selectedChatTarget !== "admin" && !selectedChatTarget.startsWith("user:");
  const chatScopeKey = `${userKey || ""}|${currentUser?.role || ""}|${selectedChatTarget}|${aiMode}`;
  const [usersList, setUsersList] = useState<{ id: number; name: string; username: string }[]>([]);
  const [groqConfig, setGroqConfig] = useState<{ apiKey: string; model: string }>({ apiKey: "", model: "llama-3.1-8b-instant" });

  const getBaseChatChannel = (target: string) => {
    if (target.startsWith("user:")) return target;
    if (!currentUser) return "";
    if (currentUser.role === "admin") return target || "admin";
    return `staff:${currentUser.name.trim()}`;
  };

  const getModeChatChannel = (mode: SafeQueryAiMode, target = selectedChatTarget) => {
    return `${getBaseChatChannel(target)}|ai:${mode}`;
  };

  const toggleCompareProvider = (_provider: CompareProvider) => { };

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
    if (!currentUser) return;
    fetch("/api/config", {
      headers: {
        Authorization: `Bearer ${currentUser.token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.apiKey) {
          setGroqConfig(data);
        }
      })
      .catch(err => console.error("Failed to load Groq configuration:", err));
  }, [currentUser]);

  // Load history from localStorage
  useEffect(() => {
    activeChatScopeRef.current = chatScopeKey;
    const localHist = localStorage.getItem(`synohub-chat-hist-${chatScopeKey}`);
    if (localHist) {
      try {
        setMessages(JSON.parse(localHist));
      } catch (e) {
        setMessages([]);
      }
    } else {
      setMessages([
        {
          role: "assistant" as const,
          content: `Greetings! I am the Synosys Officer, your neural fleet intelligence assistant. Ask me to log a new service ticket or show statistics.`,
          username: getModeChatChannel(aiMode, selectedChatTarget),
          timestamp: new Date().toISOString()
        }
      ]);
    }
  }, [chatScopeKey]);

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

  const handleSend = async () => {
    if (isAdminViewingOtherChat) return;
    if (!input.trim() || loading) return;
    const userMsg = input;
    const messageChannel = getModeChatChannel(aiMode, selectedChatTarget);
    setInput("");
    
    const updatedUserMessages: Message[] = [...messages, { role: "user" as const, content: userMsg, username: messageChannel, timestamp: new Date().toISOString() }];
    setMessages(updatedUserMessages);
    localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(updatedUserMessages));
    
    setLoading(true);
    const sendScopeKey = chatScopeKey;

    try {
      // 1. Call Groq completions API directly
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqConfig.apiKey || "dummy_key"}`
        },
        body: JSON.stringify({
          model: groqConfig.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT.replace(/\{\{ACTIVE_USER_NAME\}\}/g, currentUser?.name || "admin") },
            ...updatedUserMessages.slice(-8).map(m => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.content
            })),
            { role: "user", content: userMsg }
          ],
          temperature: 0.2,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API returned status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const rawContent = (data?.choices?.[0]?.message?.content || "").trim();
      let reply = rawContent;
      let savedRecord: any = null;

      // 2. Parse Structured JSON to create ticket
      if (rawContent.startsWith("{") && rawContent.endsWith("}")) {
        try {
          const parsedJson = JSON.parse(rawContent);
          if (parsedJson.intent === "create_service_ticket") {
            const insertResponse = await fetch("/api/services", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentUser?.token || ""}`
              },
              body: JSON.stringify({
                customerName: parsedJson.customerName,
                description: parsedJson.description,
                quantity: parsedJson.quantity || 1,
                amount: parsedJson.amount || null,
                payment: parsedJson.payment || "Applicable",
                assignee: parsedJson.assignee || null,
                requestedPerson: parsedJson.requestedPerson || currentUser?.name || "admin",
                region: parsedJson.region || "Dubai",
                implementationType: parsedJson.implementationType || "LOCATOR",
                link: parsedJson.link || null
              })
            });

            if (!insertResponse.ok) {
              const insertErr = await insertResponse.json();
              throw new Error(insertErr.error || "Failed to log service ticket in database.");
            }

            const insertResult = await insertResponse.json();
            reply = `I have successfully parsed your request and logged a new service ticket (TKT-${insertResult.id}) for client **${parsedJson.customerName}**!\n\n**Details:**\n• **Description:** ${parsedJson.description}\n• **Qty:** ${parsedJson.quantity || 1}\n• **Assignee:** ${parsedJson.assignee || "Unassigned"}\n• **Payment:** ${parsedJson.payment || "Applicable"}`;
            savedRecord = {
              type: "service",
              customerName: parsedJson.customerName
            };
          } else if (parsedJson.intent === "missing_information") {
            const missing = Array.isArray(parsedJson.missingFields) ? parsedJson.missingFields.join(", ") : "customerName or description";
            reply = `I need some more information to create the ticket. Please specify: **${missing}**.`;
          }
        } catch (jsonErr: any) {
          console.error("JSON parsing/creation failed:", jsonErr);
          reply = `Parsing error: ${jsonErr.message || "Failed to parse ticket parameters."}`;
        }
      }

      if (activeChatScopeRef.current !== sendScopeKey) return;

      const finalMessages: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: reply, username: messageChannel, timestamp: new Date().toISOString() }];
      setMessages(finalMessages);
      localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMessages));

      if (savedRecord && onRecordSaved) {
        onRecordSaved(savedRecord);
      }
    } catch (e: any) {
      if (activeChatScopeRef.current !== sendScopeKey) return;
      const errorMessage = e.message || "I'm experiencing issues. Please try again.";
      const finalMessages: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: errorMessage, username: messageChannel, timestamp: new Date().toISOString() }];
      setMessages(finalMessages);
      localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMessages));
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
