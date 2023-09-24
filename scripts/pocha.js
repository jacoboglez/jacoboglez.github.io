// Define the players array in the global scope
const players = []; // Array to store player objects
const roundScores = []; // Array to store round scores
const roundScoresList = document.getElementById('roundScores');
var roundNumber = 0;
const playerList = document.getElementById('playerList');

document.addEventListener('DOMContentLoaded', function () {
    // Load players from cookies
    const savedPlayers = getCookie('players');
    if (savedPlayers) {
        players.push(...JSON.parse(savedPlayers));
        // Update the player list
        players.forEach(player => {
            const listItem = createPlayerListItem(player);
            playerList.appendChild(listItem);
        });
    }

    // Load round scores from cookies
    const savedRoundScores = getCookie('roundScores');
    if (savedRoundScores) {
        roundScores.push(...JSON.parse(savedRoundScores));
        // Update the round scores list
        roundScores.forEach((roundScore, roundIndex) => {
            displayRoundScores(roundScore, roundIndex + 1);
        });
    }

    // Get references to HTML elements
    const playerNameInput = document.getElementById('playerName');
    const addPlayerButton = document.getElementById('addPlayer');
    const finishRoundButton = document.getElementById('finishRound');
    
    

    // Event listener for the "Add Player" button
    addPlayerButton.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();

        if (playerName) {
            // Calculate the lowest score among existing players
            if (players.length > 0) {
                var lowestScore = Number.MAX_VALUE;
                for (const currentPlayer of players) {
                    if (currentPlayer.score < lowestScore) {
                        lowestScore = currentPlayer.score;
                    }
                }
            } else {
                var lowestScore = 0
            }

            // Create a new player object
            const player = {
                name: playerName,
                score: lowestScore // Initialize the score to 0
            };

            // Add the new player to the players array
            players.push(player);

            // Create a new list item (li) to display the player info
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <span>${player.name}:</span>
                <span class="mx-4"><span id="score_${player.name}">${player.score}</span></span>
                <button class="bg-green-500 text-white p-2 mt-2 mr-2 rounded-md" onclick="addPoints('${player.name}')">+5</button>
                <button class="bg-red-500 text-white p-2 mt-2 rounded-md" onclick="subtractPoints('${player.name}')">-5</button>
            `;

            // Append the list item to the player list
            playerList.appendChild(listItem);

            // Clear the input field
            playerNameInput.value = '';
        }
    });

    

    // Event listener for the "Finish Round" button
    finishRoundButton.addEventListener('click', () => {
        
        // Create an object to store round scores
        const roundScore = {};
        roundNumber = roundNumber + 1;

        // Get scores for each player
        players.forEach(player => {
            roundScore[player.name] = player.score;
        });

        // Add the round scores to the roundScores array
        roundScores.push(roundScore);

        // Display the round scores
        displayRoundScores();

        // Reset player scores to 0
        // resetPlayerScores();

        // Clear the player list
        // clearPlayerList();

        saveDataToCookies()
    });
});

function createPlayerListItem(player){
    // Create a new list item (li) to display the player info
    const listItem = document.createElement('li');
    listItem.innerHTML = `
                <span>${player.name}:</span>
                <span class="mx-4"><span id="score_${player.name}">${player.score}</span></span>
                <button class="bg-red-500 text-white p-2 mt-2 rounded-md" onclick="subtractPoints('${player.name}')">-5</button>
                <button class="bg-green-500 text-white p-2 mt-2 mr-2 rounded-md" onclick="addPoints('${player.name}')">+5</button>
            `;
    return listItem
}

// Function to display the round scores
function displayRoundScores() {
    // Create a list item to display the round scores
    const listItem = document.createElement('li');

    listItem.textContent = `${roundNumber}: ${JSON.stringify(roundScores[roundScores.length - 1], null, 2).replace(/"([^"]+)":/g, '$1:') }`;

    // Append the list item to the round scores list
    roundScoresList.appendChild(listItem);
}

// Function to reset player scores to 0
function resetPlayerScores() {
    players.forEach(player => {
        player.score = 0;
    });
}

// Function to clear the player list
function clearPlayerList() {
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = ''; // Clear the player list
}

// Function to add 5 points to a player's score
function addPoints(playerName) {
    const scoreElement = document.getElementById(`score_${playerName}`);
    const currentScore = parseInt(scoreElement.textContent, 10);
    const newScore = currentScore + 5;
    scoreElement.textContent = newScore;

    // Update the player object's score
    const player = getPlayerByName(playerName);
    if (player) {
        player.score = newScore;
    }
}

// Function to subtract 5 points from a player's score
function subtractPoints(playerName) {
    const scoreElement = document.getElementById(`score_${playerName}`);
    const currentScore = parseInt(scoreElement.textContent, 10);
    const newScore = currentScore - 5;
    scoreElement.textContent = newScore;

    // Update the player object's score
    const player = getPlayerByName(playerName);
    if (player) {
        player.score = newScore;
    }
}

// Function to get a player by name from the players array
function getPlayerByName(playerName) {
    return players.find(player => player.name === playerName);
}

resetAllButton.addEventListener('click', () => {
    const confirmation = confirm('Are you sure you want to reset everything?');

    if (confirmation){
    // Reset all data: player names, scores, and round scores
    players.length = 0;
    roundScores.length = 0;
    roundNumber = 1;

    // Clear player input field
    clearPlayerInput();

    // Clear player list
    clearPlayerList();

    // Clear round scores list
    clearRoundScoresList();

    // Reset player scores to 0
    resetPlayerScores();

    // Clear cookies when resetting
    clearCookie('players');
    clearCookie('roundScores');
    }
});

// Function to clear the round scores list
function clearRoundScoresList() {
    const roundScoresList = document.getElementById('roundScores');
    roundScoresList.innerHTML = ''; // Clear the round scores list
}

function clearPlayerInput() {
    const playerNameInput = document.getElementById('playerName');
    playerNameInput.value = ''; // Clear the input field
}

// Function to save data to cookies
function saveDataToCookies() {
    setCookie('players', JSON.stringify(players));
    setCookie('roundScores', JSON.stringify(roundScores));
}

// Function to set a cookie
function setCookie(name, value) {
    document.cookie = `${name}=${value}; expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/`;
}

// Function to get a cookie value by name
function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [cookieName, cookieValue] = cookie.trim().split('=');
        if (cookieName === name) {
            return decodeURIComponent(cookieValue);
        }
    }
    return null;
}

// Function to clear a cookie by name
function clearCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}