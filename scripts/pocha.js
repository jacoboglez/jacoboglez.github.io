// Define the players array in the global scope
const players = []; // Array to store player objects
const roundScores = []; // Array to store round scores
const roundScoresList = document.getElementById('roundScores');
var roundNumber = 0;
const playerList = document.getElementById('playerList');

let timerValue = 15;
let countdownInterval;

// Function to start the countdown
function startCountdown() {
    const timerElement = document.getElementById('timer');
    const widgetElement = document.getElementById('widget');

    // Clear any existing interval
    clearInterval(countdownInterval);

    // Set the initial timer value and background color
    timerElement.textContent = timerValue;
    updateWidgetBackground(timerValue, widgetElement);

    // Start the countdown
    countdownInterval = setInterval(() => {
        timerValue--;
        timerElement.textContent = timerValue;

        // Update the background color
        updateWidgetBackground(timerValue, widgetElement);

        // Stop the countdown at 0
        if (timerValue <= 0) {
            clearInterval(countdownInterval);
            timerValue = 0; // Ensure timer stays at 0
        }
    }, 1000);
}

// Function to reset the timer
function resetTimer() {
    timerValue = 15; // Reset the timer value to 15
    startCountdown(); // Restart the countdown
}

// Function to update the widget's background color based on time left
function updateWidgetBackground(timeLeft, widgetElement) {
    // Remove only the background color classes, keep layout classes intact
    widgetElement.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-red-500');

    if (timeLeft <= 0) {
        widgetElement.classList.add('bg-red-500');
    } else if (timeLeft <= 5) {
        widgetElement.classList.add('bg-yellow-500');
    } else {
        widgetElement.classList.add('bg-green-500');
    }
}


// Attach the reset button functionality
document.addEventListener('DOMContentLoaded', () => {
    const resetButton = document.getElementById('resetTimer');
    resetButton.addEventListener('click', resetTimer);

    // Start the countdown when the page loads
    startCountdown();
});


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
                var lowestRank = -1;
                for (const currentPlayer of players) {
                    if (currentPlayer.score < lowestScore) {
                        lowestScore = currentPlayer.score;
                        lowestRank = currentPlayer.rank;
                    }
                }
            } else {
                var lowestScore = 0;
                var lowestRank = 1;
            }

            // Create a new player object
            const player = {
                name: playerName,
                score: lowestScore, // Initialize the score to 0
                rank: lowestRank
            };

            // Add the new player to the players array
            players.push(player);

            // Append the list item to the player list
            playerList.appendChild(createPlayerListItem(player) );

            // Clear the input field
            playerNameInput.value = '';
        }
    });

    

    // Event listener for the "Finish Round" button
    finishRoundButton.addEventListener('click', () => {
        
        clearPlayerList()

        // Create an object to store round scores
        const roundScore = {};
        roundNumber = roundNumber + 1;

        const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
        // Create list items for each player with their rank
        r = 0;
        var ant_score = 99999999999999;
        sortedPlayers.forEach((player) => {
            r = r + 1;
            if (player.score == ant_score) {
                r = r - 1;
            } 
            ant_score = player.score;
            player.rank = r;
            const listItem = createPlayerListItem(player);
            playerList.appendChild(listItem);
            roundScore[player.name] = player.score;
        });

        // // Get scores for each player
        // players.forEach(player => {
        //     roundScore[player.name] = player.score;
        // });

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
            <span">${player.rank}.</span>
                <span>${player.name}:</span>
                <span class="mx-4"><span id="score_${player.name}">${player.score}</span></span>
                <button style="touch-action: manipulation;" class="bg-red-500 text-white p-2 mt-2 rounded-md" onclick="subtractPoints('${player.name}')">-5</button>
                <button style="touch-action: manipulation;" class="bg-green-500 text-white p-2 mt-2 rounded-md" onclick="addPoints('${player.name}')">+5</button>
                <button style="touch-action: manipulation;" class="bg-green-500 text-white p-2 mt-2 mr-2 rounded-md" onclick="add10Points('${player.name}')">+10</button>
            `;
    return listItem
}

// Function to display the round scores
function displayRoundScores() {
    // Create a list item to display the round scores
    const listItem = document.createElement('li');

    listItem.textContent = `${roundNumber}: ${JSON.stringify(roundScores[roundScores.length - 1], null, 2).replace(/"([^"]+)":/g, '$1:') }`;

    // Insert at the beggining of the round scores list
    roundScoresList.insertBefore(listItem, roundScoresList.firstChild);
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

// Function to add 10 points to a player's score
function add10Points(playerName) {
    const scoreElement = document.getElementById(`score_${playerName}`);
    const currentScore = parseInt(scoreElement.textContent, 10);
    const newScore = currentScore + 10;
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