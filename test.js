var macd = require('macd');
var arr = [1,2,3,4,5,6,7,8,9,10];

var answer = macd(arr, 60, 15, 9);
console.log(answer);