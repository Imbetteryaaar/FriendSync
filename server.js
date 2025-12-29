const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const defaultTopics = [
    { id: 't1', prompt: "Weekend Activities:", options: ["Netflix Binge", "Clubbing", "Hiking", "Gaming", "Sleeping In"] },
    { id: 't2', prompt: "Dating Red Flags:", options: ["Chews Loudly", "Rude to Waiter", "Talks About Ex", "Bad Texter", "Always Late"] },
    { id: 't3', prompt: "Best Superpowers:", options: ["Invisibility", "Flight", "Telepathy", "Strength", "Time Travel"] },
    { id: 't4', prompt: "Fast Food:", options: ["McDonald's", "KFC", "Subway", "Domino's", "Taco Bell"] },
    { id: 't5', prompt: "Movie Genres:", options: ["Horror", "Rom-Com", "Sci-Fi", "Action", "Documentary"] },
    { id: 't6', prompt: "Worst Date Spots:", options: ["The Movies", "Gym", "Parent's House", "Fast Food", "Graveyard"] },
    { id: 't7', prompt: "Scariest Things:", options: ["Spiders", "Heights", "Clowns", "The Future", "Snakes"] },
    { id: 't8', prompt: "Best Pizza Toppings:", options: ["Pepperoni", "Mushrooms", "Pineapple", "Extra Cheese", "Onions"] }
];

let rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode, players: {}, answers: {}, phase: 'LOBBY', hostId: socket.id,
            settings: { rounds: 5, timer: 60 }, currentRound: 0, playerDeck: [], matchHistory: {}, timerInterval: null,
            startTime: 0 // Added to track time for reconnections
        };
        joinRoomLogic(socket, roomCode, playerName);
    });

    socket.on('joinRoom', ({ playerName, roomCode }) => {
        const code = roomCode.toUpperCase();
        if (!rooms[code]) return socket.emit('errorMsg', "Room not found!");
        joinRoomLogic(socket, code, playerName);
    });

    function joinRoomLogic(socket, code, playerName) {
        const room = rooms[code];

        // --- RECONNECTION LOGIC START ---
        // Check if this player exists but is disconnected (by name)
        const existingId = Object.keys(room.players).find(id => room.players[id].name === playerName);

        if (existingId) {
            // PERFORM IDENTITY SWAP (Old Socket ID -> New Socket ID)
            const oldData = room.players[existingId];
            
            // 1. Update Player Object
            room.players[socket.id] = { ...oldData, id: socket.id, connected: true };
            delete room.players[existingId];

            // 2. Update Host/Spotlight Pointers
            if (room.hostId === existingId) room.hostId = socket.id;
            if (room.spotlightId === existingId) room.spotlightId = socket.id;

            // 3. Update Match History Keys
            if (room.matchHistory[existingId]) {
                room.matchHistory[socket.id] = room.matchHistory[existingId];
                delete room.matchHistory[existingId];
            }
            for (let otherId in room.matchHistory) {
                if (room.matchHistory[otherId][existingId]) {
                    room.matchHistory[otherId][socket.id] = room.matchHistory[otherId][existingId];
                    delete room.matchHistory[otherId][existingId];
                }
            }

            // 4. Update Answers Key
            if (room.answers[existingId]) {
                room.answers[socket.id] = room.answers[existingId];
                delete room.answers[existingId];
            }

            // 5. Update Deck
            const deckIdx = room.playerDeck.indexOf(existingId);
            if (deckIdx !== -1) room.playerDeck[deckIdx] = socket.id;

            // Join the socket room
            socket.join(code);
            socket.data.roomCode = code;

            // --- SYNC STATE TO RECONNECTED PLAYER ---
            io.to(code).emit('updateState', sanitizeState(code)); // Update list for everyone

            if (room.phase === 'SELECTION') {
                socket.emit('goToSelection', {
                    spotlightId: room.spotlightId, spotlightName: room.players[room.spotlightId].name,
                    topics: defaultTopics.slice(0, 6),
                    roundInfo: `${room.currentRound}/${room.settings.rounds}`
                });
            } else if (room.phase === 'PLAYING') {
                const elapsed = Math.floor((Date.now() - room.startTime) / 1000);
                const remaining = Math.max(0, parseInt(room.settings.timer) - elapsed);
                socket.emit('roundStart', {
                    question: room.currentQuestion,
                    spotlightName: room.players[room.spotlightId].name,
                    duration: remaining
                });
            } else if (room.phase === 'RESULTS' && room.lastResultData) {
                socket.emit('roundOver', room.lastResultData);
            }
            return;
        }
        // --- RECONNECTION LOGIC END ---

        // Normal Join checks
        if (room.phase !== 'LOBBY') return socket.emit('errorMsg', "Game in progress!");

        socket.join(code);
        socket.data.roomCode = code;
        room.players[socket.id] = {
            id: socket.id, name: playerName, score: 0,
            avatar: playerName.charAt(0).toUpperCase(), isHost: (socket.id === room.hostId),
            connected: true
        };
        if (!room.matchHistory[socket.id]) room.matchHistory[socket.id] = {};
        io.to(code).emit('updateState', sanitizeState(code));
    }

    socket.on('startGame', (settings) => {
        const room = rooms[socket.data.roomCode];
        if (!room || socket.id !== room.hostId) return;
        if (Object.keys(room.players).length < 2) return socket.emit('errorMsg', "Need atleast 2 players!");
        room.settings = settings;
        room.currentRound = 0;
        refillDeck(room);
        startNewRound(socket.data.roomCode);
    });

    function refillDeck(room) {
        room.playerDeck = Object.keys(room.players).sort(() => Math.random() - 0.5);
    }

    function startNewRound(code) {
        const room = rooms[code];
        if (!room) return;
        if (room.currentRound >= room.settings.rounds) return endGame(code);

        room.currentRound++;
        room.phase = 'SELECTION';
        room.answers = {};
        
        // Filter deck to ensure we don't pick disconnected players as spotlight
        if (room.playerDeck.length === 0) refillDeck(room);
        
        // Remove disconnected players from deck consideration for this turn
        room.playerDeck = room.playerDeck.filter(pid => room.players[pid] && room.players[pid].connected);
        
        if (room.playerDeck.length === 0) {
            // If everyone disconnected, try refilling or just wait
            refillDeck(room);
            if (room.playerDeck.length === 0) return; // Should not happen unless 0 players
        }

        room.spotlightId = room.playerDeck.pop();

        // Safety: If spotlight missing/disconnected (race condition), retry
        if (!room.players[room.spotlightId] || !room.players[room.spotlightId].connected) {
            room.currentRound--;
            return startNewRound(code);
        }

        io.to(code).emit('goToSelection', {
            spotlightId: room.spotlightId, spotlightName: room.players[room.spotlightId].name,
            topics: defaultTopics.sort(() => 0.5 - Math.random()).slice(0, 6),
            roundInfo: `${room.currentRound}/${room.settings.rounds}`
        });
        io.to(code).emit('updateState', sanitizeState(code));
    }

    socket.on('submitTopic', (data) => {
        const room = rooms[socket.data.roomCode];
        if (!room || socket.id !== room.spotlightId) return;
        room.currentQuestion = (data.type === 'PREMADE') ? defaultTopics.find(t => t.id === data.id) : { prompt: data.prompt, options: data.options };
        room.phase = 'PLAYING';
        room.answers = {};
        room.startTime = Date.now(); // Record start time

        let timeLeft = parseInt(room.settings.timer);
        io.to(room.code).emit('roundStart', { question: room.currentQuestion, spotlightName: room.players[room.spotlightId].name, duration: timeLeft });
        if (room.timerInterval) clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= -2) { clearInterval(room.timerInterval); calculateScores(room.code); }
        }, 1000);
    });

    socket.on('submitRank', (rank) => {
        const room = rooms[socket.data.roomCode];
        if (room) {
            room.answers[socket.id] = rank;
            
            // Fix: Count only CONNECTED players
            const connectedCount = Object.values(room.players).filter(p => p.connected).length;
            
            if (Object.keys(room.answers).length >= connectedCount) {
                clearInterval(room.timerInterval);
                calculateScores(socket.data.roomCode);
            }
        }
    });

    function calculateScores(code) {
        const room = rooms[code];
        if (!room) return;
        const correctOrder = room.answers[room.spotlightId];
        
        // If spotlight disconnected/didn't answer, skip round
        if (!correctOrder) return startNewRound(code);

        let roundResults = [];
        for (let pid in room.players) {
            if (pid === room.spotlightId) continue;
            // Skip scoring for disconnected players who didn't answer
            if (!room.players[pid].connected && !room.answers[pid]) continue;

            let score = 0;
            const pRank = room.answers[pid] || [];
            pRank.forEach((item, index) => { if (item.text === correctOrder[index].text) score += 10; });
            room.players[pid].score += score;
            
            if (!room.matchHistory[pid]) room.matchHistory[pid] = {};
            if (!room.matchHistory[pid][room.spotlightId]) room.matchHistory[pid][room.spotlightId] = 0;
            room.matchHistory[pid][room.spotlightId] += score;
            
            roundResults.push({ name: room.players[pid].name, points: score, id: pid, rank: pRank });
        }
        room.phase = 'RESULTS';
        // Cache results for reconnecting players
        room.lastResultData = { results: roundResults, correctOrder, spotlightName: room.players[room.spotlightId].name };
        
        io.to(code).emit('roundOver', room.lastResultData);
    }

    socket.on('nextRound', () => {
        const code = socket.data.roomCode;
        if(rooms[code] && socket.id === rooms[code].hostId) startNewRound(code);
    });

    socket.on('playAgain', () => {
        const room = rooms[socket.data.roomCode];
        if (!room || socket.id !== room.hostId) return;
        room.currentRound = 0; room.phase = 'LOBBY';
        room.playerDeck = [];
        for (let pid in room.players) { room.players[pid].score = 0; room.matchHistory[pid] = {}; }
        io.to(room.code).emit('updateState', sanitizeState(room.code));
    });

    socket.on('endRoom', () => {
        const room = rooms[socket.data.roomCode];
        if (!room || socket.id !== room.hostId) return;
        io.to(room.code).emit('roomDestroyed');
        delete rooms[room.code];
    });

    function endGame(code) {
        const room = rooms[code];
        room.phase = 'GAMEOVER';
        const sorted = Object.values(room.players).sort((a,b) => b.score - a.score);

        let bp = { names: "None", score: -1 }; 
        let wp = { names: "None", score: 9999 };

        for (let g in room.matchHistory) {
            for (let t in room.matchHistory[g]) {
                if (!room.players[g] || !room.players[t]) continue;
                
                const pts = room.matchHistory[g][t];
                if (pts > bp.score) bp = { names: `${room.players[g].name} & ${room.players[t].name}`, score: pts };
                if (pts < wp.score && pts > 0) wp = { names: `${room.players[g].name} & ${room.players[t].name}`, score: pts };
            }
        }
        
        if (wp.score === 9999) wp = { names: "None", score: 0 };

        io.to(code).emit('gameOver', { winner: sorted[0], leaderboard: sorted, soulmates: bp, strangers: wp });
    }

    socket.on('disconnect', () => {
        const code = socket.data.roomCode;
        if (!rooms[code]) return;
        const room = rooms[code];
        
        // Fix: If in lobby, delete. If in game, mark connected=false.
        if (room.phase === 'LOBBY') {
            delete room.players[socket.id];
            if (Object.keys(room.players).length === 0) delete rooms[code];
            else {
                if (socket.id === room.hostId) { room.hostId = Object.keys(room.players)[0]; room.players[room.hostId].isHost = true; }
                io.to(code).emit('updateState', sanitizeState(code));
            }
        } else {
            // Mid-game: Mark disconnected
            if (room.players[socket.id]) {
                room.players[socket.id].connected = false;
            }
            io.to(code).emit('updateState', sanitizeState(code));
        }
    });
});

function sanitizeState(code) {
    const r = rooms[code];
    return { roomCode: code, players: Object.values(r.players), hostId: r.hostId, phase: r.phase };
}

server.listen(process.env.PORT || 3000);