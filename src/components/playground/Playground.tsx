import React, { useState, useRef, useEffect } from "react";
import { Send, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import { usePostProcessProviderState } from "../settings/PostProcessingSettingsApi/usePostProcessProviderState";
import { PostProcessingSettingsPrompts } from "@/components/settings/PostProcessingSettingsPrompts";
import { useSettings } from "@/hooks/useSettings";

interface ChatStats {
  tokens_per_second: number;
  total_tokens: number;
  completion_tokens: number;
  prompt_tokens: number;
}

interface ChatResponse {
  content: string;
  stats?: ChatStats; // stats might be missing if backend fails to populate or legacy
}

interface Message {
  role: "user" | "assistant";
  content: string;
  stats?: ChatStats;
}

const Playground: React.FC = () => {
    // ... existing state ...
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const scrollEndRef = useRef<HTMLDivElement>(null);
    const { selectedProvider: activeProvider, model: activeModel } = usePostProcessProviderState();
    const { localLlamaServerStatus } = useSettings();

    const isLocalLlama = activeProvider?.id === 'local_llama';
    const isServerStopped = isLocalLlama && !localLlamaServerStatus;
    // Don't disable input when server is stopped to maintain consistency with other providers
    const isInputDisabled = isLoading || !activeProvider;

    useEffect(() => {
        // Scroll to bottom when messages change
        if (scrollEndRef.current) {
            scrollEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages]);

    useEffect(() => {
        // Listen for transcription events
        const unlistenPromise = listen<string>("transcription-available", (event) => {
             setInputValue(prev => {
                // Determine if we need a space prefix
                const prefix = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
                return prev + prefix + event.payload;
             });
        });

        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, []);

    const handleSendMessage = async () => {
        if (!inputValue.trim() || isInputDisabled) return;

        // ... existing handleSendMessage logic ...
        const userMessage: Message = { role: "user", content: inputValue.trim() };
        setMessages((prev) => [...prev, userMessage]);
        setInputValue("");
        setIsLoading(true);

        try {
            const response = await invoke<ChatResponse>("send_chat_message", {
                message: userMessage.content,
                history: messages
            });

            const assistantMessage: Message = { 
                role: "assistant", 
                content: response.content,
                stats: response.stats 
            };
            setMessages((prev) => [...prev, assistantMessage]);
        } catch (error) {
            console.error("Failed to send message:", error);
            const errorMessage: Message = { 
                role: "assistant", 
                content: `Error: ${error}` 
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const clearHistory = () => {
        setMessages([]);
    };

    return (
        <div className="flex flex-col bg-background h-full text-foreground">


            {/* Main Content - Chat */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-4 gap-4">
             {/* Header */}
             <div className="flex justify-between items-center border-b border-mid-gray/20 pb-4">
                <div>
                    <h2 className="text-xl font-semibold">LLM Playground</h2>
                    <p className="text-sm text-gray-500">
                        Testing provider: <span className="font-semibold text-logo-primary">{activeProvider?.label || "None"}</span>
                        {activeModel && (
                            <>
                                <span className="mx-2 text-gray-300">|</span>
                                <span className="font-medium text-gray-600">{activeModel}</span>
                            </>
                        )}
                         {isLocalLlama && (
                            <span className={`ml-3 px-2 py-0.5 rounded-full text-xs font-medium ${localLlamaServerStatus ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {localLlamaServerStatus ? 'Running' : 'Stopped'}
                            </span>
                        )}
                    </p>
                </div>
                {/* ... existing button ... */}
                 <Button
                    variant="ghost"
                    onClick={clearHistory}
                    disabled={messages.length === 0}
                    title="Clear conversation"
                    className="p-2"
                >
                    <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-500 transition-colors" />
                </Button>
            </div>

            {/* Chat Area */}
             <div className="flex-1 overflow-y-auto min-h-0 pr-2 space-y-4">
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center opacity-60">
                            <p>Start a conversation to test the current provider.</p>
                            {!activeProvider && (
                                <p className="text-sm text-yellow-600 mt-2 font-medium">
                                    Warning: No post-processing provider selected in settings.
                                </p>
                            )}
                        </div>
                    ) : (
                         // ... existing map ...
                        messages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`flex ${
                                    msg.role === "user" ? "justify-end" : "justify-start"
                                }`}
                            >
                                <div
                                    className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
                                        msg.role === "user"
                                            ? "bg-logo-primary text-white"
                                            : "bg-mid-gray/10 text-foreground border border-mid-gray/10"
                                    }`}
                                >
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                    {msg.stats && (
                                        <div className="mt-2 pt-2 border-t border-gray-200/20 text-[10px] opacity-70 flex gap-3">
                                            <span>{msg.stats.tokens_per_second.toFixed(1)} tok/s</span>
                                            <span>{msg.stats.total_tokens} total tokens</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                    
                     {/* ... isLoading spinner ... */}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-mid-gray/10 rounded-2xl px-4 py-3 border border-mid-gray/10">
                                <div className="flex gap-1 items-center h-2">
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={scrollEndRef} />
            </div>

            {/* Input Area */}
            <div className="flex gap-2 pt-2 border-t border-mid-gray/20">
                <Input
                    placeholder="Type a message..."
                    value={inputValue}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isInputDisabled}
                    className="flex-1"
                    autoFocus
                />
                <Button 
                    onClick={handleSendMessage} 
                    disabled={!inputValue.trim() || isInputDisabled}
                    className="px-3"
                >
                    <Send className="w-4 h-4" />
                </Button>
            </div>
            </div>
            </div>
            
        </div>
    );
};

export default Playground;
