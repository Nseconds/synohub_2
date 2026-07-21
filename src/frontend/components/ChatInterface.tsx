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
  const [pendingTicket, setPendingTicket] = useState<any | null>(null);

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
          content: `Greetings! I am SynoAI Officer, your fleet intelligence assistant. Ask me to log a new service ticket.`,
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

    const sendScopeKey = chatScopeKey;
    if (pendingTicket) {
      const normalizedMsg = userMsg.trim().toLowerCase();
      if (normalizedMsg === "confirm" || normalizedMsg === "yes" || normalizedMsg === "ok" || normalizedMsg === "go ahead") {
        await handleConfirmPendingTicket(pendingTicket, updatedUserMessages, sendScopeKey, messageChannel);
        return;
      } else {
        setPendingTicket(null);
      }
    }
    
    setLoading(true);
    let modelUsed = groqConfig.model || "llama-3.1-8b-instant";

    try {
      // 1. Call Groq completions API directly (with fallback models if rate/token limit is hit)
      const primaryModel = groqConfig.model || "llama-3.1-8b-instant";
      const modelsToTry = Array.from(new Set([
        primaryModel,
        primaryModel === "llama-3.1-8b-instant" ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant",
        "mixtral-8x7b-32768"
      ]));

      let response: Response | null = null;
      let lastError: Error | null = null;
      let rawContent = "";

      for (const model of modelsToTry) {
        try {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${groqConfig.apiKey || "dummy_key"}`
            },
            body: JSON.stringify({
              model: model,
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

          if (res.ok) {
            response = res;
            lastError = null;
            modelUsed = model;
            break;
          }

          const errText = await res.text();
          const errLower = errText.toLowerCase();
          const isRateOrTokenLimit = res.status === 429 || errLower.includes("rate_limit") || errLower.includes("token limit") || errLower.includes("tokens per minute");
          
          if (isRateOrTokenLimit) {
            console.warn(`Model ${model} hit rate/token limit. Trying next model...`);
            lastError = new Error(`Groq API returned status ${res.status}: ${errText}`);
            continue;
          } else {
            throw new Error(`Groq API returned status ${res.status}: ${errText}`);
          }
        } catch (err: any) {
          lastError = err;
          const errMsgLower = (err.message || "").toLowerCase();
          const isRateOrTokenLimitErr = errMsgLower.includes("429") || errMsgLower.includes("rate_limit") || errMsgLower.includes("token limit") || errMsgLower.includes("tokens per minute");
          if (isRateOrTokenLimitErr) {
            continue;
          }
          throw err;
        }
      }

      if (lastError || !response) {
        throw lastError || new Error("Failed to complete request with any model.");
      }

      const data = await response.json();
      rawContent = (data?.choices?.[0]?.message?.content || "").trim();
      let reply = rawContent;
      let savedRecord: any = null;

      // 2. Parse Structured JSON to create ticket
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsedJson = JSON.parse(jsonMatch[0].trim());
          if (parsedJson.intent === "create_service_ticket") {
             const lastAssistantMessage = [...messages].reverse().find(m => m.role === "assistant");
             const isDisambiguationActive = !!(lastAssistantMessage && lastAssistantMessage.content.includes("Please clarify"));

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
                link: parsedJson.link || null,
                contactPerson: parsedJson.contactPerson || null,
                contactNumber: parsedJson.contactNumber || null,
                vehiclePlate: parsedJson.vehiclePlate || null,
                accessories: parsedJson.accessories || null,
                driverNumber: parsedJson.driverNumber || null,
                preferredDateTime: parsedJson.preferredDateTime || null,
                confirmFirstCandidate: isDisambiguationActive,
                dryRun: true
              })
            });

            if (!insertResponse.ok) {
              const insertErr = await insertResponse.json();
              if (insertErr.error === "disambiguation_required" && Array.isArray(insertErr.candidates)) {
                const candidates = insertErr.candidates;
                let clarifyMsg = "";
                if (candidates.length === 1) {
                  clarifyMsg = `Customer "${insertErr.typedName}" was not found. Please clarify, is that the customer you are asking for?\n- ${candidates[0]}`;
                } else {
                  clarifyMsg = `Customer "${insertErr.typedName}" was not found. Please clarify, did you mean one of these?\n` + candidates.map(c => `- ${c}`).join("\n");
                }
                throw { isFriendlyDisambiguation: true, friendlyMessage: clarifyMsg };
              }
              throw new Error(insertErr.error || "Failed to log service ticket in database.");
            }

            const insertResult = await insertResponse.json();
            setPendingTicket({
              customerName: insertResult.customerName,
              description: insertResult.description,
              quantity: insertResult.quantity,
              amount: insertResult.amount,
              payment: insertResult.payment,
              assignee: insertResult.assignee,
              requestedPerson: insertResult.requestedPerson,
              region: insertResult.region,
              implementationType: insertResult.implementationType,
              link: insertResult.link,
              contactPerson: insertResult.contactPerson,
              contactNumber: insertResult.contactNumber,
              vehiclePlate: insertResult.vehiclePlate,
              accessories: insertResult.accessories,
              driverNumber: insertResult.driverNumber,
              preferredDateTime: insertResult.preferredDateTime
            });
            reply = `🔹SERVICE REQUEST DRAFT (Pending Confirmation)

━━━━━━━━━━━━━━━━━━━━
CUSTOMER DETAILS
━━━━━━━━━━━━━━━━━━━━
*Customer Name   : ${insertResult.customerName || "N/A"}
${insertResult.customerUsername ? `*Customer Username: ${insertResult.customerUsername}\n` : ""}*Contact Person  : ${insertResult.contactPerson || "N/A"}
*Contact Number  : ${insertResult.contactNumber || "N/A"}
*Driver: ${insertResult.driverNumber || "N/A"}

━━━━━━━━━━━━━━━━━━━━
SERVICE DETAILS
━━━━━━━━━━━━━━━━━━━━
*Implementation Type     : ${insertResult.implementationType || "N/A"}
*Device Quantity: ${insertResult.quantity || 1}
*Vehicle Plate : ${insertResult.vehiclePlate || "N/A"}
*Installation Location : ${insertResult.region || "N/A"}
*Description : ${insertResult.description || "N/A"}
*accessories : ${insertResult.accessories || "N/A"}
*Sales person : ${insertResult.assignee || ""}
*Requested By    : ${insertResult.requestedPerson || currentUser?.name || "admin"}

━━━━━━━━━━━━━━━━━━━━
PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━
Amount          : ${insertResult.amount || ""}

Please confirm if these details are correct by replying "Confirm" / "Yes" or clicking the confirm button below.`;
            savedRecord = null;
          } else if (parsedJson.intent === "missing_information") {
            const missing = Array.isArray(parsedJson.missingFields) ? parsedJson.missingFields.join(", ") : "customerName or description";
            
            if (parsedJson.customerName && parsedJson.customerName !== "extracted customer name or null") {
              const lastAssistantMessage = [...messages].reverse().find(m => m.role === "assistant");
              const isDisambiguationActive = !!(lastAssistantMessage && lastAssistantMessage.content.includes("Please clarify"));

              const checkResponse = await fetch("/api/services", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${currentUser?.token || ""}`
                },
                body: JSON.stringify({
                  customerName: parsedJson.customerName,
                  description: "customer existence verification dry run",
                  dryRun: true,
                  confirmFirstCandidate: isDisambiguationActive
                })
              });

              if (!checkResponse.ok) {
                const checkErr = await checkResponse.json();
                if (checkErr.error === "disambiguation_required" && Array.isArray(checkErr.candidates)) {
                  const candidates = checkErr.candidates;
                  let clarifyMsg = "";
                  if (candidates.length === 1) {
                    clarifyMsg = `Customer "${checkErr.typedName}" was not found. Please clarify, is that the customer you are asking for?\n- ${candidates[0]}`;
                  } else {
                    clarifyMsg = `Customer "${checkErr.typedName}" was not found. Please clarify, did you mean one of these?\n` + candidates.map(c => `- ${c}`).join("\n");
                  }
                  throw { isFriendlyDisambiguation: true, friendlyMessage: clarifyMsg };
                } else if (checkErr.error) {
                  throw { isFriendlyDisambiguation: true, friendlyMessage: `Customer "${parsedJson.customerName}" was not found.` };
                }
              }
            }

            reply = `I need some more information to create the ticket. Please specify: **${missing}**.`;
          }
        } catch (jsonErr: any) {
          console.error("JSON parsing/creation failed:", jsonErr);
          if (jsonErr.isFriendlyDisambiguation) {
            reply = jsonErr.friendlyMessage;
          } else {
            reply = `Parsing error: ${jsonErr.message || "Failed to parse ticket parameters."}`;
          }
        }
      }

      if (activeChatScopeRef.current !== sendScopeKey) return;

      const finalMessages: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: reply, username: messageChannel, timestamp: new Date().toISOString(), model: modelUsed }];
      setMessages(finalMessages);
      localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMessages));

      if (savedRecord && onRecordSaved) {
        onRecordSaved(savedRecord);
      }
    } catch (e: any) {
      if (activeChatScopeRef.current !== sendScopeKey) return;
      const errorMessage = e.isFriendlyDisambiguation ? e.friendlyMessage : (e.message || "I'm experiencing issues. Please try again.");
      const finalMessages: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: errorMessage, username: messageChannel, timestamp: new Date().toISOString(), model: modelUsed }];
      setMessages(finalMessages);
      localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMessages));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPendingTicket = async (
    ticket: any, 
    updatedUserMessages: Message[], 
    sendScopeKey: string, 
    messageChannel: string
  ) => {
    setLoading(true);
    try {
      const insertResponse = await fetch("/api/services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${currentUser?.token || ""}`
        },
        body: JSON.stringify({
          ...ticket,
          dryRun: false
        })
      });

      if (!insertResponse.ok) {
        const insertErr = await insertResponse.json();
        throw new Error(insertErr.error || "Failed to log service ticket in database.");
      }

      const insertResult = await insertResponse.json();
      const reply = `🔹SERVICE REQUEST (Created Successfully)

━━━━━━━━━━━━━━━━━━━━
CUSTOMER DETAILS
━━━━━━━━━━━━━━━━━━━━
*Customer Name   : ${insertResult.customerName || "N/A"}
${insertResult.customerUsername ? `*Customer Username: ${insertResult.customerUsername}\n` : ""}*Contact Person  : ${insertResult.contactPerson || "N/A"}
*Contact Number  : ${insertResult.contactNumber || "N/A"}
*Driver: ${insertResult.driverNumber || "N/A"}

━━━━━━━━━━━━━━━━━━━━
SERVICE DETAILS
━━━━━━━━━━━━━━━━━━━━
*Implementation Type     : ${insertResult.implementationType || "N/A"}
*Device Quantity: ${insertResult.quantity || 1}
*Vehicle Plate : ${insertResult.vehiclePlate || "N/A"}
*Installation Location : ${insertResult.region || "N/A"}
*Description : ${insertResult.description || "N/A"}
*accessories : ${insertResult.accessories || "N/A"}
*Sales person : ${insertResult.assignee || ""}
*Requested By    : ${insertResult.requestedPerson || currentUser?.name || "admin"}

━━━━━━━━━━━━━━━━━━━━
PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━
Amount          : ${insertResult.amount || ""}`;

      if (activeChatScopeRef.current !== sendScopeKey) return;

      const finalMessages: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: reply, username: messageChannel, timestamp: new Date().toISOString() }];
      setMessages(finalMessages);
      localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMessages));
      setPendingTicket(null);

      if (onRecordSaved) {
        onRecordSaved({
          type: "service",
          customerName: insertResult.customerName
        });
      }
    } catch (e: any) {
      if (activeChatScopeRef.current !== sendScopeKey) return;
      const errorMessage = e.message || "Failed to confirm ticket.";
      const finalMessages: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: errorMessage, username: messageChannel, timestamp: new Date().toISOString() }];
      setMessages(finalMessages);
      localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMessages));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPendingTicketBtn = () => {
    if (!pendingTicket || loading) return;
    const messageChannel = getModeChatChannel(aiMode, selectedChatTarget);
    const mockUserMsg: Message = { role: "user" as const, content: "Confirm", username: messageChannel, timestamp: new Date().toISOString() };
    const updatedUserMessages = [...messages, mockUserMsg];
    setMessages(updatedUserMessages);
    localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(updatedUserMessages));
    handleConfirmPendingTicket(pendingTicket, updatedUserMessages, chatScopeKey, messageChannel);
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
      pendingTicket={pendingTicket}
      onConfirmPendingTicket={handleConfirmPendingTicketBtn}
    />
  );
};
