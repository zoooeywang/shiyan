
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- Configuration & Constants ---
const KEYWORDS_CORE = ["三郎", "旧情", "恩义", "无奈", "来世", "信物", "体面", "圣旨", "长生殿"];
const KEYWORDS_NOISE = ["喝茶", "休息", "梳妆", "天气", "鹦鹉", "琵琶", "荔枝", "长安", "梨园", "红尘", "霓裳"];
const KEYWORDS_TRAP = ["安禄山", "杨国忠", "逃跑", "假死", "私奔", "投降", "金银", "废黜", "妖妃", "胡人"];
const MAX_TIME = 40;

interface HistoryItem {
  role: 'user' | 'assistant' | 'system';
  name?: string;
  content: string;
}

interface AnalysisResult {
  reason: string;
  suspicion_change: number;
  progress_change: number;
  npc_state: string;
}

function App() {
  const [suspicion, setSuspicion] = useState(30);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([
    { role: 'system', content: ">>>> 神经连接建立... 剧本【马嵬坡】已加载。\n>>>> 警报：信息流中混杂了大量[噪音]，请谨慎甄别。" },
    { role: 'assistant', name: '杨玉环', content: "力士...是你吗？三郎呢？外面的兵为什么在喊杀我？" }
  ]);
  const [currentKeywords, setCurrentKeywords] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(MAX_TIME);
  const [isProcessing, setIsProcessing] = useState(false);
  const [input, setInput] = useState('');
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisResult[]>([]);
  const [gameOver, setGameOver] = useState<{ victory: boolean; reason: string } | null>(null);

  // Fix: Use ReturnType<typeof setTimeout> instead of NodeJS.Timeout to avoid namespace errors in browser environments.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // --- Helpers ---
  const pickRandom = (arr: string[], n: number) => {
    return [...arr].sort(() => 0.5 - Math.random()).slice(0, n);
  };

  const refreshKeywords = useCallback(() => {
    const pool = [
      ...pickRandom(KEYWORDS_CORE, 4),
      ...pickRandom(KEYWORDS_NOISE, 5),
      ...pickRandom(KEYWORDS_TRAP, 3)
    ].sort(() => Math.random() - 0.5);
    setCurrentKeywords(pool);
    setSelectedKeywords([]);
  }, []);

  useEffect(() => {
    refreshKeywords();
  }, [refreshKeywords]);

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [history]);

  // --- Timer Logic ---
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(MAX_TIME);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleTimeout = () => {
    setHistory(prev => [...prev, { role: 'system', content: "【超时警告】 沉默太久，引起了极大怀疑。" }]);
    setSuspicion(s => {
      const next = s + 30;
      if (next >= 100) handleEnd(false, "因反应迟钝被怀疑是假冒的。");
      return Math.min(100, next);
    });
    startTimer();
  };

  useEffect(() => {
    if (!gameOver && !isProcessing) startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameOver, isProcessing, startTimer]);

  const handleEnd = (victory: boolean, reason: string) => {
    setGameOver({ victory, reason });
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // --- AI Actions ---
  const handleSend = async (textOverride?: string) => {
    const msg = textOverride || input.trim();
    if (!msg || isProcessing || gameOver) return;

    setIsProcessing(true);
    if (timerRef.current) clearInterval(timerRef.current);
    setInput('');
    setHistory(prev => [...prev, { role: 'user', name: '高力士', content: msg }]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      // Use ai.models.generateContent directly to perform text generation.
      const judgeRes = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `你是一个【历史剧本杀裁判】。
        场景：马嵬坡佛堂。NPC：杨玉环（绝望、幻想皇上会救她）。玩家：高力士（来逼她死）。
        玩家输入: "${msg}"
        命中关键词: "${selectedKeywords.join('、')}"
        当前怀疑度: ${suspicion}
        
        判定标准：
        1. 魂穿露馅/OOC：说现代词、语气不敬 -> 怀疑度 +50。
        2. 命中核心词 -> 进度+10，怀疑-5。
        3. 命中陷阱词(逃跑/安禄山/假死) -> 怀疑+35，NPC暴怒。
        4. 全是无效词 -> 怀疑+15。
        5. 切断希望/情感绑架 -> 进度+15。
        6. 索要信物 -> 进度+25。
        `,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suspicion_change: { type: Type.INTEGER },
              progress_change: { type: Type.INTEGER },
              reason: { type: Type.STRING },
              npc_state: { type: Type.STRING }
            },
            required: ["suspicion_change", "progress_change", "reason", "npc_state"]
          }
        }
      });

      const jsonStr = judgeRes.text || '{}';
      const judgeData: AnalysisResult = JSON.parse(jsonStr);

      setAnalysisHistory(prev => [judgeData, ...prev]);
      
      const newSuspicion = Math.max(0, Math.min(100, suspicion + (judgeData.suspicion_change || 0)));
      const newProgress = Math.max(0, Math.min(100, progress + (judgeData.progress_change || 0)));
      
      setSuspicion(newSuspicion);
      setProgress(newProgress);

      if (newSuspicion >= 100) {
        handleEnd(false, "怀疑度爆表，卫兵已入门，你被当场拿下。");
        return;
      }
      if (newProgress >= 100) {
        handleEnd(true, "杨玉环在绝望中交出了信物，白绫已垂下。任务完成。");
        return;
      }

      // Generate NPC Response using the text property of GenerateContentResponse.
      const npcRes = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `你是杨玉环。极度惊恐但保持皇家尊严。
        裁判指示：${judgeData.reason} (NPC状态: ${judgeData.npc_state})
        玩家(高力士)说: "${msg}"
        请生成回复(60字内，带动作描写)。语气凄婉、高贵、半文半白。`,
      });

      setHistory(prev => [...prev, { role: 'assistant', name: '杨玉环', content: npcRes.text || "..." }]);
      
      refreshKeywords();
      startTimer();
    } catch (err) {
      console.error(err);
      setHistory(prev => [...prev, { role: 'system', content: ">>>> 错误：神经通路中断，连接重启中..." }]);
      startTimer();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDraft = async () => {
    if (selectedKeywords.length === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const draftRes = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `场景：高力士劝杨玉环自缢。
        请将关键词 [${selectedKeywords.join(',')}] 串联进一句台词。
        语气卑微、沉痛、无奈。只输出台词本身。`,
      });
      setInput(draftRes.text?.trim().replace(/^"|"$/g, '') || '');
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleKeyword = (k: string) => {
    if (selectedKeywords.includes(k)) {
      setSelectedKeywords(prev => prev.filter(x => x !== k));
    } else if (selectedKeywords.length < 3) {
      setSelectedKeywords(prev => [...prev, k]);
    }
  };

  return (
    <div className="flex flex-col h-screen p-4 gap-4 relative">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#00ffb4] bg-[rgba(0,20,20,0.8)] relative h-12 flex-shrink-0">
        <h1 className="text-lg tracking-widest text-[#00ffb4] uppercase font-bold">
          Chrono Trickster <span className="text-xs opacity-50 ml-2">// v2.12 HARD</span>
        </h1>
        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#222]">
          <div 
            className="h-full bg-[#ff4ea1] transition-all duration-1000 shadow-[0_0_10px_#ff4ea1]"
            style={{ width: `${(timeLeft / MAX_TIME) * 100}%`, backgroundColor: timeLeft < 10 ? '#ff0055' : '#00ffb4' }}
          />
        </div>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Left: Main View */}
        <div className="flex-[2] flex flex-col cyber-panel relative overflow-hidden">
          {/* Hologram Stage */}
          <div className="h-40 flex items-center justify-center border-b border-[#2d353f] relative overflow-hidden bg-black/20">
            <div className="w-24 h-24 rounded-full hologram-glow relative">
              <div className="absolute w-10 h-12 bg-black top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}></div>
            </div>
            <div className="absolute bottom-2 right-4 text-[10px] text-[#ff4ea1] tracking-tighter">TARGET: 杨玉环 // BIO-SYNC: 88%</div>
          </div>

          {/* Chat Log */}
          <div ref={chatLogRef} className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 text-sm leading-relaxed scroll-smooth">
            {history.map((h, i) => (
              <div 
                key={i} 
                className={`max-w-[90%] p-2 rounded animate-fadeIn ${
                  h.role === 'assistant' ? 'self-start border-l-2 border-[#ff4ea1] bg-[#ff4ea1]/5' : 
                  h.role === 'user' ? 'self-end text-right border-r-2 border-[#00ffb4] bg-[#00ffb4]/5' : 
                  'self-center text-center text-[#00ffb4] text-xs opacity-80 border-none'
                }`}
              >
                {h.name && <div className="text-[10px] font-bold opacity-70 mb-1 uppercase tracking-tighter">{h.name}</div>}
                <div className="whitespace-pre-wrap">{h.content}</div>
              </div>
            ))}
          </div>

          {/* Input Area */}
          <div className="h-16 flex border-t border-[#2d353f] bg-black/40 relative">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isProcessing || !!gameOver}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder={selectedKeywords.length > 0 ? `已选词: ${selectedKeywords.join(', ')} ...` : "生成草案或直接输入..."}
              className="flex-1 bg-transparent border-none px-4 text-sm outline-none text-[#f0f0f0] placeholder:text-[#647078]"
            />
            <button 
              onClick={() => handleSend()}
              disabled={isProcessing || !input.trim() || !!gameOver}
              className="w-24 bg-[#00ffb4] text-black font-bold text-sm hover:bg-white transition-colors disabled:bg-[#333] disabled:text-[#666]"
            >
              发送
            </button>
            {isProcessing && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-[#00ffb4] font-mono text-xs tracking-widest">
                /// 信号加密传输中 ///
              </div>
            )}
          </div>

          {gameOver && (
            <div className="absolute inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-8 text-center animate-fadeIn">
              <h2 className={`text-4xl font-bold mb-4 ${gameOver.victory ? 'text-[#00ffb4]' : 'text-[#ff4ea1]'}`}>
                {gameOver.victory ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}
              </h2>
              <p className="text-white mb-8 max-w-md">{gameOver.reason}</p>
              <button 
                onClick={() => window.location.reload()}
                className={`px-8 py-3 border ${gameOver.victory ? 'border-[#00ffb4] text-[#00ffb4]' : 'border-[#ff4ea1] text-[#ff4ea1]'} hover:bg-white/10 transition-all`}
              >
                RESTART SYSTEM
              </button>
            </div>
          )}
        </div>

        {/* Right: Tactical Panel */}
        <div className="flex-1 flex flex-col gap-4 cyber-panel p-4 min-w-[300px]">
          {/* Keywords Matrix */}
          <div>
            <div className="flex justify-between items-center text-[11px] text-[#647078] border-b border-[#2d353f] pb-1 mb-3">
              <span>KEYWORDS // 语义矩阵</span>
              <span className="text-[#ffcc00]">含干扰项</span>
            </div>
            <div className="flex flex-wrap gap-2 min-h-[80px] content-start">
              {currentKeywords.map((k) => (
                <button
                  key={k}
                  onClick={() => toggleKeyword(k)}
                  className={`px-2 py-1 text-[10px] rounded border transition-all ${
                    selectedKeywords.includes(k) 
                    ? 'bg-[#00ffb4] text-black border-[#00ffb4] shadow-[0_0_8px_#00ffb4]' 
                    : 'bg-[#282d37]/80 text-[#aaa] border-[#444] hover:border-[#00ffb4] hover:text-white'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button 
                onClick={() => { setSuspicion(s => Math.min(100, s+15)); refreshKeywords(); }}
                className="flex-1 p-2 border border-[#647078] text-[#647078] text-[10px] rounded hover:border-white hover:text-white transition-all"
              >
                ⟳ 刷新 (怀疑+15%)
              </button>
              <button 
                onClick={handleDraft}
                disabled={selectedKeywords.length === 0 || isProcessing}
                className="flex-1 p-2 border border-[#00ffb4] text-[#00ffb4] text-[10px] rounded hover:bg-[#00ffb4]/10 transition-all disabled:opacity-30"
              >
                ⚡ 生成草稿
              </button>
            </div>
          </div>

          {/* Status Monitoring */}
          <div className="flex flex-col gap-4 mt-2">
            <div className="text-[11px] text-[#647078] border-b border-[#2d353f] pb-1">STATUS // 状态监测</div>
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] uppercase font-bold">
                  <span className="text-[#ff4ea1]">Suspicion (怀疑)</span>
                  <span>{suspicion}%</span>
                </div>
                <div className="h-1 bg-[#222] rounded-full overflow-hidden">
                  <div 
                    className="h-full transition-all duration-500" 
                    style={{ width: `${suspicion}%`, backgroundColor: suspicion > 60 ? '#ff4ea1' : '#00ffb4' }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] uppercase font-bold">
                  <span className="text-[#00ffb4]">Inception (进度)</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1 bg-[#222] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[#ffcc00] transition-all duration-500" 
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Analysis Log */}
          <div className="flex-1 flex flex-col min-h-0 mt-2">
            <div className="text-[11px] text-[#647078] border-b border-[#2d353f] pb-1 mb-2">AI ANALYSIS // 裁判日志</div>
            <div className="flex-1 overflow-y-auto bg-black/30 p-2 text-[10px] font-mono leading-relaxed text-gray-400">
              {analysisHistory.length === 0 ? "等待行为输入..." : analysisHistory.map((a, i) => (
                <div key={i} className="mb-4 pb-2 border-b border-white/5 last:border-none animate-fadeIn">
                  <p className="text-white mb-1">[{a.npc_state}] {a.reason}</p>
                  <div className="flex gap-4">
                    <span className={a.suspicion_change > 0 ? 'text-[#ff4ea1]' : 'text-[#00ffb4]'}>
                      怀疑 {a.suspicion_change > 0 ? '+' : ''}{a.suspicion_change}%
                    </span>
                    <span className={a.progress_change > 0 ? 'text-[#00ffb4]' : 'text-gray-600'}>
                      进度 {a.progress_change > 0 ? '+' : ''}{a.progress_change}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
