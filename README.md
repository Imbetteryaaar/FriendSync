FriendSync
Hi, I'm Gaurav. This is FriendSync, a real-time multiplayer web game I built to practice my coding skills, learn how real-time communication works between browsers and servers and cause I was bored.

I wanted to create something fun that I could actually play with my friends cause I always saw my friends having only chameleon to play and it got pretty boring for me as I am too good at it. The concept is similar to party games like SIDEMEN play (ifykyk). The main idea is simple: one player (the Spotlight) ranks a list of items - like "Best Pizza Toppings" or "Worst Chores" and everyone else has to guess the exact order the Spotlight player chose.

It started as a small experiment to understand Socket.io, but I ended up adding a lot of features to make it a complete game experience.

How it Works
You create a room and get a code to share with friends.

Once the game starts, one person is randomly chosen as the Spotlight.

They pick a topic and rank the options from best to worst.

Everyone else tries to guess that specific order on their own screens.

You get points based on how many items you placed in the correct slot.

At the end, the game calculates who won, who are "Best Friends" (most compatible answers), and who are "Strangers" (least compatible).

Technologies Used
I built this using the MEAN stack concepts, though it focuses heavily on Node.js for the backend logic.

Node.js & Express: Used for the backend server to handle game rooms and serving the files.

Socket.io: This is the core technology powering the game. It handles all the real-time events, like when a player joins, moves an item in a list, or disconnects.

HTML & CSS: I utilized vanilla CSS for the "felt/paper" aesthetic and responsive design so it works on phones.

Vanilla JavaScript: The client-side logic is all standard JavaScript without heavy frameworks like React, which helped me understand the basics of DOM manipulation better.

SortableJS: A library I used to make the drag-and-drop ranking feel smooth on both mobile and desktop.

Canvas Confetti: Used for the celebration effects at the end of the game.

Key Features I Implemented
Real-Time Synchronization: The game updates instantly for everyone. If the host changes a setting, everyone sees it.

Reconnection Logic: One of the hardest parts was handling disconnects. I wrote logic so that if a player closes their tab or loses internet in the middle of a game, they can rejoin with the same username and the server will restore their score and put them right back on the correct screen.

Custom Topic Creator: I added a feature that lets users create their own ranking lists on the fly, including uploading images for the options.

Dynamic Scoring: The game tracks compatibility scores between every pair of players to determine the "Best Friends" stat at the end.

How to Run This Project
If you want to try this code out on your own machine, you need to have Node.js installed.

Clone or download this repository.

Open your terminal in the project folder.

Run the command "npm install" to download the necessary packages (Express and Socket.io).

Run the command "node server.js" to start the server.

Open your web browser and go to localhost:3000.

OR IF YOU WANNA PLAY THIS GAME WITH YOUR FRIENDS ON MOBILE OR PC OR TAB:
https://friendsync-egks.onrender.com/
I aint paying for hosting service if anyone got any tips any help would be appreciated!

Some AI was used to generate local topics teenagers would love to choose.
