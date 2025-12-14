const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

// --- GLOBAL DATA ---
const defaultTopics = [
    { id: 't1', prompt: "Rank these Weekend Activities:", options: ["Netflix Binge", "Clubbing", "Hiking", "Gaming", "Sleep"] },
    { id: 't2', prompt: "Rank these 'Red Flags':", options: ["Chews Loudly", "Rude to Waiter", "Talks About Ex", "Bad Texter", "Always Late"] },
    { id: 't3', prompt: "Rank these Superpowers:", options: ["Invisibility", "Flight", "Telepathy", "Strength", "Time Travel"] },
    { id: 't4', prompt: "Rank these Fast Food chains:", options: ["McDonald's", "KFC", "Subway", "Domino's", "Taco Bell"] },
    { id: 't5', prompt: "Rank these Movie Genres:", options: ["Horror", "Rom-Com", "Sci-Fi", "Action", "Documentary"] }
];

let rooms = {}; 

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

io.on('connection', (socket) => {

    // 1. CREATE ROOM
    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            players: {},
            answers: {},
            phase: 'LOBBY',
            hostId: socket.id,
            settings: { rounds: 5, timer: 60 },
            currentRound: 0,
            playerDeck: [], 
            matchHistory: {}, 
            timerInterval: null
        };
        joinRoomLogic(socket, roomCode, playerName);
    });

    // 2. JOIN ROOM
    socket.on('joinRoom', ({ playerName, roomCode }) => {
        const code = roomCode.toUpperCase();
        if (!rooms[code]) return socket.emit('errorMsg', "Room not found!");
        if (rooms[code].phase !== 'LOBBY') return socket.emit('errorMsg', "Game already started!");
        joinRoomLogic(socket, code, playerName);
    });

    function joinRoomLogic(socket, code, playerName) {
        socket.join(code);
        socket.data.roomCode = code;
        socket.data.name = playerName;

        const room = rooms[code];
        room.players[socket.id] = {
            id: socket.id,
            name: playerName,
            score: 0,
            avatar: playerName.charAt(0).toUpperCase(),
            isHost: (socket.id === room.hostId)
        };
        
        if (!room.matchHistory[socket.id]) room.matchHistory[socket.id] = {};
        io.to(code).emit('updateState', sanitizeState(code));
    }

    // 3. START GAME
    socket.on('startGame', (settings) => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || socket.id !== room.hostId) return;

        if (Object.keys(room.players).length < 3) {
            socket.emit('errorMsg', "Need at least 3 players to start!");
            return;
        }

        room.settings = settings;
        room.currentRound = 0;
        refillDeck(room);
        startNewRound(code);
    });

    function refillDeck(room) {
        let ids = Object.keys(room.players);
        ids.sort(() => Math.random() - 0.5);
        room.playerDeck = ids;
    }

    function startNewRound(code) {
        const room = rooms[code];
        if (room.currentRound >= room.settings.rounds) {
            endGame(code);
            return;
        }

        room.currentRound++;
        room.phase = 'SELECTION';
        room.answers = {};
        
        if (room.playerDeck.length === 0) refillDeck(room);
        room.spotlightId = room.playerDeck.pop();

        io.to(code).emit('goToSelection', {
            spotlightId: room.spotlightId,
            spotlightName: room.players[room.spotlightId].name,
            topics: defaultTopics,
            roundInfo: `${room.currentRound}/${room.settings.rounds}`
        });
        io.to(code).emit('updateState', sanitizeState(code));
    }

    // 4. SUBMIT TOPIC (Starts Timer)
    socket.on('submitTopic', (data) => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || socket.id !== room.spotlightId) return;

        if (data.type === 'PREMADE') {
            room.currentQuestion = defaultTopics.find(t => t.id === data.id);
        } else {
            room.currentQuestion = { prompt: data.prompt, options: data.options };
        }

        room.phase = 'PLAYING';
        room.answers = {};

        let timeLeft = parseInt(room.settings.timer);
        
        io.to(code).emit('roundStart', {
            question: room.currentQuestion,
            spotlightName: room.players[room.spotlightId].name,
            duration: timeLeft
        });

        if (room.timerInterval) clearInterval(room.timerInterval);
        
        room.timerInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= -2) { 
                clearInterval(room.timerInterval);
                calculateScores(code);
            }
        }, 1000);
    });

    // 5. SUBMIT ANSWER
    socket.on('submitRank', (rank) => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room) return;
        
        room.answers[socket.id] = rank;
        
        if (Object.keys(room.answers).length === Object.keys(room.players).length) {
            clearInterval(room.timerInterval);
            calculateScores(code);
        }
    });

    // 6. SCORING
    function calculateScores(code) {
        const room = rooms[code];
        const correctOrder = room.answers[room.spotlightId];

        if (!correctOrder) {
            io.to(code).emit('errorMsg', "Spotlight didn't answer! Skipping.");
            startNewRound(code);
            return;
        }

        let roundResults = [];

        for (let pid in room.players) {
            if (pid === room.spotlightId) continue;
            
            let score = 0;
            const pRank = room.answers[pid] || [];
            
            pRank.forEach((item, index) => {
                if (item === correctOrder[index]) score += 10;
            });

            room.players[pid].score += score;
            
            if (!room.matchHistory[pid]) room.matchHistory[pid] = {};
            if (!room.matchHistory[pid][room.spotlightId]) room.matchHistory[pid][room.spotlightId] = 0;
            room.matchHistory[pid][room.spotlightId] += score;

            roundResults.push({ 
                name: room.players[pid].name, 
                points: score,
                rank: pRank, // SEND THE FULL RANK
                id: pid 
            });
        }

        room.phase = 'RESULTS';
        io.to(code).emit('roundOver', {
            results: roundResults,
            correctOrder: correctOrder,
            spotlightName: room.players[room.spotlightId].name
        });
    }

    socket.on('nextRound', () => {
        const code = socket.data.roomCode;
        if(rooms[code] && socket.id === rooms[code].hostId) startNewRound(code);
    });

    function endGame(code) {
        const room = rooms[code];
        room.phase = 'GAMEOVER';
        const sortedPlayers = Object.values(room.players).sort((a,b) => b.score - a.score);
        
        let bestPair = { names: "No Data", score: -1 };
        let worstPair = { names: "No Data", score: 9999 };

        for (let guesserId in room.matchHistory) {
            for (let targetId in room.matchHistory[guesserId]) {
                const points = room.matchHistory[guesserId][targetId];
                if (points > bestPair.score) bestPair = { names: `${room.players[guesserId].name} & ${room.players[targetId].name}`, score: points };
                if (points < worstPair.score) worstPair = { names: `${room.players[guesserId].name} & ${room.players[targetId].name}`, score: points };
            }
        }
        
        if (worstPair.score === 9999) worstPair = { names: "None", score: 0 };

        io.to(code).emit('gameOver', {
            winner: sortedPlayers[0],
            leaderboard: sortedPlayers,
            soulmates: bestPair,
            strangers: worstPair
        });
    }

    socket.on('disconnect', () => {
        const code = socket.data.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        
        delete room.players[socket.id];
        delete room.answers[socket.id];

        if (Object.keys(room.players).length === 0) {
            delete rooms[code];
        } else {
            if (socket.id === room.hostId) {
                room.hostId = Object.keys(room.players)[0];
                room.players[room.hostId].isHost = true;
            }
            io.to(code).emit('updateState', sanitizeState(code));
        }
    });
});

function sanitizeState(code) {
    const room = rooms[code];
    return { roomCode: code, players: Object.values(room.players), hostId: room.hostId, phase: room.phase };
}

const PORT = process.env.PORT || 3000; // This allows the cloud to set the port
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));