var macd = require('macd');
var fs = require('fs');
var log = require('../../logger');
var events = require('events');
var eventEmitter = new events.EventEmitter();
var colors = require('colors');
var common;

var currencyInfo = {};

const PERIODS = {
  long: 26 * 90,
  short: 12 * 90, 
  signal: 9 * 90 
};
const readyStack = 5;
var stack = 0;
var tradeAmount = 0;
var tickCount = 0;
var myCapInfo = {};
var myWallet;
var currArr;
var tradeInterval;
var defaultAlpha = 0;
var currentAlpha = 0;
var previousAlpha = 0;
var isAlpha = false;
var goToRiver = false;
var trackingError = 5 * 0.001; // default 0.001, 0.1% 기준


function Currency(key, name, cap, minUnits) {
  this.name = name;
  this.key = key;
  this.price = [];
  this.histogram = [];
  this.macdGraph = [];
  this.maxMacd = 0;
  this.tradeStack = 0;
  this.buyPrice = 0;
  this.sellPrice = 0;
  this.recentTradePrice = 0;
  this.startDate = 0;
  this.cap = cap;
  this.boughtPrice = 0;
  this.minTradeUnits = minUnits;
  this.tradeFailed = false;
  this.signalGraph = [];
  this.predStack = 0;
  this.minusStack = 0;
  this.plusStack = 0;
  this.isPlus = 0;
  this.initialTrade = true;
}

function Wallet(defaultMoney) {
  this.default = defaultMoney;
  this.total = 0;
  this.krw = defaultMoney;
  this.totalTradeAmount = 0;
}

var minTradeUnits = {
  BTC: 0.001,
  ETH: 0.001, 
  DASH: 0.001, 
  LTC: 0.01, 
  ETC: 0.1, 
  XRP: 10, 
  BCH: 0.001, 
  XMR: 0.01, 
  ZEC: 0.01, 
  QTUM: 0.1, 
  BTG: 0.01, 
  EOS: 0.1
}

function makeWallet(obj, cb) {
  fs.readFile('./logs/alphaCap.json', function(err, capData){
    myCapInfo = JSON.parse(decodeURIComponent(capData));
                                                                                                    
    fs.readFile('./currency.json', function(err, data) {
      var currObj = JSON.parse(decodeURIComponent(data))[0];
      currArr = Object.keys(currObj);
  
      for (var i = 0; i < currArr.length; i++) {
        obj[currArr[i]] = 0;
        var key = currArr[i];
        var cap = myCapInfo[key].cap;
        currencyInfo[key] = new Currency(key, currObj[key], cap, minTradeUnits[key]);
      }

      cb();
      
    });
  })
}

function checkTicker(currency) {
  var key = currency.key;
  var name = currency.name;
  var curPrice;
  var _histogram;
  var _macd;
  var _signal;

  fs.readFile('./logs/' + key + '.txt', 'utf8', function(err, body){
    try {
      var result = JSON.parse(body); 
      var price = currencyInfo[key].price = result.price.slice(0);
      var sellPrice = currencyInfo[key].sellPrice = result.sellPrice;
      var buyPrice = currencyInfo[key].buyPrice = result.buyPrice;

      curPrice = price.slice(-1)[0];
      prevPrice = price.slice(-2, -1)[0];

      /**
       * @param data Array.<Number> the collection of prices
       * @param slowPeriods Number=26 the size of slow periods. Defaults to 26
       * @param fastPeriods Number=12 the size of fast periods. Defaults to 12
       * @param signalPeriods Number=9 the size of periods to calculate the MACD signal line.
       * 
       * @return MACD, signal, histogram
       */
      var graph = macd(price, PERIODS.long, PERIODS.short, PERIODS.signal);
      currency.histogram = _histogram = graph.histogram.slice(0);
      currency.macdGraph = _macd = graph.MACD.slice(0);
      currency.signalGraph = _signal = graph.signal.slice(0);

      var curHisto = _histogram.slice(-1)[0];
      var prevHisto = _histogram.slice(-2, -1)[0];
      var curMacd = Math.floor(_macd.slice(-1)[0]);
      var curSignal = Math.floor(_signal.slice(-1)[0]);
      var prevMacd = Math.floor(_macd.slice(-2, -1)[0]);
      var prevSignal = Math.floor(_signal.slice(-2, -1)[0]);

      
      if(currency.maxMacd < curHisto && curHisto >= 0){
        currency.maxMacd = curHisto;
      } else if(curHisto < 0){
        currency.maxMacd = 0;
      }

      

      if(goToRiver){
        sellCoin(currency, sellPrice);
        console.log('Go to HanRIVER!'.red);
      }

      var macdDiff = curMacd - prevMacd;
      if(macdDiff > 0){
        currency.predStack++;
        currency.plusStack++;
        if (currency.plusStack > 12 && currency.predStack < 0){
          currency.predStack = 0;
        }
      } else if (macdDiff < 0){
        currency.plusStack = 0;
        currency.predStack--;
        currency.minusStack++;
        if (currency.minusStack > 12 && currency.predStack > 0){
          currency.predStack = 0;
        }
      }

      if(curHisto * prevHisto <= 0){
        currency.isPlus = curHisto >= 0 ? 1 : -1;
      }
      
      if(stack < readyStack && curHisto < 0){
        sellCoin(currency, sellPrice);
      } else if(stack > readyStack){
        if (_histogram.length > PERIODS.long && currency.tradeStack <= 0) {
          if(curHisto < 0) {
            sellCoin(currency, sellPrice);
          } else if (curHisto > 100 && currency.isPlus === 1 && currency.predStack > 0 ){
            if(myWallet.krw >= 1000 && myWallet[key] * curPrice < 200000){
                buyCoin(currency, buyPrice, curPrice);
            } 
          }        
          else if (currency.initialTrade && currency.isPlus !== -1 && curHisto > 100 && currency.predStack >= readyStack){
            buyCoin(currency, buyPrice);
            currency.initialTrade = false;
          }
        }
      }

      currentAlpha += currency.cap * curPrice;
      var histoTemplate = `${key}: ${curHisto.toFixed(2)}/${currency.maxMacd.toFixed(2)}(${Math.floor(curHisto/currency.maxMacd*100).toFixed(2)})`;
      histoTemplate += ' '.repeat(40 - histoTemplate.length);

      var diffTemplate = `diff : ${macdDiff}`;
      diffTemplate += ' '.repeat(15 - diffTemplate.length);

      var signTemplate = `combo : ${currency.predStack}`
      signTemplate += ' '.repeat(15 - signTemplate.length);

      var diff = (((curPrice / prevPrice) - 1) * 100).toFixed(2);
      var diffStr = diff >= 0 ? (diff == 0 ? diff + '%' + '('+ (curPrice - prevPrice) + ')' : (diff + '%' + '('+ (curPrice - prevPrice) + ')').green) : (diff + '%'+ '('+ (curPrice - prevPrice) + ')').red

      var isPlusStr;

      switch(currency.isPlus){
        case -1:
          isPlusStr = '(-)'.red;
          break;
        case 0:
          isPlusStr = '(*)'
          break;
        case 1:
          isPlusStr = '(+)'.green;
          break;
        default :
          isPlusStr = '(*)'
      }


      if(myWallet[key] >= currency.minTradeUnits){
        console.log(`${histoTemplate} ${diffTemplate} ${signTemplate}`.green + ` ${isPlusStr} price : ${diffStr}`);
      } else {
        console.log(`${histoTemplate} ${diffTemplate} ${signTemplate}`.red + ` ${isPlusStr} price : ${diffStr} `);
      }

      tickCount++;
      if(currency.tradeStack > 0) currency.tradeStack--;
      eventEmitter.emit('collected');
    } catch (e) {
      
     console.log(e);
      myWallet.total += myWallet[key] * currencyInfo[key].price.slice(-1)[0];
      tickCount++;
      console.log('restart server........')
      if(currency.tradeStack > 0) currency.tradeStack--;
      eventEmitter.emit('collected');
    }
  });
}

function buyCoin(currency, price, curPrice) {
  var name = currency.name;
  var key = currency.key;
  var krw = myWallet.krw;
  //var cost = krw > 10000 ? Math.floor(krw / 2) : krw;
  var cost = krw > 100000 ? Math.floor(krw/4) : myWallet.krw;
  var buyCount = parseDecimal(cost / price);
  var logMessage;


  // delay simual
  cost *= 1 + trackingError;


  if (buyCount > currency.minTradeUnits && (krw - cost) >= 0) {
    tradeAmount += cost;
    myWallet.totalTradeAmount += cost
    myWallet.krw = krw - cost;
    myWallet[key] += buyCount;
    currency.tradeStack = 5;
    currency.maxMacd = 0;
    currency.boughtPrice = price * (1 + trackingError);
    currency.tradeFailed = false;

    // for log
    logMessage = '[' + name + ']  buy ' + buyCount + '(' + currency.histogram.slice(-1)[0].toFixed(2) + ')';
    console.log(logMessage);
    log.write('trade', logMessage + '\n', true);
  }
}

function sellCoin(currency, price) {
  var name = currency.name;
  var key = currency.key;
  var sellCount = parseDecimal(myWallet[key]);
  var sellPrice;
  var profit;
  
  if (sellCount >= currency.minTradeUnits) {
    sellPrice = sellCount * price * (1 - trackingError);
    tradeAmount += sellPrice;
    myWallet.totalTradeAmount += sellPrice;
    myWallet.krw += sellPrice;
    myWallet[key] -= sellCount;
    currency.tradeStack = 5;
    currency.maxMacd = 0;
    profit = Math.floor(sellCount * (price * (1 - trackingError) - currency.boughtPrice));

    // for log
    logMessage = '[' + name + ']  sell ' +  myWallet[key] * price + '(' + currency.histogram.slice(-1)[0].toFixed(2) + ') -  Profit : ' + profit + ' won';
    console.log(logMessage);
    log.write('trade', logMessage + '\n', true);
  }
}

function checkStatus(){
  var totalMoney = (myWallet.total = getTotal());
  var fee = myWallet.totalTradeAmount * 0.00075;
  var realTotal = totalMoney - fee;
  var profitRate = (realTotal / myWallet.default - 1) * 100;
  var profitStr = profitRate >= 0 ? (profitRate.toFixed(2) + '%').green : (profitRate.toFixed(2) + '%').red;
  var date = new Date();
  var alphaChange = (((currentAlpha/defaultAlpha) -1) * 100).toFixed(2);
  var time = (date.getMonth() < 10 ? '0' + (date.getMonth() + 1) : (date.getMonth() + 1)) + '/' + date.getDate() + ' ' + date.getHours() + 'h ' + date.getMinutes() + 'm ' + date.getSeconds() + 's';
  var histogramCount = currencyInfo[currArr[0]].histogram.length;
  var readyState = (histogramCount > PERIODS.long && stack > readyStack) ? 'ok' : 'ready';
  var beta = profitRate - alphaChange;
  beta = (beta >= 0) ? (beta.toFixed(2) + '%').green : (beta.toFixed(2) + '%').red;
  var logMessage;
  var prevAlphaChange;

  if(stack <= 1){
    myWallet.startDate = date.getDate();
    defaultAlpha = previousAlpha = currentAlpha;
  }

  prevAlphaChange = (((previousAlpha/defaultAlpha) -1) * 100).toFixed(2);


  if(myWallet.startDate < date.getDate()){
    myWallet.default = totalMoney;
    myWallet.startDate = date.getDate();
    defaultAlpha = previousAlpha = currentAlpha;
    tradeAmount = 0;
  }

  if(alphaChange >= 0){
    isAlpha = !!(currentAlpha >= previousAlpha);
  } else {
    isAlpha = !!(prevAlphaChange * 8/10 <= alphaChange);
  }

  previousAlpha = Number(currentAlpha);
  currentAlpha = 0;

  var alphaChangeStr = (alphaChange >= 0) ? (alphaChange + '%').green : (alphaChange + '%').red;

  logMessage = '[' + stack + '][' + histogramCount + '][' + readyState + '] Total Money: ' + Math.floor(realTotal) + '(' + profitStr +
  ')  market: ' + alphaChangeStr + '('+ (isAlpha ? '+' : '-') +')  beta : ' + beta + '  tradeAmount : ' + Math.floor(tradeAmount) + '('+ Math.floor(myWallet.totalTradeAmount) + ')  fee: ' +  Math.floor(fee) + '  curKRW: ' + Math.floor(myWallet.krw) + ' || ' + time;

  if (stack % 10 == 0) {
    var walletStatus = '\n////////My Wallet Status ///////// \n';
    for (var i in myWallet) {
      if (i == 'default' || i == 'total') {
        walletStatus += '[' + i + '] : ' + myWallet[i] + '\n';
      } else if(myWallet[i] > 0){
        walletStatus += '[' + i + '] : ' + myWallet[i] + '\n';
      }
    }
    log.write('profitLog', walletStatus + '\b', true);
    fs.writeFile('./logs/wallet.txt', JSON.stringify(myWallet), function(){
      console.log(walletStatus);
    })  
  }

  if(stack > 0) console.log(logMessage);

  log.write('log', logMessage + '\n', true);
  stack++;

  // if(totalMoney < myWallet.default * 0.8 && stack > 1){
  //   console.log('The end, Go to the hanriver!!!');
  //   return false;
  // }


  for (var i = 0; i < currArr.length; i++){
    checkTicker(currencyInfo[currArr[i]]);
  }
}

function parseDecimal(num){
  if (num == 0){
    return 0;
  }
  
  var str = String(num);
  var arr = str.split('.');
  arr[1] = arr[1].slice(0, 4);
  
  return Number(arr.join('.'));
}

function getTotal() {
  var total = 0;
  for (var key in myWallet) {
    if (key !== 'default' && key !== 'total' && key !== 'krw' && key !== 'startDate' && key !== 'totalTradeAmount') {
      var curPrice = myWallet[key] * currencyInfo[key].price.slice(-1)[0];
      total += isNaN(curPrice) ? 0 : curPrice;
    } else if(key === 'krw') {
      total += myWallet[key];
    }
  }

  if(stack <= 2){
    myWallet.default = total;
  }

  return total;
}

function readData(){
  var i = 0;

  try {
      myWallet = JSON.parse(log.read('wallet.txt'));
      console.log('read my wallet');
      console.log('Data load Complete');
      common.on('collected1', function(){
        checkStatus();
      });
      checkStatus();
    
  } catch(e) {
    console.log('there is no wallet file');
    console.log('Data load Complete');
    common.on('collected1', function(){
      checkStatus();
    });
    checkStatus();
  }

  
}

eventEmitter.on('collected', function() {
  if (tickCount == currArr.length) {
    tickCount = 0;
  }
  tryCount = 0;
});

eventEmitter.on('inited', function() {
  console.log('inited');
  readData();
});

module.exports = {
  init: function(event, defaultMoney) {
    common = event;
    myWallet = new Wallet(defaultMoney);
    common.on('collected_init', function(){
      makeWallet(myWallet, function() {
        console.log(myWallet);
        eventEmitter.emit('inited');
      });
    })
  }
};
