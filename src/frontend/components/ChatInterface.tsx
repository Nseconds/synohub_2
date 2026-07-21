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
  const [confirmedCustomer, setConfirmedCustomer] = useState<string | null>(null);

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

    let modelUsed = groqConfig.model || "llama-3.1-8b-instant";

    // Check if the user is selecting a candidate from a disambiguation list by ordinal/position
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg && lastAssistantMsg.content.includes("Please clarify")) {
      const disambiguationLines = lastAssistantMsg.content.split("\n").filter((l: string) => l.startsWith("- "));
      const disambiguationCandidates = disambiguationLines.map((l: string) => l.substring(2).trim());

      if (disambiguationCandidates.length > 0) {
        const msgLower = userMsg.trim().toLowerCase();
        const ordinalMap: Record<string, number> = {
          "1": 0, "first": 0, "first one": 0, "1st": 0, "the first": 0, "option 1": 0,
          "2": 1, "second": 1, "second one": 1, "2nd": 1, "the second": 1, "option 2": 1,
          "3": 2, "third": 2, "third one": 2, "3rd": 2, "the third": 2, "option 3": 2,
          "4": 3, "fourth": 3, "fourth one": 3, "4th": 3, "the fourth": 3, "option 4": 3,
          "5": 4, "fifth": 4, "fifth one": 4, "5th": 4, "the fifth": 4, "option 5": 4
        };
        const selectedIndex = ordinalMap[msgLower];
        const selectedCandidate = selectedIndex !== undefined ? disambiguationCandidates[selectedIndex] : undefined;

        if (selectedCandidate) {
          setLoading(true);
          try {
            const checkResponse = await fetch("/api/services", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${currentUser?.token || ""}` },
              body: JSON.stringify({
                customerName: selectedCandidate,
                description: "customer existence verification dry run",
                dryRun: true
              })
            });
            const checkData = await checkResponse.json();
            let reply = "";
            if (checkResponse.ok) {
              reply = `Got it! Customer confirmed as **${selectedCandidate}**. Now please provide a short description of the service required.`;
            } else if (checkData.error === "disambiguation_required" && Array.isArray(checkData.candidates)) {
              const newCandidates = checkData.candidates;
              reply = newCandidates.length === 1
                ? `Customer "${selectedCandidate}" was not found. Please clarify, is that the customer you are asking for?\n- ${newCandidates[0]}`
                : `Customer "${selectedCandidate}" was not found. Please clarify, did you mean one of these?\n` + newCandidates.map((c: string) => `- ${c}`).join("\n");
            } else {
              reply = `Customer "${selectedCandidate}" was not found in the database.`;
            }
            if (activeChatScopeRef.current !== sendScopeKey) return;
            const finalMsgs: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: reply, username: messageChannel, timestamp: new Date().toISOString(), model: modelUsed }];
            setMessages(finalMsgs);
            localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMsgs));
          } catch (e: any) {
            const errMsg = e.message || "Failed to verify customer.";
            const finalMsgs: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: errMsg, username: messageChannel, timestamp: new Date().toISOString(), model: modelUsed }];
            setMessages(finalMsgs);
            localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMsgs));
          } finally {
            setLoading(false);
          }
          return;
        }
      }
    }

    // Interceptor: if bot previously asked for description only AND we have a confirmed customer,
    // use the user's raw message as the description and go straight to dry-run / ticket draft
    const lastBotMsg = [...messages].reverse().find(m => m.role === "assistant");
    const waitingForDescription = !!(lastBotMsg && lastBotMsg.content.includes("Please specify:") && lastBotMsg.content.includes("description") && !lastBotMsg.content.includes("customerName"));
    if (waitingForDescription && confirmedCustomer) {
      const descriptionText = userMsg.trim();
      if (descriptionText.length > 2) {
        setLoading(true);
        try {
          const dryRunResponse = await fetch("/api/services", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${currentUser?.token || ""}` },
            body: JSON.stringify({
              customerName: confirmedCustomer,
              description: descriptionText,
              dryRun: true
            })
          });
          const dryRunData = await dryRunResponse.json();
          let reply = "";
          if (dryRunResponse.ok) {
            const r = dryRunData;
            setPendingTicket({
              customerName: r.customerName || confirmedCustomer,
              description: descriptionText,
              quantity: r.quantity || 1,
              amount: r.amount || null,
              payment: r.payment || null,
              assignee: r.assignee || null,
              requestedPerson: r.requestedPerson || currentUser?.name || "admin",
              region: r.region || null,
              implementationType: r.implementationType || null,
              link: r.link || null,
              contactPerson: r.contactPerson || null,
              contactNumber: r.contactNumber || null,
              vehiclePlate: r.vehiclePlate || null,
              accessories: r.accessories || null,
              driverNumber: r.driverNumber || null,
              preferredDateTime: r.preferredDateTime || null
            });
            setConfirmedCustomer(null);
            reply = `🔹SERVICE REQUEST DRAFT (Pending Confirmation)

━━━━━━━━━━━━━━━━━━━━
CUSTOMER DETAILS
━━━━━━━━━━━━━━━━━━━━
*Customer Name   : ${r.customerName || confirmedCustomer}
*Contact Person  : ${r.contactPerson || "N/A"}
*Contact Number  : ${r.contactNumber || "N/A"}
*Driver: ${r.driverNumber || "N/A"}

━━━━━━━━━━━━━━━━━━━━
SERVICE DETAILS
━━━━━━━━━━━━━━━━━━━━
*Implementation Type     : ${r.implementationType || "N/A"}
*Device Quantity: ${r.quantity || 1}
*Vehicle Plate : ${r.vehiclePlate || "N/A"}
*Installation Location : ${r.region || "N/A"}
*Description : ${descriptionText}
*accessories : ${r.accessories || "N/A"}
*Sales person : ${r.assignee || ""}
*Requested By    : ${r.requestedPerson || currentUser?.name || "admin"}

━━━━━━━━━━━━━━━━━━━━
PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━
Amount          : ${r.amount || ""}

Please confirm if these details are correct by replying "Confirm" / "Yes" or clicking the confirm button below.`;
          } else if (dryRunData.error === "disambiguation_required" && Array.isArray(dryRunData.candidates)) {
            const candidates = dryRunData.candidates;
            reply = candidates.length === 1
              ? `Customer "${dryRunData.typedName}" was not found. Please clarify, is that the customer you are asking for?\n- ${candidates[0]}`
              : `Customer "${dryRunData.typedName}" was not found. Please clarify, did you mean one of these?\n` + candidates.map((c: string) => `- ${c}`).join("\n");
          } else {
            reply = `I need some more information to create the ticket. Please specify: **description**.`;
          }
          if (activeChatScopeRef.current !== sendScopeKey) return;
          const finalMsgs: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: reply, username: messageChannel, timestamp: new Date().toISOString(), model: modelUsed }];
          setMessages(finalMsgs);
          localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMsgs));
        } catch (e: any) {
          const finalMsgs: Message[] = [...updatedUserMessages, { role: "assistant" as const, content: e.message || "Failed to process request.", username: messageChannel, timestamp: new Date().toISOString(), model: modelUsed }];
          setMessages(finalMsgs);
          localStorage.setItem(`synohub-chat-hist-${chatScopeKey}`, JSON.stringify(finalMsgs));
        } finally {
          setLoading(false);
        }
        return;
      }
    }
    
    setLoading(true);

    try {
      // 1. Call Groq completions API directly (with fallback models if rate/token limit is hit)
      const primaryModel = groqConfig.model || "llama-3.1-8b-instant";
      const modelsToTry = Array.from(new Set([
        primaryModel,
        primaryModel === "llama-3.1-8b-instant" ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant"
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
      let reply = "";
      let savedRecord: any = null;

      // 2. Parse Structured JSON to create ticket
      // Try to extract and auto-repair truncated JSON (add missing closing brace)
      let rawJson = rawContent;
      const jsonMatch = rawContent.match(/\{[\s\S]*/);
      if (jsonMatch) {
        rawJson = jsonMatch[0].trim();
        // Count braces to detect truncation
        const opens = (rawJson.match(/\{/g) || []).length;
        const closes = (rawJson.match(/\}/g) || []).length;
        if (opens > closes) {
          rawJson = rawJson + "}".repeat(opens - closes);
        }
      }

      if (jsonMatch) {
        try {
          const parsedJson = JSON.parse(rawJson);
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
                customerName: parsedJson.customerName || confirmedCustomer,
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
            setConfirmedCustomer(null); // clear confirmed customer after ticket is drafted
          } else if (parsedJson.intent === "missing_information") {
            let missingFields = Array.isArray(parsedJson.missingFields) ? [...parsedJson.missingFields] : ["customerName", "description"];
            
            const effectiveCustomerName = (parsedJson.customerName && parsedJson.customerName !== "extracted customer name or null") 
              ? parsedJson.customerName 
              : (confirmedCustomer || "");

            // If we have a confirmed customer but LLM erroneously lists customerName as missing, remove it
            if (effectiveCustomerName && confirmedCustomer && missingFields.includes("customerName")) {
              missingFields = missingFields.filter(f => f !== "customerName");
            }

            const missing = missingFields.join(", ") || "description";

            if (effectiveCustomerName) {
              const lastAssistantMessage = [...messages].reverse().find(m => m.role === "assistant");
              const isDisambiguationActive = !!(lastAssistantMessage && lastAssistantMessage.content.includes("Please clarify"));

              // Extract candidate list from previous disambiguation message
              let previousCandidates: string[] = [];
              if (isDisambiguationActive && lastAssistantMessage) {
                const lines = lastAssistantMessage.content.split("\n");
                previousCandidates = lines
                  .filter((l: string) => l.startsWith("- "))
                  .map((l: string) => l.substring(2).trim());
              }
              
              // Check if user's input matches one of the listed candidates (partial match)
              const userInput = effectiveCustomerName.toLowerCase();
              const matchedCandidate = previousCandidates.find(c => 
                c.toLowerCase().includes(userInput) || userInput.includes(c.toLowerCase().substring(0, 8))
              );

              const checkResponse = await fetch("/api/services", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${currentUser?.token || ""}`
                },
                body: JSON.stringify({
                  customerName: effectiveCustomerName,
                  description: "customer existence verification dry run",
                  dryRun: true,
                  confirmFirstCandidate: isDisambiguationActive && !matchedCandidate
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
                  throw { isFriendlyDisambiguation: true, friendlyMessage: `Customer "${effectiveCustomerName}" was not found.` };
                }
              } else {
                // Customer verified — store as confirmed customer for context persistence
                const checkData = await checkResponse.json();
                setConfirmedCustomer(checkData.customerName || effectiveCustomerName);
              }
            } else if (confirmedCustomer && parsedJson.missingFields && !parsedJson.missingFields.includes("description")) {
              // Customer was confirmed earlier, only description is missing - that's fine
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

      // Fallback: if reply is still empty (LLM returned natural language, not JSON), display it directly
      if (!reply) {
        reply = rawContent || "I'm sorry, I couldn't process that request.";
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
