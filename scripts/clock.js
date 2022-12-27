
clock()
clock()

window.setInterval(clock, 4000);
window.onresize = clock;


function clock() {

  var canvasId = 'my-canvas';
  var containerId = 'container';

  // Get the current time
  var now = new Date();

  var hour = now.getHours();
  var minute = now.getMinutes();

  // Get the first and second digits of the hours and minutes
  var hour1 = Math.floor(hour / 10);
  var hour2 = hour % 10
  var minute1 = Math.floor(minute / 10);
  var minute2 = minute % 10

  // Define some sizes
  var canvas = document.getElementById(canvasId);
  var canvasWidth = canvas.width;
  var canvasHeight = canvas.height;

  // Resize
  var container = document.getElementById(containerId);
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  var squareSizeX = Math.floor( 100 * canvasWidth / 1380 );
  var squareSizeY = Math.floor( 100 * canvasHeight / 540 );

  var squareSize = Math.min(squareSizeX, squareSizeY); //100 for reference
  // squareSize = 100;

  var squareSpace = Math.floor(squareSize / 5); // 20
  var boxSpace = Math.floor(squareSize / 2.5); // 40

  // Centre the clock
  xf = squareSize + 9 * (squareSize + squareSpace) + 3 * boxSpace - squareSpace + squareSize; // 1400 (squareSize = 100)
  yf = squareSize + 3 * (squareSize + squareSpace) - squareSpace + squareSize; // 560 (squareSize = 100)

  if (squareSizeX < squareSizeY) {
    x1 = squareSize;
    // Centre the Y direction
    y = squareSize + (canvasHeight - yf) / 2;

  } else {
    y = squareSize;
    // Centre the X direction
    x1 = squareSize + (canvasWidth - xf) / 2;
  }

  x2 = x1 + 1 * (squareSize + squareSpace) + boxSpace
  x3 = x2 + 3 * (squareSize + squareSpace) + boxSpace
  x4 = x3 + 2 * (squareSize + squareSpace) + boxSpace

  // First box
  drawGrid(canvasId, 3, 1, x1, y, squareSize, squareSpace, hour1, 'red');

  // Second box
  drawGrid(canvasId, 3, 3, x2, y, squareSize, squareSpace, hour2, 'blue');

  // Third box
  drawGrid(canvasId, 3, 2, x3, y, squareSize, squareSpace, minute1, 'green');

  // Fourth box
  drawGrid(canvasId, 3, 3, x4, y, squareSize, squareSpace, minute2, 'orange');

}


function drawGrid(canvasId, rows, columns, x0, y0, squareSize, space, Ncolored, color) {

  // Get a reference to the canvas element on the page
  var canvas = document.getElementById(canvasId);

  // Create a new drawing context for the canvas
  var context = canvas.getContext('2d');

  // Set the fill style to a color of your choice
  context.fillStyle = 'red';

  // Set the stroke style to a color of your choice
  context.strokeStyle = '#000000';

  context.lineWidth = 5;

  // I need to decide which of the rows by columns squares are going to be colored.
  // To achieve this, I create an array with as many ones as colored squares and need 
  // and zeros until I reach the size rows*columns.

  var filled = new Array(rows * columns);
  for (var i = 0; i < filled.length; i++) {
    if (i < Ncolored) {
      filled[i] = 1;
    } else {
      filled[i] = 0;
    }
  }

  // // Now, I shuffle the array to put the colored squares in random order
  filled.sort(function (a, b) {
    return Math.random() - 0.5;
  });

  // Loop over the number of squares you want to draw
  for (var row = 0; row < rows; row++) {
    for (var col = 0; col < columns; col++) {
      // Calculate the x and y position of the square
      var x = x0 + (squareSize + space) * col;
      var y = y0 + (squareSize + space) * row;

      // Check if that square should be colored
      if (filled[col * rows + row] == 1) {
        context.fillStyle = color;
      } else {
        context.fillStyle = 'white';
      }

      // Draw the square at the calculated position
      context.strokeRect(x, y, squareSize, squareSize);
      context.fillRect(x, y, squareSize, squareSize);
    }
  }

}
