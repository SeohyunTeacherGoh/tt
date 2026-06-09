/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, signInAnonymously } from 'firebase/auth';
import { collection, query, orderBy, limit, getDocs, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { handleFirestoreError, OperationType } from './lib/error';

interface ScoreEntry {
  id: string;
  uid: string;
  playerName: string;
  score: number;
  createdAt: any;
}

const GAME_WIDTH = 600;
const GAME_HEIGHT = 600;
const PLAYER_SPEED = 7;
const BULLET_SPEED = 10;
const ENEMY_SPEED = 3;
const ENEMY_SPAWN_RATE = 1000; // ms

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start');
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [guestName, setGuestName] = useState('Guest');
  const [isScoreSaved, setIsScoreSaved] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  
  // Game Entities
  const playerRef = useRef({ x: GAME_WIDTH / 2 - 15, y: GAME_HEIGHT - 50, width: 30, height: 30 });
  const bulletsRef = useRef<Array<{ x: number, y: number }>>([]);
  const enemiesRef = useRef<Array<{ x: number, y: number, width: number, height: number }>>([]);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const lastEnemySpawn = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    fetchLeaderboard();
    return () => unsubscribe();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(10));
      const querySnapshot = await getDocs(q);
      const scores = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScoreEntry));
      setLeaderboard(scores);
    } catch (error) {
      // Missing or insufficient permissions error might happen if offline, handle it softly.
      try {
        handleFirestoreError(error, OperationType.LIST, 'leaderboard');
      } catch (e) {
        console.error(e);
      }
    }
  };

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const saveScore = async () => {
    let currentUser = user;
    if (!currentUser) {
      try {
        const cred = await signInAnonymously(auth);
        currentUser = cred.user;
      } catch (e) {
        console.error(e);
        return;
      }
    }
    try {
      // Score documents must have exactly uid, playerName, score, createdAt.
      // ID MUST match ^[a-zA-Z0-9_\\-]+$ 
      const scoreId = `score_${Date.now()}_${Math.floor(Math.random()*1000)}`;
      await setDoc(doc(db, 'leaderboard', scoreId), {
        uid: currentUser.uid,
        playerName: currentUser.displayName || guestName || 'Anonymous',
        score: score,
        createdAt: serverTimestamp()
      });
      setIsScoreSaved(true);
      fetchLeaderboard();
    } catch (error) {
       handleFirestoreError(error, OperationType.CREATE, 'leaderboard');
    }
  };

  const startGame = () => {
    setScore(0);
    setIsScoreSaved(false);
    playerRef.current = { x: GAME_WIDTH / 2 - 15, y: GAME_HEIGHT - 50, width: 30, height: 30 };
    bulletsRef.current = [];
    enemiesRef.current = [];
    setGameState('playing');
  };

  const gameOver = () => {
    setGameState('gameover');
    if (user && score > 0) {
      saveScore();
    }
  };

  const updateGame = (time: number) => {
    if (gameState !== 'playing') return;

    if (keysRef.current['ArrowLeft'] && playerRef.current.x > 0) {
      playerRef.current.x -= PLAYER_SPEED;
    }
    if (keysRef.current['ArrowRight'] && playerRef.current.x < GAME_WIDTH - playerRef.current.width) {
      playerRef.current.x += PLAYER_SPEED;
    }

    bulletsRef.current = bulletsRef.current.filter(b => b.y > 0);
    bulletsRef.current.forEach(b => b.y -= BULLET_SPEED);

    if (time - lastEnemySpawn.current > ENEMY_SPAWN_RATE) {
      enemiesRef.current.push({
        x: Math.random() * (GAME_WIDTH - 30),
        y: 0,
        width: 30,
        height: 30
      });
      lastEnemySpawn.current = time;
    }

    enemiesRef.current.forEach(e => e.y += ENEMY_SPEED);

    for (let i = enemiesRef.current.length - 1; i >= 0; i--) {
      const e = enemiesRef.current[i];
      if (e.y > GAME_HEIGHT) {
        gameOver();
        return;
      }
      for (let j = bulletsRef.current.length - 1; j >= 0; j--) {
        const b = bulletsRef.current[j];
        if (
          b.x >= e.x && b.x <= e.x + e.width &&
          b.y >= e.y && b.y <= e.y + e.height
        ) {
          enemiesRef.current.splice(i, 1);
          bulletsRef.current.splice(j, 1);
          setScore(s => s + 10);
          break;
        }
      }
    }
  };

  const drawGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#06b6d4';
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
    ctx.fillRect(playerRef.current.x, playerRef.current.y, playerRef.current.width, playerRef.current.height);

    ctx.fillStyle = '#f43f5e';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(244, 63, 94, 0.4)';
    enemiesRef.current.forEach(e => {
      ctx.fillRect(e.x, e.y, e.width, e.height);
    });

    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ffffff';
    bulletsRef.current.forEach(b => {
      ctx.fillRect(b.x - 2, b.y - 10, 4, 10);
    });
    
    ctx.shadowBlur = 0;
  };

  const gameLoop = (time: number) => {
    if (gameState === 'playing') {
      updateGame(time);
      drawGame();
      requestRef.current = requestAnimationFrame(gameLoop);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key] = true;
      if (e.key === ' ' && gameState === 'playing') {
        bulletsRef.current.push({
          x: playerRef.current.x + playerRef.current.width / 2,
          y: playerRef.current.y
        });
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [gameState, score]); // score is needed because drawGame reads it directly

  return (
    <div className="h-screen bg-zinc-950 text-white font-sans flex flex-col relative overflow-hidden">
      {/* Background Grid Effect */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

      {/* Top HUD */}
      <header className="relative z-10 flex flex-col md:flex-row justify-between items-start p-6 md:p-8 shrink-0">
        <div className="flex flex-col">
          <span className="text-xs font-black tracking-widest text-cyan-400 uppercase">Session Active</span>
          <h1 className="text-6xl md:text-8xl font-black italic leading-none tracking-tighter hover:text-cyan-400 transition-colors">NEON<br/>STRIKE</h1>
        </div>
        
        <div className="flex gap-12 text-right mt-4 md:mt-0">
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Current Score</p>
            <p className="text-4xl md:text-6xl font-black text-white leading-none">{score}</p>
          </div>
          <div className="flex flex-col justify-end gap-2 min-w-[120px]">
            {user ? (
              <div className="flex flex-col items-end gap-2">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest truncate max-w-[120px]">OP: {user.displayName}</span>
                <button onClick={logout} className="px-4 py-1.5 text-[10px] font-black border border-zinc-800 bg-zinc-900 rounded-sm hover:bg-zinc-800 hover:text-cyan-400 transition uppercase tracking-widest text-zinc-300">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Guest Mode</span>
                <button onClick={login} className="px-3 py-1.5 text-[10px] font-black bg-cyan-500 text-black rounded-sm hover:bg-cyan-400 transition uppercase tracking-widest">
                  Auth / Google
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Game Viewport Area */}
      <main className="relative flex-1 mx-4 md:mx-8 mb-4 border border-zinc-800 bg-zinc-900/50 flex flex-col md:flex-row items-center justify-center overflow-hidden shrink-0 min-h-0">
        
        {/* Game Canvas Container */}
        <div className="relative w-full max-w-[600px] h-[600px] flex-1">
          {(gameState === 'start' || gameState === 'gameover') && (
            <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center z-20 backdrop-blur-md rounded-sm border border-zinc-800">
              <h2 className="text-4xl font-black italic tracking-tighter mb-4 text-white uppercase text-center">{gameState === 'gameover' ? 'System\nFailure' : 'Ready?'}</h2>
              {gameState === 'gameover' && <p className="mb-6 text-xl font-bold font-mono text-cyan-400">SCORE: {score}</p>}
              {!user && gameState === 'gameover' && score > 0 && (
                <div className="mb-6 flex flex-col items-center gap-3 w-full max-w-[240px]">
                  {!isScoreSaved ? (
                    <>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">Enter callsign to sync score</p>
                      <input 
                        type="text" 
                        value={guestName} 
                        onChange={(e) => setGuestName(e.target.value.substring(0, 15))} 
                        placeholder="CALLSIGN" 
                        className="bg-zinc-900 border border-zinc-700 text-cyan-400 font-mono font-bold text-center px-4 py-2 uppercase outline-none focus:border-cyan-500 transition w-full"
                      />
                      <button onClick={saveScore} className="w-full px-4 py-2 text-xs font-black tracking-widest uppercase bg-cyan-500 border border-cyan-400 hover:bg-cyan-400 text-black transition shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                        Sync Score
                      </button>
                    </>
                  ) : (
                    <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest text-center px-4 py-2 border border-emerald-900 bg-emerald-500/10 w-full">Score Synced</p>
                  )}
                </div>
              )}
              <button 
                onClick={startGame}
                className="px-6 py-3 bg-white text-black font-black uppercase tracking-tighter text-lg hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.6)] transition"
              >
                {gameState === 'gameover' ? 'Reboot System' : 'Engage'}
              </button>
              <p className="mt-8 text-[9px] font-bold text-zinc-500 uppercase tracking-widest text-center px-2">Arrows to move // Space to blast</p>
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={GAME_WIDTH}
            height={GAME_HEIGHT}
            className="block bg-zinc-950 rounded-sm border border-zinc-800 shadow-[0_0_30px_rgba(0,0,0,0.8)] z-10 w-full h-full object-contain"
          />
        </div>
        
        {/* Leaderboard Overlay */}
        <aside className="absolute right-0 top-0 bottom-0 w-full md:w-80 bg-zinc-950/90 md:bg-zinc-950/80 backdrop-blur-md md:border-l border-zinc-800 p-6 flex flex-col z-30 md:z-10 h-full overflow-y-auto mt-4 md:mt-0 transition-opacity transform md:translate-x-0 hidden md:flex">
          <div className="flex items-center gap-2 mb-6 shrink-0">
            <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
            <h2 className="text-sm font-black uppercase tracking-widest">Firestore Live</h2>
            <button onClick={fetchLeaderboard} className="ml-auto text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-cyan-400 transition">[ Sync ]</button>
          </div>
          
          <div className="space-y-4">
            {leaderboard.length === 0 ? (
               <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">No entries found</div>
            ) : (
              leaderboard.map((entry, idx) => (
                <div key={entry.id} className="flex justify-between items-end border-b border-zinc-800 pb-2">
                  <span className={`text-xs font-bold uppercase truncate max-w-[140px] ${idx === 0 ? 'text-cyan-400' : 'text-zinc-500'}`}>
                    {String(idx + 1).padStart(2, '0')}. {entry.playerName}
                  </span>
                  <span className="font-mono font-bold text-lg text-white">{entry.score}</span>
                </div>
              ))
            )}
            
            <div className="mt-4 p-3 bg-zinc-900 border border-zinc-800 rounded-sm text-[10px] font-bold font-mono text-zinc-500 leading-tight uppercase">
              &gt; Syncing scores via Cloud Firestore.<br/>&gt; Rules enforced.
            </div>
          </div>
        </aside>
      </main>

      {/* Mobile Leaderboard Toggle (Optional / Simplified) */}
      <div className="md:hidden flex flex-col p-4 bg-zinc-950 border-t border-zinc-800 shrink-0">
        <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">Top Player</h3>
        {leaderboard.length > 0 ? (
          <div className="flex justify-between items-end">
            <span className="text-sm font-bold uppercase text-cyan-400 truncate max-w-[140px]">{leaderboard[0].playerName}</span>
            <span className="font-mono font-bold text-lg text-white">{leaderboard[0].score}</span>
          </div>
        ) : (
            <span className="text-xs font-bold uppercase text-zinc-600">No stats available</span>
        )}
      </div>

      {/* Footer Controls */}
      <footer className="h-20 md:h-24 bg-zinc-950 border-t border-zinc-800 flex items-center px-4 md:px-8 justify-between shrink-0 z-20 hidden md:flex">
        <div className="flex gap-8 items-center">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Weapon System</span>
            <span className="text-lg md:text-xl font-black text-white italic tracking-tighter">PLASMA_CANNON [V2]</span>
          </div>
          <div className="h-8 w-px bg-zinc-800"></div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Shield Status</span>
            <div className="flex gap-1 mt-1">
               <div className="w-4 h-3 bg-cyan-500"></div>
               <div className="w-4 h-3 bg-cyan-500"></div>
               <div className="w-4 h-3 bg-cyan-500"></div>
               <div className="w-4 h-3 bg-zinc-800"></div>
               <div className="w-4 h-3 bg-zinc-800"></div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none">DB Status</p>
            <p className="text-sm font-bold text-emerald-500 leading-none mt-2 uppercase tracking-wide">FIRESTORE_CONNECTED</p>
          </div>
          <div className="px-6 py-2 border border-zinc-800 bg-zinc-900 text-zinc-400 font-black text-xs uppercase tracking-widest hidden lg:block">
            SYS_READY
          </div>
        </div>
      </footer>
    </div>
  );
}

